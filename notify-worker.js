const PROJECT_ID = "attrack-sync";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Must match the "30 13 * * *" entry in wrangler.toml — that's 19:00 IST
// (UTC+5:30), since Cloudflare cron triggers run on UTC.
const DAILY_REMINDER_CRON = "30 13 * * *";

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === DAILY_REMINDER_CRON) {
      ctx.waitUntil(runDailyReminders(env));
    } else {
      ctx.waitUntil(runAttendanceCheck(env));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run-check") {
      await runAttendanceCheck(env);
      return new Response("Attendance-alert check run complete.");
    }
    if (url.pathname === "/run-reminder") {
      await runDailyReminders(env);
      return new Response("Daily reminder check run complete.");
    }
    return new Response("Attrack notify-worker is alive.", { status: 200 });
  }
};

async function runAttendanceCheck(env) {
  const accessToken = await getGoogleAccessToken(env);
  const users = await listAllUsers(accessToken);
  for (const user of users) {
    try { await checkAndNotifyUser(user, accessToken, env); }
    catch (err) { console.error(`Attendance-alert check failed for user ${user.id}:`, err); }
  }
}

async function runDailyReminders(env) {
  const accessToken = await getGoogleAccessToken(env);
  const users = await listAllUsers(accessToken);
  for (const user of users) {
    try { await checkAndSendDailyReminder(user, accessToken, env); }
    catch (err) { console.error(`Daily reminder failed for user ${user.id}:`, err); }
  }
}

async function listAllUsers(accessToken) {
  let users = [];
  let pageToken = null;
  do {
    const url = new URL(`${FIRESTORE_BASE}/users`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    (data.documents || []).forEach(doc => {
      users.push({ id: doc.name.split("/").pop(), fields: firestoreToPlain(doc.fields) });
    });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return users;
}

async function checkAndNotifyUser(user, accessToken, env) {
  const { fcmToken, notifPrefs, appData } = user.fields;
  if (!fcmToken || !notifPrefs?.attendanceAlert) return;

  const lectures = appData?.lectures || [];
  const target = typeof notifPrefs.target === "number" ? notifPrefs.target : 0.75;
  const counted = lectures.filter(l => l && l.attended !== undefined && !l.isSpecial);
  const total = counted.length;
  if (total === 0) return;
  const attended = counted.filter(l => l.attended).length;
  const currentPct = attended / total;
  const pctIfNextMissed = attended / (total + 1);

  const shouldAlert = currentPct >= target && pctIfNextMissed < target;
  if (!shouldAlert) return;

  if (user.fields.notifState?.lastAlertedTotal === total) return;

  await sendPush(fcmToken, {
    title: "Attendance getting tight",
    body: `You're at ${Math.round(currentPct * 100)}%. One more missed class drops you below your ${Math.round(target * 100)}% target.`
  }, accessToken);

  await setFirestoreNestedField(user.id, "notifState.lastAlertedTotal", total, accessToken);
}

/**
 * Fires when: today (IST) has a lecture scheduled per the timetable,
 * today isn't marked a holiday, and none of today's lecture records have
 * been marked attended / not-attended yet.
 */
async function checkAndSendDailyReminder(user, accessToken, env) {
  const { fcmToken, notifPrefs, appData } = user.fields;
  if (!fcmToken || !notifPrefs?.dailyReminder) return;

  const subjects = appData?.subjects || [];
  const holidays = appData?.holidays || [];
  const lectures = appData?.lectures || [];

  const istNow = getISTNow();
  const todayIso = toISODate(istNow);
  const dow = istNow.getUTCDay(); // 0=Sun..6=Sat, as IST wall-clock day

  if (holidays.includes(todayIso)) return;

  const hasLectureToday = subjects.some(subj =>
    subj.schedule?.weeklyPattern?.some(p => p.day === dow && (p.count || 0) > 0)
  );
  if (!hasLectureToday) return;

  const todaysLectures = lectures.filter(l => l && l.date === todayIso && !l.isSpecial);
  const anyMarked = todaysLectures.some(l => l.attended !== undefined && l.attended !== null);
  if (todaysLectures.length > 0 && anyMarked) return;

  if (user.fields.notifState?.lastReminderDate === todayIso) return;

  await sendPush(fcmToken, {
    title: "Don't forget today's attendance",
    body: "You've got a lecture scheduled today and haven't marked it yet."
  }, accessToken);

  await setFirestoreNestedField(user.id, "notifState.lastReminderDate", todayIso, accessToken);
}

// IST is UTC+5:30, no DST. Workers run in UTC, so shift the epoch first,
// then read it back with UTC accessors to get IST wall-clock values.
function getISTNow() { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function toISODate(d) { return d.toISOString().slice(0, 10); }

async function sendPush(token, notification, accessToken) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, notification } })
  });
  if (!res.ok) console.error("FCM send failed:", await res.text());
}

// Updates one nested key (e.g. "notifState.lastReminderDate") without
// touching sibling keys under the same map — needed now that two different
// checks both write into notifState.
async function setFirestoreNestedField(userId, path, value, accessToken) {
  const parts = path.split(".");
  let firestoreValue = plainToFirestore(value);
  for (let i = parts.length - 1; i > 0; i--) {
    firestoreValue = { mapValue: { fields: { [parts[i]]: firestoreValue } } };
  }
  const url = `${FIRESTORE_BASE}/users/${userId}?updateMask.fieldPaths=${encodeURIComponent(path)}`;
  await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { [parts[0]]: firestoreValue } })
  });
}

function firestoreToPlain(fields) {
  if (!fields) return {};
  const out = {};
  for (const key in fields) out[key] = valueToPlain(fields[key]);
  return out;
}
function valueToPlain(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue !== undefined) return firestoreToPlain(v.mapValue.fields || {});
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(valueToPlain);
  return null;
}
function plainToFirestore(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(plainToFirestore) } };
  if (typeof value === "object") {
    const fields = {};
    for (const k in value) fields[k] = plainToFirestore(value[k]);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const encode = obj => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(env.FCM_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${arrayBufferToBase64Url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth token exchange failed: " + JSON.stringify(data));
  return data.access_token;
}

function pemToArrayBuffer(pem) {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "");
  const b64 = stripped.replace(/[^A-Za-z0-9+/=]/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function arrayBufferToBase64Url(buf) {
  let binary = "";
  new Uint8Array(buf).forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
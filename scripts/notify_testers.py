import os
import sys
import json
import time
import urllib.request
import urllib.error
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# Ensure UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.jenish.attrack"
SUBJECT = "Releasing my first app; a letter of gratitude"
DELAY_BETWEEN_EMAILS = 1.5
MARKER_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "launch_notified.json")

def check_play_store_live():
    print(f"Checking Google Play Store: {PLAY_STORE_URL}")
    req = urllib.request.Request(
        PLAY_STORE_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                print(">> Google Play Store listing is LIVE (HTTP 200)!")
                return True
    except urllib.error.HTTPError as e:
        print(f">> Play Store returned HTTP {e.code} (Not live yet)")
        return False
    except Exception as e:
        print(f">> Connection check error: {e}")
        return False
    return False

def build_email_body(person):
    return f"""Dear {person},

Today, Attrack, my first ever app has gone live on Play Store. 

I am a student pursuing Actuarial Science, noone understands what makes me passionate about app development, but I guess it is the feeling of accomplishment when I see I am solving a problem. 

11 months back, when I started this project, I did not believe in myself the slightest, about becoming an Android developer. Today I am serving more than 20 users.

I write this to you because you and 18 others were the testers of my app. Thanks to your support and testing, Google has officially approved Attrack for production!

You have truly made a difference in my life and I am ever so grateful to you for that. Who knew something as simple as this would help someone achieve a dream haha. 

Attrack is a community project. You are the community that has helped me make it a reality. 

So genuinely, 
Thank You. 

Thank you for believing in me, for giving me your email, for testing Attrack, for giving me feedback and of course --- for being there when I needed you. 

Have a wonderful day ahead, and I hope I keep bringing more projects to life. 

You can view Attrack on Google Play here:
{PLAY_STORE_URL}
and it would mean a lot to me if you could leave a 5 star rating on it :)

Kindest regards, 
Jenish,
@JenishDotOne

P.S. If you would like to join the beta for my next app, "MemStore", you can do so by replying to this email :)
"""

def main():
    force_send_str = os.environ.get("FORCE_SEND", "false").strip().lower()
    force_send = force_send_str in ["true", "1", "yes"]

    # 1. Check if already dispatched
    if os.path.exists(MARKER_FILE) and not force_send:
        print(f"Marker file exists ({MARKER_FILE}). Launch emails have already been dispatched. Exiting.")
        sys.exit(0)

    # 2. Check store status unless forced
    is_live = check_play_store_live()
    if not is_live and not force_send:
        print("Attrack is not live yet. Will re-check on next schedule.")
        sys.exit(0)

    if force_send and not is_live:
        print("WARNING: Attrack link did not return 200, but FORCE_SEND is enabled. Proceeding to send emails.")

    # 3. Read secret configuration
    raw_config = os.environ.get("LAUNCH_SECRET")
    if not raw_config:
        print("ERROR: LAUNCH_SECRET environment variable is missing.")
        sys.exit(1)

    try:
        config = json.loads(raw_config)
    except Exception as e:
        print(f"ERROR: Failed to parse LAUNCH_SECRET as JSON: {e}")
        sys.exit(1)

    sender_email = config.get("sender_email", "contactjenish.one@gmail.com")
    password = config.get("password")
    testers = config.get("testers", [])

    if not password or not testers:
        print("ERROR: Missing password or testers list in LAUNCH_SECRET.")
        sys.exit(1)

    print(f"Connecting to SMTP to notify {len(testers)} testers...")
    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465)
        server.login(sender_email, password)
        print("Connected & authenticated to Gmail SMTP.\n")
    except Exception as e:
        print(f"FATAL: SMTP Authentication failed: {e}")
        sys.exit(1)

    sent_count = 0
    failed_testers = []

    for idx, (name, email) in enumerate(testers, start=1):
        msg = MIMEMultipart()
        msg["From"] = f"Jenish <{sender_email}>"
        msg["To"] = email
        msg["Subject"] = SUBJECT

        body = build_email_body(name)
        msg.attach(MIMEText(body, "plain", "utf-8"))

        try:
            server.sendmail(sender_email, email, msg.as_string())
            print(f"[{idx}/{len(testers)}] Sent to: {name} ({email})")
            sent_count += 1
            time.sleep(DELAY_BETWEEN_EMAILS)
        except Exception as e:
            print(f"[{idx}/{len(testers)}] Failed to send to {name} ({email}): {e}")
            failed_testers.append((name, email, str(e)))

    # Also send confirmation email to Jenish
    try:
        confirm_msg = MIMEMultipart()
        confirm_msg["From"] = f"Attrack Bot <{sender_email}>"
        confirm_msg["To"] = sender_email
        confirm_msg["Subject"] = f"🚀 [Attrack Launch] {sent_count}/{len(testers)} Announcement Emails Delivered!"
        confirm_body = f"""Hi Jenish!

Attrack is LIVE on Google Play, and the automated launch announcer just finished running.

- Total Testers: {len(testers)}
- Successfully Sent: {sent_count}
- Failed: {len(failed_testers)}
- Time: {datetime.now(timezone.utc).isoformat()}
- Play Store URL: {PLAY_STORE_URL}

Congratulations on launching Attrack 1.0.0!
"""
        confirm_msg.attach(MIMEText(confirm_body, "plain", "utf-8"))
        server.sendmail(sender_email, sender_email, confirm_msg.as_string())
        print("Sent confirmation email to Jenish.")
    except Exception as e:
        print(f"Failed to send confirmation email: {e}")

    server.quit()

    # Write marker file so it doesn't send again
    os.makedirs(os.path.dirname(MARKER_FILE), exist_ok=True)
    with open(MARKER_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "dispatched_at": datetime.now(timezone.utc).isoformat(),
            "sent_count": sent_count,
            "total_count": len(testers),
            "failed_count": len(failed_testers)
        }, f, indent=2)

    # Set GitHub Actions output
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write("sent=true\n")

    print(f"\nAll done! {sent_count}/{len(testers)} emails delivered successfully.")

if __name__ == "__main__":
    main()

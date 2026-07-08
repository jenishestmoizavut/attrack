# AdSterra Ad Code Update Guide

## What Changed
AdSterra now requires using their async format instead of the old synchronous format. This prevents the "once per page" error when you have multiple ad slots.

## Step 1: Find and Update the Home Banner Ad

**Find this code** (in the "Subject overview" card or near `ads-banner-placeholder`):
```html
<div class="ads-banner-placeholder">
  <span class="ad-label">Ad</span>
  <script>
    atOptions = {
      'key' : 'YOUR_KEY_HERE',
      'format' : 'iframe',
      'height' : 50,
      'width' : 320,
      'params' : {}
    };
  </script>
  <script src="https://www.highperformanceformat.com/YOUR_KEY_HERE/invoke.js"></script>
</div>
```

**Replace with:**
```html
<div class="ads-banner-placeholder">
  <span class="ad-label">Ad</span>
  <script>
    if (typeof atAsyncOptions !== 'object') var atAsyncOptions = [];
    atAsyncOptions.push({
      key: 'YOUR_KEY_HERE',
      format: 'js',
      async: true,
      container: 'atContainer-home-banner',
      params: {},
    });
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://www.highperformanceformat.com/YOUR_KEY_HERE/invoke.js';
    document.getElementsByTagName('head')[0].appendChild(script);
  </script>
  <div id="atContainer-home-banner"></div>
</div>
```

## Step 2: Find and Update the `loadadsAd()` Function

**Find this function** (search for `function loadadsAd`):
```javascript
function loadadsAd(slotId, key) {
  const slot = document.getElementById(slotId);
  if (!slot || slot.dataset.loaded === "1") return;
  slot.dataset.loaded = "1";

  const iframe = document.createElement("iframe");
  iframe.style.border = "none";
  iframe.style.width = "320px";
  iframe.style.maxWidth = "100%";
  iframe.style.height = "50px";
  iframe.scrolling = "no";
  slot.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(
    '<body style="margin:0;padding:0;overflow:hidden;">' +
    '<script>atOptions = {"key":"' + key + '","format":"iframe","height":50,"width":320,"params":{}};<' + '/script>' +
    '<script src="https://www.highperformanceformat.com/' + key + '/invoke.js"><' + '/script>' +
    '</body>'
  );
  doc.close();
}
```

**Replace with:**
```javascript
function loadadsAd(slotId, key) {
  const slot = document.getElementById(slotId);
  if (!slot || slot.dataset.loaded === "1") return;
  slot.dataset.loaded = "1";

  const iframe = document.createElement("iframe");
  iframe.style.border = "none";
  iframe.style.width = "320px";
  iframe.style.maxWidth = "100%";
  iframe.style.height = "50px";
  iframe.scrolling = "no";
  slot.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  const containerId = "atContainer-" + slotId;
  doc.open();
  doc.write(
    '<body style="margin:0;padding:0;overflow:hidden;">' +
    '<div id="' + containerId + '"></div>' +
    '<script>' +
    'var atAsyncOptions = [];' +
    'atAsyncOptions.push({"key":"' + key + '","format":"js","async":true,"container":"' + containerId + '","params":{}});' +
    'var s = document.createElement("script");' +
    's.type = "text/javascript"; s.async = true;' +
    's.src = "https://www.highperformanceformat.com/' + key + '/invoke.js";' +
    'document.getElementsByTagName("head")[0].appendChild(s);' +
    '<' + '/script>' +
    '</body>'
  );
  doc.close();
}
```

## Key Differences Explained

| Old (Sync) | New (Async) |
|-----------|-----------|
| Sets `atOptions` object | Pushes to `atAsyncOptions` array |
| `format: 'iframe'` | `format: 'js'` |
| `document.write()` injection | Dynamic script appending to `<head>` |
| Single per-page instance only | Multiple instances per iframe OK |

## Why This Works

Each iframe has its own document with its own `<head>` and `atAsyncOptions` variable. So even though you call `loadadsAd()` multiple times (Home → Daily → Assignments → Study), each gets its own isolated "page" from AdSterra's perspective. ✅

## After Making Changes

1. Test the live site
2. Click through all tabs (Home → Daily → Assignments → Study)
3. Open DevTools (F12) → Console
4. Confirm no error messages appear
5. Ads should load cleanly in each section

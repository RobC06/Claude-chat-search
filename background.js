// background.js
// The "service worker" is a small script Chrome runs in the background for the
// extension. Its only job here is to make the toolbar icon open the side panel.

// When the extension is installed (or updated), tell Chrome that clicking the
// toolbar icon should open our side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("Could not set side panel behavior:", err));
});

// Also set it on every startup, just in case.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

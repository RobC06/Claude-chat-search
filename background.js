// background.js
// Two jobs:
//  1. Make clicking the toolbar icon open the side panel.
//  2. Keep the side panel scoped to claude.ai: it's available on claude.ai tabs
//     and disabled (closed) on every other tab, so it doesn't linger when you
//     switch away.
//
// Note: Chrome does NOT allow an extension to open the side panel on its own —
// it can only open in response to a user gesture (the toolbar click). So there
// is no true "auto-open" on visiting Claude; this only controls where the panel
// is *available*. To disable a tab we call setOptions with `enabled: false` and
// NO path — that's what actually closes an open panel on that tab.

const PANEL_PATH = "sidepanel.html";
const CLAUDE_PREFIX = "https://claude.ai/";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("Could not set side panel behavior:", err));
  reapplyAll();
});

chrome.runtime.onStartup.addListener(reapplyAll);

// Enable the panel on claude.ai tabs, disable it everywhere else.
async function applyForTab(tabId, url) {
  if (typeof tabId !== "number" || !url) return;
  try {
    if (url.startsWith(CLAUDE_PREFIX)) {
      await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (e) {
    // Some tabs (e.g. chrome:// pages) may reject setOptions; ignore.
  }
}

async function reapplyAll() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) applyForTab(t.id, t.url);
  } catch (e) {
    /* ignore */
  }
}

// Re-evaluate when the user switches tabs or a tab navigates.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    applyForTab(tab.id, tab.url);
  } catch (e) {
    /* ignore */
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    applyForTab(tabId, tab && tab.url);
  }
});

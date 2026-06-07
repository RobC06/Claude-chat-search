// background.js
// Two jobs:
//  1. Make clicking the toolbar icon open the side panel.
//  2. Restrict the side panel to claude.ai tabs (so it doesn't linger on other
//     tabs) — unless the user turns that off via the "Only on Claude.ai"
//     checkbox in the panel. The choice is saved as `showOnlyOnClaude`.
//
// Note: Chrome does NOT allow an extension to open the side panel on its own —
// it can only open in response to a click. So there is no "auto-open"; this
// just controls where the panel is *available*.

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

// Decide whether the side panel should be available on a given tab.
async function applyForTab(tabId, url) {
  if (typeof tabId !== "number" || !url) return;

  let onlyOnClaude = true;
  try {
    const r = await chrome.storage.local.get("showOnlyOnClaude");
    onlyOnClaude = r.showOnlyOnClaude !== false; // default: true
  } catch (e) {
    /* keep default */
  }

  const enabled = !onlyOnClaude || url.startsWith(CLAUDE_PREFIX);
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled });
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

// When the checkbox flips the setting, re-apply everywhere immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.showOnlyOnClaude) reapplyAll();
});

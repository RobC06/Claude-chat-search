// background.js
// Keeps the side panel scoped to claude.ai and makes it actually disappear when
// you switch to any other tab.
//
// Why it's done this way: if you let Chrome open the panel on the action click
// (openPanelOnActionClick) while a global `default_path` is set in the manifest,
// the panel opens in GLOBAL mode — and a globally-opened panel does NOT close
// when you switch to a tab where it's disabled. That's the "it won't go away"
// bug. So instead we open the panel ourselves, per tab, with
// `sidePanel.open({ tabId })`. A tab-scoped panel only lives on its own tab and
// genuinely hides when you switch away. There is no global `default_path`.
//
// Note: Chrome only allows opening the side panel in response to a user gesture,
// so there's no true auto-open — you click the toolbar icon on a Claude tab.

const PANEL_PATH = "sidepanel.html";
const CLAUDE_PREFIX = "https://claude.ai/";

function isClaude(url) {
  return typeof url === "string" && url.startsWith(CLAUDE_PREFIX);
}

// We open the panel ourselves, so the toolbar click should come to us.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});

// Keep each tab's panel availability in sync with whether it's a Claude tab.
async function applyForTab(tabId, url) {
  if (typeof tabId !== "number") return;
  try {
    if (isClaude(url)) {
      await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (e) {
    // chrome:// and similar tabs may reject setOptions; ignore.
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

chrome.runtime.onInstalled.addListener(reapplyAll);
chrome.runtime.onStartup.addListener(reapplyAll);

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

// Toolbar click: open the panel only on Claude tabs. open() must run inside the
// user gesture, so don't await anything before it.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !isClaude(tab.url)) return;
  chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

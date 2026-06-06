// sidepanel.js
// The logic for the search panel: syncing chats, searching them, and showing
// results. Runs in the extension's own context, so it can read/write our
// browser database (db.js) and talk to the content script on Claude.ai.

// Grab the page elements we'll update.
const els = {
  syncBtn: document.getElementById("syncBtn"),
  count: document.getElementById("count"),
  status: document.getElementById("status"),
  progressWrap: document.getElementById("progressWrap"),
  progressBar: document.getElementById("progressBar"),
  searchInput: document.getElementById("searchInput"),
  results: document.getElementById("results"),
  emptyState: document.getElementById("emptyState"),
};

// An in-memory copy of all conversations, so searching is instant as you type.
let CACHE = [];
let syncing = false;

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
init();

async function init() {
  await refreshCache();
  els.searchInput.addEventListener("input", () => render(els.searchInput.value));
  els.syncBtn.addEventListener("click", startSync);
}

async function refreshCache() {
  CACHE = await getAllConversations();
  updateCount();
}

function updateCount() {
  els.count.textContent = CACHE.length
    ? `${CACHE.length} chats indexed`
    : "no chats yet";
}

// ---------------------------------------------------------------------------
// Syncing: ask the Claude.ai tab to download all chats to us.
// ---------------------------------------------------------------------------
async function startSync() {
  if (syncing) return;

  const tab = await getClaudeTab();
  if (!tab) {
    showStatus(
      "Please open claude.ai in a tab and make sure you're logged in, then click Sync again.",
      true
    );
    // Offer to open it for them.
    chrome.tabs.create({ url: "https://claude.ai/" });
    return;
  }

  syncing = true;
  els.syncBtn.disabled = true;
  showStatus("Starting…");
  showProgress(0);

  try {
    // Make sure the content script is present, then kick off the sync.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    }
    await chrome.tabs.sendMessage(tab.id, { type: "START_SYNC" });
  } catch (err) {
    finishSync();
    showStatus(`Couldn't start sync: ${err.message}`, true);
  }
}

function finishSync() {
  syncing = false;
  els.syncBtn.disabled = false;
  hideProgress();
}

// Find an open Claude.ai tab to run the download in.
async function getClaudeTab() {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  return tabs[0] || null;
}

// Listen for progress + data coming back from the content script.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  switch (msg.type) {
    case "SYNC_STATUS":
      showStatus(msg.message);
      break;
    case "SYNC_PROGRESS":
      if (msg.total) showProgress(Math.round((msg.done / msg.total) * 100));
      break;
    case "SYNC_CONVERSATION":
      putConversation(msg.conversation).catch((e) =>
        console.error("Failed to save conversation:", e)
      );
      break;
    case "SYNC_DONE":
      finishSync();
      showStatus(`Done. Synced ${msg.total} conversations.`);
      chrome.storage.local.set({ lastSync: Date.now() });
      refreshCache().then(() => render(els.searchInput.value));
      break;
    case "SYNC_ERROR":
      finishSync();
      showStatus(`Sync error: ${msg.error}`, true);
      break;
  }
});

// ---------------------------------------------------------------------------
// Status + progress helpers
// ---------------------------------------------------------------------------
function showStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.remove("hidden");
  els.status.classList.toggle("error", isError);
}

function showProgress(pct) {
  els.progressWrap.classList.remove("hidden");
  els.progressBar.style.width = `${pct}%`;
}

function hideProgress() {
  els.progressWrap.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------
function render(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (!terms.length) {
    els.results.innerHTML = "";
    els.results.appendChild(els.emptyState);
    els.emptyState.classList.remove("hidden");
    return;
  }

  const matches = [];
  for (const conv of CACHE) {
    // A conversation matches only if it contains every search word.
    if (!terms.every((t) => conv.searchText.includes(t))) continue;

    // Score by how many times the words appear, so the best chats float up.
    let score = 0;
    for (const t of terms) score += conv.searchText.split(t).length - 1;

    matches.push({ conv, score, snippet: bestSnippet(conv, terms) });
  }

  matches.sort((a, b) => b.score - a.score);
  paint(matches.slice(0, 100), query, matches.length);
}

// Find the most relevant chunk of text in a conversation to preview.
function bestSnippet(conv, terms) {
  const firstTerm = terms[0];
  for (const m of conv.messages) {
    const idx = m.text.toLowerCase().indexOf(firstTerm);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(m.text.length, idx + 140);
      const frag =
        (start > 0 ? "…" : "") +
        m.text.slice(start, end) +
        (end < m.text.length ? "…" : "");
      return { role: m.role, html: highlight(frag, terms) };
    }
  }
  return { role: null, html: escapeHtml(conv.name) };
}

function paint(matches, query, totalCount) {
  els.results.innerHTML = "";

  if (!matches.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = `No chats matching “${query}”.`;
    els.results.appendChild(p);
    return;
  }

  for (const { conv, snippet } of matches) {
    const a = document.createElement("a");
    a.className = "result";
    a.href = conv.url;
    a.target = "_blank";
    a.rel = "noopener";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = conv.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    if (conv.projectName) {
      const proj = document.createElement("span");
      proj.className = "project";
      proj.textContent = conv.projectName;
      meta.appendChild(proj);
    }
    if (conv.updatedAt) {
      meta.appendChild(
        document.createTextNode(new Date(conv.updatedAt).toLocaleDateString())
      );
    }

    const snip = document.createElement("div");
    snip.className = "snippet";
    snip.innerHTML = (snippet.role ? `<strong>${snippet.role}:</strong> ` : "") + snippet.html;

    a.appendChild(title);
    if (meta.childNodes.length) a.appendChild(meta);
    a.appendChild(snip);
    els.results.appendChild(a);
  }
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[c]);
}

function highlight(text, terms) {
  let html = escapeHtml(text);
  for (const t of terms) {
    const safe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(${safe})`, "ig"), "<mark>$1</mark>");
  }
  return html;
}

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
  regexToggle: document.getElementById("regexToggle"),
  roleSelect: document.getElementById("roleSelect"),
  projectSelect: document.getElementById("projectSelect"),
  sortSelect: document.getElementById("sortSelect"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  searchError: document.getElementById("searchError"),
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
  els.searchInput.addEventListener("input", render);
  // Any filter/sort change re-runs the search.
  for (const el of [
    els.regexToggle,
    els.roleSelect,
    els.projectSelect,
    els.sortSelect,
    els.fromDate,
    els.toDate,
  ]) {
    el.addEventListener("change", render);
  }
  els.syncBtn.addEventListener("click", startSync);
}

async function refreshCache() {
  CACHE = await getAllConversations();
  updateCount();
  populateProjectFilter();
}

function updateCount() {
  els.count.textContent = CACHE.length
    ? `${CACHE.length} chats indexed`
    : "no chats yet";
}

// Build the project dropdown from whatever projects appear in the data.
function populateProjectFilter() {
  const current = els.projectSelect.value;
  const projects = new Map(); // id -> name
  for (const conv of CACHE) {
    if (conv.projectId) projects.set(conv.projectId, conv.projectName || "Project");
  }
  // Reset to the two fixed options, then add discovered projects (sorted).
  els.projectSelect.length = 2; // keep "Any project" and "No project"
  [...projects.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      els.projectSelect.appendChild(opt);
    });
  // Restore the previous selection if it still exists.
  els.projectSelect.value = [...els.projectSelect.options].some((o) => o.value === current)
    ? current
    : "any";
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
    chrome.tabs.create({ url: "https://claude.ai/" });
    return;
  }

  syncing = true;
  els.syncBtn.disabled = true;
  showStatus("Starting…");
  showProgress(0);

  try {
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
      refreshCache().then(render);
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
// Query parsing — turns the raw text box into something we can match with.
// Supports: plain words (AND), "quoted phrases", or full regex (when toggled).
// ---------------------------------------------------------------------------
function buildQuery(raw, regexMode) {
  const text = raw.trim();
  if (!text) return { type: "empty" };

  if (regexMode) {
    try {
      return { type: "regex", raw: text, re: new RegExp(text, "i") };
    } catch (e) {
      return { type: "invalid", error: e.message };
    }
  }

  // Pull out "quoted phrases" as single terms, then the leftover words.
  const phrases = [];
  const leftover = text.replace(/"([^"]+)"/g, (_, p) => {
    phrases.push(p.toLowerCase());
    return " ";
  });
  const words = leftover.toLowerCase().split(/\s+/).filter(Boolean);
  const terms = [...phrases, ...words];
  return terms.length ? { type: "terms", terms } : { type: "empty" };
}

// Count how many times `needle` appears in `haystack`.
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

// Returns a match "score" (number of hits) for a query against some text,
// or 0 if it doesn't match. For plain terms, ALL terms must be present (AND).
function scoreText(query, text) {
  if (query.type === "regex") {
    const m = text.match(new RegExp(query.raw, "ig"));
    return m ? m.length : 0;
  }
  if (query.type === "terms") {
    let score = 0;
    for (const t of query.terms) {
      const c = countOccurrences(text, t);
      if (c === 0) return 0;
      score += c;
    }
    return score;
  }
  return 0;
}

// Which messages count for the current "whose messages" filter.
function messagesForRole(conv, roleFilter) {
  if (roleFilter === "any") return conv.messages;
  const role = roleFilter === "you" ? "You" : "Claude";
  return conv.messages.filter((m) => m.role === role);
}

// The lowercased text we actually search, respecting the role filter.
function scopeText(conv, roleFilter) {
  if (roleFilter === "any") return conv.searchText;
  return messagesForRole(conv, roleFilter)
    .map((m) => m.text)
    .join("\n")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Searching + rendering
// ---------------------------------------------------------------------------
function render() {
  const regexMode = els.regexToggle.checked;
  const roleFilter = els.roleSelect.value;
  const projectFilter = els.projectSelect.value;
  const sortMode = els.sortSelect.value;
  const fromTime = els.fromDate.value ? new Date(els.fromDate.value).getTime() : null;
  // Include the whole "to" day by adding ~24h.
  const toTime = els.toDate.value
    ? new Date(els.toDate.value).getTime() + 24 * 60 * 60 * 1000
    : null;

  const query = buildQuery(els.searchInput.value, regexMode);

  // Show/clear any regex error.
  if (query.type === "invalid") {
    els.searchError.textContent = `Invalid regex: ${query.error}`;
    els.searchError.classList.remove("hidden");
    return;
  }
  els.searchError.classList.add("hidden");

  const hasQuery = query.type === "terms" || query.type === "regex";
  const hasFilter =
    projectFilter !== "any" || roleFilter !== "any" || fromTime || toTime;

  if (!hasQuery && !hasFilter) {
    showEmptyHint();
    return;
  }

  const matches = [];
  for (const conv of CACHE) {
    // --- project filter ---
    if (projectFilter === "none" && conv.projectId) continue;
    if (projectFilter !== "any" && projectFilter !== "none" && conv.projectId !== projectFilter)
      continue;

    // --- date filter (by last-updated, falling back to created) ---
    const when = conv.updatedAt || conv.createdAt;
    const t = when ? new Date(when).getTime() : null;
    if (fromTime && (t === null || t < fromTime)) continue;
    if (toTime && (t === null || t >= toTime)) continue;

    // --- role filter without a query: require at least one such message ---
    if (!hasQuery) {
      if (roleFilter !== "any" && messagesForRole(conv, roleFilter).length === 0) continue;
      matches.push({ conv, score: 0, snippet: previewSnippet(conv) });
      continue;
    }

    // --- text match (respecting role scope) ---
    const score = scoreText(query, scopeText(conv, roleFilter));
    if (score === 0) continue;
    matches.push({ conv, score, snippet: bestSnippet(conv, query, roleFilter) });
  }

  // Sort: by recency if asked, or whenever there's no query to rank by.
  if (sortMode === "recent" || !hasQuery) {
    matches.sort((a, b) => recency(b.conv) - recency(a.conv));
  } else {
    matches.sort((a, b) => b.score - a.score);
  }

  paint(matches.slice(0, 200), hasQuery);
}

function recency(conv) {
  const when = conv.updatedAt || conv.createdAt;
  return when ? new Date(when).getTime() : 0;
}

// A generic preview (first message) for filter-only browsing.
function previewSnippet(conv) {
  const first = conv.messages.find((m) => m.text.trim());
  if (!first) return { role: null, html: escapeHtml(conv.name) };
  const frag = first.text.slice(0, 180) + (first.text.length > 180 ? "…" : "");
  return { role: first.role, html: escapeHtml(frag) };
}

// Find the most relevant chunk of a conversation to preview.
function bestSnippet(conv, query, roleFilter) {
  const msgs = messagesForRole(conv, roleFilter);
  for (const m of msgs) {
    const idx = firstHitIndex(m.text, query);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(m.text.length, idx + 140);
      const frag =
        (start > 0 ? "…" : "") +
        m.text.slice(start, end) +
        (end < m.text.length ? "…" : "");
      return { role: m.role, html: highlight(frag, query) };
    }
  }
  return { role: null, html: escapeHtml(conv.name) };
}

// Index of the first match of the query within a piece of text (-1 if none).
function firstHitIndex(text, query) {
  if (query.type === "regex") {
    const m = text.match(query.re);
    return m ? m.index : -1;
  }
  const lower = text.toLowerCase();
  let best = -1;
  for (const t of query.terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

function paint(matches, hasQuery) {
  els.results.innerHTML = "";

  if (!matches.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No chats match your search and filters.";
    els.results.appendChild(p);
    return;
  }

  for (const { conv, score, snippet } of matches) {
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
        document.createTextNode(new Date(conv.updatedAt).toLocaleDateString() + " ")
      );
    }
    if (hasQuery && score > 0) {
      const m = document.createElement("span");
      m.className = "matches";
      m.textContent = `${score} match${score === 1 ? "" : "es"}`;
      meta.appendChild(m);
    }

    const snip = document.createElement("div");
    snip.className = "snippet";
    snip.innerHTML =
      (snippet.role ? `<strong>${snippet.role}:</strong> ` : "") + snippet.html;

    a.appendChild(title);
    if (meta.childNodes.length) a.appendChild(meta);
    a.appendChild(snip);
    els.results.appendChild(a);
  }
}

function showEmptyHint() {
  els.results.innerHTML = "";
  els.emptyState.classList.remove("hidden");
  els.results.appendChild(els.emptyState);
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

// Highlight matches inside a snippet. Works for both plain terms and regex.
function highlight(text, query) {
  if (query.type === "regex") {
    let html = "";
    let last = 0;
    const re = new RegExp(query.raw, "ig");
    let m;
    while ((m = re.exec(text)) !== null) {
      html += escapeHtml(text.slice(last, m.index));
      html += `<mark>${escapeHtml(m[0])}</mark>`;
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on empty match
    }
    html += escapeHtml(text.slice(last));
    return html;
  }

  let html = escapeHtml(text);
  for (const t of query.terms) {
    const safe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(${safe})`, "ig"), "<mark>$1</mark>");
  }
  return html;
}

// sidepanel.js
// The logic for the search panel: syncing chats, searching them, and showing
// results. Runs in the extension's own context, so it can read/write our
// browser database (db.js) and talk to the content script on Claude.ai.

// Grab the page elements we'll update.
const els = {
  syncLink: document.getElementById("syncLink"),
  chatCount: document.getElementById("chatCount"),
  status: document.getElementById("status"),
  progressWrap: document.getElementById("progressWrap"),
  progressBar: document.getElementById("progressBar"),
  lastSync: document.getElementById("lastSync"),
  searchInput: document.getElementById("searchInput"),
  results: document.getElementById("results"),
  regexToggle: document.getElementById("regexToggle"),
  roleSelect: document.getElementById("roleSelect"),
  projectBtn: document.getElementById("projectBtn"),
  projectLabel: document.getElementById("projectLabel"),
  projectMenu: document.getElementById("projectMenu"),
  projectList: document.getElementById("projectList"),
  projectNone: document.getElementById("projectNone"),
  projectAllBox: document.getElementById("projectAllBox"),
  projectClear: document.getElementById("projectClear"),
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

// Start in light mode, then immediately check what claude.ai is showing and
// switch to match. Light is the safe default (it's Claude's default too), so if
// the check is ever delayed we fail to light rather than a wrong dark.
applyTheme(false);
refreshTheme();

init();

async function init() {
  await refreshCache();

  const { lastSync } = await chrome.storage.local.get("lastSync");
  updateLastSync(lastSync);

  els.searchInput.addEventListener("input", render);
  // Any filter/sort change re-runs the search.
  for (const el of [
    els.regexToggle,
    els.roleSelect,
    els.sortSelect,
    els.fromDate,
    els.toDate,
  ]) {
    el.addEventListener("change", render);
  }

  // Project multi-select dropdown: open/close and outside-click to close.
  els.projectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const closed = els.projectMenu.classList.toggle("hidden");
    els.projectBtn.setAttribute("aria-expanded", String(!closed));
  });
  els.projectMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    els.projectMenu.classList.add("hidden");
    els.projectBtn.setAttribute("aria-expanded", "false");
  });
  // "No project" is independent of the projects (project checkboxes are wired
  // when created in populateProjectFilter).
  els.projectNone.addEventListener("change", onProjectChange);
  // "All projects" is a select-all toggle for the individual projects only.
  els.projectAllBox.addEventListener("change", () => {
    const on = els.projectAllBox.checked;
    projectBoxes().forEach((b) => (b.checked = on));
    updateProjectLabel();
    render();
  });
  els.projectClear.addEventListener("click", () => {
    els.projectNone.checked = false;
    els.projectAllBox.checked = false;
    projectBoxes().forEach((b) => (b.checked = false));
    updateProjectLabel();
    render();
  });
  els.syncLink.addEventListener("click", (e) => {
    e.preventDefault();
    startSync(false);
  });

  // Keep an open panel fresh: refresh when it regains focus / becomes visible,
  // and on a gentle timer while it stays open. All incremental, so it's cheap.
  window.addEventListener("focus", onActive);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onActive();
  });
  setInterval(maybeAutoSync, 20 * 1000);

  // React promptly when a claude.ai tab navigates (e.g. you start a new chat,
  // which changes its URL, or you toggle Claude's theme) — refresh data + theme.
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    const url = (tab && tab.url) || changeInfo.url || "";
    if (url.startsWith("https://claude.ai/") &&
        (changeInfo.url || changeInfo.status === "complete")) {
      maybeAutoSync();
      refreshTheme();
    }
  });

  // And refresh once right now, as the panel opens.
  onActive();
}

// Things to do whenever the panel becomes active: refresh data and match theme.
function onActive() {
  maybeAutoSync();
  refreshTheme();
}

// Mirror the side panel's light/dark theme to claude.ai's current theme.
// Retries briefly because, just after the panel opens, the Claude tab's content
// script may not be ready to answer yet — without this the theme can get stuck.
async function refreshTheme(retries = 5) {
  try {
    const tab = await getClaudeTab();
    if (!tab) return; // no Claude tab open: keep the light default
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_THEME" });
    if (resp && resp.theme) {
      applyTheme(resp.theme === "dark");
      return;
    }
  } catch (e) {
    // Content script not ready yet; fall through to retry.
  }
  if (retries > 0) setTimeout(() => refreshTheme(retries - 1), 300);
}

function applyTheme(isDark) {
  document.documentElement.classList.toggle("dark", isDark);
}

// Run an automatic (incremental) sync, but no more often than every 10s, so
// rapid focus changes don't trigger a flurry of syncs.
let lastAutoSyncAt = 0;
function maybeAutoSync() {
  if (syncing) return;
  if (Date.now() - lastAutoSyncAt < 5 * 1000) return;
  lastAutoSyncAt = Date.now();
  startSync(true);
}

async function refreshCache() {
  CACHE = await getAllConversations();
  updateChatCount();
  populateProjectFilter();
}

function updateChatCount() {
  const n = CACHE.length;
  els.chatCount.textContent = `${n} chat${n === 1 ? "" : "s"} synced`;
}

// The individual per-project checkboxes (NOT "No project" or "All projects").
function projectBoxes() {
  return [...els.projectList.querySelectorAll('input[type="checkbox"]')];
}

// The values that actually filter results: "none" (for project-less chats)
// plus the ids of any ticked projects. "All projects" is just a UI toggle.
function selectedProjectValues() {
  const vals = [];
  if (els.projectNone.checked) vals.push("none");
  projectBoxes()
    .filter((b) => b.checked)
    .forEach((b) => vals.push(b.value));
  return vals;
}

// Keep the "All projects" box in sync: ticked only when every project is ticked.
function syncAllBox() {
  const boxes = projectBoxes();
  els.projectAllBox.checked = boxes.length > 0 && boxes.every((b) => b.checked);
}

// Update the button label to reflect the current selection.
function updateProjectLabel() {
  const names = [];
  if (els.projectNone.checked) names.push("No project");
  const boxes = projectBoxes();
  const checkedProjects = boxes.filter((b) => b.checked);
  const allProjects = boxes.length > 0 && checkedProjects.length === boxes.length;

  if (names.length === 0 && checkedProjects.length === 0) {
    els.projectLabel.textContent = "Any project";
  } else if (allProjects && names.length === 0) {
    els.projectLabel.textContent = "All projects";
  } else {
    const total = names.length + checkedProjects.length;
    els.projectLabel.textContent =
      total === 1
        ? names[0] || checkedProjects[0].closest("label").textContent.trim()
        : `${total} projects`;
  }
}

// A project box was toggled: keep "All projects" in sync, refresh label + results.
function onProjectChange() {
  syncAllBox();
  updateProjectLabel();
  render();
}

// Build the per-project checkboxes from whatever projects appear in the data,
// keeping any selections the user already made.
function populateProjectFilter() {
  const prevSelected = new Set(
    projectBoxes()
      .filter((b) => b.checked)
      .map((b) => b.value)
  );
  const projects = new Map(); // id -> name
  for (const conv of CACHE) {
    if (conv.projectId) projects.set(conv.projectId, conv.projectName || "Project");
  }
  els.projectList.innerHTML = "";
  [...projects.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = id;
      if (prevSelected.has(id)) cb.checked = true;
      cb.addEventListener("change", onProjectChange);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + name));
      els.projectList.appendChild(label);
    });
  syncAllBox();
  updateProjectLabel();
}

// ---------------------------------------------------------------------------
// Syncing: ask the Claude.ai tab to download all chats to us.
// ---------------------------------------------------------------------------

// Whether the CURRENT sync should show visible progress (the bar + status text).
// Background auto-syncs stay silent to avoid a distracting "jump"; manual syncs
// and the very first full sync (empty cache) show progress.
let currentSyncVisible = false;

async function startSync(auto = false) {
  if (syncing) return;

  const tab = await getClaudeTab();
  if (!tab) {
    if (auto) {
      // On auto-open we don't nag or force-open a tab — just hint.
      els.lastSync.textContent = "Open claude.ai to refresh";
      return;
    }
    showStatus(
      "Please open claude.ai in a tab and make sure you're logged in, then click Sync again.",
      true
    );
    chrome.tabs.create({ url: "https://claude.ai/" });
    return;
  }

  syncing = true;
  currentSyncVisible = !auto || CACHE.length === 0;
  if (currentSyncVisible) {
    showStatus(auto ? "Refreshing…" : "Starting…");
    showProgress(0);
  }

  try {
    await ensureContentScript(tab.id);
    // Tell the content script what we already have, so it only fetches changes.
    const known = {};
    for (const c of CACHE) known[c.id] = c.updatedAt || "";
    await chrome.tabs.sendMessage(tab.id, { type: "START_SYNC", known });
  } catch (err) {
    finishSync();
    showStatus(`Couldn't start sync: ${err.message}`, true);
  }
}

// Make sure our content script is running in the claude.ai tab.
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

// Rename a chat from the panel. This writes to Claude's servers, so we ask the
// user to confirm the new name first (the prompt is the confirmation step).
async function renameChat(conv) {
  const entered = window.prompt("Rename this chat to:", conv.name);
  if (entered === null) return; // user cancelled
  const newName = entered.trim();
  if (!newName || newName === conv.name) return;

  const tab = await getClaudeTab();
  if (!tab) {
    showStatus("Open claude.ai in a tab first, then try renaming again.", true);
    return;
  }

  try {
    await ensureContentScript(tab.id);
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: "RENAME",
      orgId: conv.orgId || null,
      convId: conv.id,
      name: newName,
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || "unknown error");

    // Update our local copy so search reflects the new name right away.
    conv.name = newName;
    await putConversation(conv);
    showStatus(`Renamed to “${newName}”.`);
    render();
  } catch (err) {
    showStatus(`Rename failed: ${err.message}`, true);
  }
}

function finishSync() {
  syncing = false;
  hideProgress();
}

// Wrap up a sync: drop chats deleted on Claude, save the time, report results.
async function handleSyncDone(msg) {
  finishSync();

  let removed = 0;
  if (Array.isArray(msg.allIds)) {
    const keep = new Set(msg.allIds);
    const gone = CACHE.filter((c) => !keep.has(c.id));
    await Promise.all(gone.map((c) => deleteConversation(c.id)));
    removed = gone.length;
  }

  const now = Date.now();
  await chrome.storage.local.set({ lastSync: now });
  await refreshCache();

  // Don't rebuild the results list out from under an active search on a silent
  // background sync — it would shift what you're reading. The count still
  // updates quietly; results refresh next time you change the query.
  const searching = els.searchInput.value.trim().length > 0;
  if (currentSyncVisible || !searching) render();

  updateLastSync(now);

  // Only surface the "Synced — …" summary for visible (manual / first) syncs.
  if (currentSyncVisible) {
    const parts = [];
    if (msg.fetched) parts.push(`${msg.fetched} updated`);
    if (removed) parts.push(`${removed} removed`);
    showStatus(parts.length ? `Synced — ${parts.join(", ")}.` : "Already up to date.");
    // This is just confirmation that the manual sync finished — "Last synced"
    // already shows the lasting state, so fade the summary out shortly.
    statusHideTimer = setTimeout(hideStatus, 4000);
  }
}

// Show a friendly "Last synced: …" line.
function updateLastSync(ts) {
  els.lastSync.textContent = ts ? `Last synced: ${relativeTime(ts)}` : "";
}

function relativeTime(ts) {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(ts).toLocaleString();
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
      if (currentSyncVisible) showStatus(msg.message);
      break;
    case "SYNC_PROGRESS":
      if (currentSyncVisible && msg.total)
        showProgress(Math.round((msg.done / msg.total) * 100));
      break;
    case "SYNC_CONVERSATION":
      putConversation(msg.conversation).catch((e) =>
        console.error("Failed to save conversation:", e)
      );
      break;
    case "SYNC_DONE":
      handleSyncDone(msg);
      break;
    case "SYNC_ERROR":
      finishSync();
      if (currentSyncVisible) showStatus(`Sync error: ${msg.error}`, true);
      break;
  }
});

// ---------------------------------------------------------------------------
// Status + progress helpers
// ---------------------------------------------------------------------------
let statusHideTimer = null;

function showStatus(message, isError = false) {
  // A fresh message cancels any pending auto-hide (e.g. live progress updates).
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  els.status.textContent = message;
  els.status.classList.remove("hidden");
  els.status.classList.toggle("error", isError);
}

function hideStatus() {
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  els.status.classList.add("hidden");
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
  const selectedProjects = new Set(selectedProjectValues());
  const projectActive = selectedProjects.size > 0;
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
    projectActive || roleFilter !== "any" || fromTime || toTime;

  if (!hasQuery && !hasFilter) {
    showEmptyHint();
    return;
  }

  const matches = [];
  for (const conv of CACHE) {
    // --- project filter (match any of the ticked projects; "none" = no project) ---
    if (projectActive) {
      const inSelection = conv.projectId
        ? selectedProjects.has(conv.projectId)
        : selectedProjects.has("none");
      if (!inSelection) continue;
    }

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

    // Rename button — clicking it must not follow the result link.
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "rename-btn";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      renameChat(conv);
    });
    meta.appendChild(renameBtn);

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
  // Nothing to show until the user types or sets a filter.
  els.results.innerHTML = "";
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

// files.js
// The "Project Files" tab: list and search the files inside your Claude projects.
// Two sources per project:
//   • CORE  — project knowledge "docs" (carry their text, so they're searchable
//             inside) plus any uploaded project files.
//   • Chats — files attached inside that project's conversations (from the data
//             the chat sync already collected; see content.js).
// Reuses globals from sidepanel.js: CACHE, getClaudeTab, ensureContentScript,
// escapeHtml, highlight.

(function () {
  // ---- elements -----------------------------------------------------------
  const el = {
    tabChats: document.getElementById("tabChats"),
    tabFiles: document.getElementById("tabFiles"),
    chatsView: document.getElementById("chatsView"),
    filesView: document.getElementById("filesView"),

    msg1: document.getElementById("fMsg1"),
    msg2: document.getElementById("fMsg2"),

    projBtn: document.getElementById("fProjectBtn"),
    projLabel: document.getElementById("fProjectLabel"),
    projMenu: document.getElementById("fProjectMenu"),
    projList: document.getElementById("fProjectList"),
    projAll: document.getElementById("fProjectAllBox"),
    projClear: document.getElementById("fProjectClear"),

    modeList: document.getElementById("fModeList"),
    modeSearch: document.getElementById("fModeSearch"),
    modeListLbl: document.getElementById("fModeListLbl"),
    modeSearchLbl: document.getElementById("fModeSearchLbl"),

    searchBox: document.getElementById("fSearchBox"),
    searchInput: document.getElementById("fSearchInput"),
    insideWrap: document.getElementById("fInsideWrap"),
    insideDocs: document.getElementById("fInsideDocs"),
    show: document.getElementById("fShow"),
    sortWrap: document.getElementById("fSortWrap"),
    sort: document.getElementById("fSort"),

    listHead: document.getElementById("fListHead"),
    results: document.getElementById("fResults"),
  };

  // ---- state --------------------------------------------------------------
  let inited = false; // have we loaded projects + detected current one yet
  let projects = []; // [{id, name, orgId}]
  const projectsById = new Map();
  const selectedIds = new Set(); // which projects are in scope
  const fileCache = new Map(); // projectId -> {docs:[], files:[], error?}
  let currentProject = null; // {id, name} the user is currently viewing, if any

  // ---- talking to the Claude tab -----------------------------------------
  async function tabMsg(payload) {
    const tab = await getClaudeTab();
    if (!tab) throw new Error("Open claude.ai in a tab first.");
    await ensureContentScript(tab.id);
    return chrome.tabs.sendMessage(tab.id, payload);
  }

  async function activeClaudeUrl() {
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (t && t.url && t.url.startsWith("https://claude.ai/")) return t.url;
    } catch (e) {}
    const t = await getClaudeTab();
    return t ? t.url : null;
  }

  // Work out which project (if any) the user is currently looking at.
  async function detectCurrentProject() {
    const url = await activeClaudeUrl();
    if (!url) return null;
    let m = url.match(/claude\.ai\/projects?\/([0-9a-fA-F-]+)/);
    if (m) {
      const p = projectsById.get(m[1]);
      return p ? { id: p.id, name: p.name } : { id: m[1], name: "this project" };
    }
    m = url.match(/claude\.ai\/chat\/([0-9a-fA-F-]+)/);
    if (m) {
      const conv = CACHE.find((c) => c.id === m[1]);
      if (conv && conv.projectId) {
        const p = projectsById.get(conv.projectId);
        return { id: conv.projectId, name: (p && p.name) || conv.projectName || "this project" };
      }
    }
    return null;
  }

  // ---- tab switching ------------------------------------------------------
  function showTab(which) {
    const files = which === "files";
    el.tabFiles.classList.toggle("active", files);
    el.tabChats.classList.toggle("active", !files);
    el.filesView.classList.toggle("hidden", !files);
    el.chatsView.classList.toggle("hidden", files);
    if (files && !inited) initFilesTab();
  }
  el.tabChats.addEventListener("click", () => showTab("chats"));
  el.tabFiles.addEventListener("click", () => showTab("files"));

  // ---- first-time setup for the files tab --------------------------------
  async function initFilesTab() {
    inited = true;
    el.listHead.textContent = "Loading your projects…";
    try {
      const resp = await tabMsg({ type: "GET_PROJECTS" });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Couldn't load projects.");
      projects = (resp.projects || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      projectsById.clear();
      for (const p of projects) projectsById.set(p.id, p);
    } catch (e) {
      el.results.innerHTML = "";
      el.listHead.textContent = "";
      showEmpty(`Couldn't load your projects. ${e.message}`);
      buildProjectMenu();
      return;
    }

    currentProject = await detectCurrentProject();
    if (currentProject && projectsById.has(currentProject.id)) {
      selectedIds.add(currentProject.id);
    }
    buildProjectMenu();
    updateProjLabel();
    refreshFiles();
  }

  // ---- project selector dropdown -----------------------------------------
  function buildProjectMenu() {
    el.projList.innerHTML = "";
    for (const p of projects) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = p.id;
      cb.checked = selectedIds.has(p.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(p.id);
        else selectedIds.delete(p.id);
        syncAll();
        updateProjLabel();
        refreshFiles();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + p.name));
      el.projList.appendChild(label);
    }
    syncAll();
  }
  function projBoxes() {
    return [...el.projList.querySelectorAll('input[type="checkbox"]')];
  }
  function syncSelectionToMenu() {
    projBoxes().forEach((b) => (b.checked = selectedIds.has(b.value)));
    syncAll();
  }
  function syncAll() {
    const boxes = projBoxes();
    el.projAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
  }
  function updateProjLabel() {
    const n = selectedIds.size;
    if (n === 0) el.projLabel.textContent = "Select projects";
    else if (n === 1) {
      const p = projectsById.get([...selectedIds][0]);
      el.projLabel.textContent = (p && p.name) || "1 project";
    } else el.projLabel.textContent = `${n} projects`;
  }

  el.projBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const closed = el.projMenu.classList.toggle("hidden");
    el.projBtn.setAttribute("aria-expanded", String(!closed));
  });
  el.projMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => {
    el.projMenu.classList.add("hidden");
    el.projBtn.setAttribute("aria-expanded", "false");
  });
  el.projAll.addEventListener("change", () => {
    const on = el.projAll.checked;
    projBoxes().forEach((b) => {
      b.checked = on;
      if (on) selectedIds.add(b.value);
      else selectedIds.delete(b.value);
    });
    updateProjLabel();
    refreshFiles();
  });
  el.projClear.addEventListener("click", () => {
    selectedIds.clear();
    projBoxes().forEach((b) => (b.checked = false));
    el.projAll.checked = false;
    updateProjLabel();
    refreshFiles();
  });

  // ---- mode toggle (List vs Search) --------------------------------------
  function setMode(list) {
    el.modeList.checked = list;
    el.modeSearch.checked = !list;
    el.modeListLbl.classList.toggle("on", list);
    el.modeSearchLbl.classList.toggle("on", !list);
    el.searchBox.classList.toggle("hidden", list);
    el.insideWrap.classList.toggle("hidden", list); // "search inside documents" only in search
    el.sortWrap.classList.toggle("hidden", !list); // Sort only in list
    refreshFiles();
  }
  el.modeList.addEventListener("change", () => setMode(true));
  el.modeSearch.addEventListener("change", () => setMode(false));
  el.show.addEventListener("change", refreshFiles);
  el.sort.addEventListener("change", refreshFiles);
  el.insideDocs.addEventListener("change", refreshFiles);
  el.searchInput.addEventListener("input", refreshFiles);

  // ---- messages -----------------------------------------------------------
  function setMessages() {
    const list = el.modeList.checked;
    const A = list ? "File list" : "Searching";
    const v = list ? "list" : "search";
    if (currentProject) {
      el.msg1.innerHTML =
        `${A} defaults to your current project — <span class="proj">${escapeHtml(currentProject.name)}</span>.` +
        `<br>To ${v} files from other projects, click the dropdown above.`;
    } else {
      el.msg1.innerHTML =
        `<span class="proj">No current project</span> — pick one or more from the dropdown above to ${v} files.`;
    }
    el.msg2.innerHTML =
      `${A} defaults to files in the project's <b>CORE</b>.` +
      `<br>To ${v} files from <b>Chats</b> or <b>Anywhere</b>, use the Show dropdown.`;
  }

  // ---- gathering items ----------------------------------------------------
  function coreItems(projectId) {
    const pf = fileCache.get(projectId);
    if (!pf) return null; // not fetched yet
    const items = [];
    for (const d of pf.docs || [])
      items.push({ name: d.name, source: "core", content: d.content || "", createdAt: d.createdAt });
    for (const f of pf.files || [])
      items.push({ name: f.name, source: "core", content: "", createdAt: f.createdAt });
    return items;
  }
  function chatItems(projectId) {
    const items = [];
    for (const c of CACHE) {
      if (c.projectId !== projectId) continue;
      for (const f of c.files || [])
        items.push({ name: f.name, source: "chat", content: "", createdAt: f.createdAt, url: c.url });
    }
    return items;
  }
  // Returns {items, loading} for a project under the current Show filter.
  function itemsForProject(projectId) {
    const show = el.show.value;
    const chat = chatItems(projectId);
    if (show === "chat") return { items: chat, loading: false };
    const core = coreItems(projectId);
    if (core === null) return { items: [], loading: true };
    const items = show === "core" ? core : core.concat(chat);
    return { items, loading: false };
  }

  function sortItems(items) {
    if (el.sort.value === "recent") {
      items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return items;
  }

  function parseTerms(raw) {
    return raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  function fileSearch(item, terms) {
    const name = item.name.toLowerCase();
    if (terms.every((t) => name.includes(t))) return { hit: true, kind: "name" };
    if (el.insideDocs.checked && item.content) {
      const c = item.content.toLowerCase();
      if (terms.every((t) => c.includes(t))) {
        let idx = -1;
        for (const t of terms) {
          const i = c.indexOf(t);
          if (i !== -1 && (idx === -1 || i < idx)) idx = i;
        }
        const start = Math.max(0, idx - 50);
        const end = Math.min(item.content.length, idx + 120);
        const frag =
          (start > 0 ? "…" : "") + item.content.slice(start, end) + (end < item.content.length ? "…" : "");
        return { hit: true, kind: "content", snippet: frag };
      }
    }
    return { hit: false };
  }

  // Make sure CORE files are loaded for the selected projects (when needed).
  async function ensureCoreLoaded() {
    if (el.show.value === "chat") return; // chat-only needs no fetch
    const need = [...selectedIds].filter((id) => !fileCache.has(id));
    if (!need.length) return;
    for (const id of need) {
      try {
        const p = projectsById.get(id);
        const resp = await tabMsg({ type: "GET_PROJECT_FILES", projectId: id, orgId: p && p.orgId });
        fileCache.set(
          id,
          resp && resp.ok
            ? { docs: resp.docs || [], files: resp.files || [] }
            : { docs: [], files: [], error: (resp && resp.error) || "load failed" }
        );
      } catch (e) {
        fileCache.set(id, { docs: [], files: [], error: String((e && e.message) || e) });
      }
    }
    render();
  }

  // ---- render -------------------------------------------------------------
  function refreshFiles() {
    setMessages();
    render();
    ensureCoreLoaded(); // fetch any missing CORE in the background, then re-render
  }

  function showEmpty(text) {
    el.results.innerHTML = "";
    const d = document.createElement("div");
    d.className = "fempty";
    d.innerHTML = text;
    el.results.appendChild(d);
  }

  const termsQuery = (terms) => ({ type: "terms", terms });

  function render() {
    if (!inited) return;
    const list = el.modeList.checked;
    const selected = [...selectedIds]
      .map((id) => projectsById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (selected.length === 0) {
      el.listHead.textContent = "";
      el.listHead.classList.remove("searching");
      showEmpty(
        "Pick one or more projects from the <b>Project(s) Selector</b> above to see their files."
      );
      return;
    }

    let anyLoading = false;
    el.results.innerHTML = "";

    if (list) {
      el.listHead.classList.remove("searching");
      let total = 0;
      for (const p of selected) {
        const { items, loading } = itemsForProject(p.id);
        if (loading) { anyLoading = true; continue; } // group appears once loaded
        const sorted = sortItems(items.slice());
        total += sorted.length;
        el.results.appendChild(groupEl(p.name, sorted.length, sorted, null));
      }
      const showWord =
        el.show.value === "core" ? "CORE" : el.show.value === "chat" ? "Chats" : "";
      const scope = selected.length === 1
        ? `<span class="proj">${escapeHtml(selected[0].name)}</span>`
        : `<b>${selected.length} projects</b>`;
      el.listHead.innerHTML = anyLoading
        ? "Loading files…"
        : `Listing ${total} ${showWord ? showWord + " " : ""}file${total === 1 ? "" : "s"} in ${scope}`;
    } else {
      el.listHead.classList.add("searching");
      const terms = parseTerms(el.searchInput.value);
      if (!terms.length) {
        el.listHead.classList.remove("searching");
        el.listHead.textContent = "";
        showEmpty("Type above to search the files in the selected project(s).");
        return;
      }
      const q = termsQuery(terms);
      let total = 0;
      let groupsShown = 0;
      for (const p of selected) {
        const { items, loading } = itemsForProject(p.id);
        if (loading) { anyLoading = true; continue; }
        const matched = [];
        for (const it of items) {
          const r = fileSearch(it, terms);
          if (r.hit) matched.push({ it, r });
        }
        sortItems(matched.map((m) => m.it)); // sort underlying
        matched.sort((a, b) => a.it.name.localeCompare(b.it.name));
        if (matched.length) {
          total += matched.length;
          groupsShown++;
          el.results.appendChild(groupEl(p.name, matched.length, null, { matched, q }));
        }
      }
      const raw = el.searchInput.value.trim();
      el.listHead.innerHTML = anyLoading
        ? "Searching…"
        : `${total} match${total === 1 ? "" : "es"} for “${escapeHtml(raw)}” across ${groupsShown} project${groupsShown === 1 ? "" : "s"}`;
      if (!total && !anyLoading) showEmpty(`No files match “${escapeHtml(raw)}”.`);
    }
  }

  // Build a project group block. Pass `listItems` for list mode, or
  // `search={matched,q}` for search mode.
  function groupEl(projName, count, listItems, search) {
    const group = document.createElement("div");
    group.className = "fgroup";

    const head = document.createElement("div");
    head.className = "fgroup-head";
    head.innerHTML =
      `<span class="caret">▾</span><span class="gname">${escapeHtml(projName)}</span>` +
      `<span class="gcount">(${count})</span>`;
    head.addEventListener("click", () => group.classList.toggle("collapsed"));
    group.appendChild(head);

    const wrap = document.createElement("div");
    wrap.className = "fgroup-files";

    const rows = search ? search.matched : (listItems || []).map((it) => ({ it, r: null }));
    for (const { it, r } of rows) {
      const a = document.createElement("a");
      a.className = "ffile";
      if (it.url) {
        a.href = it.url;
        a.target = "_blank";
        a.rel = "noopener";
      }
      const row = document.createElement("div");
      row.className = "frow";
      const name = document.createElement("span");
      name.className = "ffname";
      if (search && r && r.kind === "name") name.innerHTML = highlight(it.name, search.q);
      else name.textContent = it.name;
      const tag = document.createElement("span");
      tag.className = "ftag " + (it.source === "chat" ? "chat" : "core");
      tag.textContent = it.source === "chat" ? "chat" : "CORE";
      row.appendChild(name);
      row.appendChild(tag);
      a.appendChild(row);
      if (search && r && r.kind === "content" && r.snippet) {
        const snip = document.createElement("div");
        snip.className = "fsnippet";
        snip.innerHTML = highlight(r.snippet, search.q);
        a.appendChild(snip);
      }
      wrap.appendChild(a);
    }
    group.appendChild(wrap);
    return group;
  }

  // ---- follow the project the user navigates to ---------------------------
  // Re-detect the current project when the Claude tab navigates or the active
  // tab changes. If it's a *different* project than before, scope to it (the
  // "defaults to current project" behavior). A manual multi-select is preserved
  // as long as you stay within the same project.
  async function maybeFollowProject() {
    if (!inited) return;
    const detected = await detectCurrentProject();
    const newId = detected ? detected.id : null;
    const oldId = currentProject ? currentProject.id : null;
    if (newId === oldId) return; // no change
    currentProject = detected;
    if (detected && projectsById.has(detected.id)) {
      selectedIds.clear();
      selectedIds.add(detected.id);
      syncSelectionToMenu();
      updateProjLabel();
    }
    setMessages();
    refreshFiles();
  }

  chrome.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
    if (changeInfo.url && tab && tab.url && tab.url.startsWith("https://claude.ai/")) {
      maybeFollowProject();
    }
  });
  chrome.tabs.onActivated.addListener(() => maybeFollowProject());

  // ---- react to fresh chat data (called from sidepanel.js refreshCache) ---
  window.onFilesCacheRefreshed = function () {
    if (inited && !el.filesView.classList.contains("hidden")) render();
  };
})();

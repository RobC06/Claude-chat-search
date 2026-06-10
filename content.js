// content.js
// This script runs *inside* the Claude.ai web page. Because it lives on the
// claude.ai origin, any request it makes automatically includes your login
// session (your cookies) — so we can ask Claude's own backend for your chats,
// exactly the way the website itself does. Nothing here sends your data
// anywhere except back to this extension on your own computer.

// ---------------------------------------------------------------------------
// Talking to Claude's internal API.
// These URLs are the same ones the Claude.ai website uses behind the scenes.
// They are not officially published, so if Claude changes them we may need to
// update this section. Keeping them in one place makes that easy.
// ---------------------------------------------------------------------------
const API = {
  async json(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} when loading ${url}`);
    }
    return res.json();
  },
  organizations() {
    return this.json("/api/organizations");
  },
  projects(orgId) {
    return this.json(`/api/organizations/${orgId}/projects`);
  },
  conversations(orgId) {
    return this.json(`/api/organizations/${orgId}/chat_conversations`);
  },
  conversation(orgId, convId) {
    return this.json(
      `/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages`
    );
  },
  projectDocs(orgId, projectId) {
    return this.json(`/api/organizations/${orgId}/projects/${projectId}/docs`);
  },
  projectFiles(orgId, projectId) {
    return this.json(`/api/organizations/${orgId}/projects/${projectId}/files`);
  },
};

// Pull any file attachments off a single message (uploads dropped into a chat).
// The shape we've seen: message.files = [{ file_name, file_kind, created_at, ... }].
function extractFiles(message) {
  const out = [];
  for (const f of message.files || []) {
    if (f && f.file_name) {
      out.push({
        name: f.file_name,
        kind: f.file_kind || null,
        createdAt: f.created_at || message.created_at || null,
      });
    }
  }
  return out;
}

// Pull readable text out of a single chat message. Claude's API has used a few
// different shapes over time, so we try the common ones.
function extractText(message) {
  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((block) => (block && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

// Rename a single conversation. This is a WRITE to Claude's servers, using the
// same endpoint the website itself uses (a PUT with {"name": "..."}). If we
// weren't told which org the chat is in, fall back to the first org (covers the
// common single-account case).
async function renameConversation(orgId, convId, name) {
  if (!orgId) {
    const orgs = await API.organizations();
    orgId = orgs && orgs[0] && orgs[0].uuid;
  }
  if (!orgId) throw new Error("Could not determine your account.");
  const res = await fetch(
    `/api/organizations/${orgId}/chat_conversations/${convId}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "anthropic-client-platform": "web_claude_ai",
      },
      body: JSON.stringify({ name }),
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json().catch(() => ({}));
}

// Detect whether claude.ai is currently showing in dark or light mode. We read
// the page's actual rendered background color (works regardless of how Claude
// implements its theme — light, dark, or "match system").
function bgColorOf(el) {
  const bg = el && getComputedStyle(el).backgroundColor;
  const nums = bg && bg.match(/\d+(\.\d+)?/g);
  if (!nums) return null;
  const arr = nums.map(Number);
  if (arr.length >= 4 && arr[3] === 0) return null; // fully transparent
  return arr;
}

function detectClaudeTheme() {
  try {
    const arr = bgColorOf(document.body) || bgColorOf(document.documentElement);
    if (!arr) return "light";
    const [r, g, b] = arr;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance < 128 ? "dark" : "light";
  } catch (e) {
    return "light";
  }
}

// Send a status/progress/data message up to the side panel.
function send(msg) {
  // .catch() avoids noisy errors if the side panel happens to be closed.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Run an async function over a list, but only `limit` at a time, so we don't
// hammer Claude's servers with hundreds of simultaneous requests.
async function mapLimit(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// The main routine. `known` is a map of { conversationId: lastUpdatedAt } that
// we already have stored — so we only download the messages for chats that are
// new or have changed since last time (incremental sync). We also collect every
// current conversation id so the panel can drop chats that were deleted.
async function syncAll(known) {
  known = known || {};
  send({ type: "SYNC_STATUS", message: "Finding your account…" });
  const orgs = await API.organizations();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("No account found. Are you logged in to Claude.ai?");
  }

  let grandTotal = 0;
  let fetched = 0;
  const allIds = [];

  for (const org of orgs) {
    const orgId = org.uuid;

    // Build a lookup of project id -> project name so we can label chats.
    const projectName = {};
    try {
      const projects = await API.projects(orgId);
      for (const p of projects) projectName[p.uuid] = p.name;
    } catch (e) {
      // Projects are optional; ignore if this account has none.
    }

    const convos = await API.conversations(orgId);
    send({
      type: "SYNC_STATUS",
      message: `Checking ${convos.length} conversations…`,
      total: convos.length,
    });

    let done = 0;
    await mapLimit(convos, 4, async (c) => {
      allIds.push(c.uuid);

      // Skip the expensive message download if we already have this version.
      const prev = known[c.uuid];
      if (prev && prev === (c.updated_at || "")) {
        done++;
        send({ type: "SYNC_PROGRESS", done, total: convos.length });
        return;
      }

      try {
        const full = await API.conversation(orgId, c.uuid);
        const rawMsgs = full.chat_messages || [];
        const messages = rawMsgs.map((m, i) => ({
          index: i,
          role: m.sender === "human" ? "You" : "Claude",
          text: extractText(m),
        }));
        // Collect any files attached within this chat, so the Project Files tab
        // can list them without re-fetching conversations.
        const files = [];
        for (const m of rawMsgs) files.push(...extractFiles(m));
        send({
          type: "SYNC_CONVERSATION",
          conversation: {
            id: c.uuid,
            orgId: orgId,
            name: c.name || full.name || "Untitled chat",
            projectId: c.project_uuid || null,
            projectName: c.project_uuid ? projectName[c.project_uuid] || null : null,
            createdAt: c.created_at || null,
            updatedAt: c.updated_at || null,
            url: `https://claude.ai/chat/${c.uuid}`,
            messages,
            files,
          },
        });
        fetched++;
      } catch (e) {
        send({
          type: "SYNC_STATUS",
          message: `Skipped one conversation (${e.message}).`,
        });
      } finally {
        done++;
        send({ type: "SYNC_PROGRESS", done, total: convos.length });
      }
    });

    grandTotal += convos.length;
  }

  send({ type: "SYNC_DONE", total: grandTotal, fetched, allIds });
}

// List every project across all orgs (for the Project Files tab's selector).
async function listAllProjects() {
  const orgs = await API.organizations();
  const out = [];
  for (const o of orgs || []) {
    try {
      const ps = await API.projects(o.uuid);
      for (const p of ps || []) {
        out.push({ id: p.uuid, name: p.name || "Project", orgId: o.uuid });
      }
    } catch (e) {
      // skip an org we can't read
    }
  }
  return out;
}

// Fetch a single project's files on demand: the knowledge "docs" (CORE, which
// carry their text) and any uploaded "files". Returns a normalized shape.
async function getProjectFiles(projectId, orgId) {
  let candidates = orgId ? [orgId] : null;
  if (!candidates) {
    const orgs = await API.organizations();
    candidates = (orgs || []).map((o) => o.uuid);
  }
  for (const oid of candidates) {
    try {
      const d = await API.projectDocs(oid, projectId);
      const docsArr = Array.isArray(d) ? d : (d && d.docs) || [];
      let filesArr = [];
      try {
        const f = await API.projectFiles(oid, projectId);
        filesArr = Array.isArray(f) ? f : (f && (f.files || f.data)) || [];
      } catch (e) {
        filesArr = [];
      }
      return {
        ok: true,
        docs: docsArr.map((x) => ({
          id: x.uuid,
          name: x.file_name || "(untitled)",
          content: typeof x.content === "string" ? x.content : "",
          createdAt: x.created_at || null,
        })),
        files: filesArr.map((x) => ({
          id: x.file_uuid || x.uuid || null,
          name: x.file_name || "(file)",
          kind: x.file_kind || null,
          createdAt: x.created_at || null,
        })),
      };
    } catch (e) {
      // wrong org for this project — try the next one
    }
  }
  return { ok: false, error: "Could not load this project's files." };
}

// Listen for commands from the side panel.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "PING") {
    sendResponse({ pong: true });
    return; // synchronous reply
  }
  if (msg.type === "GET_THEME") {
    sendResponse({ theme: detectClaudeTheme() });
    return; // synchronous reply
  }
  if (msg.type === "START_SYNC") {
    syncAll(msg.known || {}).catch((err) =>
      send({ type: "SYNC_ERROR", error: String((err && err.message) || err) })
    );
    sendResponse({ started: true });
    return true;
  }
  if (msg.type === "RENAME") {
    renameConversation(msg.orgId, msg.convId, msg.name)
      .then(() => sendResponse({ ok: true }))
      .catch((err) =>
        sendResponse({ ok: false, error: String((err && err.message) || err) })
      );
    return true; // keep the channel open for the async reply
  }
  if (msg.type === "GET_PROJECTS") {
    listAllProjects()
      .then((projects) => sendResponse({ ok: true, projects }))
      .catch((err) =>
        sendResponse({ ok: false, error: String((err && err.message) || err) })
      );
    return true;
  }
  if (msg.type === "GET_PROJECT_FILES") {
    getProjectFiles(msg.projectId, msg.orgId)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, error: String((err && err.message) || err) })
      );
    return true;
  }
});

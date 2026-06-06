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
};

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

// The main routine: download every conversation and stream them to the panel.
async function syncAll() {
  send({ type: "SYNC_STATUS", message: "Finding your account…" });
  const orgs = await API.organizations();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("No account found. Are you logged in to Claude.ai?");
  }

  let grandTotal = 0;

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
      message: `Found ${convos.length} conversations. Downloading…`,
      total: convos.length,
    });

    let done = 0;
    await mapLimit(convos, 4, async (c) => {
      try {
        const full = await API.conversation(orgId, c.uuid);
        const messages = (full.chat_messages || []).map((m, i) => ({
          index: i,
          role: m.sender === "human" ? "You" : "Claude",
          text: extractText(m),
        }));
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
          },
        });
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

  send({ type: "SYNC_DONE", total: grandTotal });
}

// Listen for commands from the side panel.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "PING") {
    sendResponse({ pong: true });
    return; // synchronous reply
  }
  if (msg.type === "START_SYNC") {
    syncAll().catch((err) =>
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
});

# Claude Chat Search

A Chrome extension that lets you **search across all your Claude.ai
conversations** — including chats that live inside Projects. Everything is
stored locally in your own browser; nothing is sent to any outside server.

## What it does

- Downloads your conversations from Claude.ai using your existing login.
- Stores them privately in your browser.
- Gives you a **side panel** with instant search, snippet previews, and a link
  straight back to each original chat.

### Search features

- **Keyword search** — type words; all must appear (snippets show the match).
- **Exact phrase** — wrap text in `"double quotes"` to match it exactly.
- **Regex** — tick the **regex** box to search with a regular expression.
- **Filters** — narrow by **project**, **date range**, and **who said it**
  (you vs Claude).
- **Sort** — by best match or most recent.
- **Match counts** — each result shows how many times your query appears.

You can also browse with filters alone (no search text) — e.g. "every chat in
Project X from last month".

### Renaming chats

Each result has a **Rename** button. Click it, type a new name, and the chat is
renamed on Claude.ai (and updated locally). This needs a claude.ai tab open and
that you're logged in. Renames take effect immediately on Claude's side.

## How it works (plain English)

When you use Claude.ai, the website quietly asks its own backend for your list
of chats. This extension makes those same requests, but only ever with *your*
login, and only to read *your own* data. The results are saved on your
computer and searched there.

> ⚠️ Those backend addresses aren't officially published by Anthropic, so a
> future change to Claude.ai could require an update to this extension. That's
> a normal trade-off for a personal tool like this.

## Installing it (no coding required)

1. Download/clone this folder to your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. You'll see "Claude Chat Search" appear. Pin it to your toolbar if you like.

## Using it

1. Open [claude.ai](https://claude.ai) in a tab and make sure you're logged in.
2. Click the **Claude Chat Search** icon in your toolbar — the side panel opens.
3. Click **Sync chats**. The first sync downloads all your conversations; this
   can take a little while if you have a lot. A progress bar shows how it's going.
4. Type in the search box. Results appear instantly. Click any result to jump
   to that chat on Claude.ai.

### Keeping things up to date (automatic)

After the first full sync, the panel **refreshes itself every time you open it**
(as long as claude.ai is open in a tab). This refresh is **incremental** — it
only downloads chats that are new or have changed, so it's quick. Chats you
delete on Claude are removed from search too. A green **chat count** and
**"Last synced"** line show how fresh your index is, and the **Sync Chats** link
(in the helper text) is always there if you want to force a manual refresh.

## Notes & limits (v1)

- **Local only.** Your chats live in this browser on this computer. If you want
  search across multiple devices later, that's when we'd add a small server
  (e.g. MongoDB on Railway).
- **Panel shows only on Claude.** The search panel only appears on claude.ai
  tabs and hides when you switch to any other tab. (Chrome doesn't allow
  extensions to open the side panel automatically, so you always open it by
  clicking the toolbar icon while on a Claude tab.)
- **Storage size.** Browsers limit local storage. A very large chat history
  might not fully fit — that's another reason you might move to a server later.
- **Keep the panel open during sync.** Closing it mid-sync stops the download
  (just reopen the panel — it refreshes automatically, and incremental sync
  means it only fetches what it still needs).

## Project layout

| File | What it's for |
|------|----------------|
| `manifest.json` | Extension's ID card and permissions |
| `content.js` | Runs on Claude.ai; fetches your chats |
| `db.js` | Saves/reads chats in the browser database |
| `sidepanel.html` / `.css` / `.js` | The search panel you use |
| `background.js` | Opens the side panel when you click the icon |

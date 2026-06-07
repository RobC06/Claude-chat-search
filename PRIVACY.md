# Privacy Policy — Search for Claude Chats

_Last updated: 2026-06-07_

**Short version: this extension keeps everything on your own computer. It does
not send your conversations, or any other data, anywhere. There are no servers,
no accounts, no analytics, and no third parties.**

## What the extension does

"Search for Claude Chats" is a browser extension that lets you search your own
Claude.ai conversations. To do that, it reads your conversations from Claude.ai
(using your existing logged-in session, in your own browser) and builds a
**search index that is stored locally on your computer** inside the browser's
built-in storage (IndexedDB and extension local storage).

When you type a search, the matching happens **on your machine**, against that
local index. Nothing about your search — the query, the results, the
conversation text — is transmitted off your device.

## What data is involved

- **Your Claude.ai conversation content** (titles, messages, project names,
  and timestamps), which is read so it can be indexed and searched.
- **A small amount of settings/state** (such as when the last sync ran).

All of this is stored **only** in your browser, on the device you installed the
extension on.

## What we do NOT do

- We do **not** send your data to the developer or to any external server.
- We do **not** use analytics, tracking, advertising, or fingerprinting.
- We do **not** sell, rent, or share your data with anyone — there is no one to
  share it with, because the data never leaves your device.
- We do **not** require an account or any sign-up.

## The permissions, and why they're needed

- **Access to claude.ai** — to read your conversations so they can be indexed
  and searched.
- **Scripting** — to run the indexing routine inside your Claude.ai tab.
- **Tabs** — to find your open Claude.ai tab and to show the search panel only
  on Claude.ai.
- **Storage** — to save the local search index and settings on your device.

Each permission is used solely for the search feature described above.

## Keeping or deleting your data

Because the data is local, you are always in control of it:

- **Uninstalling** the extension removes its stored data from your browser.
- Clearing the extension's site data via your browser also removes it.

## Changes to this policy

If this policy changes, the updated version will be published in this
repository with a new "Last updated" date.

## Contact

Questions about privacy can be sent to: **rob.cohen.06@gmail.com**

---

_This is an independent, unofficial extension. It is not affiliated with,
endorsed by, or sponsored by Anthropic. "Claude" is a trademark of its
respective owner and is used here only to describe what the extension works
with._

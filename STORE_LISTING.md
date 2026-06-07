# Chrome Web Store listing — copy & paste

Everything here is text for the Web Store Developer Dashboard. None of it ships
in the extension itself.

---

## Name

Search for Claude Chats

## Short description (132 characters max)

Search all your Claude.ai conversations. Indexed privately on your own
computer — nothing is ever uploaded or sent anywhere.

## Detailed description

Find anything you've ever discussed with Claude — in seconds.

Search for Claude Chats adds a fast, full-text search panel to claude.ai so you
can dig up that conversation you half-remember without scrolling forever. It
searches across all your chats, including the ones tucked inside projects.

— Your conversations never leave your computer —

This is the whole point of the extension: your chats are indexed locally, in
your own browser, and the search runs entirely on your machine. Nothing is
uploaded. There are no servers, no accounts, no analytics, and no third
parties. The developer never sees your data, because the data never goes
anywhere. When you close the extension or uninstall it, the local index goes
with it.

— What you can do —

• Full-text search across every Claude.ai conversation, including chats inside
  projects
• See matches highlighted in context, with a count per conversation
• Filter by who said it (you or Claude), by project, and by date range
• Sort by best match or most recent
• Use quotes for an exact phrase, or switch on regex for power searches
• Jump straight to the original conversation with one click
• A light/dark theme that automatically follows your Claude.ai setting

— How it works —

The extension reads your conversations using your existing Claude.ai login (the
same session you're already using in your browser) and builds a private search
index on your device. It keeps that index up to date quietly in the background,
so search is always ready when you need it.

— Privacy —

Everything stays on your computer. See the full privacy policy for details.

Unofficial: this extension is independent and is not affiliated with,
endorsed by, or sponsored by Anthropic.

---

## Single purpose (dashboard field)

Provide a private, local full-text search over the user's own Claude.ai
conversations.

## Permission justifications (dashboard fields)

- **Host access to claude.ai (https://claude.ai/*):** Required to read the
  user's own conversations so they can be indexed and searched. This is the
  core function of the extension.
- **scripting:** Used to run the indexing routine inside the user's claude.ai
  tab to collect conversation text for the local index.
- **tabs:** Used to locate the user's open claude.ai tab and to scope the
  search side panel so it appears only on claude.ai.
- **storage:** Used to store the local search index and the user's settings on
  the user's own device.

## Data usage disclosures (dashboard checkboxes/answers)

- Does the extension collect or use data? It handles the user's website content
  (their Claude.ai conversations) **locally only**.
- Is any data transmitted off the device? **No.** No data is sent to the
  developer or any third party.
- Is data sold to third parties? **No.**
- Is data used for purposes unrelated to the single purpose? **No.**
- Is data used for creditworthiness / lending? **No.**

I certify that this extension's data handling complies with the Developer
Program Policies: the extension stores conversation content only on the user's
device and transmits nothing.

## Privacy policy URL

(Point this at the hosted PRIVACY.md — e.g. your GitHub Pages URL, or the raw
file URL in the repository.)

## Category

Productivity

---

## Notes for submission

- Upload at least one 1280×800 screenshot (the one you composed).
- Store icon: the 128×128 from icons/icon128.png works.
- Double-check the name field reads "Search for Claude Chats".

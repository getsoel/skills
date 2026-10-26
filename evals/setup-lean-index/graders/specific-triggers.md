---
type: llm
focus: { source: file, path: context/index.md }
---

This is the context index the agent wrote. An index entry is read only when its "Use when" trigger matches the task at hand.

PASS if every entry's trigger names specific situations (concrete tasks, directories, tools or error symptoms), so that a typical task in this repo matches at most one or two entries, AND the index's own instructions tell the reader to open an entry only when it matches - not to read ahead or read anything "when in doubt".
FAIL if any entry is a catch-all that would match nearly every task (for example a repo-wide architecture/overview doc triggered by "navigating the repo" or "understanding the codebase"), or if the index tells the reader to read entries before they match.

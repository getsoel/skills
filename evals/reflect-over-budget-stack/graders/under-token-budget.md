---
type: regex
target: { source: file, path: packages/cli/provision/tenant-acme/CLAUDE.md }
pattern: '^[\s\S]{0,15000}$'
match: contains
---

The whole file is at most 15,000 chars (~5k tokens at 3 chars/token). The fixture starts at ~16,000.

---
type: regex
target: { source: file, path: context/index.md }
pattern: 'Use when:[^\n]*\b(navigat\w*|overview|orientation|getting started|understanding the (repo|codebase|monorepo)|any (task|change)|every task|general)'
flags: i
match: not_contains
---

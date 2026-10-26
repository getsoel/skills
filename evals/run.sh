#!/usr/bin/env bash
# Run the context-index eval suite with `claude plugin eval`.
#
#   evals/run.sh [<git ref>] [-- <extra plugin eval args>]
#
# The repo publishes through .claude-plugin/marketplace.json and has no plugin.json, so
# `plugin eval .` resolves no plugin. This wraps the skill (from the working tree, or from
# <git ref> to measure an older version) in a throwaway plugin dir next to these evals.
# Cases scaffold their fixture repos, so --scaffold is always passed; the skill needs Node
# for its checker and Write/Edit for setup and reflect.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
ref=""
if [ $# -gt 0 ] && [ "$1" != "--" ]; then ref="$1"; shift; fi
[ "${1:-}" = "--" ] && shift

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/.claude-plugin" "$dir/skills"
printf '{"name":"context-index","version":"0.0.0-eval","description":"context-index under eval"}\n' > "$dir/.claude-plugin/plugin.json"
cp -R "$repo/evals" "$dir/evals"
if [ -n "$ref" ]; then
  git -C "$repo" archive "$ref" skills/context-index | tar -x -C "$dir"
else
  cp -R "$repo/skills/context-index" "$dir/skills/"
fi

cd "$dir"
claude plugin eval . --scaffold --trust-plugin --allow-tools Write Edit "Bash(node *)" \
  --output-dir "$repo/evals/results/$(date +%Y%m%d-%H%M%S)${ref:+-$ref}" "$@"

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Per-project ignore list for the context tooling. Literal paths (no globs) that exclude
// foreign instruction files the project doesn't own (legacy/demo/vendored CLAUDE.md) so the
// whole-tree scan doesn't fail on them. Shared by `check` and `footguns` so the two can't
// drift on WHAT they skip.
//
// Sources: `.contextignore` at the root (one path per line, `#` comments) plus extra paths
// passed via `--ignore=`. A bare name matches that dir/file at any depth (like the built-in
// vendor prune); a path with a `/` anchors to the root and skips it plus anything beneath.
export const IGNORE_FILE = ".contextignore";

export interface Ignore {
  p: string;
  anchored: boolean;
}

export function loadIgnore(root: string, extra?: string[]): Ignore[] {
  const raw: string[] = [];
  const file = join(root, IGNORE_FILE);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) raw.push(t);
    }
  }
  for (const p of extra ?? []) {
    const t = p.trim();
    if (t) raw.push(t);
  }
  return raw
    .map((r) => {
      const p = r.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
      return { p, anchored: p.includes("/") };
    })
    .filter((x) => x.p);
}

export function makeIsIgnored(ignore: Ignore[]): (rel: string) => boolean {
  return (rel) => {
    const path = rel.split("\\").join("/");
    return ignore.some(({ p, anchored }) =>
      anchored ? path === p || path.startsWith(p + "/") : path.split("/").includes(p));
  };
}

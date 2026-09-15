export interface IndexEntry {
  path: string;
  trigger: string;
  hasUseWhen: boolean;
  globs: string[];
  eager: boolean;
  line: number;
}

// Parse context/index.md bullet entries. Shared by the validator and any activation tooling
// so entry/glob syntax can't drift.
// Entry shape: `- \`context/auth.md\` - Use when: <trigger>[; paths: \`g1\`, \`g2\`]`
export function parseIndexEntries(text: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  text.split("\n").forEach((line, i) => {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (!bullet) return;
    const body = bullet[1];
    const pathMatch = body.match(/`?([\w./-]+\.md)`?/);
    if (!pathMatch) return;
    const tw = body.match(/use when:\s*(.*?)\s*(?:;\s*paths:.*)?$/i);
    const pm = body.match(/;\s*paths:\s*(.+)$/i);
    out.push({
      path: pathMatch[1],
      trigger: tw ? tw[1].trim() : "",
      hasUseWhen: /use when:/i.test(body),
      globs: pm ? [...pm[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [],
      eager: /`?@[\w./-]+\.md`?/.test(body),
      line: i + 1,
    });
  });
  return out;
}

// An index file under context/: the root `context/index.md`, or a sub-index
// `context/<area>/index.md` that a parent index lists. Shared so the validator, the CLI and
// the activation hook agree on what makes an entry a sub-index rather than a topic doc.
export function isIndexPath(path: string): boolean {
  return /^context\/(?:[^/]+\/)*index\.md$/.test(path);
}

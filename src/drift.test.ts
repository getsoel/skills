import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkContext } from "./check";
import { checkCrossFileDuplicates, checkDeadPaths, checkDeadSymbols, pathRefs, ruleSentences } from "./drift";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "drift-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const track = () => execFileSync("git", ["add", "-A"], { cwd: root });
const run = (fn: typeof checkDeadPaths, files: string[]) => {
  const out: Array<{ file: string; line: number; msg: string }> = [];
  fn(root, files.map((f) => join(root, f)), (file, line, _sev, msg) => out.push({ file, line, msg }));
  return out;
};

test("pathRefs takes concrete paths from code spans only", () => {
  expect(pathRefs("see `apps/web/src/x.ts:12` and apps/plain/y.ts")).toEqual(["apps/web/src/x.ts"]);
  expect(pathRefs("`apps/<app>/x.ts`, `apps/*/x.ts`, `@scope/pkg`, `example.com/a/b`")).toEqual([]);
  expect(pathRefs("run `node scripts/commit-paths.mjs -m msg`")).toEqual(["scripts/commit-paths.mjs"]);
  expect(pathRefs("There is no `apps/boilerplate` template.")).toEqual([]);
  expect(pathRefs("import from `./types` here")).toEqual([]);
});

test("a path that names nothing is flagged; real, abbreviated, and ignored ones are not", () => {
  put("services/api/src/services/viewer/purchases.ts", "");
  put(".gitignore", "lib/\n");
  put(
    "context/a.md",
    [
      "- `services/api/src/services/viewer/purchases.ts` is real.",
      "- `services/viewer/purchases.ts` is the same file, written from the package.",
      "- `services/api/lib/out.js` is build output.",
      "- `services/api/src/gone.ts` moved away.",
      "- `tests/path/to/file.test.ts` is a placeholder.",
    ].join("\n"),
  );
  track();
  const out = run(checkDeadPaths, ["context/a.md"]);
  expect(out.map((f) => f.line)).toEqual([4]);
  expect(out[0]!.msg).toContain("services/api/src/gone.ts");
});

test("a path outside this repo's top level is left alone", () => {
  put("context/a.md", "The worker lives in the other repo at `workers/cdn/index.js`.\n");
  track();
  expect(run(checkDeadPaths, ["context/a.md"])).toEqual([]);
});

test("a ./ path resolves against the doc and against the root", () => {
  put("tool.sh", "");
  put("context/a.md", "Run `./tool.sh` from the root.\n");
  track();
  expect(run(checkDeadPaths, ["context/a.md"])).toEqual([]);
});

test("ruleSentences keeps long sentences, drops headings, short ones, and pointers", () => {
  expect(ruleSentences("# A heading that is long enough to count as a rule sentence here")).toEqual([]);
  expect(ruleSentences("- Too short to matter.")).toEqual([]);
  expect(ruleSentences("The full set is listed in `context/review/rubric.md` and injected by the workflow verbatim.")).toEqual([]);
  expect(ruleSentences("- **Never** edit the generated `lib/` folder by hand, regenerate it with the sdk command instead.")).toEqual([
    "never edit the generated lib/ folder by hand regenerate it with the sdk command instead",
  ]);
});

test("the same rule sentence in two docs is flagged on both", () => {
  const rule = "Never edit the generated lib folder by hand, regenerate it with the sdk command instead.";
  put("packages/sdk/CLAUDE.md", `# SDK\n\n- ${rule}\n`);
  put("context/sdk.md", `# SDK\n\nSome intro.\n\n**${rule}**\n`);
  put("context/other.md", `# Other\n\n${rule.replace("Never", "Do not")}\n`);
  const out = run(checkCrossFileDuplicates, ["packages/sdk/CLAUDE.md", "context/sdk.md", "context/other.md"]);
  expect(out.map((f) => `${f.file.slice(root.length + 1)}:${f.line}`).sort()).toEqual(["context/sdk.md:5", "packages/sdk/CLAUDE.md:3"]);
  expect(out[0]!.msg).toContain("point to it");
});

test("a rule repeated inside one doc is not a cross-file duplicate", () => {
  const rule = "Never edit the generated lib folder by hand, regenerate it with the sdk command instead.";
  put("context/sdk.md", `${rule}\n\n${rule}\n`);
  expect(run(checkCrossFileDuplicates, ["context/sdk.md"])).toEqual([]);
});

test("a backticked identifier no source file contains is flagged", () => {
  put("src/tabs.ts", "export const routeTabs = 1;\n");
  put("context/ui.md", "Use `routeTabs` for tabs. The `clipSourceTabs` helper builds them.\nThe old `legacyTabsHelper` was removed.\n");
  track();
  const out = run(checkDeadSymbols, ["context/ui.md"]);
  expect(out.map((f) => f.msg.split(" ")[0])).toEqual(["`clipSourceTabs`"]);
});

test("checkContext reports drift findings, and --file narrows the report", () => {
  put("CLAUDE.md", "# repo\n\n@context/index.md\n");
  put("context/index.md", "# Index\n\n- `context/a.md` - Use when: touching a\n- `context/b.md` - Use when: touching b\n");
  put("context/a.md", "# A\n\nSee `context/gone/x.md` for more.\n");
  put("context/b.md", "# B\n\nSee `context/gone/y.md` for more.\n");
  track();
  const all = checkContext(root).findings.filter((f) => f.msg.includes("does not exist"));
  expect(all.map((f) => f.file).sort()).toEqual(["context/a.md", "context/b.md"]);
  const one = checkContext(root, { only: ["context/b.md"] }).findings;
  expect(one.every((f) => f.file === "context/b.md")).toBe(true);
  expect(one.some((f) => f.msg.includes("context/gone/y.md"))).toBe(true);
});

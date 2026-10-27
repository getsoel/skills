import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseReason, runVerifies } from "./verify";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "const isDeleted = 0;\n");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const verify = (doc: string, run = true) => {
  writeFileSync(join(root, "doc.md"), doc);
  return runVerifies(root, [join(root, "doc.md")], { run });
};

test("only read-only pipelines may run", () => {
  expect(refuseReason("git grep -n foo -- src | wc -l")).toBeNull();
  expect(refuseReason("grep -c x src/a.ts")).toBeNull();
  expect(refuseReason("rm -rf src")).toContain("read-only");
  expect(refuseReason("git grep x | xargs rm")).toContain("read-only");
  expect(refuseReason("grep x src/a.ts > out")).toContain("shell syntax");
  expect(refuseReason("ls $(pwd)")).toContain("shell syntax");
  expect(refuseReason("kubectl get pods")).toContain("read-only");
});

test("an empty expectation conforms when the command prints nothing, drifts when it does not", () => {
  const [ok] = verify("- No flags. verify: `grep -n nothingHere src/a.ts` returns nothing\n");
  expect(ok!.outcome).toBe("conform");
  const [bad] = verify("- No flags. verify: `grep -n isDeleted src/a.ts` returns nothing\n");
  expect(bad!.outcome).toBe("drift");
  expect(bad!.detail).toContain("isDeleted");
});

test("a zero expectation reads counts", () => {
  expect(verify("verify: `grep -c nothingHere src/a.ts` (0)\n")[0]!.outcome).toBe("conform");
  expect(verify("verify: `grep -c isDeleted src/a.ts` (0)\n")[0]!.outcome).toBe("drift");
});

test("a command that names a missing tracked file is broken; a missing untracked one is unchecked", () => {
  expect(verify("verify: `grep -n x src/gone.ts` returns nothing\n")[0]!.outcome).toBe("broken");
  expect(verify("verify: `grep -n x node_modules/pkg/index.js` returns nothing\n")[0]!.outcome).toBe("unchecked");
});

test("no machine-readable expectation, a refused command, or no --run means unchecked", () => {
  expect(verify("verify: `grep -n isDeleted src/a.ts`\n")[0]!.outcome).toBe("unchecked");
  expect(verify("verify: `kubectl get pods` returns nothing\n")[0]!.outcome).toBe("unchecked");
  const [notRun] = verify("verify: `grep -n x src/a.ts` returns nothing\n", false);
  expect(notRun!.outcome).toBe("unchecked");
  expect(notRun!.detail).toContain("--run");
});

test("the label may be backticked too", () => {
  const [r] = verify("(`verify:` `grep -n nothingHere src/a.ts` - no hits)\n");
  expect(r!.command).toBe("grep -n nothingHere src/a.ts");
  expect(r!.outcome).toBe("conform");
});

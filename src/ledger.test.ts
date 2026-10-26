import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GatherResult } from "./gather";
import { recordFriction, signatureOf } from "./ledger";

function session(id: string, errors: string[]): GatherResult {
  return {
    transcript: `/x/${id}.jsonl`,
    sessionId: id,
    missing: false,
    rows: errors.map((text) => ({ kind: "error" as const, text })),
    stats: { lines: 0, extracted: 0, deduped: 0, rawBytes: 0, digestBytes: 0 },
  };
}

describe("signatureOf", () => {
  it("keys on the line that names the error, not `Exit code N` or stack framing", () => {
    expect(
      signatureOf('Exit code 1\nTraceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nModuleNotFoundError: No module named \'yaml\''),
    ).toBe("modulenotfounderror: no module named <q>");
  });

  it("collapses the same failure across checkouts, paths and quoted values", () => {
    const a = signatureOf("Exit code 128\nfatal: pathspec 'notes/HANDOFF-a.local.md' is beyond a symbolic link");
    const b = signatureOf("Exit code 128\nfatal: pathspec 'notes/other.md' is beyond a symbolic link");
    expect(a).toBe(b);
    expect(signatureOf("(eval):1: no such file or directory: /Users/a/repo-alpha/apps/mobile")).toBe(
      signatureOf("(eval):3: no such file or directory: /Users/a/repo-bravo/apps/web"),
    );
  });

  it("keys an MCP error on its message, not its `### Error` header", () => {
    expect(signatureOf("### Error\nTimeoutError: browserBackend.callTool: Timeout 5000ms exceeded.")).toBe(
      "timeouterror: browserbackend.calltool: timeout nms exceeded.",
    );
  });

  it("normalizes relative repo paths, so cwd drift is one signature", () => {
    expect(signatureOf("(eval):cd:1: no such file or directory: services/api")).toBe(
      signatureOf("(eval):cd:1: no such file or directory: apps/platform-admin"),
    );
  });

  it("keeps apostrophes inside words", () => {
    expect(signatureOf("Error: can't find module 'yaml'")).toBe("error: can't find module <q>");
  });

  it("strips tokens and ids so no secret becomes a key", () => {
    expect(signatureOf("401 unauthorized for token ghp_abcdefghijklmnopqrstuvwxyz0123")).not.toContain("ghp_");
  });

  it("returns null for an error with nothing to key on", () => {
    expect(signatureOf("Exit code 1\n\n")).toBeNull();
  });
});

describe("recordFriction", () => {
  const ledger = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "context-index", "friction.jsonl");
  const err = "Exit code 1\nzsh: no matches found: --include=*.ts";

  it("counts distinct earlier sessions, not repeats within one", () => {
    const path = ledger();
    expect(recordFriction(session("s1", [err, err]), path).get(0)?.seenBefore).toBe(0);
    expect(recordFriction(session("s2", [err]), path).get(0)?.seenBefore).toBe(1);
    expect(recordFriction(session("s3", [err]), path).get(0)?.seenBefore).toBe(2);
  });

  it("is idempotent when the same session is gathered twice", () => {
    const path = ledger();
    recordFriction(session("s1", [err]), path);
    recordFriction(session("s1", [err]), path);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
    expect(recordFriction(session("s2", [err]), path).get(0)?.seenBefore).toBe(1);
  });

  it("does not count the current session as an earlier sighting", () => {
    const path = ledger();
    recordFriction(session("s1", [err]), path);
    expect(recordFriction(session("s1", [err]), path).get(0)?.seenBefore).toBe(0);
  });
});

import { describe, it, expect } from "bun:test";
import {
  dedupe,
  digestLine,
  resolveTranscript,
  type DigestRow,
} from "./gather";

/** A transcript line, as Claude Code writes it. */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

function userTurn(text: string, extra: Record<string, unknown> = {}): string {
  return line({
    type: "user",
    promptSource: "typed",
    userType: "external",
    timestamp: "2026-07-08T22:47:00.729Z",
    message: { role: "user", content: text },
    ...extra,
  });
}

function assistantTurn(
  blocks: unknown[],
  extra: Record<string, unknown> = {},
): string {
  return line({
    type: "assistant",
    timestamp: "2026-07-08T22:47:10.000Z",
    message: { role: "assistant", content: blocks },
    ...extra,
  });
}

describe("digestLine — the human's turns", () => {
  it("keeps a typed user turn", () => {
    expect(digestLine(userTurn("actually, do it this way"))).toEqual({
      kind: "user",
      text: "actually, do it this way",
      ts: "2026-07-08T22:47:00.729Z",
    });
  });

  it("keeps a long user turn WHOLE — it is the highest-signal row in the file", () => {
    const long = "x".repeat(5000);
    expect(digestLine(userTurn(long))?.text).toHaveLength(5000);
  });

  it("drops a user line that is not a typed prompt", () => {
    // Tool results and injected reminders are `user` lines too, and none of
    // them are things the user said.
    expect(
      digestLine(line({ type: "user", message: { content: "tool output" } })),
    ).toBeNull();
    expect(digestLine(userTurn("hi", { promptSource: "injected" }))).toBeNull();
  });
});

describe("digestLine — the assistant's turns", () => {
  it("takes text blocks and ignores thinking and tool_use", () => {
    const row = digestLine(
      assistantTurn([
        { type: "thinking", thinking: "a very long private deliberation" },
        { type: "text", text: "the decision" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ]),
    );
    expect(row).toMatchObject({ kind: "assistant", text: "the decision" });
  });

  it("clips assistant prose", () => {
    const row = digestLine(
      assistantTurn([{ type: "text", text: "y".repeat(5000) }]),
    );
    expect(row!.text.length).toBeLessThan(700);
    expect(row!.text.endsWith("…")).toBe(true);
  });

  it("drops a turn that was only thinking and tool calls", () => {
    expect(
      digestLine(
        assistantTurn([
          { type: "thinking", thinking: "..." },
          { type: "tool_use", id: "toolu_2", name: "Read", input: {} },
        ]),
      ),
    ).toBeNull();
  });
});

describe("digestLine — failures", () => {
  it("keeps an errored tool_result", () => {
    const row = digestLine(
      line({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              is_error: true,
              content: "ENOENT: no such file",
            },
          ],
        },
      }),
    );
    expect(row).toMatchObject({ kind: "error", text: "ENOENT: no such file" });
  });

  it("drops a successful tool_result — this is the bulk", () => {
    expect(
      digestLine(
        line({
          type: "user",
          message: {
            content: [{ type: "tool_result", content: "a".repeat(100000) }],
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("digestLine — what it refuses to read", () => {
  it("skips sidechain rows: a subagent is a different conversation", () => {
    expect(
      digestLine(userTurn("subagent prompt", { isSidechain: true })),
    ).toBeNull();
    expect(
      digestLine(
        assistantTurn([{ type: "text", text: "subagent reply" }], {
          isSidechain: true,
        }),
      ),
    ).toBeNull();
  });

  it("drops the non-conversation line types", () => {
    for (const type of [
      "ai-title",
      "attachment",
      "file-history-snapshot",
      "mode",
      "permission-mode",
      "last-prompt",
      "system",
    ]) {
      expect(
        digestLine(line({ type, message: { content: "noise" } })),
      ).toBeNull();
    }
  });

  it("drops a torn line instead of throwing", () => {
    // A live process appends to the transcript, so the last line can be a
    // partial write. One torn line must not cost the caller the session.
    expect(
      digestLine('{"type":"user","promptSource":"typed","mess'),
    ).toBeNull();
    expect(digestLine("")).toBeNull();
    expect(digestLine("null")).toBeNull();
  });
});

describe("dedupe", () => {
  const row = (kind: DigestRow["kind"], text: string): DigestRow => ({
    kind,
    text,
  });

  it("collapses a re-recorded opening turn", () => {
    // Observed in a real transcript: the same first prompt written twice,
    // seconds apart, as two roots with DIFFERENT uuids.
    const { rows, removed } = dedupe([
      row("user", "I want to radically change this"),
      row("user", "I want to radically change this"),
      row("assistant", "understood"),
    ]);
    expect(removed).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it("KEEPS repeated answers that are genuinely separate turns", () => {
    // The regression this rule exists for: "yes" is a legitimate answer a user
    // gives many times. An assistant turn always sits between two real ones,
    // so adjacency — not content — is what tells them apart.
    const { rows, removed } = dedupe([
      row("user", "yes"),
      row("assistant", "first question"),
      row("user", "yes"),
      row("assistant", "second question"),
      row("user", "yes"),
    ]);
    expect(removed).toBe(0);
    expect(rows).toHaveLength(5);
  });

  it("does not collapse the same text from different speakers", () => {
    const { removed } = dedupe([
      row("user", "ship it"),
      row("assistant", "ship it"),
    ]);
    expect(removed).toBe(0);
  });

  it("is a no-op on an empty digest", () => {
    expect(dedupe([])).toEqual({ rows: [], removed: 0 });
  });
});

describe("resolveTranscript", () => {
  const NOWHERE = "/nonexistent-dir-for-gather-tests";

  it("never substitutes another session for one named explicitly", () => {
    // Regression: this silently resolved to the newest session in the current
    // directory and reported success, so a caller asking for session A would
    // have distilled session B's lessons and been told they were A's.
    const r = resolveTranscript({
      sessionId: "definitely-not-a-session-0000",
      cwd: NOWHERE,
    });
    expect(r.transcript).toBeNull();
    expect(r.missing).toBe(true);
  });

  it("reports nothing-found (not missing) when no session was named", () => {
    const prev = process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    try {
      const r = resolveTranscript({ cwd: NOWHERE });
      expect(r.transcript).toBeNull();
      expect(r.missing).toBe(false);
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CODE_SESSION_ID = prev;
    }
  });
});

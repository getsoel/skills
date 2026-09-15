import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContext } from "./check";
import { normalizeTopicName, scaffoldTopic } from "./scaffold";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-"));
  mkdirSync(join(root, "context"));
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\nIMPORTANT: scan the entries first.\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("normalizeTopicName kebab-cases and strips .md", () => {
  expect(normalizeTopicName("featureFlags")).toBe("feature-flags");
  expect(normalizeTopicName("Feature Flags.md")).toBe("feature-flags");
  expect(normalizeTopicName("auth")).toBe("auth");
});

test("scaffoldTopic creates a doc + wired index entry, leaving the corpus error-free", () => {
  const res = scaffoldTopic(root, "auth", "touching login, sessions, JWT");
  expect(res.topicRel).toBe("context/auth.md");
  expect(existsSync(join(root, "context", "auth.md"))).toBe(true);
  expect(readFileSync(join(root, "context", "index.md"), "utf8")).toContain(
    "`context/auth.md` - Use when: touching login, sessions, JWT",
  );
  expect(checkContext(root).findings.filter((f) => f.sev === "error")).toHaveLength(0);
});

test("scaffoldTopic normalizes a camelCase name", () => {
  const res = scaffoldTopic(root, "featureFlags", "touching feature flags, gating, rollout");
  expect(res.name).toBe("feature-flags");
  expect(res.normalized).toBe(true);
  expect(existsSync(join(root, "context", "feature-flags.md"))).toBe(true);
});

test("scaffoldTopic refuses a duplicate", () => {
  scaffoldTopic(root, "auth", "touching login");
  expect(() => scaffoldTopic(root, "auth", "touching login")).toThrow(/already exists/);
});

test("scaffoldTopic refuses when there is no index", () => {
  rmSync(join(root, "context", "index.md"));
  expect(() => scaffoldTopic(root, "auth", "x")).toThrow(/no context\/index\.md/);
});

test("scaffoldTopic refuses an empty trigger", () => {
  expect(() => scaffoldTopic(root, "auth", "   ")).toThrow(/empty trigger/);
});

test("scaffoldTopic with an area writes the doc into the area and its index, not the root", () => {
  mkdirSync(join(root, "context", "payments"));
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/payments/index.md` - Use when: payments ledger webhooks\n");
  writeFileSync(join(root, "context", "payments", "index.md"), "# Payments\n\n- `context/payments/ledger.md` - Use when: payments ledger postings\n");
  writeFileSync(join(root, "context", "payments", "ledger.md"), "# Ledger\n\npayments ledger postings\n");

  const res = scaffoldTopic(root, "webhooks", "payments webhook signing, retries", { area: "payments" });
  expect(res.topicRel).toBe("context/payments/webhooks.md");
  expect(res.indexRel).toBe("context/payments/index.md");
  expect(existsSync(join(root, "context", "payments", "webhooks.md"))).toBe(true);
  expect(readFileSync(join(root, "context", "payments", "index.md"), "utf8")).toContain(
    "`context/payments/webhooks.md` - Use when: payments webhook signing, retries",
  );
  expect(readFileSync(join(root, "context", "index.md"), "utf8")).not.toContain("webhooks.md");
  expect(checkContext(root).findings.filter((f) => f.sev === "error")).toHaveLength(0);
});

test("scaffoldTopic with an area refuses when that area has no index", () => {
  expect(() => scaffoldTopic(root, "webhooks", "payments webhooks", { area: "payments" })).toThrow(/no context\/payments\/index\.md/);
});

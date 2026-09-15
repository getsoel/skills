import { expect, test } from "bun:test";
import { ANCHOR_LABEL_RE, ANCHORS, FOOTGUN_SECTION_RE, GUARDS } from "./vocabulary";

test("anchor ladder is strongest-first", () => {
  expect(ANCHORS[0]).toBe("source");
  expect(ANCHORS).toContain("verify");
});

test("guards are enforce + verify", () => {
  expect([...GUARDS]).toEqual(["enforce", "verify"]);
});

test("label and section regexes match the canonical vocabulary", () => {
  expect(ANCHOR_LABEL_RE.test("stale-by: re-check after the next deploy")).toBe(true);
  expect(ANCHOR_LABEL_RE.test("sourced from the spec")).toBe(false);
  expect(FOOTGUN_SECTION_RE.test("## Sharp edges")).toBe(true);
});

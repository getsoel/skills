import { expect, test } from "bun:test";
import { globStaticPrefix, globToRegExp } from "./glob";

test("* stays within a path segment", () => {
  const re = globToRegExp("scripts/*.mjs");
  expect(re.test("scripts/a.mjs")).toBe(true);
  expect(re.test("scripts/sub/a.mjs")).toBe(false);
});

test("** crosses slashes", () => {
  expect(globToRegExp("src/**").test("src/a/b/c.ts")).toBe(true);
});

test("**/ matches zero or more directories", () => {
  const re = globToRegExp("**/x.ts");
  expect(re.test("x.ts")).toBe(true);
  expect(re.test("a/b/x.ts")).toBe(true);
});

test("globStaticPrefix returns the non-wildcard directory prefix", () => {
  expect(globStaticPrefix("src/auth/**")).toBe("src/auth");
  expect(globStaticPrefix("**/x")).toBe("");
  expect(globStaticPrefix("scripts/*.mjs")).toBe("scripts");
});

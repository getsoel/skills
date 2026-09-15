// Library entry for tools that embed the context-index checker (e.g. contractor's
// `contractor context`). Agents use the bundled scripts/context-index.mjs instead.
export { main } from "./cli";
export * from "./check";
export * from "./footguns";
export * from "./gather";
export * from "./ignore";
export * from "./scaffold";
export type { IndexEntry } from "./index-entry";

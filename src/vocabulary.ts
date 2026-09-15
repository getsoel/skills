// The single home for the anchor + footgun terms the validator and the footgun harvester read,
// so the two tools cannot drift apart on the definitions. Zero deps.

// The anchor ladder (skills/context-index/references/anchored-claims.md). Order = strongest first.
export const ANCHORS = [
  "source",
  "invariant",
  "enforce",
  "verify",
  "stale-by",
] as const;
export type Anchor = (typeof ANCHORS)[number];

// A GUARD makes an invariant "covered": an automated check holds the line. enforce | verify.
export const GUARDS = ["enforce", "verify"] as const;
export type Guard = (typeof GUARDS)[number];

// `external:` is the remediation ladder's terminal rung made explicit: the author already
// triaged the invariant and concluded no in-repo fix or check is feasible (upstream
// service, infra, git semantics). It is NOT a guard - but its presence means the footgun
// harvester should not re-flag the invariant as "without guard" every audit.
export const EXTERNAL_LABEL_RE = /\bexternal:/i;

// Words / headings that mark a documented footgun (read by the audit harvester and the
// stale-prose heuristic). Broad on purpose: recall here, precision in the model triage.
export const FOOTGUN_SIGNALS = [
  "gotcha",
  "footgun",
  "foot-gun",
  "silently",
  "caveat",
  "pitfall",
] as const;
export const FOOTGUN_SECTIONS = [
  "gotcha",
  "pitfall",
  "footgun",
  "foot-gun",
  "caveat",
  "sharp edge",
  "watch out",
] as const;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flex = (t: string): string => esc(t).split(" ").join("\\s*"); // multi-word terms tolerate spacing

// Prebuilt NON-global regexes (no /g -> safe to share; only used with .test()).
export const ANCHOR_LABEL_RE: RegExp = new RegExp(
  `\\b(?:${ANCHORS.map(esc).join("|")}):`,
  "i",
);
export const GUARD_LABEL_RE: RegExp = new RegExp(
  `\\b(?:${GUARDS.map(esc).join("|")}):`,
  "i",
);
export const INVARIANT_LABEL_RE = /\binvariant:/i;
export const FOOTGUN_WORD_RE: RegExp = new RegExp(
  `\\b(?:${FOOTGUN_SIGNALS.map(esc).join("|")})\\b`,
  "i",
);
export const FOOTGUN_SECTION_RE: RegExp = new RegExp(
  `^#{1,6}\\s+.*(?:${FOOTGUN_SECTIONS.map(flex).join("|")})`,
  "i",
);

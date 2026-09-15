# Anchored claims

How to write facts that can go stale - env topology, deployed versions, endpoints, config, gotchas - so they don't rot silently.

IMPORTANT: A claim about mutable state rots because nothing links it back to what makes it true. Anchor every drift-prone fact to its prover, and prefer documenting the **intended state** (an invariant reality must conform to) over the **actual state** (a snapshot that decays). A dated "verified" note with no prover reads authoritative while going wrong on day 2 - that is worse than no claim.

## The one rule: push each fact up this ladder

`source:` > `invariant:`/`enforce:` > `verify:` > `stale-by:` dated prose.

These five labels are the canonical vocabulary - they are defined once in the anchor vocabulary the validator and the footgun harvester share (`src/vocabulary.ts` in the skill's source repo), so the tools never drift from this list.

Push every state fact as far up as it will go. The higher tiers make drift impossible or loud; the bottom tier just makes it dated.

## The anchors

- **`source:`** - the fact is OWNED by a declarative artifact (a schema'd config, a lockfile, another repo). NEVER transcribe its values into prose - cite the artifact and omit the value. One fact, one home, so it cannot drift.
  - `source: deploy/environments.json` for namespace / db / port / secret path.
  - Partition ownership FIRST: for each field, name the one spec that owns it; the doc keeps only the fields no spec owns. (e.g. `deploy/environments.json` owns namespace/db; the doc owns the tenant-to-deployment mapping; `infra/topology.json` owns the per-tenant worker pool.)
- **`invariant:` + `enforce:`** - the fact is a normative rule reality MUST satisfy. State it as intended state, not a snapshot. Name the check that holds the line in `enforce:` (lint, CI, test, schema); reality then cannot regress silently.
  - `invariant: migration tag MUST end -migration-<sha>` / `enforce: deploy tag-format check`.
- **`verify:`** - the fact is live state that drifts and is not enforceable. State the INTENDED shape, then give the one-liner that re-proves it. The command is the reconciler - running it is how a future agent trusts the claim.
  - `verify: ./scripts/env-verify.sh prod` (asserts all tenants = own transcode + shared VF).
  - The reconciler MUST report three outcomes, not two: conform / drift / **unchecked**. A verify that reports "drift" when it actually could not reach or auth into the system cries wolf; one that reports "pass" then gives false confidence. Separate "could not check" from "failed".
  - Name the command's prerequisites (auth, tunnel, ssh-agent) or point at the setup doc - else "unchecked" masquerades as "broken".
- **`stale-by:`** - the honest floor, NOT a failure tier. When a fact genuinely cannot be sourced, enforced, or cheaply verified, mark it `stale-by:` with the reason - do not fabricate a higher anchor you cannot honor. Pair with a re-check trigger; never leave a bare date.
  - `stale-by: re-check vs deploy-ops if non-prod archiving regresses (VF-side, unpinned)`.

## Intended over actual

When you are about to write "X is currently Y (verified `<date>`)", stop and ask "what is the INTENDED invariant?"

- Document the invariant as the durable claim.
- Attach a `verify:` that re-proves it.
- Let the dated snapshot be the verify command's OUTPUT, not the prose.

The matrix of per-item current state belongs to the check, not the doc. The doc holds the shape; the check holds the proof.

## Intent is data the check reads, never logic it contains

A `verify:`/`enforce:` check must READ the intended state from a spec file (the `source:`), not hardcode it in the command body. Hardcoding the expected values just moves the drift one layer down - now the doc and the checker disagree, and the checker is the copy nobody re-reads. Keep the intent in one declarative file; the check loads and asserts against it.

## Writing an anchored claim

Lead with the claim or invariant, then the anchor line(s). Keep anchors as labeled lines:

```
## Migration image tag (invariant)
invariant: tag MUST end `-migration-<sha>` (sha LAST) -> Job name `...-migrate-<sha>`,
           unique per commit, so ArgoCD re-renders + runs a fresh Job every deploy.
why:       old `...-<sha>-migration` -> CONSTANT name; ArgoCD never re-renders ->
           migrations freeze silently while the app advances (500s on missing columns).
enforce:   <tag-format check in the deploy wrapper>
verify:    <per-tenant tag audit one-liner>
```

## Triage existing docs (when reflecting or refactoring)

Sort each state-bearing line and move it up the ladder:

- Value transcribed from a spec that already owns it -> delete the value, add `source:`.
- Snapshot with a verified-date -> reframe to `invariant:` + `verify:`; move the dated incident history to a commit message, changelog, or a sibling incident/topic doc.
- Footgun / gotcha -> first run the remediation ladder (`references/reflect-heuristics.md` -> "Prefer the fix over the note"): fix the root cause in code or add an `enforce:` check so it cannot recur. Only if neither is feasible, keep it - stated as an `invariant:`, not bare prose. A deleted footgun and an enforced invariant both beat a documented one.

## What NOT to anchor

- Conventions and architecture that do not describe mutable state - they are durable by nature; anchoring them is noise.
- A `verify:` you will not maintain, or one that cannot tell "unchecked" from "failed" - a broken or ambiguous verify is worse than none: it cries wolf or breeds false confidence. Omit it rather than ship a lie.
- Anything you would otherwise drop per `references/reflect-heuristics.md` - anchoring is not a reason to keep a one-off.

## Reflect integration

During `reflect`, when a kept learning is a state fact (env, version, endpoint, deployed config, gotcha), apply an anchor BEFORE writing it. A learning with no possible anchor and no `stale-by:` trigger is a snapshot - prefer dropping it to enshrining it.

IMPORTANT: Document intended state, not actual state. Push each fact up the ladder `source:` > `invariant:`/`enforce:` > `verify:` > `stale-by:`. Dated prose with no prover is the weakest tier - use it only when nothing else fits.

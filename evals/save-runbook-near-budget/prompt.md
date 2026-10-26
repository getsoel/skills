---
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill]
---

We just spent the afternoon working out how to rotate tenant-acme's storage keys, and I want future sessions to have it. Capture this in the repo's context docs. Apply it directly - don't stop to ask me to confirm.

How rotating tenant-acme's B2 storage keys works:

1. Keys live in Vault at `secret/tenants/acme/b2`; the seed in `packages/cli/provision/tenant-acme/` reads them at runtime, never from `.env`.
2. Create the new key first, scoped to the one bucket: `b2 key rotate --bucket acme-media --capabilities read,write,list`. Never create an account-wide key - the media worker would gain delete on every tenant's bucket.
3. Write it to Vault as a NEW version (`vault kv patch secret/tenants/acme/b2 keyId=... applicationKey=...`); do not delete the old version yet.
4. Restart the media worker with `pnpm cli tenant restart acme --component media --target prod --yes`. The API picks up the new version on its next config poll (up to 5 minutes); the worker does not poll, which is why it needs the restart.
5. Watch for 403s in the worker log (`tenant=acme`, `component=media`) for 15 minutes. A 403 within the first minute means the bucket scope is wrong; a 403 after 5 minutes means the API is still on the old version - check the config poll.
6. Only after a clean 15 minutes, revoke the old key: `b2 key delete <old key id>`. Revoking first is what took acme's uploads down for 40 minutes in the March incident.
7. Staging uses `acme-media-staging` and the `secret/tenants/acme-staging/b2` path; the steps are otherwise identical, and staging is where to rehearse.

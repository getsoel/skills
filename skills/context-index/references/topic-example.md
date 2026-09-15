# Auth

Use when: touching login, auth, sessions, permissions, or seeing 401/403

## Session shape

Sessions are JWTs signed with HS256, stored in an httpOnly cookie named `_acme_session`. Decode with `validateSession()` from `src/auth/session.ts` - it throws `UnauthorizedError` on failure.

## RBAC

Roles are checked via `requireRole()` middleware in `src/auth/rbac.ts`. Available roles: `admin`, `member`, `viewer`. Hierarchy is enforced - `admin` implicitly includes `member` and `viewer` permissions.

## Common pitfalls

- Don't use `jwt.verify()` directly - always go through `validateSession()` so error handling is consistent
- 401 means "not authenticated", 403 means "authenticated but lacks permission" - don't mix these

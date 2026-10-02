# Deferred Product Work

This repository is an early foundation, not a production-ready placement platform. The workspace began with a product prompt and no existing application. Work is being staged in the prompt's build order so security and data ownership can be established before candidate data is handled.

## Verification Gate — 2026-10-02

| item | status | evidence |
|---|---|---|
| Test database isolation | implemented; local container execution blocked | PostgreSQL guard tests pass 8/8; Docker CLI is unavailable, so no local DB changes were applied |
| Auth, interview, and RBAC API flows | previously verified; rerun against isolated local DB pending | prior real-database API checks passed, RBAC 196/196; current local test service has not been started |
| C: GET /api/v1/auth/me/export 500 | intermittent, root cause unknown, open | historical report says latest API run passes; capture fresh diagnostics if it recurs |
| Candidate happy-path E2E | previously passed; rerun on isolated local DB pending | probability E2E reported 1/1 pass on 2026-10-01; current environment cannot start Docker |
| Placement probability API/UI | implemented and data-backed; snapshots remain unimplemented | endpoint and simulation API tests plus prior E2E pass; confidence/breakdown and next-step cue render from live scores |
| Production builds | passed in prior Phase 2 verification | backend and frontend production builds completed without diagnostics |
| Milestones 11-13 | not implemented | recruiter/jobs, placement officer, mentor, and admin workflows remain |
| Milestone 14 | in progress | focused automated checks pass; full DB-backed and accessibility/performance verification remains |
| Acceptance gaps | open | coding sandbox, probability snapshots/trends, recruiter/officer/mentor/admin flows, and full-stack local verification remain |

- **Gate status:** the test database setup and safety checks are implemented. Local integration/E2E reruns are blocked until Docker is available or a permitted local PostgreSQL instance is configured.
- **Open issue:** the account-export 500 was intermittent and has no known root cause; it has not been reproduced in this workspace.
- **Next verification:** copy `backend/.env.test.example` to `backend/.env.test`, start the isolated test database, migrate and seed it, then run API and Playwright suites.

## Remaining build-order milestones

- **Milestones 1-2:** scaffold and schema/seeds are implemented; isolated DB revalidation remains.
- **Milestones 3-10:** candidate slices are implemented, including text interviews and the placement probability route/UI; details such as coding execution and probability history snapshots remain deferred.
- **Milestones 11-13:** recruiter, placement-officer, mentor, and admin product workflows remain.
- **Milestone 14:** continue test-database verification, then harden security, accessibility, performance, i18n, and deployment documentation.

## Acceptance gaps

The prompt's full end-to-end acceptance criteria are not yet fully verified. Auth, RBAC, interview, and probability checks have prior passing evidence, but they need a fresh run on the isolated local test database. The export endpoint's intermittent 500 remains unexplained. Do not describe the platform as production-ready.
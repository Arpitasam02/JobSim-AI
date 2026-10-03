# PlacePrep AI

PlacePrep AI is a placement-preparation platform for candidates, recruiters, placement officers, mentors, and platform administrators. This repository is the first monorepo scaffold from the product build plan.

## Prerequisites

- Node.js 20 or newer and npm 10 or newer
- Docker Desktop with Docker Compose
- Python 3.11 or newer for running the AI service outside Docker

## Run the full stack

1. Copy `.env.example` to `.env` and configure the primary `DATABASE_URL`. The primary database may be hosted or the existing local Compose `postgres` service.
2. For integration and E2E tests, use the separate local `postgres-test` service on host port `5433`; never use the primary URL as `DATABASE_URL_TEST`.
3. Open the web app at `http://localhost:5173`. The API health endpoint is `http://localhost:4000/api/v1/health`; the AI service health endpoint is `http://localhost:8000/health`.

The database credentials in Compose are for local development only. Do not use them in a deployed environment.

## Run the web app and API without Docker

Use PowerShell in Windows and run these terminals in order.

Terminal 1: AI service on port 8000

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI\ai-service'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
$env:AI_SERVICE_PORT = '8000'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Confirm it is running with a log line like `Application startup complete` or `http://127.0.0.1:8000/health`.

Terminal 2: backend on port 4000

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\tsx.cmd watch .\backend\src\server.ts
```

Confirm it is running with the server log or `http://localhost:4000/api/v1/health` returning a JSON response.

Terminal 3: frontend on port 5173

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173
```

Confirm it is running with a Vite startup line such as `Local: http://localhost:5173/`.

Terminal 4: configuration check

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node .\backend\scripts\check-env.mjs
```

Terminal 5: test database migrate and seed

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node .\backend\scripts\migrate.mjs --test
node .\backend\scripts\seed.mjs --test
```

Terminal 6: Supertest validation

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node --test .\backend\tests\api\auth.test.mjs .\backend\tests\api\rbac-matrix.test.mjs .\backend\tests\api\interviews.test.mjs
```

Confirm it ends with a final summary showing passed / failed / skipped counts.

Terminal 7: Playwright validation

The E2E suite requires the AI resume parser to return HTTP 2xx from `http://127.0.0.1:8000/health`. Start it first with `docker compose up -d ai-service --wait`, or follow the venv/uvicorn commands in Terminal 1 above. Playwright checks the configured `AI_SERVICE_URL` before starting the test API and fails early with both startup options if the health check fails; it does not start the service.

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\playwright.cmd test --config .\frontend\e2e\playwright.config.ts
```

Confirm it ends with a final summary showing passed / failed / skipped counts.

Database-backed features require PostgreSQL; Redis is optional and only improves caching, rate limiting, and queue features. If `REDIS_URL` is unset, the backend logs a warning and continues without those features.

With PostgreSQL available, run `npm.cmd run db:migrate --workspace @placeprep/backend` to apply schema migrations and `npm.cmd run db:seed --workspace @placeprep/backend` to add development sample data. Seed accounts use the `SEED_USER_PASSWORD` value (default: `PlacePrep-Dev-2026!`); change it before sharing a development database and never use seed credentials in production.

## Repository layout

- `frontend/`: React, TypeScript, Vite, Tailwind CSS, and the candidate dashboard shell.
- `backend/`: Express REST API in TypeScript.
- `ai-service/`: FastAPI service boundary for parsing and scoring adapters.
- `docs/`: implementation decisions and product documentation.

## Checks

Run `npm run lint`, `npm test`, and `npm run build` at the root. CI runs these checks for frontend and API changes. Python checks and service-level test suites will be added alongside their implementation milestones.

## Build status

Milestones 1-2 are in place. Milestone 10 is complete: the candidate workflow is implemented end-to-end with auth and consent, PDF/DOCX resume analysis, role fit and tracked roadmap, timed assessments, text interviews with evaluation, and a data-backed placement probability estimate with what-if scenarios. The candidate dashboard and probability panel now turn the weakest available signal into a direct next step.

Milestone 11, slice 1 is also complete: the recruiter workspace has a live job-creation and applicant-review flow for company postings and application tracking. Remaining slices are explicitly deferred: 11.2 placement officer batch workflows, 11.3 mentor review/evaluation flows, and 11.4 shared scheduling and notifications (calendar + reminders). Milestone 12 (admin), Milestone 13 (full role dashboards), and Milestone 14 hardening remain; see `docs/backlog.md` for the current verification status and known gaps.

The API and UI require PostgreSQL for authenticated workflows. Start the database using Docker Compose before using registration, resume history, or analysis. Resume files are local in development; configure production malware scanning and private S3-compatible storage before deployment.
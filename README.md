# PlacePrep AI

A full-stack placement-preparation platform for candidates, recruiters, placement officers, mentors, and platform administrators.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router 7 |
| Backend | Node.js 20, Express 4, TypeScript, PostgreSQL (pg), Zod, bcryptjs, Helmet |
| AI Service | Python 3.11, FastAPI, pypdf, python-docx, PyMuPDF, Tesseract OCR |
| Infrastructure | Docker Compose, PostgreSQL 16, Redis 7, Nginx |

---

## Architecture Overview

```
Browser (React SPA)
      │  HTTP / REST
      ▼
Express API  (:4000)
      │  HTTP
      ▼
FastAPI AI Service  (:8000)
      │
      ├── PostgreSQL  (:5432)  — primary data store
      └── Redis  (:6379)       — cache, rate-limit, queues (optional)
```

- The React SPA is a single-page app served by Vite in development and Nginx in Docker.
- All authenticated API calls carry a short-lived JWT access token in the `Authorization` header.
- A `HttpOnly` refresh-token cookie is used to silently renew the access token on page load.
- The AI service is a stateless FastAPI boundary; the Express API calls it for resume parsing.
- Redis is optional — the backend degrades gracefully when `REDIS_URL` is unset.

---

## Flow of Execution

### 1. Application startup

```
Docker Compose (or manual terminals)
  ├── postgres starts → healthcheck passes
  ├── redis starts → healthcheck passes
  ├── ai-service starts (uvicorn) → GET /health returns {"status":"ok"}
  └── api starts (tsx / node) → reads backend/.env → connects to postgres
        └── frontend starts (vite / nginx) → proxies /api/* to api:4000
```

### 2. User authentication

```
Browser                     Express API                  PostgreSQL
  │── POST /api/v1/auth/register ──▶│                        │
  │                                 │── INSERT users ────────▶│
  │◀── 201 { accessToken, user } ───│◀───────────────────────│
  │                                 │
  │── POST /api/v1/auth/login ──────▶│
  │                                 │── SELECT + bcrypt verify│
  │◀── 200 { accessToken, user } ───│  Set-Cookie: refreshToken (HttpOnly)
  │
  │  (on page reload)
  │── POST /api/v1/auth/refresh ────▶│  reads HttpOnly cookie
  │◀── 200 { accessToken, user } ───│  issues new access token
```

### 3. Resume upload and analysis

```
Browser                     Express API              FastAPI AI Service
  │── POST /api/v1/resumes ──────────▶│                    │
  │   (multipart PDF/DOCX, ≤5 MB)    │── POST /resume/parse ──▶│
  │                                  │   raw bytes + headers    │
  │                                  │                    │── extract text (pypdf / python-docx)
  │                                  │                    │── OCR fallback (PyMuPDF + Tesseract)
  │                                  │                    │── parse sections, skills, contact
  │                                  │◀── parsed JSON ────│
  │                                  │── score + store in postgres
  │◀── 201 { resumeId, score, … } ───│
```

### 4. Role fit and skill roadmap

```
Browser                     Express API              PostgreSQL
  │── GET /api/v1/me/role-fit ────────▶│                    │
  │                                   │── SELECT role_catalog, role_skill_weights, skills
  │                                   │── compare candidate skills vs role weights
  │◀── 200 { roleMatches, roadmap } ──│
```

### 5. Mock assessments

```
Browser                     Express API              PostgreSQL
  │── GET /api/v1/tests ──────────────▶│                    │
  │◀── 200 { tests } ─────────────────│                    │
  │── POST /api/v1/tests/:id/submit ──▶│                    │
  │                                   │── score answers, INSERT attempt
  │◀── 200 { score, feedback } ───────│
```

### 6. Mock interviews

```
Browser                     Express API              PostgreSQL
  │── POST /api/v1/interviews/start ──▶│                    │
  │◀── 200 { interviewId, question } ──│                    │
  │── POST /api/v1/interviews/:id/answer ▶│                 │
  │                                   │── evaluate answer, INSERT response
  │◀── 200 { feedback, nextQuestion } ─│
```

### 7. Placement probability

```
Browser                     Express API              PostgreSQL
  │── GET /api/v1/me/placement-probability ▶│              │
  │                                        │── aggregate resume, roleFit,
  │                                        │   assessment, interview, profile scores
  │◀── 200 { probability, factors, … } ───│
  │
  │── POST /api/v1/me/placement-probability/simulate ▶│
  │   { assessments: 85, interviews: 80 }             │── recalculate with overrides
  │◀── 200 { before, after, delta } ─────────────────│
```

### 8. Recruiter workspace

```
Browser                     Express API              PostgreSQL
  │── POST /api/v1/recruiter/jobs ─────▶│                    │
  │◀── 201 { jobId } ─────────────────│                    │
  │── GET /api/v1/recruiter/jobs/:id/applicants ▶│          │
  │◀── 200 { applicants } ────────────│                    │
  │── POST /api/v1/applications/:id/decision ▶│             │
  │◀── 200 { status } ────────────────│
```

---

## Prerequisites

- Node.js 20+ and npm 10+
- Docker Desktop with Docker Compose
- Python 3.11+ (only needed when running the AI service outside Docker)

---

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL, JWT_ACCESS_SECRET, FRONTEND_URL
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:4000/api/v1/health |
| AI Service | http://localhost:8000/health |

---

## Manual Start (PowerShell, no Docker)

Run each terminal in order and wait for the confirmation message before starting the next.

**Terminal 1 — AI service (port 8000)**
```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI\ai-service'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
$env:AI_SERVICE_PORT = '8000'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# Confirm: "Application startup complete"
```

**Terminal 2 — Backend API (port 4000)**
```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\tsx.cmd watch .\backend\src\server.ts
# Confirm: "PlacePrep API listening on port 4000"
```

**Terminal 3 — Frontend (port 5173)**
```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173
# Confirm: "Local: http://localhost:5173/"
```

---

## Database Setup

```powershell
# Apply schema migrations
npm run db:migrate --workspace @placeprep/backend

# Seed development data (default password: PlacePrep-Dev-2026!)
npm run db:seed --workspace @placeprep/backend
```

For the test database (port 5433):
```powershell
node .\backend\scripts\migrate.mjs --test
node .\backend\scripts\seed.mjs --test
```

> Never use `DATABASE_URL` as `DATABASE_URL_TEST`. They must point to separate databases.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Primary PostgreSQL connection string |
| `DATABASE_URL_TEST` | Test only | — | Separate test database (port 5433) |
| `JWT_ACCESS_SECRET` | Yes | dev default | Must be ≥32 chars; required in production |
| `FRONTEND_URL` | No | http://localhost:5173 | CORS allowed origin |
| `AI_SERVICE_URL` | No | http://localhost:8000 | FastAPI service base URL |
| `REDIS_URL` | No | unset | Enables cache, rate-limit, and queue features |
| `API_PORT` | No | 4000 | Express server port |
| `SEED_USER_PASSWORD` | No | PlacePrep-Dev-2026! | Password for seeded dev accounts |

---

## Running Tests

```powershell
# Unit tests
npm test

# API integration tests (requires running postgres-test on port 5433)
node --test .\backend\tests\api\auth.test.mjs .\backend\tests\api\rbac-matrix.test.mjs .\backend\tests\api\interviews.test.mjs

# E2E tests (requires AI service running on port 8000)
.\node_modules\.bin\playwright.cmd test --config .\frontend\e2e\playwright.config.ts

# Lint
npm run lint

# Build
npm run build
```

---

## Repository Layout

```
JobSim AI/
├── frontend/          React SPA — candidate dashboard, recruiter workspace
│   ├── src/
│   │   ├── App.tsx              Root component, routing, session management
│   │   ├── auth/                Login, register, consent pages
│   │   ├── resumes/             Resume upload and analysis workspace
│   │   ├── roles/               Role fit and skill roadmap workspace
│   │   ├── assessments/         Timed mock test workspace
│   │   ├── interviews/          Text-based mock interview workspace
│   │   ├── jobs/                Candidate job explorer, recruiter job manager
│   │   └── assistant/           Study assistant panel
│   └── e2e/                     Playwright end-to-end tests
│
├── backend/           Express REST API
│   ├── src/
│   │   ├── server.ts            Entry point
│   │   ├── app.ts               Express app factory, middleware, error handler
│   │   ├── config.ts            Env validation with Zod
│   │   ├── db.ts                PostgreSQL pool
│   │   ├── auth/                JWT auth, refresh tokens, RBAC middleware
│   │   ├── resumes/             Resume upload, AI proxy, scoring
│   │   ├── roles/               Role catalog, fit scoring, roadmap
│   │   ├── assessments/         Test delivery and scoring
│   │   ├── interviews/          Interview session and evaluation
│   │   └── jobs/                Job postings and application decisions
│   ├── migrations/              SQL schema migrations
│   └── scripts/                 migrate, seed, check-env helpers
│
├── ai-service/        FastAPI resume parser
│   └── app/main.py              PDF/DOCX extraction, OCR, skill parsing
│
├── docs/              Architecture decisions, ERD, backlog
├── docker-compose.yml Full stack: web, api, ai-service, postgres, redis
└── .env.example       Environment variable template
```

---

## Known Issues and Gaps

- Milestones 11.2 (placement officer batch workflows), 11.3 (mentor review), and 11.4 (scheduling and notifications) are deferred.
- Milestone 12 (admin panel), 13 (full role dashboards), and 14 (hardening) are not yet implemented.
- Resume files are stored locally in `uploads/resumes/`; configure S3-compatible storage and malware scanning before production deployment.
- The streak counter in the sidebar is hardcoded to "3 day streak" and does not read from `dailyProgress` state.
- The "Interview Readiness" metric card on the dashboard shows static placeholder text.
- The date in the welcome greeting is hardcoded to "WEDNESDAY, SEPTEMBER 30".
- `JWT_ACCESS_SECRET` defaults to a weak dev value; the backend throws at startup in production if it starts with `local-`, but the default is only 46 characters — enforce a stronger minimum in production config.
- The `SEED_USER_PASSWORD` default is documented in the README; rotate it before sharing any development database.
- See `docs/backlog.md` for the full verification status and gap list.

---

## Security Notes

- All error responses redact connection strings, tokens, and secrets before logging or returning to the client.
- Helmet and CORS are configured on every response.
- The JSON body limit is 32 KB; resume uploads are capped at 5 MB with both header and streaming checks.
- DOCX files are validated for zip-bomb conditions (>500 members or >30 MB expanded) before parsing.
- Never commit `.env` files or use development credentials in production.

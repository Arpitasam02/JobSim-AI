# Local Setup and Verification (No Docker)

Run these commands in Windows PowerShell. PostgreSQL is hosted on Neon, so there is no local database service to start. Use a separate hosted database for `DATABASE_URL_TEST`; add `?sslmode=require` to both URLs and never point the test URL at the primary database.

## 1. Install dependencies

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
npm.cmd install
```

Set `DATABASE_URL`, `DATABASE_URL_TEST`, and a private `JWT_ACCESS_SECRET` in `backend/.env`. `REDIS_URL` is optional; leave it unset if you do not run Redis.

## 2. Start the resume parser (Python 3.11 venv, port 8000)

Python 3.11 or newer is required. In its own terminal:

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI\ai-service'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
$env:AI_SERVICE_PORT = '8000'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Confirm it is running with a log line like `Application startup complete` or `http://127.0.0.1:8000/health`.

## 3. Start the backend on port 4000

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\tsx.cmd watch .\backend\src\server.ts
```

Confirm it is running with the server log or `http://localhost:4000/api/v1/health` returning a JSON response.

## 4. Start the frontend on port 5173

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173
```

Confirm it is running with a Vite startup line such as `Local: http://localhost:5173/`.

## 5. Check required configuration

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node .\backend\scripts\check-env.mjs
```

The checker prints only file presence and missing variable names, never values.

## 6. Migrate and seed the test database

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node .\backend\scripts\migrate.mjs --test
node .\backend\scripts\seed.mjs --test
```

The `--test` commands use `DATABASE_URL_TEST`, require it to differ from `DATABASE_URL`, and apply the schema and fixtures needed by integration tests.

## 7. Run Supertest verification

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
node --test .\backend\tests\api\auth.test.mjs .\backend\tests\api\rbac-matrix.test.mjs .\backend\tests\api\interviews.test.mjs
```

This must end with a clear final summary showing passed / failed / skipped counts.

## 8. Run Playwright verification

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\playwright.cmd test --config .\frontend\e2e\playwright.config.ts
```

This must end with a clear final summary showing passed / failed / skipped counts.

## 9. Optional: run the combined DB verification script

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
npm.cmd run verify:db
```

The command refuses to run unless `DATABASE_URL_TEST` exists and differs from `DATABASE_URL`. It builds the backend, runs the Supertest auth/RBAC/interview suites against the test database, then runs Playwright. Playwright starts the test API on `http://127.0.0.1:4001` and Vite on `http://127.0.0.1:5174`.

The E2E generates a sample PDF in memory by default. To use your own, place a text-based PDF at `frontend/e2e/fixtures/candidate-resume.pdf`; the test uses it automatically when present.

The browser flow completes registration, email verification, login, real PDF upload and analysis, role fit, a seeded mock test, and a text interview report. Screenshots, traces, and video recording are disabled.

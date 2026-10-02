# Local Setup and Verification (Windows PowerShell)

The primary database can be hosted or local. For API integration and Playwright E2E tests, use the separate local PostgreSQL 16 `postgres-test` service on host port `5433`. Test migration and seed commands reject remote hosts unless `ALLOW_REMOTE_TEST_DB=true`; the parsed host/port/database guard also rejects a test URL that points to the primary database.

## 1. Install dependencies and configure the primary database

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
npm.cmd install
```

Set the primary `DATABASE_URL` and a private `JWT_ACCESS_SECRET` in `backend/.env`. `REDIS_URL` is optional. The existing Compose `postgres` service uses host port `5432` for a local primary; alternatively set `DATABASE_URL` to your hosted primary.

## 2. Start and initialize the local test database

Copy the example to the ignored local env file, then start the isolated test service:

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
Copy-Item .\backend\.env.test.example .\backend\.env.test
npm.cmd run db:test:up --workspace @placeprep/backend
npm.cmd run db:migrate:test --workspace @placeprep/backend
npm.cmd run db:seed:test --workspace @placeprep/backend
```

Edit `backend/.env.test` if you changed the Compose test user/password. Test scripts load `backend/.env` first and then `backend/.env.test` with override, so the test URL is selected without replacing the primary URL. Startup logs show only the test database host, port, and name.

`db:test:down` stops only the test container and keeps its data. To discard and recreate only the test database volume:

```powershell
npm.cmd run db:test:reset --workspace @placeprep/backend
```

## 3. Run the API and E2E tests

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
npm.cmd run test:api --workspace @placeprep/backend
npm.cmd run test:e2e --workspace @placeprep/frontend
```

The E2E starts the test API on `http://127.0.0.1:4001` and Vite on `http://127.0.0.1:5174`. The test generates a sample PDF in memory by default; it uses `frontend/e2e/fixtures/candidate-resume.pdf` automatically when that file exists.

## 4. Run the app services

Start the resume parser (Python 3.11 or newer) in its own terminal:

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI\ai-service'
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the backend and frontend from the repository root in separate terminals:

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\tsx.cmd watch .\backend\src\server.ts
```

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\JobSim AI'
.\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173
```

The API health endpoint is `http://localhost:4000/api/v1/health`; the web app is `http://localhost:5173`.
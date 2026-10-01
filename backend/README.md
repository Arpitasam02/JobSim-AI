# PlacePrep API

Express and TypeScript REST API. Routes are versioned under `/api/v1`.

## Local setup

From the repository root, install dependencies, copy `.env.example` to `backend/.env`, configure `DATABASE_URL` and a separate `DATABASE_URL_TEST`, start PostgreSQL, then run:

```powershell
npm run db:migrate
npm run db:seed
npm run dev --workspace @placeprep/backend
```

The service listens on port 4000 by default. `GET /api/v1/health` reports API and database availability. Swagger/OpenAPI documentation is not yet implemented.

## Implemented routes

- Auth: register, login, refresh, logout, verify email, forgot/reset password
- Profile: read/update, consent history/update, account export and soft deletion
- Roles: catalog read
- Resumes: upload/list/detail, rule-based analysis, report history
- Practice: test list/create, server-timed attempts, answer autosave, submit/report, consent-gated proctor events, role fit, skill gaps, and roadmaps

Protected routes authenticate a short-lived bearer access token and check the account role. Resume endpoints only permit the candidate owner in this milestone.

## Security notes

Access-token signing secrets must be changed outside development. Refresh tokens are opaque, hashed at rest, and rotated. The browser refresh token is HttpOnly and SameSite=Strict. Set `CLAMAV_HOST` and `CLAMAV_PORT` in production; uploads fail closed if scanning is not configured. Production file storage must be replaced with a private S3-compatible adapter before deployment.

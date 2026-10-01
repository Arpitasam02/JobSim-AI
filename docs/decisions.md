# Implementation Decisions

- The workspace started with only the product prompt and no existing application or Git repository. This implementation follows build-order milestone 1 before adding data schema or feature modules.
- The frontend uses Vite, React, and TypeScript. React Router, TanStack Query, Recharts, and Tailwind are included for the product UI's planned routes, server state, visualizations, and styling.
- The API is an Express TypeScript service, and the AI boundary is a separate FastAPI service. Analysis providers will be adapter-based; this first milestone exposes health checks only and requires no paid credentials.
- PostgreSQL and Redis run locally through Docker Compose. The Compose database credentials and fallback JWT secrets are development-only and must be replaced for any shared or deployed environment.
- The first screen is a candidate dashboard shell with clearly illustrative sample metrics. It does not imply that authentication, candidate data, resume analysis, or probability scoring is implemented yet.
- The first migration uses PostgreSQL UUIDs and JSONB for evolving parsed-resume and scoring payloads; user deletion is soft-deleted while associated retained history follows explicit foreign-key policies.
- Seed accounts are generated for local development only. They are email-verified to ease UI and API development, and all share a configurable seed password.
- Access tokens use short-lived HS256 signatures; opaque refresh tokens are stored hashed and rotated in an HttpOnly, SameSite=Strict cookie. Development email tokens are returned only in development responses until a real email adapter is configured.
- Resume files are stored in a private local directory in development. PDF/DOCX bytes are checked against MIME type and file signature; ClamAV is used when configured, and production uploads fail closed without a scanner. The AI service extracts document text and attempts OCR for scanned PDFs.
- Resume scoring is deterministic and evidence-based in this milestone. It makes no LLM calls and does not invent experience; every generated rewrite is labeled for candidate verification. Role fit currently uses weighted skill evidence and exact project-skill mentions rather than embeddings.
- Node.js/npm are now available and frontend/API TypeScript builds pass. Python and Docker are unavailable, and PostgreSQL is not listening on port 5432, so parser/container/database integration has not been executed here.

## Deferred milestones

Resume builder, skill-gap roadmaps, assessments, interviews, probability, recruiter and institution workflows, and the administrative console follow the strict build order in the source prompt. No LLM outputs or placement estimates are currently calculated.
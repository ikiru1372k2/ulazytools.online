# ulazytools.online

Local development workspace for the `ulazytools.online` repository.

## Getting started

1. Install dependencies: `npm install`
2. Run the app: `npm run dev`, then open `http://localhost:3000`
3. Quality checks: `npm run verify` (typecheck, lint, build), or run `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build` separately

`npm run typecheck` runs a dedicated TypeScript project with incremental state disabled so local verification does not depend on leftover `.tsbuildinfo` or generated `.next/types` files.

## Local auth setup

Issue `#102` adds Google sign-in with Auth.js and Prisma-backed sessions.

After copying `.env.local.example` to `.env.local`, fill in:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

For the Google OAuth app, register this local callback URL exactly:

```text
http://localhost:3000/api/auth/callback/google
```

The public marketing page stays at `/`. The authenticated app area starts at `/dashboard`, and unauthenticated access redirects to `/login`.

The middleware keeps the early auth redirect on `/dashboard` and also attaches `x-request-id` to matched app and API requests. If you add routes that should bypass or extend that behavior later, update `src/middleware.ts` deliberately.

For non-local deployments, also set `AUTH_URL` (or `NEXTAUTH_URL`) to the deployed origin so OAuth callbacks resolve correctly outside `http://localhost:3000`.

## Observability baseline

Issue `#108` adds structured logging with Pino and response/request correlation through `x-request-id`.

- The shared logger entrypoint lives in `src/lib/logger.ts`.
- Matched app and API requests receive an `x-request-id` response header via `src/middleware.ts`.
- Queue producers should pass `requestId` into `enqueuePdfJob(...)` whenever a job originates from an HTTP request so worker logs can preserve end-to-end correlation.
- Runtime logs must include metadata only. Do not log raw tokens, cookies, presigned URLs, or document contents.

## Local storage setup

Issue `#103` adds a storage helper built on the AWS S3 SDK. Local development uses MinIO today, while the same helper can later target AWS S3-compatible storage by changing env values.

Short presigned URL TTLs depend on sane local clock sync. If a presigned URL fails unexpectedly, verify your machine time is correct before debugging the helper.

## Security headers baseline

Issue `#109` adds baseline response hardening through `next.config.mjs`.

Current defaults:

- `Content-Security-Policy`
- `Permissions-Policy`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` in production only

The CSP is intentionally looser in development so Next.js dev tooling keeps working. Production uses a self-first baseline, but it still keeps Next.js-compatible inline script support until we adopt a nonce- or hash-based CSP follow-up. When PDF.js, external viewers, or CDNs are introduced later, relax CSP deliberately in targeted directives rather than weakening it globally.

The most likely future CSP changes will be in:

- `connect-src`
- `img-src` / `media-src`
- `worker-src`
- external `script-src`, `style-src`, or `font-src`

`Strict-Transport-Security` is enabled only in production and does not currently opt into HSTS preload.

## Local infrastructure

Start the local development services with Docker Compose:

```powershell
docker compose up -d
docker compose ps
```

The default local services are:

- Postgres 16: `localhost:5432`
- Redis 7: `localhost:6379`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`

Copy the example environment file and adjust values only if your machine needs different ports or credentials:

```powershell
Copy-Item .env.local.example .env.local
```

```bash
cp .env.local.example .env.local
```

The example file defines local `DATABASE_URL`, `REDIS_URL`, and MinIO-backed `S3_*` values for development.

These credentials are for local Docker development only. Never reuse them in shared, staging, or production environments.

### MinIO bucket setup

Use `ulazy-pdf-dev` as the local bucket name.

To create it with the MinIO console:

1. Open `http://localhost:9001`
2. Sign in with:
   - username: `ulazytools`
   - password: `ulazytools-minio-secret`
3. Create a bucket named `ulazy-pdf-dev`

Optional `mc` CLI alternative:

```powershell
mc alias set local http://localhost:9000 ulazytools ulazytools-minio-secret
mc mb local/ulazy-pdf-dev
```

If `local` is already taken as an `mc` alias on your machine, pick another alias name and use that consistently in both commands.

To stop the stack:

```powershell
docker compose down
```

Data persists in the named Docker volumes `postgres-data` and `minio-data`. Redis is intentionally ephemeral in this setup and will not survive container removal.

If you want to wipe persisted Postgres and MinIO data, run `docker compose down -v`.

If you hit a port collision, remap the host port in a compose override or local copy of `docker-compose.yml`. For example, change `5432:5432` to `5433:5432` and update `.env.local` to match.

## Project structure

```text
.
|-- prisma/
|-- src/
|   |-- app/
|   |-- components/
|   |-- lib/
|   |-- server/
|   |-- types/
|   `-- workers/
|-- package.json
`-- tsconfig.json
```

- `src/app/`: Next.js App Router entrypoints and route-level UI.
- `src/components/`: reusable interface components and presentation primitives.
- `src/lib/`: shared, framework-agnostic helpers and cross-cutting utilities.
- `src/server/`: server-only code, backend orchestration, and infrastructure concerns.
- `src/types/`: shared project types that are not tied to a single feature folder.
- `src/workers/`: background job processors and worker runtime code.
- `prisma/`: schema, migrations, and seed assets.

## Import conventions

Use `@/` imports for modules under `src/`. For example, `@/components/ui` resolves to `src/components/ui`.

Keep server-only code under `src/server/` so it does not leak into client bundles by accident.

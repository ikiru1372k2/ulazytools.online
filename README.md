# ulazytools.online

Local development workspace for the `ulazytools.online` repository.

## Getting started

1. Install dependencies: `npm install`
2. Run the app: `npm run dev`, then open `http://localhost:3000`
3. Quality checks: `npm run verify` (typecheck, lint, build), or run `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build` separately

`npm run typecheck` runs `tsc --noEmit` with incremental state disabled so local verification does not depend on leftover `.tsbuildinfo`. After `npm run dev` or `npm run build`, `.next/types` is picked up for Next.js route typing when present.

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

The middleware matcher currently covers `/dashboard` only. If you add more clean-URL protected routes later, add them to `src/middleware.ts` as well so they get the same early redirect behavior.

For non-local deployments, also set `AUTH_URL` (or `NEXTAUTH_URL`) to the deployed origin so OAuth callbacks resolve correctly outside `http://localhost:3000`.

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

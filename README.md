# ulazytools.online

Local development workspace for the `ulazytools.online` repository.

## Getting started

1. Install dependencies: `npm install`
2. Run the app: `npm run dev`, then open `http://localhost:3000`
3. Quality checks: `npm run verify` (typecheck, lint, build), or run `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build` separately

`npm run typecheck` runs `tsc --noEmit` against `src/` and root `*.ts`/`*.tsx` only; it does not scan arbitrary `.next` build output. After `npm run dev` or `npm run build`, `.next/types` is picked up for Next.js route typing when present.

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
- `prisma/`: future Prisma schema, migrations, and seed assets.

## Import conventions

Use `@/` imports for modules under `src/`. For example, `@/components/ui` resolves to `src/components/ui`.

Keep server-only code under `src/server/` so it does not leak into client bundles by accident.

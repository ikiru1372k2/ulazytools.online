# `src/workers`

Background job processors, queue handlers, and worker runtime code belong here.

Keep worker-specific orchestration here rather than mixing it into app routes or shared utilities.

`pdfWorker.ts` is the BullMQ entrypoint for queued PDF work. Run it with
`npm run worker:dev`.

`cleanupWorker.ts` is the BullMQ entrypoint for repeatable retention cleanup.
Run it with `npm run cleanup:dev`.

BullMQ jobs in local development depend on Redis durability. If Redis is flushed
or restarted without persistence, queued jobs can be lost before the worker
processes them.

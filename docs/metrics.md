# Metrics Endpoint

The app exposes Prometheus-compatible metrics at `GET /api/metrics`.

## Auth and enablement

- If `METRICS_TOKEN` is set, scrapes must send:
  - `Authorization: Bearer <METRICS_TOKEN>`
- If `METRICS_TOKEN` is not set, the route is only available when `METRICS_ENABLED=true`.
- If neither is configured, the endpoint stays disabled by default.

## Metric names

- `ulazy_upload_presign_total`
- `ulazy_jobs_created_total`
- `ulazy_jobs_failed_total`
- `ulazy_job_latency_ms_bucket`
- `ulazy_job_latency_ms_sum`
- `ulazy_job_latency_ms_count`

## Notes

- Labels are intentionally omitted in v1 to avoid high-cardinality metrics.
- Metrics backend failures fail open so uploads and job processing continue normally.
- Local and test environments use an in-memory store; production uses Redis-backed counters when metrics are enabled.

## Minimal Prometheus scrape config

```yaml
scrape_configs:
  - job_name: ulazytools
    metrics_path: /api/metrics
    static_configs:
      - targets: ["localhost:3000"]
    authorization:
      type: Bearer
      credentials: your-metrics-token
```


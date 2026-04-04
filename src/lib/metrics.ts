import "server-only";

import IORedis from "ioredis";

import { getMetricsEnv, getQueueEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";

type CounterMetricName =
  | "ulazy_upload_presign_total"
  | "ulazy_jobs_created_total"
  | "ulazy_jobs_failed_total";

const JOB_LATENCY_METRIC_NAME = "ulazy_job_latency_ms";
const JOB_LATENCY_BUCKETS_MS = [100, 500, 1000, 5000, 15000, 60000] as const;
const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const METRICS_KEY_PREFIX = "metrics";

type HistogramSnapshot = {
  buckets: Record<string, number>;
  count: number;
  sum: number;
};

type MetricsSnapshot = Record<CounterMetricName, number> & {
  [JOB_LATENCY_METRIC_NAME]: HistogramSnapshot;
};

type MetricsStore = {
  incrementCounter: (name: CounterMetricName, by?: number) => Promise<void>;
  observeHistogram: (name: typeof JOB_LATENCY_METRIC_NAME, value: number) => Promise<void>;
  readSnapshot: () => Promise<MetricsSnapshot>;
  reset: () => Promise<void>;
};

type MetricsState = {
  counters: Record<CounterMetricName, number>;
  histogram: HistogramSnapshot;
};

const log = createLogger({
  subsystem: "metrics",
} as never);

const globalForMetrics = globalThis as typeof globalThis & {
  metricsMemoryState?: MetricsState;
  metricsRedis?: IORedis;
  metricsStore?: MetricsStore;
};

function hasRedisCommandErrors(
  results: Array<[Error | null, unknown]> | null
): results is Array<[Error, unknown]> {
  return Boolean(results?.some(([error]) => error));
}

function createEmptyHistogram(): HistogramSnapshot {
  return {
    buckets: Object.fromEntries(
      JOB_LATENCY_BUCKETS_MS.map((bucket) => [String(bucket), 0])
    ),
    count: 0,
    sum: 0,
  };
}

function createEmptyState(): MetricsState {
  return {
    counters: {
      ulazy_jobs_created_total: 0,
      ulazy_jobs_failed_total: 0,
      ulazy_upload_presign_total: 0,
    },
    histogram: createEmptyHistogram(),
  };
}

function getMemoryState() {
  globalForMetrics.metricsMemoryState ??= createEmptyState();
  return globalForMetrics.metricsMemoryState;
}

function isMetricsActive() {
  const metricsEnv = getMetricsEnv();
  return metricsEnv.METRICS_ENABLED || Boolean(metricsEnv.METRICS_TOKEN);
}

function shouldUseRedisMetrics() {
  return process.env.NODE_ENV === "production" && isMetricsActive();
}

function getRedisClient() {
  if (!globalForMetrics.metricsRedis) {
    globalForMetrics.metricsRedis = new IORedis(getQueueEnv().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  }

  return globalForMetrics.metricsRedis;
}

function getCounterKey(name: CounterMetricName) {
  return `${METRICS_KEY_PREFIX}:counter:${name}`;
}

function getHistogramBucketKey(bucket: number) {
  return `${METRICS_KEY_PREFIX}:histogram:${JOB_LATENCY_METRIC_NAME}:bucket:${bucket}`;
}

function getHistogramSumKey() {
  return `${METRICS_KEY_PREFIX}:histogram:${JOB_LATENCY_METRIC_NAME}:sum`;
}

function getHistogramCountKey() {
  return `${METRICS_KEY_PREFIX}:histogram:${JOB_LATENCY_METRIC_NAME}:count`;
}

function createMemoryStore(): MetricsStore {
  return {
    async incrementCounter(name, by = 1) {
      const state = getMemoryState();
      state.counters[name] += by;
    },
    async observeHistogram(_name, value) {
      const state = getMemoryState();
      state.histogram.count += 1;
      state.histogram.sum += value;

      for (const bucket of JOB_LATENCY_BUCKETS_MS) {
        if (value <= bucket) {
          state.histogram.buckets[String(bucket)] += 1;
          break;
        }
      }
    },
    async readSnapshot() {
      const state = getMemoryState();
      return {
        ...state.counters,
        [JOB_LATENCY_METRIC_NAME]: {
          buckets: { ...state.histogram.buckets },
          count: state.histogram.count,
          sum: state.histogram.sum,
        },
      };
    },
    async reset() {
      globalForMetrics.metricsMemoryState = createEmptyState();
    },
  };
}

function createRedisStore(): MetricsStore {
  return {
    async incrementCounter(name, by = 1) {
      const redis = getRedisClient();
      await redis.incrby(getCounterKey(name), by);
    },
    async observeHistogram(_name, value) {
      const redis = getRedisClient();
      const pipeline = redis.multi();

      pipeline.incrbyfloat(getHistogramSumKey(), value);
      pipeline.incr(getHistogramCountKey());

      for (const bucket of JOB_LATENCY_BUCKETS_MS) {
        if (value <= bucket) {
          pipeline.incr(getHistogramBucketKey(bucket));
          break;
        }
      }

      const results = await pipeline.exec();

      if (!results || hasRedisCommandErrors(results)) {
        throw new Error("Redis metrics histogram pipeline failed");
      }
    },
    async readSnapshot() {
      const redis = getRedisClient();
      const values = await redis.mget(
        getCounterKey("ulazy_upload_presign_total"),
        getCounterKey("ulazy_jobs_created_total"),
        getCounterKey("ulazy_jobs_failed_total"),
        ...JOB_LATENCY_BUCKETS_MS.map((bucket) => getHistogramBucketKey(bucket)),
        getHistogramSumKey(),
        getHistogramCountKey()
      );

      let index = 0;
      const uploadPresign = Number(values[index++] ?? 0);
      const jobsCreated = Number(values[index++] ?? 0);
      const jobsFailed = Number(values[index++] ?? 0);
      const buckets = Object.fromEntries(
        JOB_LATENCY_BUCKETS_MS.map((bucket) => [
          String(bucket),
          Number(values[index++] ?? 0),
        ])
      );
      const sum = Number(values[index++] ?? 0);
      const count = Number(values[index++] ?? 0);

      return {
        ulazy_jobs_created_total: jobsCreated,
        ulazy_jobs_failed_total: jobsFailed,
        ulazy_upload_presign_total: uploadPresign,
        [JOB_LATENCY_METRIC_NAME]: {
          buckets,
          count,
          sum,
        },
      };
    },
    async reset() {
      const redis = getRedisClient();
      await redis.del(
        getCounterKey("ulazy_upload_presign_total"),
        getCounterKey("ulazy_jobs_created_total"),
        getCounterKey("ulazy_jobs_failed_total"),
        ...JOB_LATENCY_BUCKETS_MS.map((bucket) => getHistogramBucketKey(bucket)),
        getHistogramSumKey(),
        getHistogramCountKey()
      );
    },
  };
}

function getMetricsStore() {
  if (!globalForMetrics.metricsStore) {
    globalForMetrics.metricsStore = shouldUseRedisMetrics()
      ? createRedisStore()
      : createMemoryStore();
  }

  return globalForMetrics.metricsStore;
}

async function withFailOpenMetrics(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    log.warn(
      {
        err: error,
      },
      "Metrics backend operation failed; continuing without blocking request"
    );
  }
}

export async function incrementUploadPresignCount() {
  await withFailOpenMetrics(() =>
    getMetricsStore().incrementCounter("ulazy_upload_presign_total")
  );
}

export async function incrementJobsCreatedCount() {
  await withFailOpenMetrics(() =>
    getMetricsStore().incrementCounter("ulazy_jobs_created_total")
  );
}

export async function incrementJobsFailedCount() {
  await withFailOpenMetrics(() =>
    getMetricsStore().incrementCounter("ulazy_jobs_failed_total")
  );
}

export async function observeJobLatencyMs(durationMs: number) {
  await withFailOpenMetrics(() =>
    getMetricsStore().observeHistogram(JOB_LATENCY_METRIC_NAME, durationMs)
  );
}

function renderCounter(name: CounterMetricName, help: string, value: number) {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    `${name} ${value}`,
  ].join("\n");
}

function renderHistogram(snapshot: HistogramSnapshot) {
  const lines = [
    `# HELP ${JOB_LATENCY_METRIC_NAME} PDF job latency in milliseconds.`,
    `# TYPE ${JOB_LATENCY_METRIC_NAME} histogram`,
  ];

  let cumulativeCount = 0;

  for (const bucket of JOB_LATENCY_BUCKETS_MS) {
    cumulativeCount += snapshot.buckets[String(bucket)] ?? 0;
    lines.push(
      `${JOB_LATENCY_METRIC_NAME}_bucket{le="${bucket}"} ${cumulativeCount}`
    );
  }

  lines.push(
    `${JOB_LATENCY_METRIC_NAME}_bucket{le="+Inf"} ${snapshot.count}`,
    `${JOB_LATENCY_METRIC_NAME}_sum ${snapshot.sum}`,
    `${JOB_LATENCY_METRIC_NAME}_count ${snapshot.count}`
  );

  return lines.join("\n");
}

export async function renderPrometheusMetrics() {
  const snapshot = await getMetricsStore().readSnapshot();

  return [
    renderCounter(
      "ulazy_upload_presign_total",
      "Total successful upload presign requests.",
      snapshot.ulazy_upload_presign_total
    ),
    renderCounter(
      "ulazy_jobs_created_total",
      "Total queued PDF jobs created.",
      snapshot.ulazy_jobs_created_total
    ),
    renderCounter(
      "ulazy_jobs_failed_total",
      "Total PDF jobs that reached a failed terminal state.",
      snapshot.ulazy_jobs_failed_total
    ),
    renderHistogram(snapshot[JOB_LATENCY_METRIC_NAME]),
    "",
  ].join("\n");
}

export async function resetMetricsForTests() {
  await getMetricsStore().reset();
}

export { isMetricsActive, JOB_LATENCY_BUCKETS_MS, METRICS_CONTENT_TYPE };

import { getMetricsEnv } from "@/lib/env";
import {
  isMetricsActive,
  METRICS_CONTENT_TYPE,
  renderPrometheusMetrics,
} from "@/lib/metrics";

function buildTextResponse(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, {
    headers: {
      "Content-Type": METRICS_CONTENT_TYPE,
      ...headers,
    },
    status,
  });
}

function isAuthorized(request: Request, token: string) {
  const header = request.headers.get("authorization")?.trim();
  return header === `Bearer ${token}`;
}

export async function GET(request: Request) {
  const metricsEnv = getMetricsEnv();

  if (!isMetricsActive()) {
    return buildTextResponse("metrics disabled\n", 404);
  }

  if (metricsEnv.METRICS_TOKEN && !isAuthorized(request, metricsEnv.METRICS_TOKEN)) {
    return buildTextResponse("unauthorized\n", 401, {
      "WWW-Authenticate": 'Bearer realm="metrics"',
    });
  }

  try {
    const body = await renderPrometheusMetrics();
    return buildTextResponse(body);
  } catch {
    return buildTextResponse("metrics unavailable\n", 503);
  }
}

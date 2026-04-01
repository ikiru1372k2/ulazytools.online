import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createLogger } from "@/lib/logger";
import {
  getOrCreateRequestId,
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";

export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER))
  );
  const log = createLogger({ requestId });

  log.info("Health check endpoint hit");

  return NextResponse.json({
    requestId,
    status: "ok",
  });
}

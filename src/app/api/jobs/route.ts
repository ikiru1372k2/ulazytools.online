import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "MERGE_JOB_ENDPOINT_MOVED",
        message: "Use /api/jobs/merge to create merge jobs.",
      },
    },
    {
      status: 410,
    }
  );
}

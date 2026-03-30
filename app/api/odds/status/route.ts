import { NextResponse } from "next/server";
import { fetchState } from "@/app/api/odds/fetch/route";

export async function GET() {
  return NextResponse.json({
    status: fetchState.status,
    ...(fetchState.lastUpdated && { lastUpdated: fetchState.lastUpdated }),
    ...(fetchState.error && { error: fetchState.error }),
  });
}

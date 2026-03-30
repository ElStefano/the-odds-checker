import { NextResponse } from "next/server";
import { readOdds } from "@/lib/data";

export async function GET() {
  return NextResponse.json(readOdds());
}

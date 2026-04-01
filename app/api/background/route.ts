import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const BG_FILE = path.join(DATA_DIR, "background");
const BG_META = path.join(DATA_DIR, "background-meta.json");

export async function GET() {
  try {
    const meta = JSON.parse(fs.readFileSync(BG_META, "utf-8"));
    const buffer = fs.readFileSync(BG_FILE);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": meta.contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readUrls, writeUrls, BettingUrl } from "@/lib/data";
import { randomUUID } from "crypto";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  return NextResponse.json(readUrls());
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { url, label } = await req.json();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const urls = readUrls();
  const entry: BettingUrl = {
    id: randomUUID(),
    url,
    label: label || url,
    addedAt: new Date().toISOString(),
  };
  urls.push(entry);
  try {
    writeUrls(urls);
  } catch (err) {
    console.error("writeUrls failed:", err);
    return NextResponse.json({ error: "Failed to save URL. Check that the data volume is mounted." }, { status: 500 });
  }

  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await req.json();
  const urls = readUrls().filter((u) => u.id !== id);
  writeUrls(urls);

  return NextResponse.json({ ok: true });
}

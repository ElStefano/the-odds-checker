import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";

export async function GET() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dataDir = path.join(process.cwd(), "data");
  const urlsFile = path.join(dataDir, "urls.json");

  let dirExists = false;
  let fileExists = false;
  let writable = false;
  let fileContent = null;
  let writeError = null;

  try { dirExists = fs.existsSync(dataDir); } catch {}
  try { fileExists = fs.existsSync(urlsFile); } catch {}
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, ".write-test"), "ok");
    fs.unlinkSync(path.join(dataDir, ".write-test"));
    writable = true;
  } catch (e) {
    writeError = String(e);
  }
  try {
    if (fileExists) fileContent = JSON.parse(fs.readFileSync(urlsFile, "utf-8"));
  } catch {}

  return NextResponse.json({
    cwd: process.cwd(),
    dataDir,
    dirExists,
    fileExists,
    writable,
    writeError,
    fileContent,
  });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readUrls, writeOdds, BettingUrl, OddsEntry, Match } from "@/lib/data";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright-core";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COOKIE_ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#accept-recommended-btn-handler",
  'button:has-text("Acceptera alla cookies")',
  'button:has-text("Acceptera alla")',
  'button:has-text("Accept all cookies")',
  'button:has-text("Accept all")',
  'button:has-text("Godkänn alla")',
  'button:has-text("Tillåt alla")',
];

async function fetchPageContent(url: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "sv-SE",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    for (const selector of COOKIE_ACCEPT_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch { /* try next */ }
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch { /* persistent connections — continue */ }
    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => {
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD"]);
      function extractText(node: Node): string {
        if (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has((node as Element).tagName)) return "";
        let result = "";
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent?.trim();
          if (t) result += t + "\n";
        }
        const shadowRoot = (node as Element).shadowRoot;
        if (shadowRoot) result += extractText(shadowRoot);
        for (const child of node.childNodes) result += extractText(child);
        return result;
      }
      const shadowText = extractText(document.body).replace(/\n{3,}/g, "\n\n").trim();
      const innerText = document.body.innerText.trim();
      return shadowText.length > innerText.length ? shadowText : innerText;
    });
    return text.slice(0, 20000);
  } finally {
    await browser.close();
  }
}

interface RawEntry {
  match: string;
  sport: string;
  date: string;
  market: string;
  selection: string;
  value: number;
}

async function extractOddsFromSite(label: string, url: string, content: string): Promise<RawEntry[]> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `The following text was scraped from the betting site "${label}" (${url}).
Extract all match odds you can find.

${content}

Return ONLY a JSON array — no markdown, no other text:
[
  {
    "match": "<Home Team vs Away Team>",
    "sport": "<sport in English>",
    "date": "<ISO 8601 datetime, or empty string>",
    "market": "<market type e.g. Match Winner>",
    "selection": "<selection exactly as shown on the page>",
    "value": <decimal odds as a number>
  }
]

Rules:
- For every match, extract ALL Match Winner selections (home win, draw/X, away win) — do not skip any
- Only include values explicitly visible in the text — never invent numbers
- If no odds are visible at all, return []`,
    }],
  });

  let raw = "";
  for (const block of response.content) {
    if (block.type === "text") raw = block.text;
  }
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse((jsonMatch ? jsonMatch[1] : raw).trim());
  } catch {
    return [];
  }
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/\s+vs\.?\s+|\s+-\s+/g, " vs ").trim();
}

async function generateCuratorNote(matches: Match[]): Promise<string> {
  if (matches.length === 0) return "";
  const summary = matches.slice(0, 8).map((m) => {
    const top = [...m.odds].sort((a, b) => b.value - a.value).slice(0, 3);
    return `${m.name}: ${top.map((o) => `${o.site} ${o.selection} @${o.value}`).join(", ")}`;
  }).join("\n");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 80,
    messages: [{
      role: "user",
      content: `Based on these match odds, write ONE punchy sentence (max 20 words) tipping off the single most interesting value opportunity. Sound like a knowledgeable friend, not marketing copy.\n\n${summary}`,
    }],
  });
  for (const block of response.content) {
    if (block.type === "text") return block.text.trim();
  }
  return "";
}

export async function POST() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urls = readUrls();
  if (urls.length === 0) {
    return NextResponse.json({ error: "No URLs configured" }, { status: 400 });
  }

  // Step 1: scrape all pages in parallel
  const pageContents: { entry: BettingUrl; content: string }[] = [];
  await Promise.all(
    urls.map(async (entry) => {
      try {
        const content = await fetchPageContent(entry.url);
        pageContents.push({ entry, content });
      } catch (err) {
        console.error(`Failed to fetch ${entry.url}:`, err);
      }
    })
  );

  if (pageContents.length === 0) {
    return NextResponse.json({ error: "Could not load any of the configured URLs." }, { status: 502 });
  }

  // Step 2: extract odds per site in parallel — each Claude call is focused on one site
  const extractions = await Promise.all(
    pageContents.map(({ entry, content }) =>
      extractOddsFromSite(entry.label, entry.url, content).catch((err) => {
        console.error(`Extraction failed for ${entry.label}:`, err);
        return [] as RawEntry[];
      })
    )
  );

  // Step 3: merge entries by match name
  const matchMap = new Map<string, { name: string; sport: string; date: string; odds: OddsEntry[] }>();
  for (let i = 0; i < pageContents.length; i++) {
    const { entry } = pageContents[i];
    for (const item of extractions[i]) {
      if (!item.match || typeof item.value !== "number") continue;
      const key = normalizeKey(item.match);
      if (!matchMap.has(key)) {
        matchMap.set(key, { name: item.match, sport: item.sport || "", date: item.date || "", odds: [] });
      }
      matchMap.get(key)!.odds.push({
        site: entry.label,
        market: item.market || "Match Winner",
        selection: item.selection,
        value: item.value,
        url: entry.url,
      });
    }
  }

  const matches: Match[] = Array.from(matchMap.values()).map((m) => ({
    id: normalizeKey(m.name).replace(/[^a-z0-9]+/g, "-"),
    name: m.name,
    sport: m.sport,
    date: m.date,
    odds: m.odds,
  }));

  // Step 4: generate curator note
  const curatorNote = await generateCuratorNote(matches).catch(() => "");

  const oddsData = { lastUpdated: new Date().toISOString(), curatorNote, matches };
  writeOdds(oddsData);
  return NextResponse.json(oddsData);
}

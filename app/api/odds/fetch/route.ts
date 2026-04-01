import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readUrls, writeOdds, BettingUrl } from "@/lib/data";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright-core";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Selectors that typically trigger "accept all cookies" on Swedish betting sites
const COOKIE_ACCEPT_SELECTORS = [
  // OneTrust (used by Betsson and many others)
  "#onetrust-accept-btn-handler",
  "#accept-recommended-btn-handler",
  // Generic text-based
  'button:has-text("Acceptera alla cookies")',
  'button:has-text("Acceptera alla")',
  'button:has-text("Accept all cookies")',
  'button:has-text("Accept all")',
  'button:has-text("Godkänn alla")',
  'button:has-text("Tillåt alla")',
];

// Sequential — safest on Railway memory; hard per-site cap keeps total time bounded
const CONCURRENCY = 1;
// Hard cap per site — prevents any single page from blocking the queue
const SITE_TIMEOUT_MS = 30_000;

type Browser = Awaited<ReturnType<typeof chromium.launch>>;

async function scrapeSite(browser: Browser, entry: BettingUrl): Promise<string> {
  let context;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "sv-SE",
    });
    const page = await context.newPage();

    // Block images, fonts and media — not needed for text extraction
    await page.route("**/*", (route) => {
      if (["image", "font", "media"].includes(route.request().resourceType())) route.abort();
      else route.continue();
    });

    await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Check all cookie selectors in parallel (500 ms each)
    const cookieResults = await Promise.all(
      COOKIE_ACCEPT_SELECTORS.map(async (sel) => {
        try {
          const btn = page.locator(sel).first();
          return (await btn.isVisible({ timeout: 500 })) ? btn : null;
        } catch { return null; }
      })
    );
    const cookieBtn = cookieResults.find(Boolean);
    if (cookieBtn) {
      await cookieBtn.click();
      await page.waitForTimeout(1000);
    }

    // Wait until at least 5 odds values appear — matches both 1.85 (English) and 1,85 (Swedish)
    await page.waitForFunction(
      () => (document.body?.innerText.match(/\b\d+[.,]\d{2}\b/g) ?? []).length >= 5,
      { timeout: 12000 }
    ).catch(() => {});

    const text = await page.evaluate(() => {
      if (!document.body) return "";
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

    return text.slice(0, 10000);
  } catch (err) {
    console.error(`[scrape] ${entry.url} failed:`, err);
    return "";
  } finally {
    await context?.close().catch(() => {});
  }
}

async function scrapeAll(entries: BettingUrl[]): Promise<{ entry: BettingUrl; content: string }[]> {
  console.log("[scrape] launching browser");
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-default-apps",
      "--mute-audio",
      "--no-zygote",
    ],
  });

  console.log("[scrape] browser launched");
  const results: { entry: BettingUrl; content: string }[] = [];
  const queue = [...entries];

  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      console.log(`[scrape] starting ${entry.url}`);
      const start = Date.now();
      // Hard per-site cap — if scrapeSite hangs, the timeout wins and we move on
      let hardTimeoutId: ReturnType<typeof setTimeout>;
      const content = await Promise.race([
        scrapeSite(browser, entry),
        new Promise<string>((resolve) => {
          hardTimeoutId = setTimeout(() => {
            console.warn(`[scrape] hard timeout hit for ${entry.url}`);
            resolve("");
          }, SITE_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(hardTimeoutId));
      console.log(`[scrape] done ${entry.url} in ${Date.now() - start}ms, chars=${content.length}`);
      if (content) results.push({ entry, content });
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

// In-memory flag — safe because Railway runs a persistent Node process
let fetchInProgress = false;

async function runFetch(urls: BettingUrl[]) {
  // Scrape all pages using a single shared browser with limited concurrency
  const pageContents = await scrapeAll(urls);

  if (pageContents.length === 0) {
    return NextResponse.json(
      { error: "Could not load any of the configured URLs." },
      { status: 502 }
    );
  }

  const pagesBlock = pageContents
    .map(
      ({ entry, content }) =>
        `=== ${entry.label} (${entry.url}) ===\n${content}`
    )
    .join("\n\n");

  const siteLabels = pageContents.map(({ entry }) => entry.label).join(", ");

  const prompt = `You are an extremely well-read friend who has spent years studying betting markets across every sport. You have a gift for cutting through the noise and curating exactly what's worth paying attention to.

Below is the raw text content scraped from these betting sites: ${siteLabels}.
Each site's content is separated by a === SITE_LABEL (URL) === header.
You MUST read through every section and extract odds from ALL of them — do not stop after the first few sites.

${pagesBlock}

Return a JSON object with this exact structure — nothing else, no markdown, just raw JSON:

{
  "lastUpdated": "<ISO 8601 timestamp>",
  "curatorNote": "<One punchy sentence about the single most interesting opportunity you've spotted>",
  "matches": [
    {
      "id": "<slug-style-id>",
      "name": "<Team A vs Team B>",
      "sport": "<sport name>",
      "date": "<ISO 8601 date or datetime if visible, else empty string>",
      "odds": [
        {
          "site": "<betting site label>",
          "market": "<market type e.g. Match Winner, Both Teams to Score, Over 2.5 Goals>",
          "selection": "<selection name>",
          "value": <decimal odds as number>,
          "url": "<source URL>"
        }
      ]
    }
  ]
}

Rules:
- Only include matches where AT LEAST 2 different betting sites have odds — skip any match covered by only one site
- Return AT LEAST 10 such matches — scrape broadly across all sports and sites to ensure enough coverage
- Sort matches so the most compelling / best-value odds come first
- Within each match, list odds from best value (highest decimal) to lowest
- Only include odds that are explicitly present in the scraped text — do not invent numbers
- For each match, extract ALL three Match Winner outcomes (home win, draw, away win) from EVERY site that lists that match — never skip a site's home-win odds just because you already have that outcome from another site
- The "site" field must use the exact label from the === header of the section the odds were found in (e.g. "Betsson", "Unibet") — never omit a site
- The curatorNote should sound like a knowledgeable friend tipping you off, not a marketing line`;

  try {
    console.log("[claude] sending request, prompt length:", prompt.length);
    const response = await client.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: 120_000 } // 2-minute hard timeout on the API call
    );
    console.log("[claude] response received");

    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        rawText = block.text;
      }
    }

    // Strip markdown code fences if present
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonString = jsonMatch ? jsonMatch[1] : rawText;

    const oddsData = JSON.parse(jsonString.trim());
    oddsData.lastUpdated = new Date().toISOString();
    writeOdds(oddsData);
    console.log("[claude] odds saved, matches:", oddsData.matches?.length ?? 0);
  } catch (err) {
    console.error("[claude] error:", err);
  }
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

  if (fetchInProgress) {
    return NextResponse.json({ status: "already_running" }, { status: 409 });
  }

  // Respond immediately — client polls /api/odds until lastUpdated changes
  fetchInProgress = true;
  runFetch(urls).catch(console.error).finally(() => { fetchInProgress = false; });

  return NextResponse.json({ status: "started" });
}

export async function GET() {
  const session = await getSession();
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ inProgress: fetchInProgress });
}

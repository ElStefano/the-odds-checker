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

// Sequential scraping — one page at a time to stay within Railway memory limits
const CONCURRENCY = 1;

async function scrapeAll(entries: BettingUrl[]): Promise<{ entry: BettingUrl; content: string }[]> {
  // One shared browser process — dramatically lower RAM than one browser per site
  const browser = await chromium.launch({
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

  const results: { entry: BettingUrl; content: string }[] = [];

  // Simple concurrency limiter: at most CONCURRENCY pages open at once
  const queue = [...entries];
  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      let context;
      try {
        context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          locale: "sv-SE",
        });
        const page = await context.newPage();

        // Block images, fonts and media — not needed for text extraction, saves memory and bandwidth
        await page.route("**/*", (route) => {
          const type = route.request().resourceType();
          if (["image", "font", "media"].includes(type)) {
            route.abort();
          } else {
            route.continue();
          }
        });

        await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 20000 });

        for (const selector of COOKIE_ACCEPT_SELECTORS) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              await page.waitForTimeout(1500);
              break;
            }
          } catch { /* try next */ }
        }

        try {
          await page.waitForLoadState("networkidle", { timeout: 10000 });
        } catch { /* persistent connections — continue */ }

        // Wait until at least 5 decimal odds values appear in the page text.
        // This handles sites that load odds via API after the page settles.
        try {
          await page.waitForFunction(
            () => (document.body.innerText.match(/\b\d+\.\d{2}\b/g) ?? []).length >= 5,
            { timeout: 12000 }
          );
        } catch { /* odds didn't appear — proceed with whatever loaded */ }

        await page.waitForTimeout(500);

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

        results.push({ entry, content: text.slice(0, 20000) });
      } catch (err) {
        console.error(`Failed to fetch ${entry.url}:`, err);
      } finally {
        await context?.close();
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    await browser.close();
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
- Return AT LEAST 15 matches — scrape broadly across all sports and sites to ensure enough coverage
- Sort matches so the most compelling / best-value odds come first
- Within each match, list odds from best value (highest decimal) to lowest
- Only include odds that are explicitly present in the scraped text — do not invent numbers
- For each match, extract ALL three Match Winner outcomes (home win, draw, away win) from EVERY site that lists that match — never skip a site's home-win odds just because you already have that outcome from another site
- The "site" field must use the exact label from the === header of the section the odds were found in (e.g. "Betsson", "Unibet") — never omit a site
- The curatorNote should sound like a knowledgeable friend tipping you off, not a marketing line`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8096,
      messages: [{ role: "user", content: prompt }],
    });

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
  } catch (err) {
    console.error("Claude fetch error:", err);
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

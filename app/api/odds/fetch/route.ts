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

    // Dismiss cookie consent if present
    for (const selector of COOKIE_ACCEPT_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch {
        // selector not found — try next
      }
    }

    // Give JS-heavy SPAs time to render odds after consent
    await page.waitForTimeout(6000);

    // Extract text piercing Shadow DOM (needed for Stencil.js sites like Betsson)
    // Falls back to innerText for simpler sites
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
      // Prefer shadow DOM result if substantially richer than innerText
      const innerText = document.body.innerText.trim();
      return shadowText.length > innerText.length ? shadowText : innerText;
    });
    return text.slice(0, 20000);
  } finally {
    await browser.close();
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

  // Fetch all pages in parallel with a headless browser
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

  const prompt = `You are an extremely well-read friend who has spent years studying betting markets across every sport. You have a gift for cutting through the noise and curating exactly what's worth paying attention to.

Below is the raw text content scraped directly from the following betting site pages. Extract all available match odds from this content.

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
- Include at least 10 football matches — scrape as many as the pages provide
- Sort matches so the most compelling / best-value odds come first
- Within each match, list odds from best value (highest decimal) to lowest
- Only include odds that are explicitly present in the scraped text — do not invent numbers
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

    return NextResponse.json(oddsData);
  } catch (err) {
    console.error("Claude fetch error:", err);
    return NextResponse.json(
      { error: "Failed to extract odds" },
      { status: 500 }
    );
  }
}

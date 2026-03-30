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
  // Bet365
  ".ccm-CookieConsentPopup_Accept",
  'button[data-test="accept-all-cookies"]',
  // Generic text-based (English + Swedish)
  'button:has-text("Accept All Cookies")',
  'button:has-text("Accept all cookies")',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("Acceptera alla cookies")',
  'button:has-text("Acceptera alla")',
  'button:has-text("Godkänn alla")',
  'button:has-text("Tillåt alla")',
];

interface PageResult {
  entry: BettingUrl;
  text: string;
  screenshots: string[]; // base64 PNG
}

async function fetchPageContent(url: string): Promise<{ text: string; screenshots: string[] }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "sv-SE",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Remove the webdriver property that headless Chrome exposes
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

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

    // Bet365 loads odds via WebSocket after page load — give it more time
    const isBet365 = url.includes("bet365");
    await page.waitForTimeout(isBet365 ? 10000 : 6000);

    // Take screenshots at up to 3 scroll positions to capture the full match list
    const screenshots: string[] = [];
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = 800;
    const scrollPositions = [0];
    if (pageHeight > viewportHeight) scrollPositions.push(Math.floor(pageHeight / 2));
    if (pageHeight > viewportHeight * 2) scrollPositions.push(pageHeight - viewportHeight);

    for (const scrollY of scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300);
      const buf = await page.screenshot({ type: "png" });
      screenshots.push(buf.toString("base64"));
    }

    // Also extract text (Shadow DOM traversal for Stencil.js sites like Betsson)
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

    return { text: text.slice(0, 20000), screenshots };
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

  // Fetch all pages in parallel
  const pageResults: PageResult[] = [];
  await Promise.all(
    urls.map(async (entry) => {
      try {
        const { text, screenshots } = await fetchPageContent(entry.url);
        pageResults.push({ entry, text, screenshots });
      } catch (err) {
        console.error(`Failed to fetch ${entry.url}:`, err);
      }
    })
  );

  if (pageResults.length === 0) {
    return NextResponse.json(
      { error: "Could not load any of the configured URLs." },
      { status: 502 }
    );
  }

  const pagesBlock = pageResults
    .map(({ entry, text }) => `=== ${entry.label} (${entry.url}) ===\n${text}`)
    .join("\n\n");

  const systemPrompt = `You are an extremely well-read friend who has spent years studying betting markets across every sport. You have a gift for cutting through the noise and curating exactly what's worth paying attention to.

You will receive scraped text content from betting sites AND screenshots of those pages. Use both sources — sometimes the screenshots contain odds that the text extraction missed (e.g. on Bet365).

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
- Sort matches so the most compelling / best-value odds come first
- Within each match, list odds from best value (highest decimal) to lowest
- Only include odds explicitly present in the text or screenshots — do not invent numbers
- For each match, extract ALL three Match Winner outcomes (home win, draw, away win) from EVERY site that lists that match
- The curatorNote should sound like a knowledgeable friend tipping you off, not a marketing line`;

  // Build multimodal message content: text first, then screenshots labelled by site
  const messageContent: Anthropic.MessageParam["content"] = [
    { type: "text", text: `Scraped text content:\n\n${pagesBlock}` },
  ];

  for (const { entry, screenshots } of pageResults) {
    if (screenshots.length > 0) {
      messageContent.push({
        type: "text",
        text: `Screenshots from ${entry.label} (${entry.url}):`,
      });
      for (const data of screenshots) {
        messageContent.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data },
        });
      }
    }
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8096,
      system: systemPrompt,
      messages: [{ role: "user", content: messageContent }],
    });

    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") rawText = block.text;
    }

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

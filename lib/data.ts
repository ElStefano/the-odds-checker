import fs from "fs";

const DATA_DIR = "/app/data";
const URLS_FILE = `${DATA_DIR}/urls.json`;
const ODDS_FILE = `${DATA_DIR}/odds.json`;

export interface BettingUrl {
  id: string;
  url: string;
  label: string;
  addedAt: string;
}

export interface OddsEntry {
  site: string;
  market: string;
  selection: string;
  value: number;
  url: string;
}

export interface Match {
  id: string;
  name: string;
  sport: string;
  date: string;
  odds: OddsEntry[];
}

export interface OddsData {
  lastUpdated?: string;
  curatorNote?: string;
  matches?: Match[];
}

export function readUrls(): BettingUrl[] {
  try {
    const raw = fs.readFileSync(URLS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function writeUrls(urls: BettingUrl[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 2));
}

export function readOdds(): OddsData {
  try {
    const raw = fs.readFileSync(ODDS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function writeOdds(data: OddsData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ODDS_FILE, JSON.stringify(data, null, 2));
}

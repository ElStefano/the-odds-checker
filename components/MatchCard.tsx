"use client";

import { Match, OddsEntry } from "@/lib/data";
import { OddsRow } from "./OddsRow";

interface SiteEntry { id: string; url: string; label: string; }

export interface SelectionGroup {
  label: string;
  siteOdds: { name: string; value: number; url: string }[];
}

function formatDate(dateStr: string) {
  if (!dateStr) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function isMatchWinner(market: string) {
  return /match.?winner|matchresultat|1x2|full.?time.?result|fulltid|ft.?result|match result|1 x 2|resultat/i.test(market);
}

export function categorizeSel(selection: string, homeTeam: string, awayTeam: string): "home" | "draw" | "away" {
  const s = selection.toLowerCase().trim();

  // Explicit 1X2 notation — check these first as exact matches
  if (s === "1") return "home";
  if (s === "x") return "draw";
  if (s === "2") return "away";

  // Also handle when "1", "x", "2" appear alongside other text e.g. "1 (home)"
  if (/^1[\s(]/.test(s)) return "home";
  if (/^x[\s(]/.test(s)) return "draw";
  if (/^2[\s(]/.test(s)) return "away";

  // Common draw synonyms
  if (/^(draw|oavgjort|remis|kryss|tie|unentschieden|egalite|unentsch)$/.test(s)) return "draw";

  // Common home/away words
  if (/^(home|hemma)$/.test(s)) return "home";
  if (/^(away|borta|gäst)$/.test(s)) return "away";

  // Team name matching
  if (homeTeam && (s.includes(homeTeam.toLowerCase()) || homeTeam.toLowerCase().includes(s))) return "home";
  if (awayTeam && (s.includes(awayTeam.toLowerCase()) || awayTeam.toLowerCase().includes(s))) return "away";

  return "home"; // fallback
}

function bestPerSite(entries: { name: string; value: number; url: string }[]) {
  const map = new Map<string, { name: string; value: number; url: string }>();
  for (const e of entries) {
    const existing = map.get(e.name);
    if (!existing || e.value > existing.value) map.set(e.name, e);
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

export function buildGroups(odds: OddsEntry[], homeTeam: string, awayTeam: string): SelectionGroup[] {
  const mw = odds.filter(o => isMatchWinner(o.market));
  const src = mw.length > 0 ? mw : odds;

  const home: { name: string; value: number; url: string }[] = [];
  const draw: { name: string; value: number; url: string }[] = [];
  const away: { name: string; value: number; url: string }[] = [];

  for (const o of src) {
    const cat = categorizeSel(o.selection, homeTeam, awayTeam);
    const entry = { name: o.site, value: o.value, url: o.url };
    if (cat === "draw") draw.push(entry);
    else if (cat === "away") away.push(entry);
    else home.push(entry);
  }

  return [
    { label: homeTeam || "Team 1", siteOdds: bestPerSite(home) },
    { label: "Draw", siteOdds: bestPerSite(draw) },
    { label: awayTeam || "Team 2", siteOdds: bestPerSite(away) },
  ];
}

export function MatchCard({ match, rank, sites }: { match: Match; rank: number; sites: SiteEntry[] }) {
  const formattedDate = formatDate(match.date);
  const parts = match.name.split(/ vs\.? /i);
  const homeTeam = parts[0]?.trim() ?? "";
  const awayTeam = parts[1]?.trim() ?? "";
  const groups = buildGroups(match.odds, homeTeam, awayTeam);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
          {rank}
        </span>
        <div>
          <h2 className="font-semibold text-gray-900 text-base leading-snug">{match.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-500 font-medium">{match.sport}</span>
            {formattedDate && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">{formattedDate}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        {groups.filter((g) => g.siteOdds.length > 0).map((g) => (
          <OddsRow key={g.label} group={g} allSites={sites} />
        ))}
      </div>
    </div>
  );
}

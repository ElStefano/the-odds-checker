"use client";

import { OddsEntry } from "@/lib/data";

export interface GroupedOdds {
  market: string;
  selection: string;
  siteOdds: { name: string; value: number; url: string }[]; // all sites, sorted best first
}

function normalizeMarket(market: string): string {
  const m = market.toLowerCase().trim();
  if (/match.?winner|matchresultat|1x2|full.?time.?result|fulltid|ft.?result|match result/.test(m)) return "match_winner";
  if (/both.?teams.*(score|goal)|båda.?lagen|btts/.test(m)) return "btts";
  return m;
}

function normalizeSelection(selection: string): string {
  const s = selection.toLowerCase().trim();
  if (/^(draw|oavgjort|remis|x|tie)$/.test(s)) return "draw";
  if (/^(home|hemma|1)$/.test(s)) return "home";
  if (/^(away|borta|2)$/.test(s)) return "away";
  if (/^(yes|ja)$/.test(s)) return "yes";
  if (/^(no|nej)$/.test(s)) return "no";
  return s;
}

export function groupOdds(odds: OddsEntry[]): GroupedOdds[] {
  const map = new Map<string, GroupedOdds>();
  for (const o of odds) {
    const key = `${normalizeMarket(o.market)}__${normalizeSelection(o.selection)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        market: o.market,
        selection: o.selection,
        siteOdds: [{ name: o.site, value: o.value, url: o.url }],
      });
    } else {
      if (!existing.siteOdds.some((s) => s.name === o.site)) {
        existing.siteOdds.push({ name: o.site, value: o.value, url: o.url });
        existing.siteOdds.sort((a, b) => b.value - a.value);
      }
    }
  }
  return Array.from(map.values());
}

export function OddsRow({ odds }: { odds: GroupedOdds }) {
  const best = odds.siteOdds[0]?.value;
  const bestSites = odds.siteOdds.filter((s) => s.value === best);
  const otherSites = odds.siteOdds.filter((s) => s.value !== best);

  return (
    <div className="py-2.5 px-3 rounded-lg bg-gray-50">
      <p className="text-xs text-gray-500 mb-1.5">
        {odds.market} — <span className="font-medium text-gray-700">{odds.selection}</span>
      </p>
      <div className="space-y-0.5">
        {/* Best sites on one row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            {bestSites.map((s) => {
              const siteRoot = (() => { try { return new URL(s.url).origin; } catch { return s.url; } })();
              return (
                <a
                  key={s.name}
                  href={siteRoot}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors px-3 py-1 rounded-full"
                >
                  {s.name}
                </a>
              );
            })}
          </div>
          <span className="text-sm font-semibold tabular-nums text-gray-900">
            {best.toFixed(2)}
          </span>
        </div>
        {/* Other sites */}
        {otherSites.map((s) => (
          <div key={s.name} className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{s.name}</span>
            <span className="text-sm font-semibold tabular-nums text-gray-400">
              {s.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

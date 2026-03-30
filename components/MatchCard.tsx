"use client";

import { Match } from "@/lib/data";
import { OddsRow, groupOdds } from "./OddsRow";

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

export function MatchCard({ match, rank }: { match: Match; rank: number }) {
  const formattedDate = formatDate(match.date);
  const ALLOWED_MARKETS = /match.?winner|matchresultat|1x2|full.?time.?result|fulltid|ft.?result|both.?teams.*(score|goal)|båda.?lagen|btts|draw/i;
  const filtered = match.odds.filter((o) => ALLOWED_MARKETS.test(o.market));
  const grouped = groupOdds(filtered.length > 0 ? filtered : match.odds);

  const visible = grouped;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
            {rank}
          </span>
          <div>
            <h2 className="font-semibold text-gray-900 text-base leading-snug">
              {match.name}
            </h2>
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
        <span className="text-xs text-gray-400 whitespace-nowrap mt-1">
          {visible.length} {visible.length === 1 ? "market" : "markets"}
        </span>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        {visible.map((o, i) => (
          <OddsRow key={i} odds={o} />
        ))}
      </div>
    </div>
  );
}

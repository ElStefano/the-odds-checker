"use client";

import { useState, useEffect, useCallback } from "react";
import { OddsData } from "@/lib/data";
import { MatchCard, buildGroups } from "./MatchCard";

interface SiteEntry {
  id: string;
  url: string;
  label: string;
}

function formatLastUpdated(iso?: string) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function OddsBoard() {
  const [data, setData] = useState<OddsData | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOdds = useCallback(async () => {
    setLoading(true);
    try {
      const [oddsRes, urlsRes] = await Promise.all([
        fetch("/api/odds"),
        fetch("/api/urls"),
      ]);
      const [oddsJson, urlsJson] = await Promise.all([
        oddsRes.json(),
        urlsRes.ok ? urlsRes.json() : [],
      ]);
      setData(oddsJson);
      setSites(urlsJson);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOdds();
  }, [fetchOdds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const matches = (data?.matches ?? [])
    .filter((m) => /football|soccer|fotboll/i.test(m.sport))
    .filter((m) => {
      // Only show matches where all 3 outcomes (home/draw/away) have at least one site with odds
      const parts = m.name.split(/ vs\.? /i);
      const homeTeam = parts[0]?.trim() ?? "";
      const awayTeam = parts[1]?.trim() ?? "";
      const groups = buildGroups(m.odds, homeTeam, awayTeam);
      return groups.every((g) => g.siteOdds.length > 0);
    })
    .slice(0, 10);
  const lastUpdated = formatLastUpdated(data?.lastUpdated);

  return (
    <div>
      {/* Sites strip */}
      {sites.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Checking odds from
          </p>
          <div className="flex flex-wrap gap-2">
            {sites.map((s) => {
              const root = (() => { try { return new URL(s.url).origin; } catch { return s.url; } })();
              return (
                <a
                  key={s.id}
                  href={root}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-full transition-colors"
                >
                  {s.label}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Curator note */}
      {data?.curatorNote && (
        <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-indigo-500 mb-1">Your curator says</p>
          <p className="text-indigo-900 text-base">{data.curatorNote}</p>
        </div>
      )}

      {lastUpdated && (
        <p className="text-xs text-gray-400 mb-4">Last updated: {lastUpdated}</p>
      )}

      {matches.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <p className="text-lg font-medium">No odds available yet.</p>
          <p className="text-sm mt-1">An admin can trigger a refresh from the dashboard.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((match, i) => (
            <MatchCard key={match.id} match={match} rank={i + 1} sites={sites} />
          ))}
        </div>
      )}
    </div>
  );
}

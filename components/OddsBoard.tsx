"use client";

import { useState, useEffect, useCallback } from "react";
import { OddsData } from "@/lib/data";
import { MatchCard, buildGroups } from "./MatchCard";
import { useLang } from "@/lib/i18n";

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
  const { t } = useLang();
  const [data, setData] = useState<OddsData | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadOdds = useCallback(async () => {
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
      // Deduplicate by label — multiple URLs for the same site count as one
      const seen = new Set<string>();
      const unique = (urlsJson as SiteEntry[]).filter((s) => {
        const key = s.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setSites(unique);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOdds();
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((d) => setIsAdmin(d.isAdmin ?? false));
  }, [loadOdds]);

  async function handleFetch() {
    setFetching(true);
    setFetchStatus(null);
    try {
      const before = data?.lastUpdated ?? null;
      const startRes = await fetch("/api/odds/fetch", { method: "POST" });
      if (!startRes.ok && startRes.status !== 409) {
        const d = await startRes.json();
        setFetchStatus({ type: "error", message: d.error || t.fetchFailed });
        return;
      }
      // Poll /api/odds until lastUpdated changes (up to ~3 minutes)
      for (let i = 0; i < 140; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch("/api/odds");
        const d = await res.json();
        if (d.lastUpdated && d.lastUpdated !== before) {
          setData(d);
          setFetchStatus({ type: "success", message: t.oddsUpdated });
          return;
        }
      }
      setFetchStatus({ type: "error", message: t.timedOut });
    } catch {
      setFetchStatus({ type: "error", message: t.networkError });
    } finally {
      setFetching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const matches = (data?.matches ?? [])
    .filter((m) => {
      // Require at least 2 distinct sites covering this match
      const distinctSites = new Set(m.odds.map((o) => o.site.toLowerCase())).size;
      if (distinctSites < 2) return false;
      // Home and away must have odds; draw is optional (hockey etc.)
      const parts = m.name.split(/ vs\.? /i);
      const homeTeam = parts[0]?.trim() ?? "";
      const awayTeam = parts[1]?.trim() ?? "";
      const groups = buildGroups(m.odds, homeTeam, awayTeam);
      return groups[0].siteOdds.length > 0 && groups[2].siteOdds.length > 0;
    })
    .slice(0, 20);
  const lastUpdated = formatLastUpdated(data?.lastUpdated);

  return (
    <div>
      {/* Sites strip */}
      {sites.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            {t.checkingOddsFrom}
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
          <p className="text-sm font-medium text-indigo-500 mb-1">{t.curatorSays}</p>
          <p className="text-indigo-900 text-base">{data.curatorNote}</p>
        </div>
      )}

      {isAdmin && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={handleFetch}
            disabled={fetching}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {fetching && (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {fetching ? t.fetching : t.fetchOdds}
          </button>
          {fetchStatus && (
            <span className={`text-xs font-medium ${fetchStatus.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
              {fetchStatus.message}
            </span>
          )}
        </div>
      )}

      {lastUpdated && (
        <p className="text-xs text-gray-400 mb-4">{t.lastUpdated} {lastUpdated}</p>
      )}

      {matches.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <p className="text-lg font-medium">{t.noOdds}</p>
          <p className="text-sm mt-1">{t.noOddsHint}</p>
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

"use client";

import { SelectionGroup } from "./MatchCard";

interface SiteEntry { id: string; url: string; label: string; }

export function OddsRow({ group, allSites }: { group: SelectionGroup; allSites: SiteEntry[] }) {
  // Group siteOdds by value so identical odds share a row
  const valueMap = new Map<number, { name: string; url: string }[]>();
  for (const s of group.siteOdds) {
    const existing = valueMap.get(s.value) ?? [];
    existing.push({ name: s.name, url: s.url });
    valueMap.set(s.value, existing);
  }
  const valueGroups = Array.from(valueMap.entries()).sort(([a], [b]) => b - a);
  const bestValue = valueGroups[0]?.[0] ?? null;

  const presentNames = new Set(group.siteOdds.map((s) => s.name.toLowerCase()));
  const missingSites = allSites.filter((s) => !presentNames.has(s.label.toLowerCase()));

  return (
    <div className="py-2.5 px-3 rounded-lg bg-gray-50">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {group.label}
      </p>
      <div className="space-y-1">
        {valueGroups.map(([value, sitesInGroup]) => {
          const isBest = value === bestValue;
          return (
            <div key={value} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
                {sitesInGroup.map((s) => {
                  const siteRoot = (() => { try { return new URL(s.url).origin; } catch { return s.url; } })();
                  return isBest ? (
                    <a
                      key={s.name}
                      href={siteRoot}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-full transition-colors"
                    >
                      {s.name}
                    </a>
                  ) : (
                    <span key={s.name} className="text-sm text-gray-500">{s.name}</span>
                  );
                })}
              </div>
              <span className={`text-sm font-semibold tabular-nums ${isBest ? "text-gray-900" : "text-gray-400"}`}>
                {value.toFixed(2)}
              </span>
            </div>
          );
        })}
        {missingSites.map((s) => (
          <div key={s.id} className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{s.label}</span>
            <span className="text-xs text-gray-300 italic">Can&apos;t find the market</span>
          </div>
        ))}
      </div>
    </div>
  );
}

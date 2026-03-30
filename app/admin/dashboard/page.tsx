"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BettingUrl } from "@/lib/data";

export default function AdminDashboard() {
  const router = useRouter();
  const [urls, setUrls] = useState<BettingUrl[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Per-site inline "add URL" form state: label -> url input value
  const [addingTo, setAddingTo] = useState<Record<string, string>>({});
  // Scrape preview state: url -> result or "loading"
  const [previews, setPreviews] = useState<Record<string, { charCount: number; pageTitle: string; finalUrl: string; cookieDismissed: boolean; preview: string } | "loading" | string>>({});

  const loadUrls = useCallback(async () => {
    const res = await fetch("/api/urls");
    if (res.status === 401) {
      router.push("/admin");
      return;
    }
    const data = await res.json();
    setUrls(data);
  }, [router]);

  const loadLastUpdated = useCallback(async () => {
    const res = await fetch("/api/odds");
    if (res.ok) {
      const data = await res.json();
      if (data.lastUpdated) {
        setLastUpdated(
          new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(data.lastUpdated))
        );
      }
    }
  }, []);

  useEffect(() => {
    loadUrls();
    loadLastUpdated();
  }, [loadUrls, loadLastUpdated]);

  async function postUrl(url: string, label: string): Promise<string | null> {
    const res = await fetch("/api/urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, label }),
    });
    if (!res.ok) {
      const data = await res.json();
      return data.error || "Failed to add URL.";
    }
    return null;
  }

  async function handleAddUrl(e: FormEvent) {
    e.preventDefault();
    setAddError("");
    const err = await postUrl(newUrl, newLabel || newUrl);
    if (err) {
      setAddError(err);
      return;
    }
    setNewUrl("");
    setNewLabel("");
    loadUrls();
  }

  async function handleAddToSite(label: string) {
    const url = addingTo[label]?.trim();
    if (!url) return;
    const err = await postUrl(url, label);
    if (!err) {
      setAddingTo((prev) => ({ ...prev, [label]: "" }));
      loadUrls();
    }
  }

  async function handlePreview(url: string) {
    setPreviews((prev) => ({ ...prev, [url]: "loading" }));
    try {
      const res = await fetch("/api/debug/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreviews((prev) => ({ ...prev, [url]: data.error || "Failed" }));
      } else {
        setPreviews((prev) => ({ ...prev, [url]: data }));
      }
    } catch {
      setPreviews((prev) => ({ ...prev, [url]: "Network error" }));
    }
  }

  async function handleDelete(id: string) {
    await fetch("/api/urls", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadUrls();
  }

  async function handleFetch() {
    setFetching(true);
    setFetchStatus(null);
    try {
      const oddsRes = await fetch("/api/odds");
      const before = oddsRes.ok ? (await oddsRes.json()).lastUpdated ?? null : null;

      const startRes = await fetch("/api/odds/fetch", { method: "POST" });
      if (!startRes.ok && startRes.status !== 409) {
        const data = await startRes.json();
        setFetchStatus({ type: "error", message: data.error || "Fetch failed." });
        return;
      }
      // Poll until lastUpdated changes (up to ~3 minutes)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch("/api/odds");
        const d = await res.json();
        if (d.lastUpdated && d.lastUpdated !== before) {
          setFetchStatus({ type: "success", message: "Odds updated successfully." });
          loadLastUpdated();
          return;
        }
      }
      setFetchStatus({ type: "error", message: "Timed out waiting for new odds." });
    } catch {
      setFetchStatus({ type: "error", message: "Network error." });
    } finally {
      setFetching(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin");
  }

  // Group URLs by label
  const siteGroups: { label: string; entries: BettingUrl[] }[] = [];
  const seen = new Map<string, BettingUrl[]>();
  for (const u of urls) {
    const key = u.label.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, []);
      siteGroups.push({ label: u.label, entries: seen.get(key)! });
    }
    seen.get(key)!.push(u);
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">The Odds Checker</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Odds Refresh */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-1">Refresh Odds</h2>
          <p className="text-sm text-gray-500 mb-4">
            Sends all configured URLs to Claude to extract and curate the latest odds.
            {lastUpdated && (
              <span className="ml-1 text-gray-400">Last run: {lastUpdated}</span>
            )}
          </p>
          <button
            onClick={handleFetch}
            disabled={fetching || urls.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {fetching && (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {fetching ? "Fetching odds..." : "Fetch odds now"}
          </button>
          {fetchStatus && (
            <p
              className={`mt-3 text-sm px-3 py-2 rounded-lg ${
                fetchStatus.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {fetchStatus.message}
            </p>
          )}
          {urls.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">Add at least one URL below before fetching.</p>
          )}
        </section>

        {/* Add new site */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Add Betting Site</h2>
          <form onSubmit={handleAddUrl} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                required
                placeholder="https://www.example-betting-site.com/football"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Site name <span className="text-gray-400 font-normal">(used to group multiple URLs)</span>
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Unibet"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            {addError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {addError}
              </p>
            )}
            <button
              type="submit"
              className="bg-gray-900 hover:bg-gray-700 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Add site
            </button>
          </form>
        </section>

        {/* Site list grouped by label */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Configured Sites{" "}
            <span className="text-gray-400 font-normal text-sm">
              ({siteGroups.length} {siteGroups.length === 1 ? "site" : "sites"}, {urls.length} {urls.length === 1 ? "URL" : "URLs"})
            </span>
          </h2>
          {siteGroups.length === 0 ? (
            <p className="text-sm text-gray-400">No sites added yet.</p>
          ) : (
            <ul className="space-y-4">
              {siteGroups.map(({ label, entries }) => (
                <li key={label} className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p>
                  <ul className="space-y-1.5 mb-3">
                    {entries.map((u) => {
                      const preview = previews[u.url];
                      return (
                        <li key={u.id}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500 truncate min-w-0">{u.url}</p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => handlePreview(u.url)}
                                disabled={preview === "loading"}
                                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors disabled:opacity-50"
                              >
                                {preview === "loading" ? "Testing…" : "Test"}
                              </button>
                              <button
                                onClick={() => handleDelete(u.id)}
                                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          {preview && preview !== "loading" && (
                            <div className="mt-2 rounded-lg bg-white border border-gray-200 p-3 text-xs space-y-1">
                              {typeof preview === "string" ? (
                                <p className="text-red-600">{preview}</p>
                              ) : (
                                <>
                                  <p><span className="font-medium">Title:</span> {preview.pageTitle || "(none)"}</p>
                                  <p><span className="font-medium">Final URL:</span> <span className="text-gray-400 break-all">{preview.finalUrl}</span></p>
                                  <p><span className="font-medium">Chars extracted:</span> {preview.charCount.toLocaleString()}</p>
                                  <p><span className="font-medium">Cookie dismissed:</span> {preview.cookieDismissed ? "yes" : "no"}</p>
                                  <details className="mt-1">
                                    <summary className="cursor-pointer font-medium text-gray-600">Text preview (first 3000 chars)</summary>
                                    <pre className="mt-1 whitespace-pre-wrap text-gray-500 max-h-48 overflow-y-auto">{preview.preview}</pre>
                                  </details>
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {/* Inline add-URL form for this site */}
                  {addingTo[label] !== undefined ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="url"
                        value={addingTo[label]}
                        onChange={(e) =>
                          setAddingTo((prev) => ({ ...prev, [label]: e.target.value }))
                        }
                        placeholder="https://..."
                        autoFocus
                        className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <button
                        onClick={() => handleAddToSite(label)}
                        disabled={!addingTo[label]?.trim()}
                        className="flex-shrink-0 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() =>
                          setAddingTo((prev) => {
                            const next = { ...prev };
                            delete next[label];
                            return next;
                          })
                        }
                        className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() =>
                        setAddingTo((prev) => ({ ...prev, [label]: "" }))
                      }
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                    >
                      + Add URL to {label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Back to board */}
        <div className="mt-6 text-center">
          <a href="/" className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors">
            View odds board
          </a>
        </div>
      </div>
    </main>
  );
}

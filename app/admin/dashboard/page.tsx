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

  async function handleAddUrl(e: FormEvent) {
    e.preventDefault();
    setAddError("");
    const res = await fetch("/api/urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: newUrl, label: newLabel }),
    });
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || "Failed to add URL.");
      return;
    }
    setNewUrl("");
    setNewLabel("");
    loadUrls();
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
      const res = await fetch("/api/odds/fetch", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setFetchStatus({ type: "error", message: data.error || "Fetch failed." });
        return;
      }
      setFetchStatus({ type: "success", message: "Odds updated successfully." });
      loadLastUpdated();
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

        {/* Add URL */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Add Betting Site URL</h2>
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
                Label <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Bet365 Football"
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
              Add URL
            </button>
          </form>
        </section>

        {/* URL List */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Configured URLs{" "}
            <span className="text-gray-400 font-normal text-sm">({urls.length})</span>
          </h2>
          {urls.length === 0 ? (
            <p className="text-sm text-gray-400">No URLs added yet.</p>
          ) : (
            <ul className="space-y-2">
              {urls.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-4 py-2 px-3 bg-gray-50 rounded-lg"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.label}</p>
                    <p className="text-xs text-gray-400 truncate">{u.url}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(u.id)}
                    className="flex-shrink-0 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                  >
                    Remove
                  </button>
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

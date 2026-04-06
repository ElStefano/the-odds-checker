"use client";

import { useLang, Lang } from "@/lib/i18n";

export function PageHeader() {
  const { lang, setLang, t } = useLang();

  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          The Odds Checker
        </h1>
        <p className="text-gray-500 mt-1 text-sm">{t.tagline}</p>
        <p className="text-gray-400 mt-0.5 text-xs">
          Built by{" "}
          <a
            href="https://www.use.se"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-500 hover:text-indigo-700 transition-colors"
          >
            UXiGaming
          </a>
        </p>
      </div>
      <div className="flex items-center gap-1 mt-1 flex-shrink-0">
        {(["sv", "en"] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
              lang === l
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

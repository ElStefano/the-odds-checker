"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "sv" | "en";

const translations = {
  sv: {
    tagline: "Kurerade matchodds, bäst värde först.",
    checkingOddsFrom: "Kollar odds från",
    curatorSays: "Tips från coachen",
    fetchOdds: "Hämta odds",
    fetching: "Hämtar…",
    oddsUpdated: "Odds uppdaterade.",
    fetchFailed: "Hämtning misslyckades.",
    timedOut: "Timeout vid väntan på nya odds (5 min).",
    networkError: "Nätverksfel.",
    noOdds: "Inga odds tillgängliga ännu.",
    noOddsHint: "En admin kan starta en uppdatering från instrumentpanelen.",
    lastUpdated: "Senast uppdaterad:",
    draw: "Kryss",
    cantFindMarket: "Hittar inte marknaden",
    dateLocale: "sv-SE",
  },
  en: {
    tagline: "Curated match odds, best value first.",
    checkingOddsFrom: "Checking odds from",
    curatorSays: "Your curator says",
    fetchOdds: "Fetch odds",
    fetching: "Fetching…",
    oddsUpdated: "Odds updated.",
    fetchFailed: "Fetch failed.",
    timedOut: "Timed out waiting for new odds (5 min).",
    networkError: "Network error.",
    noOdds: "No odds available yet.",
    noOddsHint: "An admin can trigger a refresh from the dashboard.",
    lastUpdated: "Last updated:",
    draw: "Draw",
    cantFindMarket: "Can't find the market",
    dateLocale: "en-GB",
  },
} as const;

type Translations = typeof translations.sv;

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LangContext = createContext<LangContextValue>({
  lang: "sv",
  setLang: () => {},
  t: translations.sv,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("sv");

  useEffect(() => {
    const stored = localStorage.getItem("lang");
    if (stored === "en" || stored === "sv") setLangState(stored);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("lang", l);
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

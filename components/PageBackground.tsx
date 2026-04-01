"use client";

import { useEffect, useState, ReactNode } from "react";

export function PageBackground({ children }: { children: ReactNode }) {
  const [hasBackground, setHasBackground] = useState(false);

  useEffect(() => {
    fetch("/api/background", { method: "HEAD" })
      .then((r) => setHasBackground(r.ok))
      .catch(() => {});
  }, []);

  return (
    <main
      className="min-h-screen bg-gray-50"
      style={
        hasBackground
          ? {
              backgroundImage: "url(/api/background)",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundAttachment: "fixed",
            }
          : undefined
      }
    >
      {children}
    </main>
  );
}

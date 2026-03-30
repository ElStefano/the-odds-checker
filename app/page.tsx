import { OddsBoard } from "@/components/OddsBoard";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            The Odds Checker
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Curated match odds, best value first.
          </p>
        </div>
        <OddsBoard />
      </div>
    </main>
  );
}

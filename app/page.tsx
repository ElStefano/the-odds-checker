import { OddsBoard } from "@/components/OddsBoard";
import { PageHeader } from "@/components/PageHeader";
import { PageBackground } from "@/components/PageBackground";

export default function Home() {
  return (
    <PageBackground>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <PageHeader />
        <OddsBoard />
      </div>
    </PageBackground>
  );
}

import { MatchHistory } from "@/components/MatchHistory";
import { getMatchHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  return <MatchHistory entries={getMatchHistory(scope === "all" ? 1_000 : 100, scope === "all")} />;
}

import { MatchHistory } from "@/components/MatchHistory";
import { getMatchHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  return <MatchHistory entries={getMatchHistory()} />;
}

import { Dashboard } from "@/components/Dashboard";
import { getDatabase } from "@/lib/db";
import { getMatchHistory, getTrophies } from "@/lib/history";
import { getOverview } from "@/lib/queries";
import { personalPerformanceTrend } from "@/lib/competitive-insights";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDatabase();
  const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
  return <Dashboard data={{ overview: getOverview(), matches: getMatchHistory(5), trophies: getTrophies(3), performance: personalPerformanceTrend(10), warehouse: { matches: count("riot_matches"), participants: count("riot_participants"), observations: count("live_observations"), snapshots: count("meta_snapshots") } }} />;
}

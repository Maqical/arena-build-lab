import { TrophyCase } from "@/components/TrophyCase";
import { getTrophies } from "@/lib/history";

export const dynamic = "force-dynamic";

export default function TrophiesPage() {
  return <TrophyCase trophies={getTrophies()} />;
}

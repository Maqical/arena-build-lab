import { ArenaWorkbench } from "@/components/arena-workbench";
import { getChampions, getEntityOptions, getOverview, searchCombos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  const overview = getOverview();
  const champions = getChampions();
  const entityOptions = getEntityOptions();
  const initialCombos = searchCombos({ curatedOnly: true, limit: 36 });
  return <ArenaWorkbench overview={overview} champions={champions} entityOptions={entityOptions} initialCombos={initialCombos} />;
}

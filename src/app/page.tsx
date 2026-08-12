import { ArenaWorkbench } from "@/components/arena-workbench";
import { getChampions, getEntityOptions, getOverview, getStatFormulas, searchCombos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  const overview = getOverview();
  const champions = getChampions();
  const entityOptions = getEntityOptions();
  const statFormulas = getStatFormulas();
  const initialCombos = searchCombos({ curatedOnly: true, limit: 36 });
  return <ArenaWorkbench overview={overview} champions={champions} entityOptions={entityOptions} statFormulas={statFormulas} initialCombos={initialCombos} />;
}

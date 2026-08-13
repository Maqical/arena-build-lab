import { ArenaWorkbench } from "@/components/arena-workbench";
import { getChampions, getEntityOptions, getOverview, getStatFormulas, searchCombos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function BuildLabPage() {
  return <ArenaWorkbench overview={getOverview()} champions={getChampions()} entityOptions={getEntityOptions()} statFormulas={getStatFormulas()} initialCombos={searchCombos({ curatedOnly: true, limit: 36 })} />;
}

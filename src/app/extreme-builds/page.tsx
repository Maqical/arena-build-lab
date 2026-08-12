import { ExtremeBuildsBrowser } from "@/components/ExtremeBuildsBrowser";
import { getExtremeBuildCsvRows } from "@/lib/extreme-build-csv";
import { getChampions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ExtremeBuildsPage() {
  return <ExtremeBuildsBrowser builds={getExtremeBuildCsvRows()} champions={getChampions()} />;
}

import { Suspense } from "react";
import { LoadingBlock } from "@/components/api-state";
import { FindingsExplorer } from "@/components/findings/findings-explorer";

export default async function ScanFindingsPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  return (
    // useSearchParams in the explorer needs a Suspense boundary.
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <FindingsExplorer scanId={scanId} />
    </Suspense>
  );
}

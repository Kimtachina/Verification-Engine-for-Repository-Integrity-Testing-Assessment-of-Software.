import { FindingDetail } from "./finding-detail";

export default async function FindingPage({ params }: { params: Promise<{ findingId: string }> }) {
  const { findingId } = await params;
  return <FindingDetail findingId={findingId} />;
}

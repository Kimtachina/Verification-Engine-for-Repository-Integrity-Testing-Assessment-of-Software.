import { FileTable } from "@/components/findings/file-table";

export default async function ScanFilesPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  return <FileTable scanId={scanId} />;
}

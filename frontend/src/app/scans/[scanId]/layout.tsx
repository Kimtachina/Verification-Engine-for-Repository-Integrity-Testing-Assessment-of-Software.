import type { ReactNode } from "react";
import { ScanHeader } from "./scan-header";

/** Shared by the findings and files views of a scan: summary on top, view below. */
export default async function ScanLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  return (
    <div className="space-y-8">
      <ScanHeader scanId={scanId} />
      {children}
    </div>
  );
}

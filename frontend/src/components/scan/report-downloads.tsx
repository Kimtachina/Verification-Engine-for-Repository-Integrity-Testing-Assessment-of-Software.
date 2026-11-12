import type { ReportFormat } from "@veritas/shared";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

const FORMATS: Array<{ format: ReportFormat; label: string; hint: string }> = [
  { format: "html", label: "HTML", hint: "เปิดในเบราว์เซอร์หรือพิมพ์ได้" },
  { format: "markdown", label: "Markdown", hint: "แปะใน Pull Request หรือ Wiki" },
  { format: "sarif", label: "SARIF", hint: "นำเข้า GitHub Code Scanning หรือ IDE" },
  { format: "json", label: "JSON", hint: "ข้อมูลครบทุกฟิลด์ สำหรับโปรแกรมอื่น" },
];

export function ReportDownloads({ scanId }: { scanId: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">ดาวน์โหลดรายงาน</legend>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Download className="size-4" aria-hidden />
        รายงาน:
      </span>
      {FORMATS.map(({ format, label, hint }) => (
        <Button key={format} asChild variant="outline" size="sm">
          <a href={api.reportUrl(scanId, format)} download title={hint}>
            {label}
          </a>
        </Button>
      ))}
    </fieldset>
  );
}

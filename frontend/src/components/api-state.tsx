import { AlertTriangle, ServerOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE, ApiError } from "@/lib/api-client";

/** One place for how API failures look, so every page explains them the same way. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 0) {
    return (
      <Alert variant="destructive">
        <ServerOff aria-hidden />
        <AlertTitle>เชื่อมต่อ VERITAS API ไม่ได้</AlertTitle>
        <AlertDescription>
          <p>
            ไม่พบ API ที่ <code className="font-mono">{API_BASE}</code> เปิดเซิร์ฟเวอร์ด้วยคำสั่ง{" "}
            <code className="font-mono">bun run api</code> ที่โฟลเดอร์โปรเจกต์ แล้วรีเฟรชหน้านี้
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden />
      <AlertTitle>
        {error instanceof ApiError && error.status === 404 ? "ไม่พบข้อมูล" : "เกิดข้อผิดพลาด"}
      </AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {error instanceof ApiError && error.details && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{error.details}</pre>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        // Static placeholder list; index keys are fine.
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders never reorder
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

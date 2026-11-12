import type { Health } from "@veritas/shared";
import { CheckCircle2, CircleDashed } from "lucide-react";

const INSTALL: Record<string, string> = {
  ruff: "brew install ruff",
  semgrep: "brew install semgrep",
  gitleaks: "brew install gitleaks",
  "osv-scanner": "brew install osv-scanner",
};

export function ToolStatus({ tools }: { tools: Health["tools"] }) {
  return (
    <ul className="space-y-2 text-sm">
      {tools.map((t) => (
        <li key={t.name} className="flex items-center gap-2">
          {t.available ? (
            <CheckCircle2 className="size-4 text-good" aria-label="พร้อมใช้" />
          ) : (
            <CircleDashed className="size-4 text-muted-foreground" aria-label="ยังไม่ได้ติดตั้ง" />
          )}
          <span className="font-mono">{t.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {t.available ? (
              t.source === "bundled" ? (
                "มากับ VERITAS"
              ) : (
                "ติดตั้งในเครื่อง"
              )
            ) : (
              <code className="font-mono">{INSTALL[t.name] ?? "bun install"}</code>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

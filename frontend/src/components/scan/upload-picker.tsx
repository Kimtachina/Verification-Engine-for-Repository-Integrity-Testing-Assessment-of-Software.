"use client";

import { FolderUp, X } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readDroppedFiles } from "@/lib/folder-drop";
import { formatBytes, selectUploadFiles, type UploadSelection } from "@/lib/upload";
import { cn } from "@/lib/utils";

/**
 * Pick a folder with the system dialog, or drop one here. Shows what will be uploaded and
 * what was left out before anything is sent.
 */
export function UploadPicker({
  selection,
  onChange,
  disabled,
}: {
  selection: UploadSelection | null;
  onChange: (selection: UploadSelection | null) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);

  const onPicked = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onChange(
      selectUploadFiles(
        Array.from(list, (file) => ({ file, fullPath: file.webkitRelativePath || file.name })),
      ),
    );
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    setReading(true);
    try {
      onChange(selectUploadFiles(await readDroppedFiles(event.dataTransfer.items)));
    } finally {
      setReading(false);
    }
  };

  const skippedTotal = selection ? Object.values(selection.skipped).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the button below is the accessible way to pick a folder */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-foreground/60 bg-muted" : "border-border",
          disabled && "opacity-60",
        )}
      >
        <FolderUp className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm">{reading ? "กำลังอ่านโฟลเดอร์…" : "ลากโฟลเดอร์โปรเจกต์มาวางที่นี่ หรือ"}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={disabled || reading}
        >
          เลือกโฟลเดอร์…
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          // Non-standard but supported by Chrome, Edge, Firefox and Safari: pick a whole folder.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            onPicked(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          ไม่ส่ง node_modules, .git, dist และโฟลเดอร์ build · ไฟล์ละไม่เกิน 10 MB · รวมไม่เกิน 200 MB
        </p>
      </div>

      {selection && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <div>
            <p className="font-medium">
              {selection.name} — {selection.files.length.toLocaleString("th-TH")} ไฟล์ (
              {formatBytes(selection.bytes)})
            </p>
            {skippedTotal > 0 && (
              <p className="text-xs text-muted-foreground">
                ข้าม {skippedTotal.toLocaleString("th-TH")} ไฟล์
                {selection.skipped["ignored-folder"] > 0 &&
                  ` · ${selection.skipped["ignored-folder"].toLocaleString("th-TH")} ในโฟลเดอร์ที่ไม่ต้องตรวจ`}
                {selection.skipped["too-large"] > 0 &&
                  ` · ${selection.skipped["too-large"]} ไฟล์ใหญ่เกิน 10 MB`}
                {selection.skipped["unsafe-path"] > 0 &&
                  ` · ${selection.skipped["unsafe-path"]} ไฟล์ชื่อไม่ปลอดภัย`}
              </p>
            )}
            {selection.error && <p className="text-xs text-sev-high">{selection.error}</p>}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="ยกเลิกโฟลเดอร์ที่เลือก"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

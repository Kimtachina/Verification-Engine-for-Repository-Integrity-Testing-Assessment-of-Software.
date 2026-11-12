import { UPLOAD_LIMITS, type UploadSkipReason, uploadDecision } from "@veritas/shared";

export interface PickedFile<F extends { size: number } = File> {
  file: F;
  /** Path inside the chosen folder, without the folder's own name: "src/app.ts". */
  path: string;
}

export interface UploadSelection<F extends { size: number } = File> {
  /** The chosen folder's name, shown to the user and kept by the server. */
  name: string;
  files: PickedFile<F>[];
  bytes: number;
  skipped: Record<UploadSkipReason, number>;
  /** Set when the selection cannot be uploaded as it is. */
  error: string | null;
}

/**
 * Turns what the browser gives us (paths like "my-app/src/app.ts" from a folder picker or
 * a drop) into what will be uploaded: the folder name, the files with paths relative to
 * it, and counts of what was left out and why. The server enforces the same rules.
 */
export function selectUploadFiles<F extends { size: number }>(
  entries: ReadonlyArray<{ file: F; fullPath: string }>,
): UploadSelection<F> {
  const paths = entries.map((e) => e.fullPath.replace(/^\/+/, ""));
  const firstSegments = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  // One top folder for everything: that is the project; strip it from every path.
  const top = firstSegments.size === 1 ? [...firstSegments][0] : "";
  const name = top || "project";

  const skipped: Record<UploadSkipReason, number> = {
    "ignored-folder": 0,
    "too-large": 0,
    "unsafe-path": 0,
  };
  const files: PickedFile<F>[] = [];
  let bytes = 0;
  entries.forEach((entry, i) => {
    const full = paths[i] ?? "";
    const path = top ? full.slice(top.length + 1) : full;
    const decision = uploadDecision(path, entry.file.size);
    if (!decision.upload) {
      skipped[decision.reason]++;
      return;
    }
    files.push({ file: entry.file, path });
    bytes += entry.file.size;
  });

  let error: string | null = null;
  if (files.length === 0) error = "ไม่มีไฟล์ที่อัปโหลดได้ในโฟลเดอร์นี้";
  else if (files.length > UPLOAD_LIMITS.maxFiles) {
    error = `มี ${files.length.toLocaleString("th-TH")} ไฟล์ เกินขีดจำกัด ${UPLOAD_LIMITS.maxFiles.toLocaleString("th-TH")} ไฟล์`;
  } else if (bytes > UPLOAD_LIMITS.maxTotalBytes) {
    error = `ขนาดรวม ${formatBytes(bytes)} เกินขีดจำกัด ${formatBytes(UPLOAD_LIMITS.maxTotalBytes)}`;
  }
  return { name, files, bytes, skipped, error };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

import { UPLOAD_SKIP_DIRS } from "@veritas/shared";

/**
 * Reads files from a drag-and-drop, descending into folders. Skipped folders such as
 * node_modules are never opened, which keeps large projects fast to drop.
 * Browser-only: uses the File and Directory Entries API.
 */
export async function readDroppedFiles(
  items: DataTransferItemList,
): Promise<Array<{ file: File; fullPath: string }>> {
  // Entries must be taken synchronously: the list is cleared after the event handler returns.
  const roots = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const out: Array<{ file: File; fullPath: string }> = [];
  for (const root of roots) await walk(root, out);
  return out;
}

async function walk(
  entry: FileSystemEntry,
  out: Array<{ file: File; fullPath: string }>,
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, fullPath: entry.fullPath.replace(/^\//, "") });
    return;
  }
  if (!entry.isDirectory || UPLOAD_SKIP_DIRS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 entries per call; keep reading until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, out);
  }
}

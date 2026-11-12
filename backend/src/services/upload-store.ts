import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isSafeRelativePath, UPLOAD_LIMITS, type Upload, uploadSchema } from "@veritas/shared";
import { HttpError } from "./http-error";

const META_FILE = "upload.json";
/** Uploads kept on disk; older ones are deleted when a new one arrives. */
export const KEEP_UPLOADS = 10;

export interface UploadedFile {
  /** Relative to the uploaded folder, e.g. "src/app.ts". Untrusted: validated before use. */
  path: string;
  file: Blob;
}

/**
 * Stores folders uploaded from the dashboard under `<dir>/<id>/<name>/`, one folder per
 * upload. Scans refer to an upload by its server-generated id, never by a path, so a
 * client still cannot point a scan at an arbitrary directory.
 */
export class UploadStore {
  constructor(private readonly dir: string) {}

  async save(rawName: string, files: readonly UploadedFile[]): Promise<Upload> {
    checkLimits(files);
    const seen = new Set<string>();
    for (const f of files) {
      if (!isSafeRelativePath(f.path))
        throw new HttpError(
          400,
          `Unsafe file path in upload: ${JSON.stringify(f.path.slice(0, 200))}`,
        );
      if (seen.has(f.path)) throw new HttpError(400, `Duplicate file path in upload: ${f.path}`);
      seen.add(f.path);
    }

    const id = crypto.randomUUID();
    const name = safeName(rawName);
    const root = join(this.dir, id, name);
    try {
      await mkdir(root, { recursive: true });
      for (const f of files) {
        const target = resolve(root, f.path);
        // Second line of defence after isSafeRelativePath: the resolved path must stay inside.
        if (!isInside(target, root))
          throw new HttpError(400, `Unsafe file path in upload: ${f.path}`);
        await mkdir(dirname(target), { recursive: true });
        await writeNew(target, f);
      }
      const upload: Upload = {
        id,
        name,
        files: files.length,
        bytes: files.reduce((n, f) => n + f.file.size, 0),
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(this.dir, id, META_FILE), JSON.stringify(upload));
      await this.prune(KEEP_UPLOADS);
      return upload;
    } catch (error) {
      // Never leave half an upload behind.
      await rm(join(this.dir, id), { recursive: true, force: true });
      throw error;
    }
  }

  /** Absolute folder to scan for an upload id, or null if there is no such upload. */
  async rootOf(id: string): Promise<string | null> {
    const upload = await this.get(id);
    return upload ? join(this.dir, upload.id, upload.name) : null;
  }

  async get(id: string): Promise<Upload | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
      const meta = uploadSchema.safeParse(
        JSON.parse(await readFile(join(this.dir, id, META_FILE), "utf-8")),
      );
      return meta.success && meta.data.id === id ? meta.data : null;
    } catch {
      return null;
    }
  }

  /** Newest first. */
  async list(): Promise<Upload[]> {
    if (!existsSync(this.dir)) return [];
    const ids = await readdir(this.dir);
    const uploads = await Promise.all(ids.map((id) => this.get(id)));
    return uploads
      .filter((u): u is Upload => u !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async prune(keep: number): Promise<void> {
    for (const old of (await this.list()).slice(keep)) {
      await rm(join(this.dir, old.id), { recursive: true, force: true });
    }
  }
}

function checkLimits(files: readonly UploadedFile[]): void {
  if (files.length === 0) throw new HttpError(400, "The upload contains no files.");
  if (files.length > UPLOAD_LIMITS.maxFiles) {
    throw new HttpError(413, `Too many files: ${files.length} (limit ${UPLOAD_LIMITS.maxFiles}).`);
  }
  const big = files.find((f) => f.file.size > UPLOAD_LIMITS.maxFileBytes);
  if (big) {
    throw new HttpError(
      413,
      `File too large: ${big.path} (limit ${UPLOAD_LIMITS.maxFileBytes / 1024 / 1024} MB per file).`,
    );
  }
  const total = files.reduce((n, f) => n + f.file.size, 0);
  if (total > UPLOAD_LIMITS.maxTotalBytes) {
    throw new HttpError(
      413,
      `Upload too large: ${Math.round(total / 1024 / 1024)} MB (limit ${UPLOAD_LIMITS.maxTotalBytes / 1024 / 1024} MB).`,
    );
  }
}

/** Writes a file that must not exist yet ("wx"), so two uploaded paths can never merge. */
async function writeNew(target: string, f: UploadedFile): Promise<void> {
  try {
    await writeFile(target, new Uint8Array(await f.file.arrayBuffer()), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // On case-insensitive disks (macOS, Windows) "User.ts" and "user.ts" are one file.
      throw new HttpError(400, `Two files in the upload map to the same path: ${f.path}`);
    }
    throw error;
  }
}

/** The folder name as one safe path segment; "project" when nothing usable remains. */
export function safeName(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
    .replace(/[/\\:\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 100);
  return cleaned.length > 0 && isSafeRelativePath(cleaned) ? cleaned : "project";
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel);
}

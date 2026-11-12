export interface RunProcessOptions {
  cmd: string[];
  cwd?: string;
  stdin?: string;
  signal?: AbortSignal;
  /** Output beyond this is an error, not silently truncated. Default 64 MiB. */
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  override name = "ProcessError";
}

/**
 * Runs an external tool and collects its output. Arguments are passed as an array,
 * never through a shell, so file names from the scanned code cannot inject commands.
 */
export async function runProcess({
  cmd,
  cwd,
  stdin,
  signal,
  maxOutputBytes = 64 * 1024 * 1024,
  env,
}: RunProcessOptions): Promise<ProcessResult> {
  signal?.throwIfAborted();
  const proc = Bun.spawn(cmd, {
    ...(cwd !== undefined && { cwd }),
    env: env ?? minimalEnv(),
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });

  const onAbort = () => proc.kill();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readCapped(proc.stdout, maxOutputBytes, proc),
      readCapped(proc.stderr, maxOutputBytes, proc),
      proc.exited,
    ]);
    if (signal?.aborted) throw signal.reason ?? new ProcessError(`${cmd[0]} was aborted`);
    return { exitCode, stdout, stderr };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  max: number,
  proc: { kill(): void },
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > max) {
      proc.kill();
      throw new ProcessError(`Process output exceeded ${max} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** PATH and locale only: tools must not see secrets from the server's environment. */
function minimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Absolute path of an executable on PATH, or null. */
export function findExecutable(name: string): string | null {
  return Bun.which(name);
}

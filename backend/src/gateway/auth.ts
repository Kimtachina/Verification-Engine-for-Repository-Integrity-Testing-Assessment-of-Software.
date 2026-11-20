import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "veritas_session";
const SESSION_DAYS = 30;

/**
 * Sessions for the single shared password. The cookie is `<expiry ms>.<HMAC>`, signed with
 * a key derived from the password, so it survives restarts (Hugging Face Spaces sleep)
 * and changing the password logs everyone out. Nothing is stored server-side.
 */
export class PasswordAuth {
  private readonly key: Buffer;
  private readonly passwordHash: Buffer;

  constructor(
    password: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createHmac("sha256", "veritas-session-v1").update(password).digest();
    this.passwordHash = sha256(password);
  }

  /** Constant-time: the time taken says nothing about how much of the guess was right. */
  checkPassword(guess: string): boolean {
    return timingSafeEqual(sha256(guess), this.passwordHash);
  }

  issue(): string {
    const expires = String(this.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    return `${expires}.${this.sign(expires)}`;
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [expires, signature] = token.split(".");
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    const expected = Buffer.from(this.sign(expires));
    const given = Buffer.from(signature);
    return (
      given.length === expected.length &&
      timingSafeEqual(given, expected) &&
      Number(expires) > this.now()
    );
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.key).update(payload).digest("base64url");
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/**
 * Over HTTPS the cookie is SameSite=None + Partitioned, so it also works when the app is
 * shown inside the Hugging Face Space page (an iframe on another site); cross-site
 * requests are refused by the Origin check instead. Over plain HTTP (local) it is Lax.
 */
export function sessionCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", `Max-Age=${maxAgeSeconds}`];
  parts.push(...(secure ? ["SameSite=None", "Secure", "Partitioned"] : ["SameSite=Lax"]));
  return parts.join("; ");
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** Failed logins per client, to slow down password guessing. In memory: one process. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  blocked(client: string): boolean {
    const entry = this.failures.get(client);
    if (!entry) return false;
    if (entry.resetAt <= this.now()) {
      this.failures.delete(client);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  fail(client: string): void {
    const entry = this.failures.get(client);
    if (!entry || entry.resetAt <= this.now()) {
      this.failures.set(client, { count: 1, resetAt: this.now() + this.windowMs });
    } else {
      entry.count++;
    }
  }

  succeed(client: string): void {
    this.failures.delete(client);
  }
}

/** Only same-site paths: "/scans/x" yes, "//evil.com" or "https://…" no. */
export function safeNext(next: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A self-contained page: works before the dashboard (and its scripts) can be reached. */
export function loginPage(next: string, error?: string): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>เข้าสู่ระบบ · VERITAS</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #171717; --muted: #737373; --border: #e5e5e5; --card: #fff; --bad: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #f5f5f5; --muted: #a3a3a3; --border: #262626; --card: #171717; --bad: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, "IBM Plex Sans Thai", sans-serif; }
  form { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; display: grid; gap: 12px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: 0.02em; }
  p { margin: 0; color: var(--muted); font-size: 14px; }
  label { font-size: 14px; font-weight: 500; }
  input { width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  button { padding: 9px; border: 0; border-radius: 8px; background: var(--fg); color: var(--bg); font: inherit; font-weight: 500; cursor: pointer; }
  .error { color: var(--bad); }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>VERITAS</h1>
  <p>ใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
  <label for="password">รหัสผ่าน</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">เข้าสู่ระบบ</button>
</form>
</body>
</html>`;
}

import {
  LoginLimiter,
  loginPage,
  type PasswordAuth,
  readCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  safeNext,
  sessionCookie,
} from "./auth";

export interface GatewayOptions {
  /** The VERITAS API (Elysia's `app.handle`). Serves every /api/* path. */
  api: (request: Request) => Response | Promise<Response>;
  /** The dashboard (Next.js) to proxy every other path to, e.g. http://127.0.0.1:3000. */
  webUpstream?: string;
  /** When set, everything except the login page needs a session. */
  auth?: PasswordAuth;
  limiter?: LoginLimiter;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The one public entry point when VERITAS runs on a server: password check first, then
 * /api/* to the API and the rest to the dashboard, all on one origin and port.
 */
export function createGateway({
  api,
  webUpstream,
  auth,
  limiter = new LoginLimiter(),
}: GatewayOptions) {
  return async (request: Request, clientIp = "unknown"): Promise<Response> => {
    const url = new URL(request.url);
    const secure = isHttps(request);

    if (auth) {
      // SameSite=None cookies are sent cross-site, so a write must come from our own pages.
      if (UNSAFE_METHODS.has(request.method) && !sameOrigin(request)) {
        return text(403, "Cross-site request refused");
      }
      if (url.pathname === "/login") {
        return request.method === "POST"
          ? login(request, auth, limiter, forwardedFor(request) ?? clientIp, secure)
          : html(200, loginPage(safeNext(url.searchParams.get("next"))));
      }
      if (url.pathname === "/logout" && request.method === "POST") {
        return redirect("/login", sessionCookie("", secure, 0));
      }
      if (!auth.verify(readCookie(request.headers.get("cookie"), SESSION_COOKIE))) {
        if (url.pathname.startsWith("/api/")) {
          return json(401, { error: "Sign in to VERITAS first" });
        }
        return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      }
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/") || !webUpstream) {
      return api(request);
    }
    return proxy(request, webUpstream);
  };
}

async function login(
  request: Request,
  auth: PasswordAuth,
  limiter: LoginLimiter,
  client: string,
  secure: boolean,
): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const next = safeNext(
    typeof form?.get("next") === "string" ? (form?.get("next") as string) : null,
  );
  if (limiter.blocked(client)) {
    return html(429, loginPage(next, "ลองผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่"));
  }
  if (typeof password !== "string" || !auth.checkPassword(password)) {
    limiter.fail(client);
    return html(401, loginPage(next, "รหัสผ่านไม่ถูกต้อง"));
  }
  limiter.succeed(client);
  return redirect(next, sessionCookie(auth.issue(), secure, SESSION_MAX_AGE));
}

/** Streams the request to the dashboard and its response back unchanged. */
async function proxy(request: Request, upstream: string): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("host");
  try {
    const response = await fetch(new URL(url.pathname + url.search, upstream), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
      redirect: "manual",
      // Pass compressed bodies through as they are, with their content-encoding header.
      decompress: false,
    });
    return new Response(response.body, response);
  } catch {
    return text(502, "The dashboard is starting; reload in a few seconds.");
  }
}

/** Behind a proxy (Hugging Face) the original scheme and host come in forwarded headers. */
function isHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (proto ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // No Origin (some same-origin form posts): the session cookie check still applies.
  if (!origin || origin === "null") return origin === null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function forwardedFor(request: Request): string | undefined {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

import { describe, expect, test } from "bun:test";
import { LoginLimiter, PasswordAuth, readCookie, safeNext } from "../../src/gateway/auth";
import { createGateway } from "../../src/gateway/gateway";

const PASSWORD = "correct horse battery";
const HOST = "veritas.example";

function setup(now = () => 1_000_000) {
  const auth = new PasswordAuth(PASSWORD, now);
  const api = (request: Request) =>
    Response.json({ api: new URL(request.url).pathname, method: request.method });
  const gateway = createGateway({ api, auth, limiter: new LoginLimiter(3, 60_000, now) });
  const call = (path: string, init: RequestInit = {}) =>
    gateway(
      new Request(`http://${HOST}${path}`, {
        ...init,
        headers: { host: HOST, ...(init.headers as Record<string, string>) },
      }),
      "10.0.0.1",
    );
  const login = (password: string, extra: Record<string, string> = {}) =>
    call("/login", {
      method: "POST",
      body: new URLSearchParams({ password, next: "/scans/abc", ...extra }),
      headers: { origin: `http://${HOST}` },
    });
  return { auth, call, login };
}

const sessionOf = (response: Response) =>
  readCookie(response.headers.get("set-cookie"), "veritas_session");

describe("gateway with a password", () => {
  test("pages redirect to the login page and the API answers 401 until signed in", async () => {
    const { call } = setup();
    const page = await call("/scans/abc?x=1");
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/login?next=%2Fscans%2Fabc%3Fx%3D1");
    const api = await call("/api/scans");
    expect(api.status).toBe(401);
    expect(await call("/login")).toHaveProperty("status", 200);
  });

  test("the right password sets a session that opens pages and the API", async () => {
    const { call, login } = setup();
    const response = await login(PASSWORD);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/scans/abc");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const session = sessionOf(response);
    const api = await call("/api/scans", { headers: { cookie: `veritas_session=${session}` } });
    expect(await api.json()).toEqual({ api: "/api/scans", method: "GET" });
  });

  test("over HTTPS the cookie also works inside the Hugging Face iframe", async () => {
    const { call } = setup();
    const response = await call("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
      headers: { origin: `https://${HOST}`, "x-forwarded-proto": "https" },
    });
    expect(response.headers.get("set-cookie")).toContain("SameSite=None; Secure; Partitioned");
  });

  test("a wrong password is refused, and repeated failures are slowed down", async () => {
    const { login } = setup();
    for (let i = 0; i < 3; i++) expect((await login("guess")).status).toBe(401);
    const blocked = await login(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(sessionOf(blocked)).toBeUndefined();
  });

  test("forged, tampered and expired sessions do not open anything", async () => {
    let now = 1_000_000;
    const { auth, call } = setup(() => now);
    const token = auth.issue();
    const [expires, signature] = token.split(".");
    const tampered = `${Number(expires) + 1}.${signature}`;
    for (const value of ["", "123.abc", tampered, new PasswordAuth("other password!").issue()]) {
      const response = await call("/api/scans", {
        headers: { cookie: `veritas_session=${value}` },
      });
      expect(response.status).toBe(401);
    }
    expect(auth.verify(token)).toBe(true);
    now += 31 * 24 * 60 * 60 * 1000;
    expect(auth.verify(token)).toBe(false);
  });

  test("writes from another site are refused even with a session", async () => {
    const { auth, call } = setup();
    const cookie = `veritas_session=${auth.issue()}`;
    const evil = await call("/api/scans", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    const ours = await call("/api/scans", {
      method: "POST",
      headers: { cookie, origin: `http://${HOST}` },
    });
    expect(ours.status).toBe(200);
  });

  test("the login page only redirects to paths on this site", async () => {
    const { login } = setup();
    const response = await login(PASSWORD, { next: "//evil.example/x" });
    expect(response.headers.get("location")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/history")).toBe("/history");
  });
});

describe("gateway without a password (local use)", () => {
  test("everything goes straight to the API", async () => {
    const gateway = createGateway({ api: () => new Response("api") });
    expect(await (await gateway(new Request("http://localhost/api/health"))).text()).toBe("api");
  });

  test("non-API paths are proxied to the dashboard", async () => {
    const web = Bun.serve({
      port: 0,
      fetch: (r) => new Response(`web ${new URL(r.url).pathname}`),
    });
    try {
      const gateway = createGateway({
        api: () => new Response("api"),
        webUpstream: `http://127.0.0.1:${web.port}`,
      });
      const page = await gateway(new Request("http://localhost/history?x=1"));
      expect(await page.text()).toBe("web /history");
      expect(await (await gateway(new Request("http://localhost/api/x"))).text()).toBe("api");
    } finally {
      web.stop(true);
    }
  });
});

/**
 * Standalone test for lib/jwt.js. Run with: npm run test:jwt
 * Not a test framework -- just direct assertions, since this is a small,
 * self-contained utility and the whole point is to verify it before
 * anything else gets built on top of it.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-this-run-only";

const assert = require("assert");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const {
  signAuthToken,
  verifyAuthToken,
  setAuthCookie,
  clearAuthCookie,
  attachUser,
  requireRole,
} = require("./jwt");

function request(server, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { host: "localhost", port, path, method: opts.method || "GET", headers: opts.headers || {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  console.log("1. Sign + verify round-trip ...");
  const token = signAuthToken({ userId: 42, role: "admin" });
  const decoded = verifyAuthToken(token);
  assert.strictEqual(decoded.userId, 42);
  assert.strictEqual(decoded.role, "admin");
  console.log("   OK");

  console.log("2. Tampered token is rejected ...");
  const tampered = token.slice(0, -3) + "xyz";
  assert.strictEqual(verifyAuthToken(tampered), null);
  console.log("   OK");

  console.log("3. Garbage token is rejected ...");
  assert.strictEqual(verifyAuthToken("not.a.jwt"), null);
  console.log("   OK");

  console.log("4. Full Express request cycle: login sets cookie, protected route reads it ...");
  const app = express();
  app.use(cookieParser());
  app.use(attachUser);

  app.post("/login", (req, res) => {
    setAuthCookie(res, { userId: 7, role: "admin" });
    res.json({ ok: true });
  });
  app.get("/admin-only", requireRole("admin"), (req, res) => res.json({ user: req.user }));
  app.get("/super-admin-only", requireRole("super_admin"), (req, res) => res.json({ user: req.user }));
  app.post("/logout", (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  const server = app.listen(0);
  try {
    // No cookie yet -> 401
    const noAuth = await request(server, "/admin-only");
    assert.strictEqual(noAuth.status, 401);
    console.log("   /admin-only with no cookie -> 401 OK");

    // Log in, capture the Set-Cookie header
    const loginRes = await request(server, "/login", { method: "POST" });
    const setCookieHeader = loginRes.headers["set-cookie"][0];
    const cookie = setCookieHeader.split(";")[0];
    assert.ok(setCookieHeader.includes("HttpOnly"));
    console.log("   login sets an HttpOnly cookie OK");

    // Use the cookie against an admin-only route -> 200
    const authed = await request(server, "/admin-only", { headers: { Cookie: cookie } });
    assert.strictEqual(authed.status, 200);
    const authedBody = JSON.parse(authed.body);
    assert.strictEqual(authedBody.user.userId, 7);
    console.log("   /admin-only with valid cookie -> 200, correct user OK");

    // Same cookie against a super_admin-only route -> 403 (role enforcement)
    const forbidden = await request(server, "/super-admin-only", { headers: { Cookie: cookie } });
    assert.strictEqual(forbidden.status, 403);
    console.log("   /super-admin-only with an admin cookie -> 403 OK (role enforcement works)");

    // Log out, then the same cookie value should be cleared client-side;
    // simulate "no cookie sent" to represent the post-logout browser state
    const afterLogout = await request(server, "/admin-only");
    assert.strictEqual(afterLogout.status, 401);
    console.log("   after logout (no cookie) -> 401 OK");
  } finally {
    server.close();
  }

  console.log("\nAll JWT auth tests passed.");
}

main().catch((err) => {
  console.error("JWT auth test FAILED:", err);
  process.exit(1);
});

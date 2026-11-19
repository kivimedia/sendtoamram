// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// The browser sends "Content-Type: application/json" on every request, including the
// buttons that send no body (pay, start/pause/resume deep scan, sync now, send to
// accountant, billing portal, dismiss alert). The JSON reader ran JSON.parse("") on
// those, threw, and every one of those buttons answered "Internal server error" on live.

let app: FastifyInstance;

beforeAll(async () => {
  process.env.CRON_SECRET = "test-cron-secret-not-real";
  const { createServer } = await import("../../server/app");
  app = await createServer();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe("JSON content type with no body", () => {
  it("reaches the route instead of failing as a server error", async () => {
    // A cron route answers 401 without the secret, so it shows the request got through
    // the body reader without touching the database.
    const res = await app.inject({
      method: "POST",
      url: "/api/cron/gmail-sync",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("still reads a real JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cron/gmail-sync",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(401);
  });

  it("answers a broken JSON body with 400, not 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cron/gmail-sync",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
  });
});

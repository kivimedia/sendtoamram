// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// Vercel Cron calls every scheduled path with GET (plus "Authorization: Bearer $CRON_SECRET").
// The routes were POST-only, so every scheduled run got a 404 and Gmail sync / deep scan never ran.
const CRON_PATHS = ["/cron/gmail-sync", "/cron/deep-scan", "/cron/monthly-delivery", "/cron/missing-receipts"];

let app: FastifyInstance;

beforeAll(async () => {
  process.env.CRON_SECRET = "test-cron-secret-not-real";
  const { registerHealthRoutes } = await import("../../server/routes/health");
  app = Fastify();
  await registerHealthRoutes(app);
  await app.ready();
}, 120_000); // loading Fastify can take well over the 10 s default on a busy machine

afterAll(async () => {
  await app.close();
});

describe("scheduled job routes", () => {
  for (const url of CRON_PATHS) {
    it(`${url} answers the scheduler's GET (401 without the secret, never 404)`, async () => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    });

    it(`${url} still refuses a POST without the secret`, async () => {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode).toBe(401);
    });

    it(`${url} refuses a wrong secret`, async () => {
      const res = await app.inject({ method: "GET", url, headers: { authorization: "Bearer wrong" } });
      expect(res.statusCode).toBe(401);
    });
  }
});

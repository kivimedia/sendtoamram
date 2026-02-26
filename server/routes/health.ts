import { FastifyInstance } from "fastify";
import { env } from "../config";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  // Vercel Cron endpoint for monthly delivery
  app.post("/cron/monthly-delivery", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    try {
      const { checkAndRunMonthlyDeliveries } = await import("../services/monthly-delivery");
      const result = await checkAndRunMonthlyDeliveries();
      return { ok: true, ...result };
    } catch (error) {
      console.error("[cron] Monthly delivery failed:", error);
      reply.code(500);
      return { error: "Monthly delivery failed" };
    }
  });

  // Vercel Cron endpoint for Gmail sync
  app.post("/cron/gmail-sync", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    try {
      const { syncAllGmailInboxes } = await import("../services/gmail-sync");
      const result = await syncAllGmailInboxes();
      return { ok: true, ...result };
    } catch (error) {
      console.error("[cron] Gmail sync failed:", error);
      reply.code(500);
      return { error: "Gmail sync failed" };
    }
  });

  // Vercel Cron endpoint for deep scan processing
  app.post("/cron/deep-scan", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    try {
      const { processScanJobs } = await import("../services/deep-scan");
      const result = await processScanJobs();
      return { ok: true, ...result };
    } catch (error) {
      console.error("[cron] Deep scan failed:", error);
      reply.code(500);
      return { error: "Deep scan failed" };
    }
  });

  // Vercel Cron endpoint for missing receipt detection (1st of month, 9AM)
  app.post("/cron/missing-receipts", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    try {
      const { processAllBusinesses } = await import("../services/missing-receipts");
      const result = await processAllBusinesses();
      return { ok: true, ...result };
    } catch (error) {
      console.error("[cron] Missing receipts check failed:", error);
      reply.code(500);
      return { error: "Missing receipts check failed" };
    }
  });
}

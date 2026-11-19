import { FastifyInstance } from "fastify";
import { env } from "../config";

// Vercel Cron calls each scheduled path with GET and "Authorization: Bearer $CRON_SECRET".
// These routes used to be POST-only, so every scheduled run got a 404 and nothing ran.
// POST stays accepted for manual runs.
function registerCron(
  app: FastifyInstance,
  url: string,
  label: string,
  run: () => Promise<Record<string, unknown>>,
): void {
  app.route({
    method: ["GET", "POST"],
    url,
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
        reply.code(401);
        return { error: "Unauthorized" };
      }

      try {
        const result = await run();
        return { ok: true, ...result };
      } catch (error) {
        console.error(`[cron] ${label} failed:`, error);
        reply.code(500);
        return { error: `${label} failed` };
      }
    },
  });
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  registerCron(app, "/cron/monthly-delivery", "Monthly delivery", async () => {
    const { checkAndRunMonthlyDeliveries } = await import("../services/monthly-delivery");
    return checkAndRunMonthlyDeliveries();
  });

  registerCron(app, "/cron/gmail-sync", "Gmail sync", async () => {
    const { syncAllGmailInboxes } = await import("../services/gmail-sync");
    return syncAllGmailInboxes();
  });

  registerCron(app, "/cron/deep-scan", "Deep scan", async () => {
    const { processScanJobs } = await import("../services/deep-scan");
    return processScanJobs();
  });

  // 1st of the month, 9 AM
  registerCron(app, "/cron/missing-receipts", "Missing receipts check", async () => {
    const { processAllBusinesses } = await import("../services/missing-receipts");
    return processAllBusinesses();
  });
}

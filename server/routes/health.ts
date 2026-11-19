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

  // One real AI read of a fixed sample receipt, so a broken reader shows up as a
  // failed check instead of thousands of receipts silently saved at 0.
  registerCron(app, "/cron/ai-selftest", "AI self-test", async () => {
    const { extractInvoiceFromText, isAiEnabled, AI_SELFTEST_BUSINESS_ID } = await import("../services/ai");
    if (!isAiEnabled()) return { ai: "disabled", model: env.AI_MODEL_CHEAP };
    const receipt = [
      "From: Example Cloud Ltd <billing@example.com>",
      "Subject: Your receipt",
      "Amount paid: $10.00 USD",
      "Date paid: November 19, 2026",
    ].join("\n");
    const notReceipt = [
      "From: Dana Cohen <dana@example.com>",
      "Subject: Re: balloon arch for Saturday",
      "Hi! Attached a photo of the venue. Can you do the arch in gold and white? Thanks, Dana",
    ].join("\n");
    try {
      const a = await extractInvoiceFromText(AI_SELFTEST_BUSINESS_ID, receipt);
      const b = await extractInvoiceFromText(AI_SELFTEST_BUSINESS_ID, notReceipt);
      const checks = {
        receiptAmount: a.amountCents === 1000,
        receiptCurrency: a.currency === "USD",
        receiptIsReceipt: a.isReceipt !== false,
        clientEmailIsNotReceipt: b.isReceipt === false,
      };
      const pass = Object.values(checks).every(Boolean);
      return { ai: pass ? "pass" : "wrong", model: env.AI_MODEL_CHEAP, checks, receipt: a, clientEmail: b };
    } catch (error) {
      return {
        ai: "failed",
        model: env.AI_MODEL_CHEAP,
        error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error),
      };
    }
  });
}

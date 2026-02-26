import "dotenv/config";
import { env } from "./config";
import { createServer } from "./app";

async function start() {
  const app = await createServer();
  await app.listen({ host: env.HOST, port: env.PORT });

  // Periodic Gmail sync every 5 minutes
  if (env.DATABASE_URL) {
    setInterval(async () => {
      try {
        const { syncAllGmailInboxes } = await import("./services/gmail-sync");
        const result = await syncAllGmailInboxes();
        if (result.total > 0) {
          console.log(`[periodic-sync] Synced ${result.total} new documents`);
        }
      } catch (error) {
        console.error("[periodic-sync] Failed:", error);
      }
    }, 5 * 60 * 1000);
    console.log("[startup] Periodic Gmail sync enabled (every 5 min)");

    // Monthly delivery check once per hour (local dev; Vercel uses cron)
    setInterval(async () => {
      try {
        const { checkAndRunMonthlyDeliveries } = await import("./services/monthly-delivery");
        const result = await checkAndRunMonthlyDeliveries();
        if (result.delivered > 0) {
          console.log(`[monthly-delivery] Delivered ${result.delivered} monthly reports`);
        }
      } catch (error) {
        console.error("[monthly-delivery] Failed:", error);
      }
    }, 60 * 60 * 1000);
    console.log("[startup] Monthly delivery check enabled (hourly)");
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

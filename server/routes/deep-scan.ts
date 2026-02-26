import { FastifyInstance } from "fastify";
import { store } from "../store";
import { env } from "../config";

export async function registerDeepScanRoutes(app: FastifyInstance): Promise<void> {
  // Start a deep scan for a business
  app.post<{ Params: { businessId: string } }>(
    "/deep-scan/:businessId/start",
    async (request, reply) => {
      if (!env.DATABASE_URL) {
        reply.code(400);
        return { error: "Deep scan requires a database connection" };
      }

      const { businessId } = request.params;

      // Gate behind billing (if Stripe is configured)
      if (env.STRIPE_SECRET_KEY) {
        const billing = await store.getBusinessBilling(businessId);
        if (!billing.onboardingPaid) {
          reply.code(402);
          return { error: "Payment required — activate your account first" };
        }
      }

      // Check if there's already an active scan
      const existing = await store.getActiveScanJob(businessId);
      if (existing) {
        return {
          scanJobId: existing.id,
          status: existing.status,
          message: "A scan is already active",
        };
      }

      // Find the Gmail inbox for this business
      const inboxes = await store.getGmailInboxes(businessId);
      if (inboxes.length === 0) {
        reply.code(400);
        return { error: "No Gmail inbox connected" };
      }

      const inbox = inboxes[0];

      // Build Gmail search query for invoices going back 3 years
      const afterDate = new Date();
      afterDate.setFullYear(afterDate.getFullYear() - 3);
      const afterStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;

      const gmailQuery = `after:${afterStr} (has:attachment OR subject:(חשבונית OR invoice OR receipt OR קבלה OR payment OR תשלום OR billing OR הזמנה))`;

      const { id } = await store.createScanJob(
        businessId,
        inbox.id,
        gmailQuery,
        afterDate.toISOString().slice(0, 10),
      );

      console.log(`[deep-scan] Started scan job ${id} for business ${businessId}`);

      return {
        scanJobId: id,
        status: "DISCOVERING",
        message: "Deep scan started",
      };
    },
  );

  // Get scan status
  app.get<{ Params: { businessId: string } }>(
    "/deep-scan/:businessId/status",
    async (request, reply) => {
      const { businessId } = request.params;

      // First check active scan
      let job = await store.getActiveScanJob(businessId);

      // If no active scan, check most recent completed/paused one
      if (!job) {
        job = await store.getLatestCompletedScanJob(businessId);
      }

      if (!job) {
        return { active: false };
      }

      // Calculate percentages
      const discoveryComplete = job.status !== "DISCOVERING";
      const totalToProcess = job.totalToProcess || job.totalDiscovered || 0;
      const processedPercent = totalToProcess > 0
        ? Math.round((job.processedCount / totalToProcess) * 100)
        : 0;
      const aiPercent = job.aiTotal > 0
        ? Math.round((job.aiProcessed / job.aiTotal) * 100)
        : 0;

      return {
        active: ["DISCOVERING", "PROCESSING", "AI_PASS"].includes(job.status),
        scanJobId: job.id,
        status: job.status,
        currentPass: job.currentPass,
        discovery: {
          totalFound: job.totalDiscovered,
          isComplete: discoveryComplete,
        },
        processing: {
          total: totalToProcess,
          processed: job.processedCount,
          created: job.documentsCreated,
          skipped: job.skippedCount,
          errors: job.errorCount,
          percent: processedPercent,
        },
        ai: {
          total: job.aiTotal,
          processed: job.aiProcessed,
          percent: aiPercent,
        },
        lastError: job.lastError,
        startedAt: job.createdAt?.toISOString?.() ?? job.createdAt,
        updatedAt: job.updatedAt?.toISOString?.() ?? job.updatedAt,
      };
    },
  );

  // Pause a scan
  app.post<{ Params: { businessId: string } }>(
    "/deep-scan/:businessId/pause",
    async (request, reply) => {
      const { businessId } = request.params;
      const job = await store.getActiveScanJob(businessId);
      if (!job) {
        reply.code(404);
        return { error: "No active scan to pause" };
      }

      await store.updateScanJob(job.id, { status: "PAUSED" });
      return { scanJobId: job.id, status: "PAUSED" };
    },
  );

  // Resume a scan
  app.post<{ Params: { businessId: string } }>(
    "/deep-scan/:businessId/resume",
    async (request, reply) => {
      const { businessId } = request.params;

      const job = await store.getLatestCompletedScanJob(businessId);
      if (!job || job.status !== "PAUSED") {
        reply.code(404);
        return { error: "No paused scan to resume" };
      }

      // Determine which phase to resume in
      const counts = await store.getScanQueueCountByStatus(job.id);
      const hasPending = (counts["PENDING"]?.count ?? 0) > 0;
      const hasRegexDone = Object.entries(counts)
        .filter(([s]) => s === "REGEX_DONE")
        .some(([, v]: [string, any]) => (v.needsAi ?? 0) > 0);

      let resumeStatus: string;
      if (hasPending) {
        resumeStatus = "PROCESSING";
      } else if (hasRegexDone) {
        resumeStatus = "AI_PASS";
      } else {
        // Check if discovery was incomplete
        resumeStatus = job.discoveryPageToken ? "DISCOVERING" : "PROCESSING";
      }

      await store.updateScanJob(job.id, { status: resumeStatus });
      return { scanJobId: job.id, status: resumeStatus };
    },
  );
}

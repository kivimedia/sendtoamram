import { FastifyInstance } from "fastify";
import { z } from "zod";
import { store } from "../store";
import { syncGmailInbox } from "../services/gmail-sync";

const startPayloadSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).optional(),
  businessName: z.string().min(1).optional(),
  accountantName: z.string().min(1).optional(),
  accountantEmail: z.string().email().optional(),
});

const connectInboxPayloadSchema = z.object({
  businessId: z.string().min(1),
  provider: z.enum(["gmail", "outlook", "imap", "yahoo", "icloud"]),
  email: z.string().email().optional(),
});

const scanPayloadSchema = z.object({
  businessId: z.string().min(1),
  targetCount: z.number().int().positive().max(500).optional(),
});

const businessParamsSchema = z.object({
  businessId: z.string().min(1),
});

export async function registerOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/onboarding/start", async (request) => {
    const body = startPayloadSchema.parse(request.body);
    return store.startOnboarding(body);
  });

  app.get("/onboarding/state/:businessId", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    return store.getOnboardingState(businessId);
  });

  app.post("/onboarding/connect-inbox", async (request) => {
    const body = connectInboxPayloadSchema.parse(request.body);
    return store.connectInbox(body);
  });

  app.post("/onboarding/scan", async (request) => {
    const body = scanPayloadSchema.parse(request.body);

    const gmailInboxes = await store.getGmailInboxes(body.businessId);
    console.log(`[scan] Quick scan starting for business ${body.businessId} — ${gmailInboxes.length} Gmail inbox(es)`);

    for (const inbox of gmailInboxes) {
      try {
        console.log(`[scan] Syncing inbox ${inbox.id} (${inbox.email})...`);
        const result = await syncGmailInbox(inbox.id, { quickScan: true });
        console.log(`[scan] Inbox ${inbox.email}: ${result.newDocuments} new documents`);
      } catch (error: any) {
        console.error(`[scan] Gmail sync FAILED for inbox ${inbox.id} (${inbox.email}):`, error?.message ?? error);
      }
    }

    const scanResult = await store.runScan(body);
    console.log(`[scan] Quick scan done: foundInvoices=${scanResult.foundInvoices}`);
    return scanResult;
  });
}

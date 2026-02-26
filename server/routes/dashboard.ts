import { FastifyInstance } from "fastify";
import { z } from "zod";
import { store } from "../store";
import { syncGmailInbox } from "../services/gmail-sync";
import { sendDocumentsToAccountant } from "../services/email";
import { env } from "../config";

const businessParamsSchema = z.object({
  businessId: z.string().min(1),
});

const documentQuerySchema = z.object({
  status: z.enum(["all", "sent", "pending", "review"]).default("all"),
});

const chatMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  userId: z.string().optional(),
});

const documentParamsSchema = z.object({
  businessId: z.string().min(1),
  documentId: z.string().min(1),
});

const exportQuerySchema = z.object({
  format: z.enum(["csv"]).default("csv"),
  status: z.enum(["all", "sent", "pending", "review"]).default("all"),
});

const updateDocumentSchema = z.object({
  category: z.string().optional(),
  comments: z.string().nullable().optional(),
  amountCents: z.number().int().optional(),
  vendorName: z.string().optional(),
  status: z.enum(["sent", "pending", "review"]).optional(),
});

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard/:businessId/summary", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    return store.getDashboardSummary(businessId);
  });

  app.get("/dashboard/:businessId/documents", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const query = documentQuerySchema.parse(request.query);
    return store.getDashboardDocuments(businessId, query.status);
  });

  app.get("/dashboard/:businessId/documents/:documentId", async (request) => {
    const { businessId, documentId } = documentParamsSchema.parse(request.params);
    return store.getDashboardDocumentDetail(businessId, documentId);
  });

  app.patch("/dashboard/:businessId/documents/:documentId", async (request) => {
    const { businessId, documentId } = documentParamsSchema.parse(request.params);
    const updates = updateDocumentSchema.parse(request.body);
    return store.updateDocument(businessId, documentId, updates);
  });

  app.get("/dashboard/:businessId/monthly-pdf", async (request, reply) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const { month } = monthQuerySchema.parse(request.query);

    const now = new Date();
    const monthKey = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const summary = await store.getDashboardSummary(businessId);

    const { documents } = await store.getDashboardDocuments(businessId, "all");
    const monthStart = new Date(`${monthKey}-01T00:00:00Z`);
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthDocs = documents.filter((d: any) => {
      const date = new Date(d.issuedAt);
      return date >= monthStart && date < nextMonth;
    });

    const { generateMonthlyReport } = await import("../services/pdf");
    const pdfBuffer = await generateMonthlyReport(
      businessId,
      monthKey,
      summary.business.name,
      summary.business.accountantName,
      monthDocs,
    );

    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="sendtoamram-${monthKey}.pdf"`);
    return reply.send(pdfBuffer);
  });

  app.get("/dashboard/:businessId/export", async (request, reply) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const query = exportQuerySchema.parse(request.query);
    const csv = store.exportDashboardCsv(businessId, query.status);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="sendtoamram-${businessId}.csv"`);
    return csv;
  });

  app.get("/dashboard/:businessId/chat", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    return store.getDashboardChat(businessId);
  });

  app.post("/dashboard/:businessId/chat", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const payload = chatMessageSchema.parse(request.body);
    return store.postDashboardChat({ businessId, text: payload.text, userId: payload.userId });
  });

  app.post("/dashboard/:businessId/send-to-accountant", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);

    if (!env.RESEND_API_KEY) {
      throw new Error("Email delivery is not configured (missing RESEND_API_KEY)");
    }

    const accountant = await store.getAccountantForBusiness(businessId);
    if (!accountant.email) {
      throw new Error("לא הוגדר מייל לרואה חשבון. עדכנו בהגדרות.");
    }

    const { documents } = await store.getDashboardDocuments(businessId, "pending");
    if (documents.length === 0) {
      return { sent: false, message: "אין מסמכים ממתינים לשליחה." };
    }

    const summary = await store.getDashboardSummary(businessId);

    const result = await sendDocumentsToAccountant({
      accountantEmail: accountant.email,
      accountantName: accountant.name,
      businessName: summary.business.name,
      documents: documents.map((d: any) => ({
        vendor: d.vendor,
        amountCents: d.amountCents,
        currency: d.currency,
        issuedAt: d.issuedAt,
        category: d.category,
        type: d.type ?? "invoice",
      })),
    });

    const sentIds = documents.map((d: any) => d.id);
    await store.markDocumentsSent(businessId, sentIds);

    return {
      sent: true,
      emailId: result.id,
      documentCount: documents.length,
      accountantEmail: accountant.email,
    };
  });

  app.get("/dashboard/:businessId/categories", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const mappings = await store.getVendorCategoryMappings(businessId);

    const builtIn = ['תוכנה', 'חשבונות', 'משרד', 'ציוד', 'נסיעות', 'שיווק', 'מקצועי', 'כללי'];
    const customFromMappings = [...new Set(
      mappings.map((m: any) => m.category).filter((c: string) => !builtIn.includes(c))
    )];

    return {
      categories: [...builtIn, ...customFromMappings],
      vendorMappings: mappings.slice(0, 50),
    };
  });

  app.get("/dashboard/:businessId/alerts", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const alerts = await store.getMissingReceiptAlerts(businessId, "pending");
    return { businessId, alerts };
  });

  app.patch("/dashboard/:businessId/alerts/:alertId/dismiss", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const { alertId } = z.object({ alertId: z.string().min(1) }).parse(request.params);
    await store.updateAlertStatus(alertId, "dismissed");
    return { ok: true };
  });

  app.post("/dashboard/:businessId/sync", async (request) => {
    const { businessId } = businessParamsSchema.parse(request.params);
    const gmailInboxes = await store.getGmailInboxes(businessId);
    let totalNew = 0;

    for (const inbox of gmailInboxes) {
      try {
        const result = await syncGmailInbox(inbox.id);
        totalNew += result.newDocuments;
      } catch (error) {
        console.error(`[sync] Gmail sync failed for inbox ${inbox.id}:`, error);
      }
    }

    const summary = await store.getDashboardSummary(businessId);
    return { newDocuments: totalNew, summary };
  });
}

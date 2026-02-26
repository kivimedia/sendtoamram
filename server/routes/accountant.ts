import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { store } from "../store";
import {
  sendMagicLinkEmail,
  verifyMagicLinkToken,
  createAccountantToken,
  verifyAccountantToken,
} from "../services/accountant-auth";

const magicLinkSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  token: z.string().min(1),
});

const businessIdSchema = z.object({
  businessId: z.string().min(1),
});

// ─── Auth middleware ───

async function getAccountantEmail(request: FastifyRequest): Promise<string> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  const result = verifyAccountantToken(auth.slice(7));
  if (!result) {
    throw Object.assign(new Error("Invalid or expired token"), { statusCode: 401 });
  }
  return result.email;
}

async function assertAccountantAccessToBusiness(email: string, businessId: string): Promise<void> {
  const clients = await store.getBusinessesForAccountant(email);
  const hasAccess = clients.some((c: any) => c.id === businessId);
  if (!hasAccess) {
    throw Object.assign(new Error("Access denied to this business"), { statusCode: 403 });
  }
}

// ─── Routes ───

export async function registerAccountantRoutes(app: FastifyInstance): Promise<void> {
  // Send magic link
  app.post("/accountant/auth/send-magic-link", async (request) => {
    const { email } = magicLinkSchema.parse(request.body);
    await sendMagicLinkEmail(email);
    return { ok: true, message: "אם הכתובת קיימת במערכת, נשלח אליך קישור כניסה." };
  });

  // Verify magic link token → return session JWT
  app.post("/accountant/auth/verify", async (request) => {
    const { token } = verifySchema.parse(request.body);
    const result = verifyMagicLinkToken(token);
    if (!result) {
      throw Object.assign(new Error("קישור לא תקין או שפג תוקפו"), { statusCode: 401 });
    }

    const exists = await store.accountantEmailExists(result.email);
    if (!exists) {
      throw Object.assign(new Error("הכתובת לא נמצאה במערכת"), { statusCode: 404 });
    }

    const sessionToken = createAccountantToken(result.email);
    return {
      ok: true,
      token: sessionToken,
      email: result.email,
    };
  });

  // Get all client businesses for this accountant
  app.get("/accountant/clients", async (request) => {
    const email = await getAccountantEmail(request);
    const clients = await store.getClientHealthForAccountant(email);

    return {
      email,
      clients: clients.map((c: any) => ({
        businessId: c.businessId,
        businessName: c.businessName,
        pendingCount: c.pendingCount,
        reviewCount: c.reviewCount,
        sentCount: c.sentCount,
        totalCount: c.totalCount,
        lastDocumentAt: c.lastDocumentAt,
        health: getHealthStatus(c.pendingCount + c.reviewCount),
      })),
    };
  });

  // Get single client summary
  app.get("/accountant/clients/:businessId/summary", async (request) => {
    const email = await getAccountantEmail(request);
    const { businessId } = businessIdSchema.parse(request.params);
    await assertAccountantAccessToBusiness(email, businessId);
    return store.getDashboardSummary(businessId);
  });

  // Get single client documents
  app.get("/accountant/clients/:businessId/documents", async (request) => {
    const email = await getAccountantEmail(request);
    const { businessId } = businessIdSchema.parse(request.params);
    await assertAccountantAccessToBusiness(email, businessId);
    const statusSchema = z.object({ status: z.enum(["all", "sent", "pending", "review"]).default("all") });
    const { status } = statusSchema.parse(request.query);
    return store.getDashboardDocuments(businessId, status);
  });

  // Download monthly PDF for a client
  app.get("/accountant/clients/:businessId/monthly-pdf", async (request, reply) => {
    const email = await getAccountantEmail(request);
    const { businessId } = businessIdSchema.parse(request.params);
    await assertAccountantAccessToBusiness(email, businessId);

    const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
    const { month } = monthSchema.parse(request.query);

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

  // Export client documents as CSV
  app.get("/accountant/clients/:businessId/export", async (request, reply) => {
    const email = await getAccountantEmail(request);
    const { businessId } = businessIdSchema.parse(request.params);
    await assertAccountantAccessToBusiness(email, businessId);

    const querySchema = z.object({
      format: z.enum(["csv"]).default("csv"),
      status: z.enum(["all", "sent", "pending", "review"]).default("all"),
    });
    const query = querySchema.parse(request.query);
    const csv = store.exportDashboardCsv(businessId, query.status);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="sendtoamram-${businessId}.csv"`);
    return csv;
  });

  // Bulk export — download CSVs for multiple clients
  app.post("/accountant/bulk-export", async (request) => {
    const email = await getAccountantEmail(request);
    const bulkSchema = z.object({
      businessIds: z.array(z.string().min(1)).min(1),
      status: z.enum(["all", "sent", "pending", "review"]).default("all"),
    });
    const { businessIds, status } = bulkSchema.parse(request.body);

    const results: Array<{ businessId: string; businessName: string; csv: string }> = [];
    const clients = await store.getBusinessesForAccountant(email);
    const allowedIds = new Set(clients.map((c: any) => c.id));

    for (const businessId of businessIds) {
      if (!allowedIds.has(businessId)) continue;
      const csv = await store.exportDashboardCsv(businessId, status);
      const summary = await store.getDashboardSummary(businessId);
      results.push({ businessId, businessName: summary.business.name, csv });
    }

    return { exports: results };
  });

  // Invite a new client — send invitation email
  app.post("/accountant/invite-client", async (request) => {
    const email = await getAccountantEmail(request);
    const inviteSchema = z.object({
      clientEmail: z.string().email(),
      clientName: z.string().optional(),
    });
    const { clientEmail, clientName } = inviteSchema.parse(request.body);

    const { env } = await import("../config");
    if (!env.RESEND_API_KEY) {
      throw new Error("Email delivery is not configured");
    }

    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);

    const signupUrl = `${env.FRONTEND_BASE_URL}/onboarding`;
    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: clientEmail,
      subject: "הוזמנת ל-SendToAmram – ניהול חשבוניות אוטומטי",
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">SendToAmram</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="font-size:16px;color:#333;">שלום${clientName ? ` ${clientName}` : ""},</p>
      <p style="font-size:15px;color:#555;">
        רואה החשבון שלך הזמין אותך להשתמש ב-SendToAmram לניהול חשבוניות אוטומטי.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${signupUrl}" style="display:inline-block;padding:12px 32px;background:#ee5a24;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          הרשמה חינם
        </a>
      </div>
      <p style="font-size:13px;color:#999;">
        הודעה זו נשלחה מ-<a href="https://sendtoamram.co.il" style="color:#ee5a24;">SendToAmram</a>.
      </p>
    </div>
  </div>
</body>
</html>`,
    });

    if (result.error) {
      throw new Error(`Failed to send invitation: ${result.error.message}`);
    }

    return { ok: true, emailId: result.data!.id, sentTo: clientEmail };
  });
}

function getHealthStatus(openCount: number): "green" | "yellow" | "red" {
  if (openCount === 0) return "green";
  if (openCount <= 5) return "yellow";
  return "red";
}

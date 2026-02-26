import { pool } from "../db";
import { generateMonthlyReport } from "./pdf";
import { env } from "../config";

interface DeliveryCandidate {
  businessId: string;
  businessName: string;
  accountantName: string;
  accountantEmail: string;
}

function lastMonthKey(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

export async function checkAndRunMonthlyDeliveries(): Promise<{ delivered: number }> {
  const today = new Date().getDate();

  // Find businesses where monthly_delivery_day matches today and auto delivery is on
  const candidates = await pool.query<DeliveryCandidate>(
    `SELECT b.id AS "businessId", b.name AS "businessName",
            ac.name AS "accountantName", ac.email AS "accountantEmail"
     FROM businesses b
     JOIN accountant_contacts ac ON ac.business_id = b.id
     WHERE ac.monthly_delivery_day = $1
       AND ac.auto_monthly_delivery = true
       AND ac.email IS NOT NULL
       AND ac.email != ''`,
    [today],
  );

  const monthKey = lastMonthKey();
  let delivered = 0;

  for (const biz of candidates.rows) {
    try {
      // Check if already delivered this month
      const existing = await pool.query(
        `SELECT id FROM monthly_summaries
         WHERE business_id = $1 AND month_key = $2 AND delivered_at IS NOT NULL`,
        [biz.businessId, monthKey],
      );
      if (existing.rows.length > 0) {
        console.log(`[monthly-delivery] Already delivered ${monthKey} for ${biz.businessName}`);
        continue;
      }

      // Fetch last month's documents
      const monthStart = new Date(`${monthKey}-01T00:00:00Z`);
      const nextMonth = new Date(monthStart);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const docsResult = await pool.query(
        `SELECT vendor_name AS "vendor", amount_cents AS "amountCents",
                currency, issued_at AS "issuedAt", category, status, type
         FROM documents
         WHERE business_id = $1 AND issued_at >= $2 AND issued_at < $3
         ORDER BY issued_at ASC`,
        [biz.businessId, monthStart.toISOString(), nextMonth.toISOString()],
      );

      if (docsResult.rows.length === 0) {
        console.log(`[monthly-delivery] No documents for ${monthKey} for ${biz.businessName}`);
        continue;
      }

      // Generate PDF
      const pdfBuffer = await generateMonthlyReport(
        biz.businessId,
        monthKey,
        biz.businessName,
        biz.accountantName,
        docsResult.rows,
      );

      // Send email with PDF attachment via Resend
      if (!env.RESEND_API_KEY) {
        console.warn("[monthly-delivery] No RESEND_API_KEY, skipping email");
        continue;
      }

      const { Resend } = await import("resend");
      const resend = new Resend(env.RESEND_API_KEY);

      const totalAmount = docsResult.rows.reduce((s: number, d: any) => s + (d.amountCents || 0), 0);
      const amountStr = `₪${(totalAmount / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;

      const result = await resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to: biz.accountantEmail,
        subject: `${biz.businessName} – דוח חודשי ${monthKey} | SendToAmram`,
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;text-align:right;">
            <p>שלום ${biz.accountantName},</p>
            <p>מצורף דוח חודשי של ${biz.businessName} לחודש ${monthKey}.</p>
            <p><strong>${docsResult.rows.length}</strong> מסמכים בסך כולל של <strong>${amountStr}</strong>.</p>
            <p style="color:#999;font-size:12px;">נשלח אוטומטית מ-SendToAmram</p>
          </div>`,
        attachments: [
          {
            filename: `sendtoamram-${monthKey}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      if (result.error) {
        throw new Error(`Resend: ${result.error.message}`);
      }

      // Record delivery
      await pool.query(
        `INSERT INTO monthly_summaries (id, business_id, month_key, total_documents, total_amount_cents, delivered_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
         ON CONFLICT (business_id, month_key) DO UPDATE SET delivered_at = now()`,
        [biz.businessId, monthKey, docsResult.rows.length, totalAmount],
      );

      await pool.query(
        `UPDATE accountant_contacts SET last_delivered_at = now() WHERE business_id = $1`,
        [biz.businessId],
      );

      delivered++;
      console.log(`[monthly-delivery] Delivered ${monthKey} to ${biz.accountantEmail} for ${biz.businessName}`);
    } catch (error) {
      console.error(`[monthly-delivery] Failed for ${biz.businessName}:`, error);
    }
  }

  return { delivered };
}

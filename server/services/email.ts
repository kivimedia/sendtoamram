import { Resend } from "resend";
import { env } from "../config";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    resend = new Resend(env.RESEND_API_KEY);
  }
  return resend;
}

interface DocumentRow {
  vendor: string;
  amountCents: number;
  currency: string;
  issuedAt: string;
  category: string;
  type: string;
}

function formatAmount(cents: number, currency: string): string {
  if (cents === 0) return "ממתין לחילוץ";
  const symbol = currency === "ILS" ? "₪" : currency;
  return `${symbol}${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

function formatDate(dateIso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateIso));
}

function buildDocumentTable(documents: DocumentRow[]): string {
  const rows = documents
    .map(
      (doc) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${doc.vendor}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${formatAmount(doc.amountCents, doc.currency)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${formatDate(doc.issuedAt)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${doc.category}</td>
        </tr>`,
    )
    .join("\n");

  return `
    <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;direction:rtl;text-align:right;">
      <thead>
        <tr style="background:#f8f8f8;">
          <th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right;">ספק</th>
          <th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right;">סכום</th>
          <th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right;">תאריך</th>
          <th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:right;">קטגוריה</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
}

export async function sendDocumentsToAccountant(payload: {
  accountantEmail: string;
  accountantName: string;
  businessName: string;
  documents: DocumentRow[];
  senderName?: string;
}): Promise<{ id: string }> {
  const { accountantEmail, accountantName, businessName, documents, senderName } = payload;

  const totalAmount = documents.reduce((sum, doc) => sum + doc.amountCents, 0);
  const subject = `${businessName} – ${documents.length} מסמכים חדשים | SendToAmram`;

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">📬 SendToAmram</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="font-size:16px;color:#333;">שלום ${accountantName},</p>
      <p style="font-size:15px;color:#555;">
        ${senderName ? `${senderName} מ` : ""}${businessName} שלח/ה לך <strong>${documents.length}</strong> מסמכים
        בסך כולל של <strong>${formatAmount(totalAmount, "ILS")}</strong>.
      </p>

      <div style="margin:24px 0;">
        ${buildDocumentTable(documents)}
      </div>

      <p style="font-size:13px;color:#999;margin-top:24px;">
        המייל הזה נשלח אוטומטית מ-<a href="https://sendtoamram.co.il" style="color:#ee5a24;">SendToAmram</a>.
      </p>
    </div>
  </div>
</body>
</html>`;

  const result = await getResend().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: accountantEmail,
    subject,
    html,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  return { id: result.data!.id };
}

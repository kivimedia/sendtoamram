import { store } from "../store";
import { env } from "../config";

/**
 * Detect vendor patterns — looks at last 12 months of documents
 * and identifies vendors that appear monthly (3+ occurrences with ~1 month gaps).
 */
export async function detectVendorPatterns(businessId: string): Promise<number> {
  const vendors = await store.getVendorDocumentFrequency(businessId);
  let patternsFound = 0;

  for (const vendor of vendors) {
    const months: string[] = vendor.months ?? [];
    if (months.length < 3) continue;

    // Check if the vendor has a roughly monthly cadence
    // Sort months and check average gap
    const sorted = months.sort();
    let totalGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const [y1, m1] = sorted[i - 1].split("-").map(Number);
      const [y2, m2] = sorted[i].split("-").map(Number);
      totalGap += (y2 - y1) * 12 + (m2 - m1);
    }
    const avgGap = totalGap / (sorted.length - 1);

    // Monthly: avg gap ~1-1.5 months, Quarterly: ~2.5-3.5, Yearly: ~10-14
    let frequency = "monthly";
    if (avgGap > 2 && avgGap <= 4) frequency = "quarterly";
    else if (avgGap > 4) frequency = "yearly";
    else if (avgGap > 1.5) continue; // irregular, skip

    await store.upsertVendorPattern({
      businessId,
      vendorName: vendor.vendorName,
      frequency,
      avgAmountCents: vendor.avgAmountCents ?? 0,
      lastSeenAt: vendor.lastSeenAt,
      occurrenceCount: vendor.occurrenceCount,
    });
    patternsFound++;
  }

  console.log(`[missing-receipts] Detected ${patternsFound} vendor patterns for business ${businessId}`);
  return patternsFound;
}

/**
 * Check for missing receipts — for each tracked monthly vendor pattern,
 * see if the expected month has a document. If not, create an alert.
 */
export async function checkMissingReceipts(businessId: string): Promise<number> {
  const patterns = await store.getTrackedVendorPatterns(businessId);
  let alertsCreated = 0;

  const now = new Date();
  // Check last month — if we're on the 1st, the previous month just ended
  const checkDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const expectedMonth = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}`;

  for (const pattern of patterns) {
    if (pattern.frequency !== "monthly") continue;

    // Check if there's already an alert for this vendor+month
    const hasAlert = await store.hasAlertForVendorMonth(pattern.id, expectedMonth);
    if (hasAlert) continue;

    // Check if there's a document for this vendor in the expected month
    const hasDoc = await store.hasDocumentForVendorInMonth(
      businessId,
      pattern.vendorName,
      expectedMonth,
    );

    if (!hasDoc) {
      await store.createMissingReceiptAlert({
        businessId,
        vendorPatternId: pattern.id,
        expectedMonth,
      });
      alertsCreated++;
      console.log(`[missing-receipts] Alert: ${pattern.vendorName} missing for ${expectedMonth}`);
    }
  }

  return alertsCreated;
}

/**
 * Send alerts for newly created missing receipt alerts via email (and WhatsApp if configured).
 */
export async function sendMissingReceiptAlerts(
  businessId: string,
  alerts: Array<{ id: string; vendorName: string; expectedMonth: string; avgAmountCents: number }>,
): Promise<number> {
  if (alerts.length === 0) return 0;

  let notified = 0;
  const summary = await store.getDashboardSummary(businessId);

  // Send email notification if Resend is configured
  if (env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(env.RESEND_API_KEY);

      const alertRows = alerts.map((a) => {
        const amount = a.avgAmountCents > 0
          ? `~₪${(a.avgAmountCents / 100).toLocaleString("he-IL")}`
          : "";
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${a.vendorName}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${a.expectedMonth}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${amount}</td></tr>`;
      }).join("\n");

      const accountant = await store.getAccountantForBusiness(businessId);
      const toEmail = accountant?.email;
      if (toEmail) {
        await resend.emails.send({
          from: env.RESEND_FROM_EMAIL,
          to: toEmail,
          subject: `${summary.business.name} – ${alerts.length} חשבוניות חסרות | SendToAmram`,
          html: `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#ff6b6b,#ee5a24);padding:20px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">⚠️ חשבוניות חסרות – ${summary.business.name}</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="font-size:15px;color:#555;">זוהו ${alerts.length} חשבוניות חסרות שהיו צפויות להגיע:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr style="background:#f8f8f8;"><th style="padding:8px 12px;text-align:right;">ספק</th><th style="padding:8px 12px;text-align:right;">חודש</th><th style="padding:8px 12px;text-align:right;">סכום משוער</th></tr></thead>
        <tbody>${alertRows}</tbody>
      </table>
      <p style="font-size:13px;color:#999;">נשלח אוטומטית מ-<a href="https://sendtoamram.co.il" style="color:#ee5a24;">SendToAmram</a></p>
    </div>
  </div>
</body>
</html>`,
        });
        notified++;
      }
    } catch (error) {
      console.error(`[missing-receipts] Failed to send email alerts:`, error);
    }
  }

  // Send WhatsApp notification if bridge is configured
  if (env.WHATSAPP_BRIDGE_URL) {
    try {
      const { bridgeSendText, bridgeGetStatus } = await import("./whatsapp-bridge-client");
      const session = await bridgeGetStatus(businessId);
      if (session.status === "connected" && session.connectedJid) {
        const lines = alerts.map((a) => {
          const amount = a.avgAmountCents > 0
            ? ` (~₪${(a.avgAmountCents / 100).toLocaleString("he-IL")})`
            : "";
          return `• ${a.vendorName} – ${a.expectedMonth}${amount}`;
        });
        const message = `⚠️ חשבוניות חסרות עבור ${summary.business.name}:\n\n${lines.join("\n")}\n\nבדוק/י בדשבורד.`;
        await bridgeSendText(businessId, session.connectedJid, message);
        notified++;
      }
    } catch (error) {
      console.error(`[missing-receipts] Failed to send WhatsApp alerts:`, error);
    }
  }

  // Mark alerts as notified
  for (const alert of alerts) {
    await store.updateAlertStatus(alert.id, "notified");
  }

  return notified;
}

/**
 * Process all active businesses — called by cron job.
 * 1. Detect/update vendor patterns
 * 2. Check for missing receipts
 * 3. Send notifications for new alerts
 */
export async function processAllBusinesses(): Promise<{ businessesProcessed: number; alertsCreated: number }> {
  const businessIds = await store.getAllActiveBusinessIds();
  let totalAlerts = 0;

  for (const businessId of businessIds) {
    try {
      await detectVendorPatterns(businessId);
      const alertCount = await checkMissingReceipts(businessId);
      totalAlerts += alertCount;

      // Send notifications for newly created (pending) alerts
      if (alertCount > 0) {
        const pendingAlerts = await store.getMissingReceiptAlerts(businessId, "pending");
        await sendMissingReceiptAlerts(businessId, pendingAlerts);
      }
    } catch (error) {
      console.error(`[missing-receipts] Failed for business ${businessId}:`, error);
    }
  }

  console.log(`[missing-receipts] Processed ${businessIds.length} businesses, created ${totalAlerts} alerts`);
  return { businessesProcessed: businessIds.length, alertsCreated: totalAlerts };
}

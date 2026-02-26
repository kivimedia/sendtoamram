import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

interface DocumentRow {
  vendor?: string;
  vendorName?: string;
  amountCents: number;
  currency?: string;
  issuedAt: string;
  category?: string;
  status?: string;
  type?: string;
}

function formatAmount(cents: number): string {
  if (cents === 0) return "—";
  return `${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

function formatDate(dateIso: string): string {
  try {
    const d = new Date(dateIso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch {
    return dateIso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  sent: "נשלח",
  pending: "ממתין",
  review: "לבדיקה",
  SENT: "נשלח",
  PENDING: "ממתין",
  REVIEW: "לבדיקה",
};

function getFontPath(): string | null {
  // Try multiple paths for different environments (dev vs bundled)
  const candidates = [
    // Dev: server/services/pdf.ts → server/assets/
    path.join(__dirname, "..", "assets", "NotoSansHebrew-Regular.ttf"),
    // Bundled ESM: alongside the bundle
    path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "NotoSansHebrew-Regular.ttf"),
    // Process cwd fallback
    path.join(process.cwd(), "server", "assets", "NotoSansHebrew-Regular.ttf"),
    path.join(process.cwd(), "assets", "NotoSansHebrew-Regular.ttf"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return null;
}

// Reverse Hebrew text for PDF rendering (PDFKit doesn't handle RTL natively)
function reverseHebrew(text: string): string {
  // Simple approach: reverse the entire string for display in RTL context
  return text.split("").reverse().join("");
}

export async function generateMonthlyReport(
  businessId: string,
  monthKey: string,
  businessName: string,
  accountantName: string,
  documents: DocumentRow[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        layout: "portrait",
        info: {
          Title: `SendToAmram Report - ${monthKey}`,
          Author: "SendToAmram",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Try to register Hebrew font, fall back to Helvetica
      let fontName = "Helvetica";
      const fontPath = getFontPath();
      if (fontPath) {
        try {
          doc.registerFont("Hebrew", fontPath);
          fontName = "Hebrew";
        } catch {
          // Font not available, use default
        }
      }

      const pageWidth = doc.page.width - 80; // margins

      // Header with gradient-style background
      doc.rect(0, 0, doc.page.width, 100).fill("#ee5a24");
      doc.fontSize(24).font(fontName).fillColor("#ffffff");
      doc.text("SendToAmram", 40, 30, { align: "center" });
      doc.fontSize(12).fillColor("#ffffff");
      doc.text(`${monthKey} | ${businessName}`, 40, 62, { align: "center" });

      // Reset position
      doc.fillColor("#333333");
      doc.y = 120;

      // Summary section
      const totalAmount = documents.reduce((sum, d) => sum + d.amountCents, 0);
      const pendingCount = documents.filter((d) => (d.status ?? "").toLowerCase() === "pending").length;
      const sentCount = documents.filter((d) => (d.status ?? "").toLowerCase() === "sent").length;

      doc.fontSize(14).font(fontName).fillColor("#333333");
      doc.text(`Summary`, 40, doc.y, { align: "left" });
      doc.moveDown(0.5);

      doc.fontSize(10).fillColor("#555555");
      doc.text(`Business: ${businessName}`, 40);
      doc.text(`Accountant: ${accountantName}`);
      doc.text(`Month: ${monthKey}`);
      doc.text(`Total Documents: ${documents.length}`);
      doc.text(`Total Amount: ILS ${formatAmount(totalAmount)}`);
      doc.text(`Sent: ${sentCount} | Pending: ${pendingCount}`);
      doc.moveDown(1);

      // Table header
      const tableTop = doc.y;
      const colWidths = [40, 150, 80, 80, 90, 70];
      const colStarts = [40];
      for (let i = 1; i < colWidths.length; i++) {
        colStarts.push(colStarts[i - 1] + colWidths[i - 1]);
      }
      const headers = ["#", "Vendor", "Amount (ILS)", "Date", "Category", "Status"];

      // Header row background
      doc.rect(40, tableTop - 4, pageWidth, 20).fill("#f0f0f0");
      doc.fillColor("#333333").fontSize(9).font(fontName);

      headers.forEach((header, i) => {
        doc.text(header, colStarts[i] + 4, tableTop, {
          width: colWidths[i] - 8,
          align: "left",
        });
      });

      doc.y = tableTop + 20;

      // Table rows
      documents.forEach((row, index) => {
        // Check for page break
        if (doc.y > doc.page.height - 80) {
          doc.addPage();
          doc.y = 40;
        }

        const rowY = doc.y;
        const vendor = row.vendor ?? row.vendorName ?? "Unknown";
        const category = row.category ?? "-";
        const status = STATUS_LABELS[(row.status ?? "").toLowerCase()] ?? row.status ?? "-";

        // Alternate row background
        if (index % 2 === 0) {
          doc.rect(40, rowY - 2, pageWidth, 18).fill("#fafafa");
        }

        doc.fillColor("#333333").fontSize(8).font(fontName);
        doc.text(String(index + 1), colStarts[0] + 4, rowY, { width: colWidths[0] - 8 });
        doc.text(vendor.substring(0, 30), colStarts[1] + 4, rowY, { width: colWidths[1] - 8 });
        doc.text(formatAmount(row.amountCents), colStarts[2] + 4, rowY, { width: colWidths[2] - 8 });
        doc.text(formatDate(row.issuedAt), colStarts[3] + 4, rowY, { width: colWidths[3] - 8 });
        doc.text(category.substring(0, 15), colStarts[4] + 4, rowY, { width: colWidths[4] - 8 });
        doc.text(status, colStarts[5] + 4, rowY, { width: colWidths[5] - 8 });

        doc.y = rowY + 18;
      });

      // Footer
      doc.y = doc.page.height - 50;
      doc.fontSize(8).fillColor("#999999").font(fontName);
      doc.text(
        `Generated by SendToAmram on ${new Date().toISOString().slice(0, 10)}`,
        40,
        doc.y,
        { align: "center" },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

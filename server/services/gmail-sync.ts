import { env } from "../config";
import { store } from "../store";
import { getValidAccessToken } from "./oauth";
import { isAiEnabled, extractInvoiceFromText, extractInvoiceFromImage, extractInvoiceFromPdf, type VendorCategoryMapping } from "./ai";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string; size: number };
    parts?: Array<{
      mimeType: string;
      filename?: string;
      body?: { data?: string; attachmentId?: string; size: number };
      parts?: Array<any>;
    }>;
  };
  internalDate: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }>;
  }>;
  historyId: string;
  nextPageToken?: string;
}

// ─── Gmail API helpers ───

export async function gmailFetch(accessToken: string, path: string): Promise<any> {
  const response = await fetch(`${GMAIL_API}/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API ${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function fetchRecentMessageIds(accessToken: string, maxResults: number): Promise<string[]> {
  const query = encodeURIComponent(
    "has:attachment OR subject:(חשבונית OR invoice OR receipt OR קבלה OR payment OR תשלום OR billing OR הזמנה)",
  );
  const data: GmailListResponse = await gmailFetch(
    accessToken,
    `/messages?maxResults=${maxResults}&q=${query}`,
  );
  return (data.messages ?? []).map((m) => m.id);
}

async function fetchNewMessageIdsSinceHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: "messageAdded",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const data: GmailHistoryResponse = await gmailFetch(
        accessToken,
        `/history?${params.toString()}`,
      );
      for (const entry of data.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          ids.push(added.message.id);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (error: any) {
    // If history ID is invalid/expired, fall back to full fetch
    if (error.message?.includes("404") || error.message?.includes("historyId")) {
      console.warn("Gmail historyId expired, falling back to full fetch");
      return fetchRecentMessageIds(accessToken, 50);
    }
    throw error;
  }

  return ids;
}

export async function fetchGmailMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  return gmailFetch(accessToken, `/messages/${messageId}?format=full`);
}

export async function fetchGmailAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<string> {
  const data = await gmailFetch(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  // Gmail returns base64url encoding — convert to standard base64
  return (data.data as string).replace(/-/g, "+").replace(/_/g, "/");
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

export async function getLatestHistoryId(accessToken: string): Promise<string> {
  const profile = await gmailFetch(accessToken, "/profile");
  return profile.historyId;
}

// ─── Email → Document extraction ───

function extractPlainText(message: GmailMessage): string | null {
  if (message.payload.body?.data) {
    return Buffer.from(message.payload.body.data, "base64url").toString("utf-8");
  }
  const textPart = message.payload.parts?.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
  }
  // Check nested parts (multipart/alternative inside multipart/mixed)
  for (const part of message.payload.parts ?? []) {
    if (part.parts) {
      const nested = part.parts.find((p: any) => p.mimeType === "text/plain");
      if (nested?.body?.data) {
        return Buffer.from(nested.body.data, "base64url").toString("utf-8");
      }
    }
  }
  return null;
}

export function extractDocumentFromEmail(
  message: GmailMessage,
  inbox: { id: string; businessId: string },
): {
  businessId: string;
  inboxConnectionId: string;
  source: string;
  type: string;
  status: string;
  vendorName: string;
  amountCents: number;
  currency: string;
  vatCents: number | null;
  issuedAt: string;
  confidence: number;
  category: string | null;
  rawText: string | null;
  gmailMessageId: string;
  attachments: AttachmentInfo[];
  attachmentFilenames: string[];
} | null {
  const headers = Object.fromEntries(
    message.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
  );
  const subject = headers["subject"] ?? "";
  const from = headers["from"] ?? "";
  const date = new Date(parseInt(message.internalDate));

  // Extract sender name
  const vendorMatch = from.match(/^"?([^"<]+)"?\s*</);
  const vendorName = vendorMatch?.[1]?.trim() ?? from.split("@")[0]?.replace(/[._-]/g, " ") ?? "Unknown";

  const lowerSubject = subject.toLowerCase();
  const hasInvoiceSignal = /invoice|חשבונית|receipt|קבלה|payment|תשלום|billing|הזמנה|order|confirmation/.test(lowerSubject);

  const hasAttachment = message.payload.parts?.some(
    (p) =>
      p.filename &&
      p.filename.length > 0 &&
      (p.filename.endsWith(".pdf") || p.filename.endsWith(".png") ||
       p.filename.endsWith(".jpg") || p.filename.endsWith(".jpeg") ||
       p.filename.endsWith(".xlsx") || p.filename.endsWith(".csv")),
  );

  // Accept emails that have invoice signals OR attachments
  if (!hasInvoiceSignal && !hasAttachment) {
    return null;
  }

  const bodyText = extractPlainText(message);

  // Determine type
  let type = "INVOICE";
  if (/receipt|קבלה/.test(lowerSubject)) type = "RECEIPT";
  else if (/subscription|מנוי/.test(lowerSubject)) type = "SUBSCRIPTION";
  else if (/confirmation|אישור/.test(lowerSubject)) type = "PAYMENT_CONFIRMATION";

  // Try to extract amount from subject or snippet (basic regex)
  let amountCents = 0;
  const amountMatch = (subject + " " + (message.snippet ?? "")).match(
    /(?:₪|ILS|NIS)\s*([\d,]+\.?\d*)|(\d[\d,]*\.?\d*)\s*(?:₪|ILS|NIS)/,
  );
  if (amountMatch) {
    const raw = (amountMatch[1] ?? amountMatch[2]).replace(/,/g, "");
    amountCents = Math.round(parseFloat(raw) * 100);
  }

  // Collect downloadable attachments
  const attachments: AttachmentInfo[] = [];
  const attachmentFilenames: string[] = [];
  for (const part of message.payload.parts ?? []) {
    if (part.body?.attachmentId && part.filename && part.filename.length > 0) {
      const lower = part.filename.toLowerCase();
      if (lower.endsWith(".pdf") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
        });
        attachmentFilenames.push(part.filename);
      }
    }
  }

  return {
    businessId: inbox.businessId,
    inboxConnectionId: inbox.id,
    source: "EMAIL",
    type,
    status: "PENDING",
    vendorName,
    amountCents,
    currency: "ILS",
    vatCents: amountCents > 0 ? Math.floor(amountCents * 0.17) : null,
    issuedAt: date.toISOString(),
    confidence: hasInvoiceSignal && hasAttachment ? 0.85 : hasInvoiceSignal ? 0.65 : 0.45,
    category: null,
    rawText: bodyText?.substring(0, 2000) ?? null,
    gmailMessageId: message.id,
    attachments,
    attachmentFilenames,
  };
}

// ─── Main sync function ───

export async function syncGmailInbox(inboxConnectionId: string): Promise<{ newDocuments: number }> {
  const inbox = await store.getInboxConnection(inboxConnectionId);
  if (!inbox || !inbox.oauthConnectionId) {
    throw new Error("No OAuth connection for this inbox");
  }

  // Skip incremental sync if a deep scan is active for this inbox
  const hasActiveScan = await store.hasActiveScanForInbox(inboxConnectionId);
  if (hasActiveScan) {
    console.log(`[gmail-sync] Skipping incremental sync for inbox ${inboxConnectionId} — deep scan active`);
    return { newDocuments: 0 };
  }

  const oauth = await store.getOAuthConnection(inbox.oauthConnectionId);
  if (!oauth) {
    throw new Error("OAuth connection not found");
  }

  const accessToken = await getValidAccessToken(oauth, store, env);

  // Determine sync strategy
  const historyId = inbox.gmailHistoryId;
  let messageIds: string[];

  if (historyId) {
    messageIds = await fetchNewMessageIdsSinceHistory(accessToken, historyId);
  } else {
    messageIds = await fetchRecentMessageIds(accessToken, 50);
  }

  console.log(`[gmail-sync] Found ${messageIds.length} messages to process for inbox ${inboxConnectionId}`);

  // Load learned vendor→category mappings for AI prompt enhancement
  let vendorMappings: VendorCategoryMapping[] = [];
  if (isAiEnabled()) {
    try {
      const mappings = await store.getVendorCategoryMappings(inbox.businessId);
      vendorMappings = mappings.map(m => ({
        vendorNameOriginal: m.vendorNameOriginal,
        category: m.category,
      }));
    } catch { /* ignore */ }
  }

  let newDocuments = 0;
  let aiProcessed = 0;
  const AI_BATCH_LIMIT = 5; // Max AI calls per sync cycle for serverless timeout safety

  for (const messageId of messageIds) {
    if (await store.hasDocumentForGmailMessage(inbox.businessId, messageId)) {
      continue;
    }

    try {
      const message = await fetchGmailMessage(accessToken, messageId);
      const doc = extractDocumentFromEmail(message, inbox);
      if (!doc) continue;

      // AI extraction (if enabled and under batch limit)
      if (isAiEnabled() && aiProcessed < AI_BATCH_LIMIT) {
        try {
          if (doc.attachments.length > 0) {
            // Download and process the first attachment
            const att = doc.attachments[0];
            const base64Data = await fetchGmailAttachment(accessToken, messageId, att.attachmentId);

            let extracted;
            if (att.mimeType === "application/pdf") {
              extracted = await extractInvoiceFromPdf(inbox.businessId, base64Data, undefined, vendorMappings);
            } else if (att.mimeType.startsWith("image/")) {
              extracted = await extractInvoiceFromImage(inbox.businessId, base64Data, att.mimeType, undefined, vendorMappings);
            }

            if (extracted && extracted.confidence > 0.2) {
              doc.vendorName = extracted.vendorName || doc.vendorName;
              doc.amountCents = extracted.amountCents || doc.amountCents;
              doc.vatCents = extracted.vatCents ?? doc.vatCents;
              doc.category = extracted.category || doc.category;
              doc.confidence = extracted.confidence;
              doc.type = extracted.type || doc.type;
              if (extracted.issuedAt && extracted.issuedAt !== new Date().toISOString().slice(0, 10)) {
                doc.issuedAt = new Date(extracted.issuedAt).toISOString();
              }
            }
            aiProcessed++;
          } else if (doc.rawText) {
            // Text-only AI extraction
            const extracted = await extractInvoiceFromText(inbox.businessId, doc.rawText, vendorMappings);
            if (extracted && extracted.confidence > 0.2) {
              doc.vendorName = extracted.vendorName || doc.vendorName;
              doc.amountCents = extracted.amountCents || doc.amountCents;
              doc.vatCents = extracted.vatCents ?? doc.vatCents;
              doc.category = extracted.category || doc.category;
              doc.confidence = extracted.confidence;
              doc.type = extracted.type || doc.type;
            }
            aiProcessed++;
          }
        } catch (aiErr) {
          console.error(`[gmail-sync] AI extraction failed for ${messageId}:`, aiErr);
          // Continue with regex-extracted data
        }
      }

      // Apply learned vendor→category override (exact match wins over AI)
      if (doc.vendorName) {
        try {
          const mapping = await store.getVendorCategoryMapping(inbox.businessId, doc.vendorName);
          if (mapping) {
            doc.category = mapping.category;
            doc.confidence = Math.max(doc.confidence, 0.9);
          }
        } catch { /* ignore */ }
      }

      await store.createDocument(doc);
      newDocuments++;
    } catch (error) {
      console.error(`[gmail-sync] Failed to process message ${messageId}:`, error);
    }
  }

  // Update sync cursor
  try {
    const latestHistoryId = await getLatestHistoryId(accessToken);
    await store.updateInboxSyncCursor(inboxConnectionId, latestHistoryId);
  } catch (error) {
    console.error("[gmail-sync] Failed to update history cursor:", error);
  }

  console.log(`[gmail-sync] Sync complete: ${newDocuments} new documents`);
  return { newDocuments };
}

export async function syncAllGmailInboxes(): Promise<{ total: number }> {
  let total = 0;
  // Get all businesses that have connected Gmail inboxes
  // We'll iterate all connected Gmail inboxes across all businesses
  try {
    const { pool } = await import("../db");
    const result = await pool.query(
      `SELECT id FROM inbox_connections
       WHERE provider = 'GMAIL' AND status = 'CONNECTED'
         AND auth_method = 'OAUTH' AND oauth_connection_id IS NOT NULL`,
    );
    for (const row of result.rows) {
      try {
        const { newDocuments } = await syncGmailInbox(row.id);
        total += newDocuments;
      } catch (error) {
        console.error(`[gmail-sync] Failed to sync inbox ${row.id}:`, error);
      }
    }
  } catch {
    // Fallback for JSON store
    // Can't easily iterate all businesses in JSON mode without exposing internals
    console.log("[gmail-sync] Periodic sync skipped (no DATABASE_URL)");
  }
  return { total };
}

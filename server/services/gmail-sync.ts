import { env } from "../config";
import { store } from "../store";
import { getValidAccessToken } from "./oauth";
import { isAiEnabled, extractInvoiceFromText, extractInvoiceFromImage, extractInvoiceFromPdf, classifyEmailBatch, type VendorCategoryMapping, type EmailCandidate, type ClassificationResult } from "./ai";

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

async function fetchRecentMessageIds(accessToken: string, maxResults: number, afterDate?: Date): Promise<string[]> {
  let q = "has:attachment OR subject:(חשבונית OR invoice OR receipt OR קבלה OR payment OR תשלום OR billing OR הזמנה)";
  if (afterDate) {
    const y = afterDate.getFullYear();
    const m = String(afterDate.getMonth() + 1).padStart(2, "0");
    const d = String(afterDate.getDate()).padStart(2, "0");
    q = `after:${y}/${m}/${d} (${q})`;
  }

  const ids: string[] = [];
  let pageToken: string | undefined;
  // Gmail API caps maxResults at 500 per page — paginate to reach the requested limit
  do {
    const pageSize = Math.min(maxResults - ids.length, 500);
    let url = `/messages?maxResults=${pageSize}&q=${encodeURIComponent(q)}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const data: GmailListResponse = await gmailFetch(accessToken, url);
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = (data as any).nextPageToken;
  } while (pageToken && ids.length < maxResults);

  return ids;
}

// ─── Quick scan: targeted queries for real invoices ───

async function fetchQuickScanCandidates(accessToken: string, afterDate: Date): Promise<string[]> {
  const y = afterDate.getFullYear();
  const m = String(afterDate.getMonth() + 1).padStart(2, "0");
  const d = String(afterDate.getDate()).padStart(2, "0");
  const datePrefix = `after:${y}/${m}/${d}`;

  // Query A: direct invoice/receipt keywords + document attachment (high signal)
  const queryA = `${datePrefix} subject:(חשבונית OR invoice OR receipt OR קבלה OR חשבון) filename:(pdf OR xlsx OR csv)`;
  // Query B: billing/payment/subscription keywords (medium signal)
  const queryB = `${datePrefix} subject:("חשבונית מס" OR "tax invoice" OR קבלה OR "אישור תשלום" OR "payment confirmation" OR billing OR subscription OR "receipt from" OR "purchase confirmation" OR "order confirmation" OR "renewal confirmation" OR "payment successful" OR "הזמנה" OR "sales receipt") -category:promotions -category:social`;

  const idSet = new Set<string>();

  for (const q of [queryA, queryB]) {
    try {
      const data: GmailListResponse = await gmailFetch(
        accessToken,
        `/messages?maxResults=100&q=${encodeURIComponent(q)}`,
      );
      for (const msg of data.messages ?? []) idSet.add(msg.id);
    } catch (err: any) {
      console.error(`[gmail-sync] Quick scan query failed: ${err.message}`);
    }
  }

  console.log(`[gmail-sync] Quick scan candidates: ${idSet.size} unique IDs from targeted queries`);
  return [...idSet].slice(0, 200);
}

interface GmailMetadataMessage {
  id: string;
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{ filename?: string; mimeType: string }>;
  };
  internalDate: string;
}

async function fetchGmailMessageMetadata(accessToken: string, messageId: string): Promise<GmailMetadataMessage> {
  return gmailFetch(
    accessToken,
    `/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
  );
}

// ─── AI-powered quick scan ───

export async function quickScanWithAI(
  inboxConnectionId: string,
): Promise<{ newDocuments: number; candidates: number; aiConfirmed: number }> {
  const inbox = await store.getInboxConnection(inboxConnectionId);
  if (!inbox || !inbox.oauthConnectionId) {
    throw new Error("No OAuth connection for this inbox");
  }

  const hasActiveScan = await store.hasActiveScanForInbox(inboxConnectionId);
  if (hasActiveScan) {
    console.log(`[gmail-sync] Skipping quick scan for inbox ${inboxConnectionId}: deep scan active`);
    return { newDocuments: 0, candidates: 0, aiConfirmed: 0 };
  }

  const oauth = await store.getOAuthConnection(inbox.oauthConnectionId);
  if (!oauth) throw new Error("OAuth connection not found");

  const accessToken = await getValidAccessToken(oauth, store, env);

  // Step 1: Fetch candidate IDs with targeted queries
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const candidateIds = await fetchQuickScanCandidates(accessToken, threeMonthsAgo);

  if (candidateIds.length === 0) {
    console.log(`[gmail-sync] Quick scan: 0 candidates found for inbox ${inboxConnectionId}`);
    try {
      const latestHistoryId = await getLatestHistoryId(accessToken);
      await store.updateInboxSyncCursor(inboxConnectionId, latestHistoryId);
    } catch { /* ignore */ }
    return { newDocuments: 0, candidates: 0, aiConfirmed: 0 };
  }

  // Step 2: Fetch first 30 messages (metadata only) in parallel batches
  const METADATA_BATCH = 30;
  const idsToFetch = candidateIds.slice(0, METADATA_BATCH);
  const metadataResults = await Promise.all(
    idsToFetch.map(async (id) => {
      try {
        return await fetchGmailMessageMetadata(accessToken, id);
      } catch {
        return null;
      }
    }),
  );
  const metadataMessages = metadataResults.filter((m): m is GmailMetadataMessage => m !== null);

  // Step 3: Build EmailCandidate array for AI classification
  const emailCandidates: EmailCandidate[] = metadataMessages.map((msg, i) => {
    const headers = Object.fromEntries(
      msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
    );
    const attachmentNames = (msg.payload.parts ?? [])
      .filter((p) => p.filename && p.filename.length > 0)
      .map((p) => p.filename!);

    return {
      index: i,
      subject: headers["subject"] ?? "",
      from: headers["from"] ?? "",
      snippet: msg.snippet ?? "",
      date: headers["date"] ?? new Date(parseInt(msg.internalDate)).toISOString().slice(0, 10),
      hasAttachment: attachmentNames.length > 0,
      attachmentNames,
    };
  });

  // Step 4: AI batch classification (single Haiku call)
  console.log(`[gmail-sync] Quick scan: classifying ${emailCandidates.length} emails with AI...`);
  let classifications: ClassificationResult[];
  try {
    classifications = await classifyEmailBatch(inbox.businessId, emailCandidates);
  } catch (err: any) {
    console.error(`[gmail-sync] AI classification failed: ${err.message}`);
    // Fallback: return 0 rather than garbage results
    return { newDocuments: 0, candidates: candidateIds.length, aiConfirmed: 0 };
  }

  const confirmed = classifications.filter((c) => c.isInvoice && c.confidence >= 0.5);
  console.log(`[gmail-sync] Quick scan: AI confirmed ${confirmed.length} invoices out of ${emailCandidates.length} candidates`);

  // Step 5: Fetch full messages for confirmed invoices and extract real amounts
  let newDocuments = 0;
  const MAX_DOCS = 5;

  for (const classification of confirmed) {
    if (newDocuments >= MAX_DOCS) break;

    const metaMsg = metadataMessages[classification.index];
    if (!metaMsg) continue;

    // Check for duplicates
    if (await store.hasDocumentForGmailMessage(inbox.businessId, metaMsg.id)) continue;

    const headers = Object.fromEntries(
      metaMsg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
    );
    const date = new Date(parseInt(metaMsg.internalDate));

    // Fetch full message to get body text with real amounts
    let amountCents = classification.amountCents || 0;
    let currency = classification.currency || "ILS";
    let rawText: string | null = metaMsg.snippet?.substring(0, 2000) ?? null;
    let attachmentFilenames: string[] = (metaMsg.payload.parts ?? [])
      .filter((p) => p.filename && p.filename.length > 0)
      .map((p) => p.filename!);

    try {
      const fullMessage = await fetchGmailMessage(accessToken, metaMsg.id);
      const bodyText = extractPlainText(fullMessage);
      if (bodyText) rawText = bodyText.substring(0, 2000);

      // Extract real amount from subject + snippet + body text
      const searchText = (headers["subject"] ?? "") + " " + (metaMsg.snippet ?? "") + " " + (bodyText?.substring(0, 2000) ?? "");
      const extracted = extractAmountFromText(searchText);
      if (extracted.amountCents > 0) {
        amountCents = extracted.amountCents;
        currency = extracted.currency;
      }

      // Update attachment filenames from full message (more accurate)
      attachmentFilenames = (fullMessage.payload.parts ?? [])
        .filter((p: any) => p.filename && p.filename.length > 0)
        .map((p: any) => p.filename!);
    } catch (err: any) {
      console.warn(`[gmail-sync] Could not fetch full message ${metaMsg.id}: ${err.message}`);
      // Continue with metadata-only data
    }

    // Skip invoices where we couldn't extract a real amount — don't show $0 junk in preview
    if (amountCents === 0) {
      console.log(`[gmail-sync] Quick scan: skipping ${classification.vendorName || "unknown"} — no amount found in email body`);
      continue;
    }

    const vendorName = classification.vendorName || headers["from"]?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || "Unknown";

    await store.createDocument({
      businessId: inbox.businessId,
      inboxConnectionId: inbox.id,
      source: "EMAIL",
      type: classification.type || "INVOICE",
      status: "PENDING",
      vendorName,
      amountCents,
      currency,
      vatCents: amountCents > 0 && currency === "ILS" ? Math.floor(amountCents * 0.17) : null,
      issuedAt: date.toISOString(),
      confidence: classification.confidence,
      category: classification.category || null,
      rawText,
      gmailMessageId: metaMsg.id,
    });
    newDocuments++;
    console.log(`[gmail-sync] Quick scan: created doc for ${vendorName} — ${currency} ${amountCents / 100}`);
  }

  // Update sync cursor
  try {
    const latestHistoryId = await getLatestHistoryId(accessToken);
    await store.updateInboxSyncCursor(inboxConnectionId, latestHistoryId);
  } catch (error) {
    console.error("[gmail-sync] Failed to update history cursor:", error);
  }

  console.log(`[gmail-sync] Quick scan complete: ${newDocuments} new docs, ${candidateIds.length} candidates, ${confirmed.length} AI-confirmed`);
  return { newDocuments, candidates: candidateIds.length, aiConfirmed: confirmed.length };
}

// ─── History-based incremental sync ───

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

// ─── Amount extraction helper (shared by quick scan + full sync) ───

function extractAmountFromText(text: string): { amountCents: number; currency: string } {
  const amountPatterns: Array<{ re: RegExp; cur: string }> = [
    { re: /(?:₪|ILS|NIS)\s*([\d,]+\.?\d*)/, cur: "ILS" },
    { re: /([\d,]+\.?\d*)\s*(?:₪|ILS|NIS)/, cur: "ILS" },
    { re: /\$\s*([\d,]+\.?\d*)/, cur: "USD" },
    { re: /([\d,]+\.?\d*)\s*USD/i, cur: "USD" },
    { re: /€\s*([\d,]+\.?\d*)/, cur: "EUR" },
    { re: /([\d,]+\.?\d*)\s*EUR/i, cur: "EUR" },
    { re: /סה"כ[:\s]*([\d,]+\.?\d*)/, cur: "ILS" },
    { re: /total[:\s]*([\d,]+\.?\d*)/i, cur: "ILS" },
  ];
  for (const { re, cur } of amountPatterns) {
    const match = text.match(re);
    if (match) {
      const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
      const val = parseFloat(raw);
      if (val > 0 && val < 1_000_000) {
        return { amountCents: Math.round(val * 100), currency: cur };
      }
    }
  }
  return { amountCents: 0, currency: "ILS" };
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

  // Accept emails that have invoice signals OR relevant attachments
  if (!hasInvoiceSignal && !hasAttachment) {
    return null;
  }
  // Attachment-only (no subject keyword): require invoice-like filename
  if (!hasInvoiceSignal && hasAttachment) {
    const hasInvoiceFilename = message.payload.parts?.some(
      (p) => p.filename && /invoice|חשבונית|receipt|קבלה|bill|חשבון/i.test(p.filename),
    );
    if (!hasInvoiceFilename) return null;
  }

  const bodyText = extractPlainText(message);

  // Determine type
  let type = "INVOICE";
  if (/receipt|קבלה/.test(lowerSubject)) type = "RECEIPT";
  else if (/subscription|מנוי/.test(lowerSubject)) type = "SUBSCRIPTION";
  else if (/confirmation|אישור/.test(lowerSubject)) type = "PAYMENT_CONFIRMATION";

  // Try to extract amount from subject, snippet, and body (multi-currency)
  const searchText = subject + " " + (message.snippet ?? "") + " " + (bodyText?.substring(0, 1000) ?? "");
  const { amountCents, currency } = extractAmountFromText(searchText);

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
    currency,
    vatCents: amountCents > 0 && currency === "ILS" ? Math.floor(amountCents * 0.17) : null,
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

export interface SyncOptions {
  /** Quick scan mode: skip AI, skip attachments, 3-month window, max 10 messages */
  quickScan?: boolean;
}

export async function syncGmailInbox(inboxConnectionId: string, options?: SyncOptions): Promise<{ newDocuments: number }> {
  const { quickScan = false } = options ?? {};
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

  if (quickScan) {
    // Quick scan: last 3 months, no AI — cast a wide net to find real invoices
    // Gmail reads are free; only cost is time. Fetch up to 1000 IDs, stop processing at 3 docs.
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    messageIds = await fetchRecentMessageIds(accessToken, 1000, threeMonthsAgo);
  } else if (historyId) {
    messageIds = await fetchNewMessageIdsSinceHistory(accessToken, historyId);
  } else {
    messageIds = await fetchRecentMessageIds(accessToken, 50);
  }

  console.log(`[gmail-sync] Found ${messageIds.length} messages to process for inbox ${inboxConnectionId}${quickScan ? " (quick scan)" : ""}`);

  // Load learned vendor→category mappings for AI prompt enhancement
  let vendorMappings: VendorCategoryMapping[] = [];
  if (!quickScan && isAiEnabled()) {
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
  let skippedNoMatch = 0;
  let skippedDuplicate = 0;
  let processed = 0;
  const AI_BATCH_LIMIT = 5; // Max AI calls per sync cycle for serverless timeout safety
  const QUICK_SCAN_DOC_LIMIT = 3; // Stop processing once we have enough samples

  for (const messageId of messageIds) {
    // Quick scan early-stop: we only need a few samples to show the user
    if (quickScan && newDocuments >= QUICK_SCAN_DOC_LIMIT) break;

    if (await store.hasDocumentForGmailMessage(inbox.businessId, messageId)) {
      skippedDuplicate++;
      continue;
    }

    try {
      processed++;
      const message = await fetchGmailMessage(accessToken, messageId);
      const doc = extractDocumentFromEmail(message, inbox);
      if (!doc) {
        skippedNoMatch++;
        if (quickScan && processed <= 5) {
          // Log first few skipped messages for debugging
          const headers = Object.fromEntries(message.payload.headers.map((h: any) => [h.name.toLowerCase(), h.value]));
          console.log(`[gmail-sync] Skipped message: subject="${headers["subject"]?.substring(0, 80)}" from="${headers["from"]?.substring(0, 50)}"`);
        }
        continue;
      }

      // AI extraction (if enabled, under batch limit, and NOT quick scan)
      if (!quickScan && isAiEnabled() && aiProcessed < AI_BATCH_LIMIT) {
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
      if (!quickScan && doc.vendorName) {
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

  console.log(`[gmail-sync] Sync complete: ${newDocuments} new docs | ${messageIds.length} candidates | ${processed} processed | ${skippedNoMatch} no-match | ${skippedDuplicate} dupes${quickScan ? " (quick scan)" : ""}`);
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

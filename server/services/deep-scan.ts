import { store } from "../store";
import { getValidAccessToken } from "./oauth";
import { env } from "../config";
import {
  gmailFetch,
  fetchGmailMessage,
  fetchGmailAttachment,
  extractDocumentFromEmail,
  getLatestHistoryId,
} from "./gmail-sync";

const TIME_BUDGET_MS = 22_000; // 22s — leave 8s buffer for Vercel's 30s limit

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

// ─── Phase 1: Discovery ───
// Paginates through Gmail to collect all matching message IDs

export async function discoverMessages(scanJobId: string): Promise<{ done: boolean; found: number }> {
  const job = await store.getScanJob(scanJobId);
  if (!job || job.status !== "DISCOVERING") return { done: true, found: 0 };

  const inbox = await store.getInboxConnection(job.inboxConnectionId);
  if (!inbox?.oauthConnectionId) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "No OAuth connection" });
    return { done: true, found: 0 };
  }

  const oauth = await store.getOAuthConnection(inbox.oauthConnectionId);
  if (!oauth) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "OAuth not found" });
    return { done: true, found: 0 };
  }

  const accessToken = await getValidAccessToken(oauth, store, env);
  const startTime = Date.now();
  let pageToken = job.discoveryPageToken || undefined;
  let totalFound = job.totalDiscovered;

  try {
    do {
      const params = new URLSearchParams({
        maxResults: "500",
        q: job.gmailQuery,
      });
      if (pageToken) params.set("pageToken", pageToken);

      const data: GmailListResponse = await gmailFetch(
        accessToken,
        `/messages?${params.toString()}`,
      );

      const ids = (data.messages ?? []).map((m) => m.id);
      if (ids.length > 0) {
        const inserted = await store.insertScanMessages(scanJobId, ids);
        totalFound += ids.length;
        console.log(`[deep-scan] Discovered ${ids.length} messages (${inserted} new), total: ${totalFound}`);
      }

      pageToken = data.nextPageToken;

      // Save progress after each page
      await store.updateScanJob(scanJobId, {
        discoveryPageToken: pageToken ?? null,
        totalDiscovered: totalFound,
      });

      // Check time budget
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log("[deep-scan] Discovery pausing — time budget reached");
        return { done: false, found: totalFound };
      }
    } while (pageToken);

    // Discovery complete
    console.log(`[deep-scan] Discovery complete. Total: ${totalFound} messages`);
    if (totalFound === 0) {
      await store.updateScanJob(scanJobId, {
        status: "COMPLETED",
        totalDiscovered: 0,
        totalToProcess: 0,
      });
    } else {
      await store.updateScanJob(scanJobId, {
        status: "PROCESSING",
        totalDiscovered: totalFound,
        totalToProcess: totalFound,
      });
    }
    return { done: true, found: totalFound };
  } catch (error: any) {
    console.error("[deep-scan] Discovery error:", error);
    await store.updateScanJob(scanJobId, {
      lastError: error.message?.substring(0, 500),
    });
    return { done: false, found: totalFound };
  }
}

// ─── Phase 2: Regex Batch Processing ───
// Claims pending messages and runs regex extraction

export async function processRegexBatch(scanJobId: string): Promise<{ processed: number; created: number; done: boolean }> {
  const job = await store.getScanJob(scanJobId);
  if (!job || job.status !== "PROCESSING") return { processed: 0, created: 0, done: true };

  const inbox = await store.getInboxConnection(job.inboxConnectionId);
  if (!inbox?.oauthConnectionId) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "No OAuth connection" });
    return { processed: 0, created: 0, done: true };
  }

  const oauth = await store.getOAuthConnection(inbox.oauthConnectionId);
  if (!oauth) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "OAuth not found" });
    return { processed: 0, created: 0, done: true };
  }

  const accessToken = await getValidAccessToken(oauth, store, env);
  const startTime = Date.now();

  // Claim a batch of pending messages
  const batch = await store.claimPendingMessages(scanJobId, 50);
  if (batch.length === 0) {
    // No more pending — check if we need AI pass
    const counts = await store.getScanQueueCountByStatus(scanJobId);
    const aiNeeded = Object.entries(counts)
      .filter(([status]) => status === "REGEX_DONE")
      .reduce((sum, [, v]: [string, any]) => sum + (v.needsAi ?? 0), 0);

    if (aiNeeded > 0) {
      console.log(`[deep-scan] Regex pass complete. ${aiNeeded} messages need AI processing`);
      await store.updateScanJob(scanJobId, {
        status: "AI_PASS",
        aiTotal: aiNeeded,
      });
    } else {
      console.log("[deep-scan] Processing complete — no AI needed");
      // Update history cursor so incremental sync resumes properly
      try {
        const latestHistoryId = await getLatestHistoryId(accessToken);
        await store.updateInboxSyncCursor(job.inboxConnectionId, latestHistoryId);
      } catch { /* ignore */ }
      await store.updateScanJob(scanJobId, { status: "COMPLETED" });
    }
    return { processed: 0, created: 0, done: true };
  }

  let processed = 0;
  let created = 0;
  let errors = 0;

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      // Time's up — put remaining items back to PENDING
      for (let j = i; j < batch.length; j++) {
        await store.updateScanMessage(batch[j].id, { status: "PENDING" });
      }
      break;
    }

    const item = batch[i];
    try {
      // Check for duplicate
      const isDup = await store.hasDocumentForGmailMessage(inbox.businessId, item.gmailMessageId);
      if (isDup) {
        await store.updateScanMessage(item.id, { status: "DUPLICATE" });
        processed++;
        continue;
      }

      // Fetch and extract
      const message = await fetchGmailMessage(accessToken, item.gmailMessageId);
      const doc = extractDocumentFromEmail(message, {
        id: inbox.id,
        businessId: inbox.businessId,
      });

      if (!doc) {
        await store.updateScanMessage(item.id, { status: "SKIPPED" });
        processed++;
        continue;
      }

      // Create the document
      const { id: docId } = await store.createDocument(doc);

      // Check if this message has attachments that need AI
      const hasDownloadableAttachment = doc.attachments.length > 0;
      await store.updateScanMessage(item.id, {
        status: "REGEX_DONE",
        needsAi: hasDownloadableAttachment,
        documentId: docId,
      });

      processed++;
      created++;
    } catch (error: any) {
      console.error(`[deep-scan] Error processing ${item.gmailMessageId}:`, error.message);
      await store.updateScanMessage(item.id, {
        status: "FAILED",
        errorMessage: error.message?.substring(0, 500),
      });
      processed++;
      errors++;
    }
  }

  // Update job counters
  await store.updateScanJob(scanJobId, {
    processedCount: job.processedCount + processed,
    documentsCreated: job.documentsCreated + created,
    errorCount: job.errorCount + errors,
    skippedCount: job.skippedCount + (processed - created - errors),
  });

  console.log(`[deep-scan] Regex batch: ${processed} processed, ${created} created, ${errors} errors`);
  return { processed, created, done: false };
}

// ─── Phase 3: AI Batch Processing ───
// Claims messages that need AI and enhances documents

export async function processAiBatch(scanJobId: string): Promise<{ processed: number; done: boolean }> {
  const job = await store.getScanJob(scanJobId);
  if (!job || job.status !== "AI_PASS") return { processed: 0, done: true };

  const inbox = await store.getInboxConnection(job.inboxConnectionId);
  if (!inbox?.oauthConnectionId) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "No OAuth connection" });
    return { processed: 0, done: true };
  }

  const oauth = await store.getOAuthConnection(inbox.oauthConnectionId);
  if (!oauth) {
    await store.updateScanJob(scanJobId, { status: "FAILED", lastError: "OAuth not found" });
    return { processed: 0, done: true };
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(oauth, store, env);
  } catch (error: any) {
    await store.updateScanJob(scanJobId, { lastError: `Token error: ${error.message}` });
    return { processed: 0, done: false };
  }

  // Check if AI is available — deep scan always uses cheap model (Haiku) to keep costs low
  const { isAiEnabled, extractInvoiceFromPdf, extractInvoiceFromImage } =
    await import("./ai");
  const cheapModel = env.AI_MODEL_CHEAP;

  // Load learned vendor→category mappings (trimmed to top 5 for cost)
  let vendorMappings: Array<{ vendorNameOriginal: string; category: string }> = [];
  try {
    const mappings = await store.getVendorCategoryMappings(inbox.businessId);
    // Only include top 5 most-corrected mappings to reduce prompt tokens
    vendorMappings = mappings.slice(0, 5).map((m: any) => ({
      vendorNameOriginal: m.vendorNameOriginal,
      category: m.category,
    }));
  } catch { /* ignore */ }
  if (!isAiEnabled()) {
    console.log("[deep-scan] AI not enabled — completing scan without AI pass");
    try {
      const latestHistoryId = await getLatestHistoryId(accessToken);
      await store.updateInboxSyncCursor(job.inboxConnectionId, latestHistoryId);
    } catch { /* ignore */ }
    await store.updateScanJob(scanJobId, { status: "COMPLETED" });
    return { processed: 0, done: true };
  }

  // Claim a small batch (AI is slow)
  const batch = await store.claimAiMessages(scanJobId, 5);
  if (batch.length === 0) {
    console.log("[deep-scan] AI pass complete");
    try {
      const latestHistoryId = await getLatestHistoryId(accessToken);
      await store.updateInboxSyncCursor(job.inboxConnectionId, latestHistoryId);
    } catch { /* ignore */ }
    await store.updateScanJob(scanJobId, { status: "COMPLETED" });
    return { processed: 0, done: true };
  }

  const startTime = Date.now();
  let processed = 0;
  let aiSkipped = 0;

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      // Put remaining back
      for (let j = i; j < batch.length; j++) {
        await store.updateScanMessage(batch[j].id, { status: "REGEX_DONE" });
      }
      break;
    }

    const item = batch[i];
    try {
      // ── Optimization 1: Known vendor skip ──
      // If we have 3+ high-confidence docs from this vendor, reuse the extraction
      if (item.documentId) {
        const doc = await store.getDocumentById(item.documentId);
        if (doc?.vendorName) {
          const known = await store.getKnownVendorExtraction(inbox.businessId, doc.vendorName);
          if (known) {
            await store.updateDocument(inbox.businessId, item.documentId, {
              vendorName: known.vendorName,
              category: known.category,
              status: "pending",
            });
            await store.updateScanMessage(item.id, { status: "AI_DONE" });
            processed++;
            aiSkipped++;
            continue;
          }
        }
      }

      // Re-fetch the Gmail message to get attachment info
      const message = await fetchGmailMessage(accessToken, item.gmailMessageId);

      // Find the first downloadable attachment
      const att = message.payload.parts?.find(
        (p) =>
          p.body?.attachmentId &&
          p.filename &&
          p.filename.length > 0 &&
          (p.filename.toLowerCase().endsWith(".pdf") ||
            p.filename.toLowerCase().endsWith(".png") ||
            p.filename.toLowerCase().endsWith(".jpg") ||
            p.filename.toLowerCase().endsWith(".jpeg")),
      );

      if (!att?.body?.attachmentId) {
        await store.updateScanMessage(item.id, { status: "AI_DONE" });
        processed++;
        continue;
      }

      // ── Optimization 2: Attachment size filter ──
      // Skip tiny attachments (<5KB = likely signatures/logos) and huge ones (>2MB = marketing)
      const attSize = att.body?.size ?? 0;
      if (attSize > 0 && (attSize < 5_000 || attSize > 2_000_000)) {
        console.log(`[deep-scan] Skipping attachment ${att.filename} (${attSize} bytes) — outside size range`);
        await store.updateScanMessage(item.id, { status: "AI_DONE" });
        processed++;
        aiSkipped++;
        continue;
      }

      const base64Data = await fetchGmailAttachment(accessToken, item.gmailMessageId, att.body.attachmentId);

      let extracted: any;
      if (att.mimeType === "application/pdf") {
        extracted = await extractInvoiceFromPdf(inbox.businessId, base64Data, cheapModel, vendorMappings);
      } else if (att.mimeType.startsWith("image/")) {
        extracted = await extractInvoiceFromImage(inbox.businessId, base64Data, att.mimeType, cheapModel, vendorMappings);
      }

      if (extracted && extracted.confidence > 0.2 && item.documentId) {
        const updates: Record<string, any> = {};
        if (extracted.vendorName) updates.vendorName = extracted.vendorName;
        if (extracted.amountCents) updates.amountCents = extracted.amountCents;
        if (extracted.category) updates.category = extracted.category;
        if (extracted.confidence >= 0.6) updates.status = "pending";
        else updates.status = "review";

        await store.updateDocument(inbox.businessId, item.documentId, updates);
      }

      await store.updateScanMessage(item.id, { status: "AI_DONE" });
      processed++;
    } catch (error: any) {
      console.error(`[deep-scan] AI error for ${item.gmailMessageId}:`, error.message);
      await store.updateScanMessage(item.id, {
        status: "AI_DONE",
        errorMessage: error.message?.substring(0, 500),
      });
      processed++;
    }
  }

  await store.updateScanJob(scanJobId, {
    aiProcessed: job.aiProcessed + processed,
  });

  console.log(`[deep-scan] AI batch: ${processed} processed, ${aiSkipped} skipped (known vendor/size filter)`);
  return { processed, done: false };
}

// ─── Orchestrator: called by cron ───

export async function processScanJobs(): Promise<{ processed: number }> {
  const jobs = await store.getAllActiveScanJobs();
  if (jobs.length === 0) return { processed: 0 };

  let totalProcessed = 0;

  for (const job of jobs) {
    if (job.status === "PAUSED") continue;

    try {
      if (job.status === "DISCOVERING") {
        const result = await discoverMessages(job.id);
        totalProcessed += result.found;
      } else if (job.status === "PROCESSING") {
        const result = await processRegexBatch(job.id);
        totalProcessed += result.processed;
      } else if (job.status === "AI_PASS") {
        const result = await processAiBatch(job.id);
        totalProcessed += result.processed;
      }
    } catch (error: any) {
      console.error(`[deep-scan] Job ${job.id} error:`, error);
      await store.updateScanJob(job.id, { lastError: error.message?.substring(0, 500) });
    }
  }

  return { processed: totalProcessed };
}

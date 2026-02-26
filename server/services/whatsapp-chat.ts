import { store } from "../store";
import { bridgeSendText } from "./whatsapp-bridge-client";
import { chatResponse, isAiEnabled, extractInvoiceFromImage } from "./ai";

/**
 * Handle an inbound text message from WhatsApp.
 * Looks up business context, runs AI chat, sends reply back.
 */
export async function handleWhatsAppInbound(
  businessId: string,
  fromPhone: string,
  text: string,
): Promise<void> {
  try {
    // Get business context for AI
    const summary = await store.getDashboardSummary(businessId);
    const { documents: recentDocs } = await store.getDashboardDocuments(businessId, "all");

    // Get recent chat messages for context
    const chatData = await store.getDashboardChat(businessId);
    const recentMessages = (chatData.messages ?? [])
      .slice(-8)
      .map((m: any) => ({
        role: m.from === "user" ? "user" as const : "assistant" as const,
        text: m.text,
      }));

    // Store inbound message
    await store.postDashboardChat({
      businessId,
      text,
      userId: fromPhone,
      channel: "whatsapp",
    });

    if (!isAiEnabled()) {
      await bridgeSendText(businessId, fromPhone, "שלום! המערכת פעילה אך AI לא זמין כרגע.");
      return;
    }

    // Generate AI response
    const reply = await chatResponse(businessId, text, recentMessages, {
      businessName: summary.business.name,
      accountantName: summary.business.accountantName,
      summary,
      recentDocs: recentDocs.slice(0, 10),
    });

    // Store bot reply
    await store.postDashboardChat({
      businessId,
      text: reply,
      userId: "bot",
      channel: "whatsapp",
    });

    // Send reply back via WhatsApp bridge
    await bridgeSendText(businessId, fromPhone, reply);
  } catch (error) {
    console.error(`[whatsapp-chat] Error handling inbound from ${fromPhone}:`, error);
    try {
      await bridgeSendText(businessId, fromPhone, "מצטער, אירעה שגיאה. נסה שוב מאוחר יותר.");
    } catch { /* ignore send error */ }
  }
}

/**
 * Handle an inbound image/media message from WhatsApp.
 * Runs AI extraction, creates a document, sends confirmation.
 */
export async function handleWhatsAppMediaInbound(
  businessId: string,
  fromPhone: string,
  imageBase64: string,
  mimeType: string,
): Promise<void> {
  try {
    if (!isAiEnabled()) {
      await bridgeSendText(businessId, fromPhone, "קיבלתי תמונה, אבל AI לא זמין כרגע לעיבוד.");
      return;
    }

    // Extract invoice data from image
    const extracted = await extractInvoiceFromImage(businessId, imageBase64, mimeType);

    if (extracted.confidence < 0.2) {
      await bridgeSendText(businessId, fromPhone, "קיבלתי תמונה, אבל לא הצלחתי לזהות חשבונית. נסה תמונה ברורה יותר.");
      return;
    }

    // Create document
    await store.createDocument({
      businessId,
      inboxConnectionId: "whatsapp",
      source: "WHATSAPP",
      type: extracted.type,
      status: extracted.confidence >= 0.6 ? "PENDING" : "REVIEW",
      vendorName: extracted.vendorName,
      amountCents: extracted.amountCents,
      currency: extracted.currency,
      vatCents: extracted.vatCents,
      issuedAt: new Date(extracted.issuedAt).toISOString(),
      confidence: extracted.confidence,
      category: extracted.category,
      rawText: null,
      gmailMessageId: `whatsapp-${Date.now()}`,
      attachments: [],
      attachmentFilenames: [],
    });

    const amount = extracted.amountCents > 0
      ? `₪${(extracted.amountCents / 100).toLocaleString("he-IL")}`
      : "סכום לא ידוע";

    await bridgeSendText(
      businessId,
      fromPhone,
      `זיהיתי חשבונית!\n` +
      `ספק: ${extracted.vendorName}\n` +
      `סכום: ${amount}\n` +
      `קטגוריה: ${extracted.category}\n` +
      `ביטחון: ${Math.round(extracted.confidence * 100)}%\n\n` +
      `המסמך נשמר בדשבורד.`,
    );
  } catch (error) {
    console.error(`[whatsapp-chat] Error handling media from ${fromPhone}:`, error);
    try {
      await bridgeSendText(businessId, fromPhone, "מצטער, לא הצלחתי לעבד את התמונה.");
    } catch { /* ignore */ }
  }
}

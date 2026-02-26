import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config";
import { pool } from "../db";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function isAiEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// ── Cost tracking ──────────────────────────────────────────────

async function logUsage(
  businessId: string,
  model: string,
  operation: string,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  try {
    const isExpensive = model.includes("sonnet") || model.includes("opus");
    const inputCostPerMTok = isExpensive ? 300 : 25;
    const outputCostPerMTok = isExpensive ? 1500 : 125;
    const costCents =
      (usage.input_tokens * inputCostPerMTok + usage.output_tokens * outputCostPerMTok) / 1_000_000;

    await pool.query(
      `INSERT INTO ai_usage_log (business_id, model, operation, input_tokens, output_tokens, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [businessId, model, operation, usage.input_tokens, usage.output_tokens, costCents],
    );
  } catch (err) {
    console.error("[ai] Failed to log usage:", err);
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface ExtractedInvoice {
  vendorName: string;
  amountCents: number;
  currency: string;
  vatCents: number | null;
  issuedAt: string;
  type: string;
  category: string;
  confidence: number;
}

export interface VendorCategoryMapping {
  vendorNameOriginal: string;
  category: string;
}

const BUILTIN_CATEGORIES = ['תוכנה', 'חשבונות', 'משרד', 'ציוד', 'נסיעות', 'שיווק', 'מקצועי', 'כללי'];

const EXTRACTION_SYSTEM_PROMPT_BASE = `You are an Israeli invoice/receipt data extractor. Extract structured data and return ONLY valid JSON, no markdown, no explanation.

Return exactly this shape:
{
  "vendorName": "string – the vendor/company name",
  "amountCents": 0,
  "currency": "ILS",
  "vatCents": null,
  "issuedAt": "YYYY-MM-DD",
  "type": "INVOICE",
  "category": "כללי",
  "confidence": 0.8
}

Rules:
- amountCents is in agorot (1 ILS = 100 agorot). Example: ₪150 = 15000
- vatCents: If VAT is separately listed, extract it. Otherwise null.
- type: one of INVOICE, RECEIPT, SUBSCRIPTION, PAYMENT_CONFIRMATION
- category: one of תוכנה, חשבונות, משרד, ציוד, נסיעות, שיווק, מקצועי, כללי
- issuedAt: Best guess date in YYYY-MM-DD. If unknown, use today.
- confidence: 0-1 how confident you are in the extraction.
- If you truly cannot extract anything useful, return confidence: 0.1 with best guesses.`;

function buildExtractionPrompt(vendorMappings?: VendorCategoryMapping[]): string {
  let prompt = EXTRACTION_SYSTEM_PROMPT_BASE;

  if (vendorMappings && vendorMappings.length > 0) {
    const examples = vendorMappings.slice(0, 20);
    prompt += `\n\nIMPORTANT: The user has previously corrected categories for these vendors. Use these mappings when you encounter the same or similar vendor names:\n`;
    for (const m of examples) {
      prompt += `- "${m.vendorNameOriginal}" → ${m.category}\n`;
    }
    prompt += `\nIf you recognize a vendor that matches or is very similar to one of these, use the mapped category. For example, "Google LLC", "Google Israel", and "GOOGLE" should all map to the same category if any variant appears above.`;

    const customCategories = [...new Set(
      vendorMappings.map(m => m.category)
        .filter(c => !BUILTIN_CATEGORIES.includes(c))
    )];
    if (customCategories.length > 0) {
      prompt += `\nAdditional custom categories this business uses: ${customCategories.join(', ')}. You may use these in addition to the built-in categories.`;
    }
  }

  return prompt;
}

function parseExtractedJson(response: Anthropic.Message): ExtractedInvoice {
  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      vendorName: String(parsed.vendorName || "לא ידוע"),
      amountCents: Math.round(Number(parsed.amountCents) || 0),
      currency: String(parsed.currency || "ILS"),
      vatCents: parsed.vatCents != null ? Math.round(Number(parsed.vatCents)) : null,
      issuedAt: String(parsed.issuedAt || new Date().toISOString().slice(0, 10)),
      type: String(parsed.type || "INVOICE").toUpperCase(),
      category: String(parsed.category || "כללי"),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    console.error("[ai] Failed to parse JSON response:", cleaned.slice(0, 200));
    return {
      vendorName: "לא ידוע",
      amountCents: 0,
      currency: "ILS",
      vatCents: null,
      issuedAt: new Date().toISOString().slice(0, 10),
      type: "INVOICE",
      category: "כללי",
      confidence: 0.1,
    };
  }
}

// ── Extraction: text only (Haiku) ──────────────────────────────

export async function extractInvoiceFromText(
  businessId: string,
  rawText: string,
  vendorMappings?: VendorCategoryMapping[],
): Promise<ExtractedInvoice> {
  const model = env.AI_MODEL_CHEAP;
  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: buildExtractionPrompt(vendorMappings),
    messages: [
      { role: "user", content: `Extract invoice data from this email:\n\n${rawText.substring(0, 4000)}` },
    ],
  });
  await logUsage(businessId, model, "extract_text", response.usage);
  return parseExtractedJson(response);
}

// ── Extraction: image (Sonnet vision) ──────────────────────────

export async function extractInvoiceFromImage(
  businessId: string,
  imageBase64: string,
  mimeType: string,
  modelOverride?: string,
  vendorMappings?: VendorCategoryMapping[],
): Promise<ExtractedInvoice> {
  const model = modelOverride ?? env.AI_MODEL_EXPENSIVE;
  const mediaType = mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: buildExtractionPrompt(vendorMappings),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Extract invoice/receipt data from this image. Return JSON only.",
          },
        ],
      },
    ],
  });
  await logUsage(businessId, model, "extract_image", response.usage);
  return parseExtractedJson(response);
}

// ── Extraction: PDF (Sonnet document) ──────────────────────────

export async function extractInvoiceFromPdf(
  businessId: string,
  pdfBase64: string,
  modelOverride?: string,
  vendorMappings?: VendorCategoryMapping[],
): Promise<ExtractedInvoice> {
  const model = modelOverride ?? env.AI_MODEL_EXPENSIVE;
  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: buildExtractionPrompt(vendorMappings),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          } as any,
          {
            type: "text",
            text: "Extract invoice/receipt data from this PDF. Return JSON only.",
          },
        ],
      },
    ],
  });
  await logUsage(businessId, model, "extract_pdf", response.usage);
  return parseExtractedJson(response);
}

// ── Chat response (Haiku) ──────────────────────────────────────

export async function chatResponse(
  businessId: string,
  userMessage: string,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  context: {
    businessName: string;
    accountantName: string;
    summary: any;
    recentDocs: any[];
  },
): Promise<string> {
  const model = env.AI_MODEL_CHEAP;

  const systemPrompt = `אתה "Amram AI", עוזר חכם לניהול חשבוניות והוצאות עבור עסקים ישראליים.
ענה בעברית בצורה תמציתית וידידותית (1-3 משפטים).

הקשר עסקי:
- שם העסק: ${context.businessName}
- רואה חשבון: ${context.accountantName}
- סיכום: סה"כ ${context.summary?.totals?.documents ?? 0} מסמכים, ${context.summary?.totals?.sent ?? 0} נשלחו, ${context.summary?.totals?.pending ?? 0} ממתינים
- סכום כולל: ₪${((context.summary?.totals?.amountCents ?? 0) / 100).toLocaleString("he-IL")}
- מסמכים אחרונים: ${JSON.stringify(context.recentDocs?.slice(0, 10) ?? [])}

כללים:
- ענה רק על סמך הנתונים שבהקשר. אל תמציא.
- אם אינך יודע, אמור "אין לי מספיק מידע לענות על זה."
- אם שואלים על סכומים, ענה בשקלים (₪).`;

  const messages: Anthropic.MessageParam[] = [
    ...recentMessages.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.text,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages,
  });

  await logUsage(businessId, model, "chat", response.usage);

  return response.content[0]?.type === "text"
    ? response.content[0].text
    : "מצטער, לא הצלחתי לענות כרגע.";
}

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

export const BUILTIN_CATEGORIES = [
  'תוכנה', 'ענן ואחסון', 'פרסום', 'שיווק', 'תקשורת',
  'משרד', 'ציוד', 'נסיעות', 'מזון', 'שכירות',
  'ביטוח', 'חשבונות', 'ייעוץ', 'לימודים', 'רישיונות',
  'בנקאות', 'מקצועי', 'כללי',
];

// Vendor name patterns mapped to categories (case-insensitive regex)
export const VENDOR_CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  // תוכנה - Software
  { pattern: /github|gitlab|jetbrains|atlassian|jira|confluence|notion|slack|zoom|microsoft|office\s?365|adobe|figma|canva|monday\.com|asana|clickup|trello|dropbox|1password|lastpass/i, category: 'תוכנה' },
  // ענן ואחסון - Cloud/Hosting
  { pattern: /aws|amazon\s?web|vercel|netlify|heroku|digitalocean|linode|vultr|hetzner|cloudflare|siteground|godaddy|namecheap|wix|squarespace|firebase|supabase|neon|planetscale|railway|render|fly\.io/i, category: 'ענן ואחסון' },
  // פרסום - Advertising
  { pattern: /google\s?ads|meta\s?ads|facebook\s?ads|instagram\s?ads|tiktok\s?ads|linkedin\s?ads|twitter\s?ads|taboola|outbrain|bing\s?ads/i, category: 'פרסום' },
  // שיווק - Marketing
  { pattern: /mailchimp|sendgrid|hubspot|mailerlite|convertkit|activecampaign|sendinblue|brevo|constant\s?contact|klaviyo|semrush|ahrefs|moz/i, category: 'שיווק' },
  // תקשורת - Telecom
  { pattern: /בזק|bezeq|פרטנר|partner|סלקום|cellcom|הוט|hot\b|גולן|golan|012|013|018|pelephone|פלאפון|yes\b|רמי\s?לוי\s?תקשורת/i, category: 'תקשורת' },
  // מזון - Food
  { pattern: /מסעד[הת]|restaurant|wolt|תן ביס|10bis|cibus|סיבוס|japanika|שיפודי|פיצ[הא]|אגדיר|cafe|קפה|בית\s?קפה|מאפ[הי]/i, category: 'מזון' },
  // ביטוח - Insurance
  { pattern: /ביטוח|insurance|הראל|הפניקס|מגדל|כלל\s?ביטוח|menora|מנורה|migdal|clal|phoenix|harel/i, category: 'ביטוח' },
  // חשבונות - Accounting
  { pattern: /רואה?\s?חשבון|accountant|חשבשבת|hashavshevet|priority|סאפ|sap\b|invoice4u|greeninvoice|חשבונית\s?ירוקה|icount|rivhit|רווחית/i, category: 'חשבונות' },
  // נסיעות - Travel
  { pattern: /booking\.com|airbnb|waze|gett|uber|yango|מונית|taxi|אל\s?על|elal|ישראייר|israir|arkia|ארקיע|airlines|flight|hotel|מלון/i, category: 'נסיעות' },
  // רישיונות - Licenses
  { pattern: /license|רישיון|רשם\s?החברות|עירייה|municipality|ארנונה|arnona|aguda|אגודה|רשות/i, category: 'רישיונות' },
  // בנקאות - Banking
  { pattern: /לאומי|leumi|הפועלים|hapoalim|מזרחי|mizrahi|דיסקונט|discount|בנק\s?הדואר|paypal|stripe|payoneer|wise\.com|עמלת?\s?בנק/i, category: 'בנקאות' },
  // משרד - Office
  { pattern: /office\s?depot|סופר\s?פארם|kravitz|קרביץ|שופרסל|רמי\s?לוי|דיו|טונר|toner|ink|paper|נייר|ריהוט|furniture/i, category: 'משרד' },
  // ציוד - Equipment
  { pattern: /ksp|ivory|bug|באג|זאפ|next|נקסט\s?דיגיטל|dell|lenovo|apple|samsung|lg\b|hp\b|מחשב|computer|מדפסת|printer|מסך|monitor/i, category: 'ציוד' },
  // לימודים - Education
  { pattern: /udemy|coursera|linkedin\s?learning|masterclass|קורס|course|סדנ[הא]|workshop|הכשרה|training|אקדמי|academic|מכללה|college/i, category: 'לימודים' },
  // ייעוץ - Consulting
  { pattern: /consulting|ייעוץ|יועץ|advisor|עורך?\s?דין|lawyer|attorney|פרילנסר|freelanc/i, category: 'ייעוץ' },
];

/** Match a vendor name against known rules. Returns category or null. */
export function matchVendorCategory(vendorName: string): string | null {
  const name = vendorName.trim();
  if (!name) return null;
  for (const rule of VENDOR_CATEGORY_RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }
  return null;
}

const CATEGORY_LIST_STR = BUILTIN_CATEGORIES.join(', ');

const EXTRACTION_SYSTEM_PROMPT_BASE = `You are an Israeli invoice/receipt data extractor. Extract structured data and return ONLY valid JSON, no markdown, no explanation.

Return exactly this shape:
{
  "vendorName": "string - the vendor/company name",
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
- category: Pick the BEST match from: ${CATEGORY_LIST_STR}
  Category guide:
  - תוכנה: dev tools, SaaS apps (GitHub, Slack, Notion, Figma, Adobe)
  - ענן ואחסון: cloud hosting, domains (AWS, Vercel, GoDaddy, Cloudflare)
  - פרסום: ad spend (Google Ads, Meta Ads, TikTok Ads)
  - שיווק: marketing tools (Mailchimp, HubSpot, SEMrush)
  - תקשורת: phone, internet (Bezeq, Partner, Cellcom, HOT)
  - משרד: office supplies, printing
  - ציוד: hardware, electronics (KSP, Dell, Apple)
  - נסיעות: flights, hotels, taxis, car rental
  - מזון: restaurants, catering (Wolt, 10bis)
  - שכירות: rent, lease, co-working spaces
  - ביטוח: insurance policies
  - חשבונות: accounting software (Hashavshevet, GreenInvoice, iCount)
  - ייעוץ: consulting, legal, freelancers
  - לימודים: courses, training, workshops
  - רישיונות: licenses, municipal fees, permits
  - בנקאות: bank fees, payment processors (PayPal, Stripe)
  - מקצועי: professional services not fitting above
  - כללי: ONLY if nothing else fits. Avoid using this.
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

// ── Batch classification: quick scan (Haiku) ────────────────────

export interface EmailCandidate {
  index: number;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  hasAttachment: boolean;
  attachmentNames: string[];
}

export interface ClassificationResult {
  index: number;
  isInvoice: boolean;
  type: string;
  vendorName: string;
  amountCents: number;
  currency: string;
  category: string;
  confidence: number;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are an Israeli business EXPENSE classifier. Your job is to find emails that represent EXPENSES (money the business PAID OUT to vendors/services). These will be sent to the business's accountant.

IMPORTANT — This is for EXPENSE tracking. Only accept documents where the business SPENT money.

REJECT — NOT expenses:
- INCOME: "Payment Received", payouts, client payments, earnings, "new order" from customers
- ALERTS: billing warnings ("spend is at X%"), threshold notifications, budget alerts, expiry warnings ("X days left until expiration")
- FAILURES: "payment failed", "auto-recharge failed", "issue with payment", declined cards
- CANCELLATIONS: "plan will not renew", unsubscribe confirmations
- ONBOARDING: "Welcome to...", account setup, getting started, feature announcements
- REPORTS: performance reports, analytics summaries, weekly/monthly reports
- GENERAL: newsletters, marketing, promotions, shared files, meeting invites, security alerts, shipping notifications

ACCEPT — real business expenses (money PAID BY the business):
- Invoices (חשבונית, חשבונית מס, tax invoice) — for services/goods purchased
- Receipts (קבלה, אישור תשלום) — proof of payment made
- SaaS/subscription charges — monthly/annual fees the business pays (Vercel, AWS, Anthropic, etc.)
- Hosting/domain renewals — SiteGround, GoDaddy, etc.
- Ad spend receipts — Meta ads, Google Ads (receipts, NOT budget alerts)
- Purchase confirmations — software, equipment, supplies bought
- Utility bills — phone, internet, cloud services

Return ONLY a JSON array. For each email by index:
- If expense: {"index":N,"isInvoice":true,"type":"INVOICE|RECEIPT|SUBSCRIPTION|PAYMENT_CONFIRMATION","vendorName":"...","amountCents":0,"currency":"ILS|USD|EUR","category":"...","confidence":0.9}
- If NOT: {"index":N,"isInvoice":false}

amountCents = amount in smallest unit (agorot for ILS, cents for USD). ₪150 = 15000, $20 = 2000.
If amount not visible in metadata, set amountCents to 0 but still mark isInvoice true if it's clearly an expense.
Categories: ${CATEGORY_LIST_STR}
Pick the BEST match. Use כללי ONLY when nothing else fits.`;

export async function classifyEmailBatch(
  businessId: string,
  emails: EmailCandidate[],
): Promise<ClassificationResult[]> {
  if (emails.length === 0) return [];

  const model = env.AI_MODEL_CHEAP;

  // Build compact email list for the prompt
  const emailList = emails.map((e) => {
    let line = `${e.index}. From: "${e.from}" | Subject: "${e.subject}"`;
    if (e.snippet) line += ` | Preview: "${e.snippet.substring(0, 120)}"`;
    if (e.hasAttachment && e.attachmentNames.length > 0) {
      line += ` | Attachments: ${e.attachmentNames.join(", ")}`;
    } else if (e.hasAttachment) {
      line += ` | Has attachment`;
    }
    if (e.date) line += ` | Date: ${e.date}`;
    return line;
  }).join("\n");

  const response = await getClient().messages.create({
    model,
    max_tokens: 2048,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: `Classify these ${emails.length} emails:\n\n${emailList}` },
    ],
  });

  await logUsage(businessId, model, "classify_batch", response.usage);

  // Parse response
  const text = response.content[0]?.type === "text" ? response.content[0].text : "[]";
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Expected array");

    return parsed.map((item: any) => ({
      index: Number(item.index),
      isInvoice: Boolean(item.isInvoice),
      type: String(item.type || "INVOICE").toUpperCase(),
      vendorName: String(item.vendorName || ""),
      amountCents: Math.round(Number(item.amountCents) || 0),
      currency: String(item.currency || "ILS"),
      category: String(item.category || "כללי"),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
    }));
  } catch (err) {
    console.error("[ai] Failed to parse classification response:", cleaned.slice(0, 300));
    // Fallback: return all as non-invoices
    return emails.map((e) => ({
      index: e.index,
      isInvoice: false,
      type: "INVOICE",
      vendorName: "",
      amountCents: 0,
      currency: "ILS",
      category: "כללי",
      confidence: 0,
    }));
  }
}

// ── Invoice Chat Tools (tool_use) ──────────────────────────────

const INVOICE_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_invoices",
    description: "Search and filter invoices by vendor name, category, or status. Returns matching invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Vendor name to search (partial, case-insensitive)" },
        category: { type: "string", description: "Category to filter by (exact Hebrew name)" },
        status: { type: "string", enum: ["sent", "pending", "review"], description: "Status filter" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "recategorize_invoices",
    description: "Change the category of all invoices from a specific vendor. Optionally filter by current category.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Vendor name to match (case-insensitive)" },
        oldCategory: { type: "string", description: "Only recategorize invoices currently in this category (optional)" },
        newCategory: { type: "string", description: "New category to assign" },
      },
      required: ["vendor", "newCategory"],
    },
  },
  {
    name: "get_invoice_stats",
    description: "Get summary statistics grouped by category or vendor - count, total amount.",
    input_schema: {
      type: "object" as const,
      properties: {
        groupBy: { type: "string", enum: ["category", "vendor"], description: "Group results by" },
        vendor: { type: "string", description: "Optional vendor name filter" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max groups to return (default 15)" },
      },
      required: ["groupBy"],
    },
  },
  {
    name: "ignore_invoices",
    description: "Remove/hide invoices - marks them as ignored so they are excluded from reports and lists. Use when user wants to delete, remove, hide, or exclude invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Vendor name to match (case-insensitive)" },
        category: { type: "string", description: "Only ignore invoices in this category (optional)" },
        status: { type: "string", enum: ["sent", "pending", "review"], description: "Only ignore invoices with this status (optional)" },
      },
      required: ["vendor"],
    },
  },
  {
    name: "restore_invoices",
    description: "Restore previously ignored/hidden invoices back to pending status. Use when user wants to bring back removed invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendor: { type: "string", description: "Vendor name to match (case-insensitive)" },
      },
      required: ["vendor"],
    },
  },
];

export interface InvoiceToolExecutor {
  searchInvoices(params: { vendor?: string; category?: string; status?: string; limit?: number }): Promise<any[]>;
  recategorizeInvoices(params: { vendor: string; oldCategory?: string; newCategory: string }): Promise<number>;
  getInvoiceStats(params: { groupBy: string; vendor?: string; category?: string; limit?: number }): Promise<any[]>;
  ignoreInvoices(params: { vendor: string; category?: string; status?: string }): Promise<number>;
  restoreInvoices(params: { vendor: string }): Promise<number>;
}

export async function invoiceChatResponse(
  businessId: string,
  userMessage: string,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  context: { businessName: string; totalDocs: number; totalAmountCents: number },
  executor: InvoiceToolExecutor,
): Promise<string> {
  const model = env.AI_MODEL_CHEAP;

  const systemPrompt = `אתה "Amram AI", עוזר חכם לניהול חשבוניות.
ענה בעברית. תמציתי וידידותי.

עסק: ${context.businessName}
סה"כ: ${context.totalDocs} חשבוניות, ₪${(context.totalAmountCents / 100).toLocaleString("he-IL")}
קטגוריות: ${CATEGORY_LIST_STR}

יכולות:
- חיפוש חשבוניות לפי ספק, קטגוריה, סטטוס
- שינוי קטגוריה של חשבוניות
- סטטיסטיקות לפי קטגוריה או ספק
- הסתרה/מחיקה של חשבוניות (הוצאה מדוחות)
- שחזור חשבוניות שהוסתרו

כשהמשתמש מבקש לשנות קטגוריה, בצע את הפעולה ודווח כמה חשבוניות עודכנו.
כשהמשתמש מבקש למחוק, להסתיר, או להוציא חשבוניות מהדוחות - השתמש בכלי ignore_invoices.
כשהמשתמש מבקש להחזיר חשבוניות שהוסתרו - השתמש בכלי restore_invoices.
כשהמשתמש שואל על ספק, חפש את החשבוניות שלו.
כשאתה מציג תוצאות, הצג אותן בצורה מסודרת עם סכומים בשקלים (₪).
אם המשתמש כותב באנגלית, ענה באנגלית.`;

  const messages: Anthropic.MessageParam[] = [
    ...recentMessages.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.text,
    })),
    { role: "user", content: userMessage },
  ];

  // Tool-use loop (max 3 rounds)
  for (let round = 0; round < 3; round++) {
    const response = await getClient().messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: INVOICE_TOOLS,
      messages,
    });

    await logUsage(businessId, model, "invoice_chat", response.usage);

    // Check if the response is a final text answer
    const textBlock = response.content.find((b) => b.type === "text");
    const toolBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolBlocks.length === 0 && textBlock?.type === "text") {
      return textBlock.text;
    }

    // Execute tool calls
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolBlocks) {
      if (block.type !== "tool_use") continue;
      const input = block.input as any;
      let result: any;

      try {
        if (block.name === "search_invoices") {
          result = await executor.searchInvoices({
            vendor: input.vendor,
            category: input.category,
            status: input.status,
            limit: input.limit ?? 10,
          });
        } else if (block.name === "recategorize_invoices") {
          const count = await executor.recategorizeInvoices({
            vendor: input.vendor,
            oldCategory: input.oldCategory,
            newCategory: input.newCategory,
          });
          result = { updated: count, vendor: input.vendor, newCategory: input.newCategory };
        } else if (block.name === "get_invoice_stats") {
          result = await executor.getInvoiceStats({
            groupBy: input.groupBy,
            vendor: input.vendor,
            category: input.category,
            limit: input.limit ?? 15,
          });
        } else if (block.name === "ignore_invoices") {
          const count = await executor.ignoreInvoices({
            vendor: input.vendor,
            category: input.category,
            status: input.status,
          });
          result = { ignored: count, vendor: input.vendor };
        } else if (block.name === "restore_invoices") {
          const count = await executor.restoreInvoices({ vendor: input.vendor });
          result = { restored: count, vendor: input.vendor };
        } else {
          result = { error: "Unknown tool" };
        }
      } catch (err: any) {
        result = { error: err.message ?? "Tool execution failed" };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return "לא הצלחתי לעבד את הבקשה. נסה שוב.";
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

  // Pre-analyze for duplicates: same vendor+amount+date from different sources/inboxes
  const docs = context.recentDocs ?? [];
  const duplicateGroups: string[] = [];
  const seen = new Map<string, any[]>();
  for (const d of docs) {
    const key = `${d.vendor}|${d.amountCents}|${d.issuedAt}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(d);
  }
  for (const [, group] of seen) {
    if (group.length > 1) {
      const sources = group.map((g: any) => g.inbox || g.source).join(", ");
      duplicateGroups.push(`${group[0].vendor} - ₪${(group[0].amountCents / 100).toFixed(2)} (${group[0].issuedAt}) נמצא ${group.length} פעמים מ: ${sources}`);
    }
  }

  const systemPrompt = `אתה "Amram AI", עוזר חכם ומקצועי לניהול חשבוניות והוצאות עבור עסקים ישראליים.
ענה בעברית בצורה ידידותית ומועילה. תן תשובות מפורטות כשהמשתמש שואל שאלה ספציפית.

הקשר עסקי:
- שם העסק: ${context.businessName}
- רואה חשבון: ${context.accountantName}
- סיכום: סה"כ ${context.summary?.totals?.documents ?? 0} מסמכים, ${context.summary?.totals?.sent ?? 0} נשלחו, ${context.summary?.totals?.pending ?? 0} ממתינים
- סכום כולל: ₪${((context.summary?.totals?.amountCents ?? 0) / 100).toLocaleString("he-IL")}
${duplicateGroups.length > 0 ? `\n- כפילויות שזוהו:\n${duplicateGroups.map((d) => `  * ${d}`).join("\n")}` : "- לא זוהו כפילויות בין תיבות דואר שונות."}
- מסמכים אחרונים (כולל מקור ותיבת דואר): ${JSON.stringify(docs.slice(0, 15))}

יכולות:
- ניתוח הוצאות לפי קטגוריה, ספק, תקופה
- זיהוי כפילויות בין תיבות דואר שונות (אותו ספק + סכום + תאריך ממקורות שונים)
- סיכומים חודשיים ומגמות
- מעקב אחר סטטוס מסמכים (ממתין/נשלח/לבדיקה)
- מידע על תיבות דואר מחוברות ומקורות מסמכים

כללים:
- ענה על סמך הנתונים שבהקשר. אל תמציא נתונים.
- אם שואלים על כפילויות - בדוק אם אותו מסמך (ספק+סכום+תאריך) הגיע ממספר מקורות/תיבות דואר.
- אם שואלים על סכומים, ענה בשקלים (₪).
- אם אינך יודע, אמור "אין לי מספיק מידע כרגע."
- אם המשתמש כותב באנגלית, ענה באנגלית.`;

  const messages: Anthropic.MessageParam[] = [
    ...recentMessages.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.text,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  await logUsage(businessId, model, "chat", response.usage);

  return response.content[0]?.type === "text"
    ? response.content[0].text
    : "מצטער, לא הצלחתי לענות כרגע.";
}

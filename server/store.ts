import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type InboxProvider = "GMAIL" | "OUTLOOK" | "IMAP" | "YAHOO" | "ICLOUD";
export type InboxStatus = "CONNECTED" | "SYNCING" | "FAILED" | "DISCONNECTED";
export type InboxAuthMethod = "MANUAL" | "OAUTH";
export type OAuthProvider = "gmail" | "outlook";
export type DocumentSource = "EMAIL" | "WHATSAPP";
export type DocumentType = "INVOICE" | "RECEIPT" | "SUBSCRIPTION" | "PAYMENT_CONFIRMATION";
export type DocumentStatus = "SENT" | "PENDING" | "REVIEW";
export type MessageDirection = "USER" | "BOT";
export type MessageChannel = "WEBCHAT" | "WHATSAPP";
export type WhatsAppIntegrationStatus = "CONNECTED" | "PENDING" | "FAILED";
export type WhatsAppProvider = "CLOUD_API" | "BAILEYS";

interface User {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  preferredLanguage: string;
  createdAt: string;
  updatedAt: string;
}

interface Business {
  id: string;
  name: string;
  accountantDisplayName: string;
  currency: string;
  timezone: string;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BusinessMember {
  id: string;
  businessId: string;
  userId: string;
  role: "OWNER" | "MEMBER";
  createdAt: string;
}

interface AccountantContact {
  id: string;
  businessId: string;
  name: string;
  email: string | null;
  phone: string | null;
  firmName: string | null;
  autoMonthlyDelivery: boolean;
  monthlyDeliveryDay: number;
  lastDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OAuthConnection {
  id: string;
  businessId: string;
  provider: OAuthProvider;
  externalAccountId: string | null;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InboxConnection {
  id: string;
  businessId: string;
  userId: string | null;
  provider: InboxProvider;
  email: string;
  status: InboxStatus;
  authMethod: InboxAuthMethod;
  oauthConnectionId: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WhatsAppIntegration {
  id: string;
  businessId: string;
  provider: WhatsAppProvider;
  customerPhoneE164: string | null;
  customerName: string | null;
  status: WhatsAppIntegrationStatus;
  businessPhoneNumberId: string | null;
  wabaId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DocumentRecord {
  id: string;
  businessId: string;
  inboxConnectionId: string | null;
  source: DocumentSource;
  type: DocumentType;
  status: DocumentStatus;
  vendorName: string;
  amountCents: number;
  currency: string;
  vatCents: number | null;
  issuedAt: string;
  confidence: number;
  category: string | null;
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  businessId: string;
  userId: string | null;
  channel: MessageChannel;
  direction: MessageDirection;
  text: string;
  createdAt: string;
}

interface MonthlySummary {
  id: string;
  businessId: string;
  monthKey: string;
  totalDocuments: number;
  totalAmountCents: number;
  deliveredAt: string | null;
  createdAt: string;
}

interface AppDatabase {
  users: User[];
  businesses: Business[];
  members: BusinessMember[];
  accountantContacts: AccountantContact[];
  oauthConnections: OAuthConnection[];
  inboxConnections: InboxConnection[];
  whatsappIntegrations: WhatsAppIntegration[];
  documents: DocumentRecord[];
  conversationMessages: ConversationMessage[];
  monthlySummaries: MonthlySummary[];
}

const PROVIDER_MAP = {
  gmail: "GMAIL",
  outlook: "OUTLOOK",
  imap: "IMAP",
  yahoo: "YAHOO",
  icloud: "ICLOUD",
} as const;

const STATUS_MAP = {
  all: null,
  sent: "SENT",
  pending: "PENDING",
  review: "REVIEW",
} as const;

const VENDORS = [
  { vendorName: "Google Cloud", category: "תוכנה", minCents: 12000, maxCents: 280000, type: "SUBSCRIPTION" as DocumentType },
  { vendorName: "Adobe Creative", category: "תוכנה", minCents: 8900, maxCents: 24000, type: "SUBSCRIPTION" as DocumentType },
  { vendorName: "בזק אינטרנט", category: "חשבונות", minCents: 7900, maxCents: 25900, type: "INVOICE" as DocumentType },
  { vendorName: "WeWork", category: "משרד", minCents: 199000, maxCents: 530000, type: "INVOICE" as DocumentType },
  { vendorName: "Office Depot", category: "ציוד", minCents: 6900, maxCents: 95000, type: "RECEIPT" as DocumentType },
  { vendorName: "אל על", category: "נסיעות", minCents: 65000, maxCents: 299000, type: "INVOICE" as DocumentType },
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, "");
  if (!compact) {
    return "";
  }
  return compact.startsWith("+") ? compact : `+${compact}`;
}

function monthKeyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function escapeCsv(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function createInitialDb(): AppDatabase {
  return {
    users: [],
    businesses: [],
    members: [],
    accountantContacts: [],
    oauthConnections: [],
    inboxConnections: [],
    whatsappIntegrations: [],
    documents: [],
    conversationMessages: [],
    monthlySummaries: [],
  };
}

export class AppStore {
  private readonly dataFilePath: string;

  private data: AppDatabase;

  constructor(dataFilePath?: string) {
    const defaultDataDir = path.join(process.cwd(), "server", "data");
    if (!existsSync(defaultDataDir)) {
      mkdirSync(defaultDataDir, { recursive: true });
    }
    this.dataFilePath = dataFilePath ?? path.join(defaultDataDir, "app-db.json");
    this.data = this.load();
  }

  private load(): AppDatabase {
    if (!existsSync(this.dataFilePath)) {
      const initial = createInitialDb();
      writeFileSync(this.dataFilePath, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }
    const parsed = JSON.parse(readFileSync(this.dataFilePath, "utf-8")) as Partial<AppDatabase>;
    return {
      users: parsed.users ?? [],
      businesses: parsed.businesses ?? [],
      members: parsed.members ?? [],
      accountantContacts: parsed.accountantContacts ?? [],
      oauthConnections: parsed.oauthConnections ?? [],
      inboxConnections: (parsed.inboxConnections ?? []).map((entry) => ({
        ...entry,
        authMethod: entry.authMethod ?? "MANUAL",
        oauthConnectionId: entry.oauthConnectionId ?? null,
      })),
      whatsappIntegrations: (parsed.whatsappIntegrations ?? []).map((entry) => ({
        ...entry,
        provider: entry.provider ?? "CLOUD_API",
      })),
      documents: parsed.documents ?? [],
      conversationMessages: parsed.conversationMessages ?? [],
      monthlySummaries: parsed.monthlySummaries ?? [],
    };
  }

  private save(): void {
    writeFileSync(this.dataFilePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  private getBusinessOrThrow(businessId: string): Business {
    const business = this.data.businesses.find((entry) => entry.id === businessId);
    if (!business) {
      throw new Error("Business not found");
    }
    return business;
  }

  private getOwnerForBusiness(businessId: string): User | null {
    const member = this.data.members.find((entry) => entry.businessId === businessId && entry.role === "OWNER");
    if (!member) {
      return null;
    }
    return this.data.users.find((entry) => entry.id === member.userId) ?? null;
  }

  private ensureAccountantContact(businessId: string, accountantName: string): AccountantContact {
    const existing = this.data.accountantContacts.find((entry) => entry.businessId === businessId);
    if (existing) {
      return existing;
    }
    const timestamp = nowIso();
    const created: AccountantContact = {
      id: randomUUID(),
      businessId,
      name: accountantName,
      email: null,
      phone: null,
      firmName: null,
      autoMonthlyDelivery: true,
      monthlyDeliveryDay: 3,
      lastDeliveredAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.data.accountantContacts.push(created);
    return created;
  }

  private getWhatsAppIntegration(businessId: string): WhatsAppIntegration | null {
    return this.data.whatsappIntegrations.find((entry) => entry.businessId === businessId) ?? null;
  }

  private serializeConnectedInboxes(businessId: string) {
    return this.data.inboxConnections
      .filter((entry) => entry.businessId === businessId && entry.status !== "DISCONNECTED")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({
        id: entry.id,
        email: entry.email,
        provider: entry.provider.toLowerCase(),
        status: entry.status.toLowerCase(),
        authMethod: entry.authMethod.toLowerCase(),
        lastSyncAt: entry.lastSyncAt,
        invoicesFound: this.data.documents.filter((doc) => doc.inboxConnectionId === entry.id).length,
      }));
  }

  private serializeWhatsAppIntegration(businessId: string) {
    const integration = this.getWhatsAppIntegration(businessId);
    if (!integration) {
      return null;
    }
    return {
      id: integration.id,
      provider: integration.provider.toLowerCase(),
      customerPhoneE164: integration.customerPhoneE164,
      customerName: integration.customerName,
      status: integration.status.toLowerCase(),
      businessPhoneNumberId: integration.businessPhoneNumberId,
      wabaId: integration.wabaId,
      lastInboundAt: integration.lastInboundAt,
      lastOutboundAt: integration.lastOutboundAt,
      lastError: integration.lastError,
    };
  }

  private integrationStatus(businessId: string) {
    const connected = this.data.inboxConnections.filter((entry) => entry.businessId === businessId && entry.status === "CONNECTED");
    return {
      gmailConnected: connected.some((entry) => entry.provider === "GMAIL" && entry.authMethod === "OAUTH"),
      outlookConnected: connected.some((entry) => entry.provider === "OUTLOOK" && entry.authMethod === "OAUTH"),
      whatsappConnected: Boolean(this.getWhatsAppIntegration(businessId)?.status === "CONNECTED"),
    };
  }

  startOnboarding(payload: {
    email?: string;
    fullName?: string;
    businessName?: string;
    accountantName?: string;
    accountantEmail?: string;
  }) {
    const timestamp = nowIso();
    const email = normalizeEmail(payload.email ?? "demo@sendtoamram.co.il");
    const accountantName = payload.accountantName?.trim() || "עמרם";
    let user = this.data.users.find((entry) => entry.email === email);

    if (!user) {
      user = {
        id: randomUUID(),
        email,
        fullName: payload.fullName ?? null,
        phone: null,
        preferredLanguage: "he",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.users.push(user);
    } else if (payload.fullName !== undefined) {
      user.fullName = payload.fullName || null;
      user.updatedAt = timestamp;
    }

    let member = this.data.members.find((entry) => entry.userId === user.id && entry.role === "OWNER");
    let business: Business;
    if (!member) {
      business = {
        id: randomUUID(),
        name: payload.businessName?.trim() || "עסק חדש",
        accountantDisplayName: accountantName,
        currency: "ILS",
        timezone: "Asia/Jerusalem",
        onboardingCompletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.businesses.push(business);
      member = {
        id: randomUUID(),
        businessId: business.id,
        userId: user.id,
        role: "OWNER",
        createdAt: timestamp,
      };
      this.data.members.push(member);
      this.ensureAccountantContact(business.id, accountantName);
    } else {
      business = this.getBusinessOrThrow(member.businessId);
      if (payload.businessName?.trim()) {
        business.name = payload.businessName.trim();
      }
      if (payload.accountantName?.trim()) {
        business.accountantDisplayName = accountantName;
      }
      business.updatedAt = timestamp;
      const accountant = this.ensureAccountantContact(business.id, business.accountantDisplayName);
      if (payload.accountantName?.trim()) {
        accountant.name = accountantName;
        accountant.updatedAt = timestamp;
      }
    }

    this.save();
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
      },
      connectedInboxes: this.serializeConnectedInboxes(business.id),
      whatsapp: this.serializeWhatsAppIntegration(business.id),
      nextStep: "connect_inbox",
    };
  }

  getOnboardingState(businessId: string) {
    const business = this.getBusinessOrThrow(businessId);
    const owner = this.getOwnerForBusiness(businessId);
    return {
      user: owner
        ? {
            id: owner.id,
            email: owner.email,
            fullName: owner.fullName,
          }
        : null,
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
      },
      connectedInboxes: this.serializeConnectedInboxes(businessId),
      whatsapp: this.serializeWhatsAppIntegration(businessId),
      nextStep: "connect_inbox",
    };
  }

  connectInbox(payload: {
    businessId: string;
    provider: keyof typeof PROVIDER_MAP;
    email?: string;
  }) {
    this.getBusinessOrThrow(payload.businessId);
    const provider = PROVIDER_MAP[payload.provider];
    const inboxes = this.data.inboxConnections.filter((entry) => entry.businessId === payload.businessId);
    const suffix = inboxes.length > 0 ? `+${inboxes.length + 1}` : "";
    const defaultEmail = payload.provider === "gmail"
      ? `you${suffix}@gmail.com`
      : payload.provider === "outlook"
        ? `you${suffix}@outlook.com`
        : payload.provider === "imap"
          ? `finance${suffix}@company.co.il`
          : payload.provider === "yahoo"
            ? `you${suffix}@yahoo.com`
            : `you${suffix}@icloud.com`;

    const email = normalizeEmail(payload.email ?? defaultEmail);
    const timestamp = nowIso();
    const owner = this.getOwnerForBusiness(payload.businessId);
    let inbox = inboxes.find((entry) => normalizeEmail(entry.email) === email);
    if (!inbox) {
      inbox = {
        id: randomUUID(),
        businessId: payload.businessId,
        userId: owner?.id ?? null,
        provider,
        email,
        status: "CONNECTED",
        authMethod: "MANUAL",
        oauthConnectionId: null,
        lastSyncAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.inboxConnections.push(inbox);
    } else {
      inbox.provider = provider;
      inbox.status = "CONNECTED";
      inbox.authMethod = "MANUAL";
      inbox.oauthConnectionId = null;
      inbox.lastSyncAt = timestamp;
      inbox.updatedAt = timestamp;
    }

    this.save();
    return {
      businessId: payload.businessId,
      connectedInboxes: this.serializeConnectedInboxes(payload.businessId),
    };
  }

  upsertOAuthInbox(payload: {
    businessId: string;
    provider: OAuthProvider;
    email: string;
    externalAccountId: string | null;
    accessToken: string;
    refreshToken?: string | null;
    tokenType?: string | null;
    scope?: string | null;
    expiresAt?: string | null;
  }) {
    this.getBusinessOrThrow(payload.businessId);
    const timestamp = nowIso();
    const email = normalizeEmail(payload.email);
    const owner = this.getOwnerForBusiness(payload.businessId);

    let oauthConnection = this.data.oauthConnections.find(
      (entry) =>
        entry.businessId === payload.businessId &&
        entry.provider === payload.provider &&
        normalizeEmail(entry.email) === email,
    );

    if (!oauthConnection) {
      oauthConnection = {
        id: randomUUID(),
        businessId: payload.businessId,
        provider: payload.provider,
        externalAccountId: payload.externalAccountId,
        email,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        tokenType: payload.tokenType ?? null,
        scope: payload.scope ?? null,
        expiresAt: payload.expiresAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.oauthConnections.push(oauthConnection);
    } else {
      oauthConnection.externalAccountId = payload.externalAccountId;
      oauthConnection.accessToken = payload.accessToken;
      oauthConnection.refreshToken = payload.refreshToken ?? oauthConnection.refreshToken;
      oauthConnection.tokenType = payload.tokenType ?? oauthConnection.tokenType;
      oauthConnection.scope = payload.scope ?? oauthConnection.scope;
      oauthConnection.expiresAt = payload.expiresAt ?? oauthConnection.expiresAt;
      oauthConnection.updatedAt = timestamp;
    }

    const provider = payload.provider === "gmail" ? "GMAIL" : "OUTLOOK";
    let inbox = this.data.inboxConnections.find(
      (entry) => entry.businessId === payload.businessId && normalizeEmail(entry.email) === email,
    );
    if (!inbox) {
      inbox = {
        id: randomUUID(),
        businessId: payload.businessId,
        userId: owner?.id ?? null,
        provider,
        email,
        status: "CONNECTED",
        authMethod: "OAUTH",
        oauthConnectionId: oauthConnection.id,
        lastSyncAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.inboxConnections.push(inbox);
    } else {
      inbox.provider = provider;
      inbox.status = "CONNECTED";
      inbox.authMethod = "OAUTH";
      inbox.oauthConnectionId = oauthConnection.id;
      inbox.lastSyncAt = timestamp;
      inbox.updatedAt = timestamp;
    }

    this.save();
    return {
      businessId: payload.businessId,
      connectedInboxes: this.serializeConnectedInboxes(payload.businessId),
    };
  }

  connectWhatsApp(payload: {
    businessId: string;
    phoneE164: string;
    customerName?: string;
    provider?: WhatsAppProvider;
    businessPhoneNumberId?: string | null;
    wabaId?: string | null;
    status?: WhatsAppIntegrationStatus;
    lastError?: string | null;
  }) {
    this.getBusinessOrThrow(payload.businessId);
    const timestamp = nowIso();
    const phone = normalizePhone(payload.phoneE164);

    let integration = this.data.whatsappIntegrations.find((entry) => entry.businessId === payload.businessId);
    if (!integration) {
      integration = {
        id: randomUUID(),
        businessId: payload.businessId,
        provider: payload.provider ?? "CLOUD_API",
        customerPhoneE164: phone,
        customerName: payload.customerName ?? null,
        status: payload.status ?? "PENDING",
        businessPhoneNumberId: payload.businessPhoneNumberId ?? null,
        wabaId: payload.wabaId ?? null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: payload.lastError ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.whatsappIntegrations.push(integration);
    } else {
      integration.provider = payload.provider ?? integration.provider;
      integration.customerPhoneE164 = phone || integration.customerPhoneE164;
      integration.customerName = payload.customerName ?? integration.customerName;
      integration.status = payload.status ?? integration.status;
      integration.businessPhoneNumberId = payload.businessPhoneNumberId ?? integration.businessPhoneNumberId;
      integration.wabaId = payload.wabaId ?? integration.wabaId;
      integration.lastError = payload.lastError ?? integration.lastError;
      integration.updatedAt = timestamp;
    }

    this.save();
    return this.serializeWhatsAppIntegration(payload.businessId);
  }

  markWhatsAppInbound(payload: { fromPhone: string; text: string }) {
    const phone = normalizePhone(payload.fromPhone);
    const integration = this.data.whatsappIntegrations.find(
      (entry) => normalizePhone(entry.customerPhoneE164 ?? "") === phone,
    );
    if (!integration) {
      return null;
    }

    integration.status = "CONNECTED";
    integration.lastInboundAt = nowIso();
    integration.lastError = null;
    integration.updatedAt = nowIso();
    this.data.conversationMessages.push({
      id: randomUUID(),
      businessId: integration.businessId,
      userId: null,
      channel: "WHATSAPP",
      direction: "USER",
      text: payload.text,
      createdAt: nowIso(),
    });
    this.save();
    return { businessId: integration.businessId };
  }

  markWhatsAppOutbound(businessId: string, text: string) {
    const integration = this.getWhatsAppIntegration(businessId);
    if (integration) {
      integration.status = "CONNECTED";
      integration.lastOutboundAt = nowIso();
      integration.lastError = null;
      integration.updatedAt = nowIso();
    }
    this.data.conversationMessages.push({
      id: randomUUID(),
      businessId,
      userId: null,
      channel: "WHATSAPP",
      direction: "BOT",
      text,
      createdAt: nowIso(),
    });
    this.save();
  }

  markWhatsAppStatusByPhone(fromPhone: string, errorMessage?: string | null) {
    const phone = normalizePhone(fromPhone);
    const integration = this.data.whatsappIntegrations.find(
      (entry) => normalizePhone(entry.customerPhoneE164 ?? "") === phone,
    );
    if (!integration) {
      return;
    }
    integration.lastOutboundAt = nowIso();
    integration.status = errorMessage ? "FAILED" : "CONNECTED";
    integration.lastError = errorMessage ?? null;
    integration.updatedAt = nowIso();
    this.save();
  }

  private buildSummary(businessId: string) {
    const business = this.getBusinessOrThrow(businessId);
    const docs = this.data.documents.filter((entry) => entry.businessId === businessId);
    const totals = {
      documents: docs.length,
      amountCents: docs.reduce((sum, entry) => sum + entry.amountCents, 0),
      sent: docs.filter((entry) => entry.status === "SENT").length,
      pending: docs.filter((entry) => entry.status === "PENDING").length,
      review: docs.filter((entry) => entry.status === "REVIEW").length,
      connectedInboxes: this.data.inboxConnections.filter(
        (entry) => entry.businessId === businessId && entry.status === "CONNECTED",
      ).length,
    };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currentDocs = docs.filter((entry) => new Date(entry.issuedAt) >= monthStart);
    const previousDocs = docs.filter((entry) => {
      const issuedAt = new Date(entry.issuedAt);
      return issuedAt >= previousMonthStart && issuedAt < monthStart;
    });

    const currentAmount = currentDocs.reduce((sum, entry) => sum + entry.amountCents, 0);
    const previousAmount = previousDocs.reduce((sum, entry) => sum + entry.amountCents, 0);
    const deltaPercent = previousAmount === 0
      ? 100
      : Number((((currentAmount - previousAmount) / previousAmount) * 100).toFixed(1));

    return {
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
      },
      billing: {
        onboardingPaid: true,
        subscriptionStatus: "active",
      },
      totals,
      month: {
        documents: currentDocs.length,
        amountCents: currentAmount,
        documentsDelta: currentDocs.length - previousDocs.length,
        amountDeltaPercent: deltaPercent,
      },
    };
  }

  private seedDocumentsIfEmpty(businessId: string, targetCount: number) {
    if (this.data.documents.some((entry) => entry.businessId === businessId)) {
      return;
    }
    const rand = createSeededRandom(targetCount * 43 + businessId.length);
    const inboxes = this.data.inboxConnections.filter((entry) => entry.businessId === businessId);
    for (let index = 0; index < targetCount; index += 1) {
      const template = VENDORS[Math.floor(rand() * VENDORS.length)];
      const source: DocumentSource = rand() > 0.25 ? "EMAIL" : "WHATSAPP";
      const statusRoll = rand();
      const status: DocumentStatus = statusRoll < 0.77 ? "SENT" : statusRoll < 0.92 ? "PENDING" : "REVIEW";
      const amountCents = template.minCents + Math.floor(rand() * (template.maxCents - template.minCents));
      const daysAgo = Math.floor(rand() * 75);
      const issuedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
      const inbox = source === "EMAIL" && inboxes.length > 0 ? inboxes[Math.floor(rand() * inboxes.length)] : null;
      const timestamp = nowIso();
      this.data.documents.push({
        id: randomUUID(),
        businessId,
        inboxConnectionId: inbox?.id ?? null,
        source,
        type: template.type,
        status,
        vendorName: template.vendorName,
        amountCents,
        currency: "ILS",
        vatCents: Math.floor(amountCents * 0.17),
        issuedAt,
        confidence: Number((0.82 + rand() * 0.18).toFixed(3)),
        category: template.category,
        rawText: `Synthetic sample #${index + 1}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  private seedChatIfEmpty(businessId: string, accountantName: string) {
    if (this.data.conversationMessages.some((entry) => entry.businessId === businessId)) {
      return;
    }
    const owner = this.getOwnerForBusiness(businessId);
    const seedMessages: Array<{ direction: MessageDirection; text: string }> = [
      { direction: "USER", text: "כמה הוצאתי על תוכנה החודש?" },
      { direction: "BOT", text: "נכון לעכשיו: 2,574 ש\"ח על תוכנה החודש. רוצה פירוט לפי ספקים?" },
      { direction: "USER", text: `${accountantName} קיבל הכל?` },
      { direction: "BOT", text: `כמעט. רוב המסמכים כבר נשלחו ל-${accountantName}.` },
    ];
    seedMessages.forEach((message) => {
      this.data.conversationMessages.push({
        id: randomUUID(),
        businessId,
        userId: owner?.id ?? null,
        channel: "WEBCHAT",
        direction: message.direction,
        text: message.text,
        createdAt: nowIso(),
      });
    });
  }

  runScan(payload: { businessId: string; targetCount?: number }) {
    const business = this.getBusinessOrThrow(payload.businessId);
    const target = payload.targetCount ?? 47;
    this.seedDocumentsIfEmpty(payload.businessId, target);
    this.seedChatIfEmpty(payload.businessId, business.accountantDisplayName);

    if (!business.onboardingCompletedAt) {
      business.onboardingCompletedAt = nowIso();
      business.updatedAt = nowIso();
    }

    const summary = this.buildSummary(payload.businessId);
    const monthKey = monthKeyFor(new Date());
    const existing = this.data.monthlySummaries.find(
      (entry) => entry.businessId === payload.businessId && entry.monthKey === monthKey,
    );
    if (existing) {
      existing.totalDocuments = summary.month.documents;
      existing.totalAmountCents = summary.month.amountCents;
    } else {
      this.data.monthlySummaries.push({
        id: randomUUID(),
        businessId: payload.businessId,
        monthKey,
        totalDocuments: summary.month.documents,
        totalAmountCents: summary.month.amountCents,
        deliveredAt: null,
        createdAt: nowIso(),
      });
    }

    this.save();
    return {
      businessId: payload.businessId,
      foundInvoices: summary.totals.documents,
      totalAmountCents: summary.totals.amountCents,
      accountantName: summary.business.accountantName,
      summary,
    };
  }

  getDashboardSummary(businessId: string) {
    return this.buildSummary(businessId);
  }

  getDashboardDocuments(businessId: string, status: keyof typeof STATUS_MAP) {
    this.getBusinessOrThrow(businessId);
    const target = STATUS_MAP[status];
    const documents = this.data.documents
      .filter((entry) => entry.businessId === businessId && (target ? entry.status === target : true))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

    return {
      businessId,
      documents: documents.map((entry) => {
        const inbox = this.data.inboxConnections.find((item) => item.id === entry.inboxConnectionId);
        return {
          id: entry.id,
          vendor: entry.vendorName,
          amountCents: entry.amountCents,
          currency: entry.currency,
          issuedAt: entry.issuedAt,
          category: entry.category ?? "כללי",
          status: entry.status.toLowerCase(),
          source: entry.source.toLowerCase(),
          provider: (inbox?.provider ?? "WHATSAPP").toLowerCase(),
          type: entry.type.toLowerCase(),
          confidence: entry.confidence,
        };
      }),
    };
  }

  getDashboardDocumentDetail(businessId: string, documentId: string) {
    this.getBusinessOrThrow(businessId);
    const document = this.data.documents.find((entry) => entry.businessId === businessId && entry.id === documentId);
    if (!document) {
      throw new Error("Document not found");
    }
    const inbox = this.data.inboxConnections.find((entry) => entry.id === document.inboxConnectionId);
    return {
      id: document.id,
      businessId: document.businessId,
      vendor: document.vendorName,
      amountCents: document.amountCents,
      currency: document.currency,
      vatCents: document.vatCents,
      issuedAt: document.issuedAt,
      status: document.status.toLowerCase(),
      source: document.source.toLowerCase(),
      provider: (inbox?.provider ?? "WHATSAPP").toLowerCase(),
      type: document.type.toLowerCase(),
      category: document.category ?? "כללי",
      confidence: document.confidence,
      rawText: document.rawText,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  exportDashboardCsv(businessId: string, status: keyof typeof STATUS_MAP = "all") {
    const rows = this.getDashboardDocuments(businessId, status).documents;
    const header = ["id", "vendor", "amount_cents", "currency", "issued_at", "category", "status", "source", "provider", "type", "confidence"].join(",");
    const body = rows.map((row) =>
      [
        escapeCsv(row.id),
        escapeCsv(row.vendor),
        escapeCsv(row.amountCents),
        escapeCsv(row.currency),
        escapeCsv(row.issuedAt),
        escapeCsv(row.category),
        escapeCsv(row.status),
        escapeCsv(row.source),
        escapeCsv(row.provider),
        escapeCsv(row.type),
        escapeCsv(row.confidence),
      ].join(",")
    );
    return [header, ...body].join("\n");
  }

  getDashboardChat(businessId: string) {
    this.getBusinessOrThrow(businessId);
    const messages = this.data.conversationMessages
      .filter((entry) => entry.businessId === businessId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-50);
    return {
      businessId,
      messages: messages.map((entry) => ({
        id: entry.id,
        from: entry.direction === "USER" ? "user" : "bot",
        text: entry.text,
        channel: entry.channel.toLowerCase(),
        createdAt: entry.createdAt,
      })),
    };
  }

  async postDashboardChat(payload: { businessId: string; text: string; userId?: string }) {
    const business = this.getBusinessOrThrow(payload.businessId);
    this.data.conversationMessages.push({
      id: randomUUID(),
      businessId: payload.businessId,
      userId: payload.userId ?? null,
      channel: "WEBCHAT",
      direction: "USER",
      text: payload.text,
      createdAt: nowIso(),
    });

    const summary = this.buildSummary(payload.businessId);

    let replyText: string;
    try {
      const { isAiEnabled, chatResponse } = await import("./services/ai");
      if (isAiEnabled()) {
        const recentMsgs = this.data.conversationMessages
          .filter((m) => m.businessId === payload.businessId)
          .slice(-10)
          .map((m) => ({
            role: m.direction === "USER" ? "user" as const : "assistant" as const,
            text: m.text,
          }));
        const recentDocs = this.data.documents
          .filter((d) => d.businessId === payload.businessId)
          .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
          .slice(0, 20)
          .map((d) => ({
            vendor: d.vendorName,
            amountCents: d.amountCents,
            category: d.category,
            status: d.status,
            issuedAt: d.issuedAt,
          }));
        replyText = await chatResponse(payload.businessId, payload.text, recentMsgs, {
          businessName: summary.business.name,
          accountantName: summary.business.accountantName,
          summary,
          recentDocs,
        });
      } else {
        throw new Error("AI not enabled");
      }
    } catch {
      replyText = payload.text.toLowerCase().includes("קיבל")
        ? `נשלחו ${summary.totals.sent} מסמכים ל-${summary.business.accountantName}.`
        : `החודש נקלטו ${summary.month.documents} מסמכים בסך ${(summary.month.amountCents / 100).toLocaleString("he-IL")} ש"ח.`;
    }

    const reply = {
      id: randomUUID(),
      businessId: payload.businessId,
      userId: payload.userId ?? null,
      channel: "WEBCHAT" as MessageChannel,
      direction: "BOT" as MessageDirection,
      text: replyText,
      createdAt: nowIso(),
    };
    this.data.conversationMessages.push(reply);
    business.updatedAt = nowIso();
    this.save();

    return {
      businessId: payload.businessId,
      reply: {
        id: reply.id,
        from: "bot",
        text: reply.text,
        createdAt: reply.createdAt,
      },
    };
  }

  getSettings(businessId: string) {
    const business = this.getBusinessOrThrow(businessId);
    const owner = this.getOwnerForBusiness(businessId);
    const accountant = this.ensureAccountantContact(businessId, business.accountantDisplayName);
    const flags = this.integrationStatus(businessId);
    const whatsappIntegration = this.getWhatsAppIntegration(businessId);
    const whatsappIntegrationName = whatsappIntegration?.provider === "BAILEYS"
      ? "WhatsApp (Baileys)"
      : "WhatsApp Cloud API";
    return {
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
        currency: business.currency,
        timezone: business.timezone,
      },
      owner: owner
        ? {
            id: owner.id,
            email: owner.email,
            fullName: owner.fullName,
            phone: owner.phone,
            preferredLanguage: owner.preferredLanguage,
          }
        : null,
      inboxes: this.serializeConnectedInboxes(businessId),
      accountant: {
        name: accountant.name,
        email: accountant.email,
        phone: accountant.phone,
        firmName: accountant.firmName,
        monthlyDeliveryDay: accountant.monthlyDeliveryDay,
        autoMonthlyDelivery: accountant.autoMonthlyDelivery,
      },
      whatsapp: this.serializeWhatsAppIntegration(businessId),
      integrations: [
        { name: "Gmail OAuth", connected: flags.gmailConnected },
        { name: "Outlook OAuth", connected: flags.outlookConnected },
        { name: whatsappIntegrationName, connected: flags.whatsappConnected },
        { name: "Google Drive", connected: false },
      ],
    };
  }

  updateAccountSettings(payload: {
    businessId: string;
    fullName?: string;
    email?: string;
    phone?: string | null;
    businessName?: string;
    preferredLanguage?: string;
    currency?: string;
  }) {
    const business = this.getBusinessOrThrow(payload.businessId);
    const owner = this.getOwnerForBusiness(payload.businessId);
    if (!owner) {
      throw new Error("Business owner not found");
    }

    if (payload.email && normalizeEmail(payload.email) !== owner.email) {
      const email = normalizeEmail(payload.email);
      const exists = this.data.users.some((entry) => entry.email === email && entry.id !== owner.id);
      if (exists) {
        throw new Error("Email is already in use");
      }
      owner.email = email;
    }
    if (payload.fullName !== undefined) {
      owner.fullName = payload.fullName?.trim() || null;
    }
    if (payload.phone !== undefined) {
      owner.phone = payload.phone?.trim() || null;
    }
    if (payload.preferredLanguage !== undefined) {
      owner.preferredLanguage = payload.preferredLanguage;
    }
    if (payload.businessName?.trim()) {
      business.name = payload.businessName.trim();
    }
    if (payload.currency?.trim()) {
      business.currency = payload.currency.trim().toUpperCase();
    }
    owner.updatedAt = nowIso();
    business.updatedAt = nowIso();
    this.save();
    return this.getSettings(payload.businessId);
  }

  updateAccountantSettings(payload: {
    businessId: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    firmName?: string | null;
    monthlyDeliveryDay?: number;
    autoMonthlyDelivery?: boolean;
  }) {
    const business = this.getBusinessOrThrow(payload.businessId);
    const accountant = this.ensureAccountantContact(payload.businessId, business.accountantDisplayName);
    if (payload.name?.trim()) {
      accountant.name = payload.name.trim();
      business.accountantDisplayName = accountant.name;
    }
    if (payload.email !== undefined) {
      accountant.email = payload.email?.trim() || null;
    }
    if (payload.phone !== undefined) {
      accountant.phone = payload.phone?.trim() || null;
    }
    if (payload.firmName !== undefined) {
      accountant.firmName = payload.firmName?.trim() || null;
    }
    if (payload.monthlyDeliveryDay !== undefined) {
      accountant.monthlyDeliveryDay = payload.monthlyDeliveryDay;
    }
    if (payload.autoMonthlyDelivery !== undefined) {
      accountant.autoMonthlyDelivery = payload.autoMonthlyDelivery;
    }
    accountant.updatedAt = nowIso();
    business.updatedAt = nowIso();
    this.save();
    return this.getSettings(payload.businessId);
  }

  disconnectInbox(payload: { businessId: string; inboxId: string }) {
    this.getBusinessOrThrow(payload.businessId);
    const index = this.data.inboxConnections.findIndex(
      (entry) => entry.businessId === payload.businessId && entry.id === payload.inboxId,
    );
    if (index < 0) {
      throw new Error("Inbox not found");
    }
    const [removed] = this.data.inboxConnections.splice(index, 1);
    this.data.documents = this.data.documents.map((entry) =>
      entry.inboxConnectionId === removed.id ? { ...entry, inboxConnectionId: null, updatedAt: nowIso() } : entry
    );
    if (removed.oauthConnectionId) {
      const stillUsed = this.data.inboxConnections.some((entry) => entry.oauthConnectionId === removed.oauthConnectionId);
      if (!stillUsed) {
        this.data.oauthConnections = this.data.oauthConnections.filter((entry) => entry.id !== removed.oauthConnectionId);
      }
    }
    this.save();
    return {
      businessId: payload.businessId,
      connectedInboxes: this.serializeConnectedInboxes(payload.businessId),
    };
  }

  // ─── new methods for sync ───

  getInboxConnection(id: string) {
    const entry = this.data.inboxConnections.find((e) => e.id === id);
    return entry ? { ...entry, gmailHistoryId: (entry as any).gmailHistoryId ?? null } : null;
  }

  getOAuthConnection(id: string) {
    return this.data.oauthConnections.find((e) => e.id === id) ?? null;
  }

  updateOAuthTokens(id: string, tokens: { accessToken: string; refreshToken: string | null; expiresAt: string | null }) {
    const entry = this.data.oauthConnections.find((e) => e.id === id);
    if (!entry) return;
    entry.accessToken = tokens.accessToken;
    entry.refreshToken = tokens.refreshToken ?? entry.refreshToken;
    entry.expiresAt = tokens.expiresAt;
    entry.updatedAt = nowIso();
    this.save();
  }

  getGmailInboxes(businessId: string) {
    return this.data.inboxConnections.filter(
      (e) => e.businessId === businessId && e.provider === "GMAIL" && e.status === "CONNECTED"
        && e.authMethod === "OAUTH" && e.oauthConnectionId,
    ).map((e) => ({ ...e, gmailHistoryId: (e as any).gmailHistoryId ?? null }));
  }

  hasDocumentForGmailMessage(businessId: string, gmailMessageId: string): boolean {
    return this.data.documents.some(
      (e) => e.businessId === businessId && (e as any).gmailMessageId === gmailMessageId,
    );
  }

  createDocument(doc: {
    businessId: string; inboxConnectionId?: string | null; source: string; type: string;
    status: string; vendorName: string; amountCents: number; currency: string;
    vatCents?: number | null; issuedAt: string; confidence: number;
    category?: string | null; rawText?: string | null; gmailMessageId?: string | null;
  }) {
    const timestamp = nowIso();
    const record = {
      id: randomUUID(),
      businessId: doc.businessId,
      inboxConnectionId: doc.inboxConnectionId ?? null,
      source: doc.source as DocumentSource,
      type: doc.type as DocumentType,
      status: doc.status as DocumentStatus,
      vendorName: doc.vendorName,
      amountCents: doc.amountCents,
      currency: doc.currency,
      vatCents: doc.vatCents ?? null,
      issuedAt: doc.issuedAt,
      confidence: doc.confidence,
      category: doc.category ?? null,
      rawText: doc.rawText ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.data.documents.push(record as any);
    this.save();
    return { id: record.id };
  }

  updateInboxSyncCursor(inboxConnectionId: string, gmailHistoryId: string) {
    const entry = this.data.inboxConnections.find((e) => e.id === inboxConnectionId);
    if (entry) {
      (entry as any).gmailHistoryId = gmailHistoryId;
      entry.lastSyncAt = nowIso();
      entry.updatedAt = nowIso();
      this.save();
    }
  }

  getConnectedWhatsAppIntegrations() {
    return this.data.whatsappIntegrations
      .filter((e) => e.status === "CONNECTED" && e.provider === "BAILEYS")
      .map((e) => ({
        id: e.id,
        businessId: e.businessId,
        provider: e.provider,
        customerPhoneE164: e.customerPhoneE164,
        customerName: e.customerName,
        status: e.status,
      }));
  }

  getAccountantForBusiness(businessId: string) {
    const business = this.getBusinessOrThrow(businessId);
    return this.ensureAccountantContact(businessId, business.accountantDisplayName);
  }

  markDocumentsSent(businessId: string, documentIds: string[]) {
    let count = 0;
    for (const doc of this.data.documents) {
      if (doc.businessId === businessId && documentIds.includes(doc.id) && doc.status !== "SENT") {
        doc.status = "SENT";
        doc.updatedAt = new Date().toISOString();
        count++;
      }
    }
    this.save();
    return count;
  }

  updateDocument(businessId: string, documentId: string, updates: {
    category?: string;
    comments?: string | null;
    amountCents?: number;
    vendorName?: string;
    status?: string;
  }) {
    this.getBusinessOrThrow(businessId);
    const doc = this.data.documents.find((d) => d.businessId === businessId && d.id === documentId);
    if (!doc) throw new Error("Document not found");
    if (updates.category !== undefined) doc.category = updates.category;
    if (updates.comments !== undefined) (doc as any).comments = updates.comments;
    if (updates.amountCents !== undefined) doc.amountCents = updates.amountCents;
    if (updates.vendorName !== undefined) doc.vendorName = updates.vendorName;
    if (updates.status !== undefined) doc.status = updates.status.toUpperCase() as any;
    doc.updatedAt = nowIso();
    this.save();
    return this.getDashboardDocumentDetail(businessId, documentId);
  }

  createDocumentFromWhatsApp(payload: { businessId: string; filename: string; mimetype: string; caption: string }) {
    const isImage = payload.mimetype.startsWith("image/");
    const isPdf = payload.mimetype === "application/pdf";
    const type = isPdf || isImage ? "INVOICE" : "RECEIPT";
    return this.createDocument({
      businessId: payload.businessId,
      source: "WHATSAPP",
      type,
      status: "PENDING",
      vendorName: payload.caption || payload.filename || "WhatsApp Media",
      amountCents: 0,
      currency: "ILS",
      issuedAt: new Date().toISOString(),
      confidence: 0.3,
      rawText: payload.caption || null,
    });
  }

  // ─── billing stubs (requires Postgres) ───

  async getBusinessBilling(): Promise<any> { return { stripeCustomerId: null, subscriptionStatus: "free", onboardingPaid: false }; }
  async updateBusinessBilling(): Promise<void> {}
  async getBusinessByStripeCustomerId(): Promise<any> { return null; }

  // ─── deep scan stubs (requires Postgres) ───

  async createScanJob(): Promise<any> { throw new Error("Deep scan requires DATABASE_URL"); }
  async getActiveScanJob(): Promise<any> { return null; }
  async getScanJob(): Promise<any> { return null; }
  async getAllActiveScanJobs(): Promise<any[]> { return []; }
  async updateScanJob(): Promise<void> {}
  async insertScanMessages(): Promise<number> { return 0; }
  async claimPendingMessages(): Promise<any[]> { return []; }
  async claimAiMessages(): Promise<any[]> { return []; }
  async updateScanMessage(): Promise<void> {}
  async getScanQueueCountByStatus(): Promise<any> { return {}; }
  async hasActiveScanForInbox(): Promise<boolean> { return false; }
  async getLatestCompletedScanJob(): Promise<any> { return null; }
}

import { AppStorePg } from "./store-pg";
import { env } from "./config";

export const store: any = env.DATABASE_URL ? new AppStorePg() : new AppStore();

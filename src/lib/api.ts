export type InboxProvider = "gmail" | "outlook" | "imap" | "yahoo" | "icloud";
export type OAuthProvider = "gmail" | "outlook";
export type DocumentFilter = "all" | "sent" | "pending" | "review";

export interface ConnectedInbox {
  id: string;
  email: string;
  provider: InboxProvider;
  status: string;
  authMethod?: string;
  lastSyncAt: string | null;
  invoicesFound?: number;
}

export interface OnboardingStateResponse {
  user: {
    id: string;
    email: string;
    fullName: string | null;
  } | null;
  business: {
    id: string;
    name: string;
    accountantName: string;
  };
  connectedInboxes: ConnectedInbox[];
  whatsapp: {
    id: string;
    provider: string;
    customerPhoneE164: string | null;
    customerName: string | null;
    status: string;
    businessPhoneNumberId: string | null;
    wabaId: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastError: string | null;
  } | null;
  nextStep: string;
}

export interface OnboardingStartPayload {
  email?: string;
  fullName?: string;
  businessName?: string;
  accountantName?: string;
  accountantEmail?: string;
}

export interface BillingStatus {
  onboardingPaid: boolean;
  subscriptionStatus: string;
  billingEnabled: boolean;
}

export interface DashboardSummaryResponse {
  business: {
    id: string;
    name: string;
    accountantName: string;
  };
  billing?: {
    onboardingPaid: boolean;
    subscriptionStatus: string;
  };
  totals: {
    documents: number;
    amountCents: number;
    sent: number;
    pending: number;
    review: number;
    connectedInboxes: number;
  };
  month: {
    documents: number;
    amountCents: number;
    documentsDelta: number;
    amountDeltaPercent: number;
  };
}

export interface DashboardDocument {
  id: string;
  vendor: string;
  amountCents: number;
  currency: string;
  issuedAt: string;
  category: string;
  status: "sent" | "pending" | "review";
  source: "email" | "whatsapp";
  provider: string;
  type?: string;
  confidence?: number;
}

export interface DashboardDocumentDetail extends DashboardDocument {
  businessId: string;
  vatCents: number | null;
  rawText: string | null;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentUpdate {
  category?: string;
  comments?: string | null;
  amountCents?: number;
  vendorName?: string;
  status?: "sent" | "pending" | "review";
}

export interface DashboardChatMessage {
  id: string;
  from: "user" | "bot";
  text: string;
  channel?: string;
  createdAt: string;
}

export interface SettingsResponse {
  business: {
    id: string;
    name: string;
    accountantName: string;
    currency: string;
    timezone: string;
  };
  owner: {
    id: string;
    email: string;
    fullName: string | null;
    phone: string | null;
    preferredLanguage: string;
  } | null;
  inboxes: ConnectedInbox[];
  accountant: {
    name: string;
    email: string | null;
    phone: string | null;
    firmName: string | null;
    monthlyDeliveryDay: number;
    autoMonthlyDelivery: boolean;
  };
  whatsapp: OnboardingStateResponse["whatsapp"];
  integrations: Array<{ name: string; connected: boolean }>;
}

export interface WhatsAppSessionResponse {
  provider: "baileys" | "cloudapi";
  status: "idle" | "connecting" | "qr" | "connected" | "failed" | string;
  businessId: string;
  mainPhoneE164: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
  connectedJid: string | null;
  updatedAt: string | null;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}`;
    let message = fallbackMessage;
    try {
      const payload = await response.json();
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Ignore json parse failures.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function getOAuthStartUrl(
  businessId: string,
  provider: OAuthProvider,
): Promise<{ provider: OAuthProvider; authUrl: string }> {
  return apiRequest(`/oauth/${provider}/start?businessId=${encodeURIComponent(businessId)}`);
}

export function startOnboarding(payload: OnboardingStartPayload): Promise<OnboardingStateResponse> {
  return apiRequest("/onboarding/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getOnboardingState(businessId: string): Promise<OnboardingStateResponse> {
  return apiRequest(`/onboarding/state/${businessId}`);
}

export function connectInbox(payload: {
  businessId: string;
  provider: InboxProvider;
  email?: string;
}): Promise<{ businessId: string; connectedInboxes: ConnectedInbox[] }> {
  return apiRequest("/onboarding/connect-inbox", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runInitialScan(payload: {
  businessId: string;
}): Promise<{
  businessId: string;
  foundInvoices: number;
  totalAmountCents: number;
  accountantName: string;
  summary: DashboardSummaryResponse;
}> {
  return apiRequest("/onboarding/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function connectWhatsAppIntegration(payload: {
  businessId: string;
  phoneE164: string;
  customerName?: string;
}): Promise<{
  businessId: string;
  provider: "baileys" | "cloudapi";
  integration: OnboardingStateResponse["whatsapp"];
  session: WhatsAppSessionResponse | null;
}> {
  return apiRequest("/whatsapp/connect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getWhatsAppSession(
  businessId: string,
): Promise<WhatsAppSessionResponse> {
  return apiRequest(`/whatsapp/session/${businessId}`);
}

export function sendWhatsAppMessage(payload: {
  businessId: string;
  text: string;
}): Promise<{ ok: true }> {
  return apiRequest("/whatsapp/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDashboardSummary(businessId: string): Promise<DashboardSummaryResponse> {
  return apiRequest(`/dashboard/${businessId}/summary`);
}

export function syncDashboard(
  businessId: string,
): Promise<{ newDocuments: number; summary: DashboardSummaryResponse }> {
  return apiRequest(`/dashboard/${businessId}/sync`, { method: "POST" });
}

export function sendToAccountant(
  businessId: string,
): Promise<{ sent: boolean; emailId?: string; documentCount?: number; accountantEmail?: string; message?: string }> {
  return apiRequest(`/dashboard/${businessId}/send-to-accountant`, { method: "POST" });
}

export function getDashboardDocuments(
  businessId: string,
  status: DocumentFilter,
): Promise<{ businessId: string; documents: DashboardDocument[] }> {
  return apiRequest(`/dashboard/${businessId}/documents?status=${status}`);
}

export function getDashboardDocumentDetail(
  businessId: string,
  documentId: string,
): Promise<DashboardDocumentDetail> {
  return apiRequest(`/dashboard/${businessId}/documents/${documentId}`);
}

export async function downloadDashboardExport(
  businessId: string,
  status: DocumentFilter,
): Promise<Blob> {
  const response = await fetch(`/api/dashboard/${businessId}/export?format=csv&status=${status}`);
  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}`);
  }
  return response.blob();
}

export function getDashboardChat(
  businessId: string,
): Promise<{ businessId: string; messages: DashboardChatMessage[] }> {
  return apiRequest(`/dashboard/${businessId}/chat`);
}

export function postDashboardChat(
  businessId: string,
  text: string,
): Promise<{ businessId: string; reply: DashboardChatMessage }> {
  return apiRequest(`/dashboard/${businessId}/chat`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function getSettings(businessId: string): Promise<SettingsResponse> {
  return apiRequest(`/settings/${businessId}`);
}

export function updateSettingsAccount(
  businessId: string,
  payload: {
    fullName?: string;
    email?: string;
    phone?: string | null;
    businessName?: string;
    preferredLanguage?: string;
    currency?: string;
  },
): Promise<SettingsResponse> {
  return apiRequest(`/settings/${businessId}/account`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateSettingsAccountant(
  businessId: string,
  payload: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    firmName?: string | null;
    monthlyDeliveryDay?: number;
    autoMonthlyDelivery?: boolean;
  },
): Promise<SettingsResponse> {
  return apiRequest(`/settings/${businessId}/accountant`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function disconnectInbox(
  businessId: string,
  inboxId: string,
): Promise<{ businessId: string; connectedInboxes: ConnectedInbox[] }> {
  return apiRequest(`/settings/${businessId}/inboxes/${inboxId}`, {
    method: "DELETE",
  });
}

export function updateDocument(
  businessId: string,
  documentId: string,
  updates: DocumentUpdate,
): Promise<DashboardDocumentDetail> {
  return apiRequest(`/dashboard/${businessId}/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function downloadMonthlyPdf(
  businessId: string,
  month?: string,
): Promise<Blob> {
  const params = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await fetch(`/api/dashboard/${businessId}/monthly-pdf${params}`);
  if (!response.ok) {
    throw new Error(`PDF download failed with status ${response.status}`);
  }
  return response.blob();
}

// ─── Deep Scan ───

export interface DeepScanStatus {
  active: boolean;
  scanJobId?: string;
  status?: string;
  currentPass?: string;
  discovery?: {
    totalFound: number;
    isComplete: boolean;
  };
  processing?: {
    total: number;
    processed: number;
    created: number;
    skipped: number;
    errors: number;
    percent: number;
  };
  ai?: {
    total: number;
    processed: number;
    percent: number;
  };
  lastError?: string | null;
  startedAt?: string;
  updatedAt?: string;
}

export function startDeepScan(
  businessId: string,
): Promise<{ scanJobId: string; status: string; message: string }> {
  return apiRequest(`/deep-scan/${businessId}/start`, { method: "POST" });
}

export function getDeepScanStatus(businessId: string): Promise<DeepScanStatus> {
  return apiRequest(`/deep-scan/${businessId}/status`);
}

export function pauseDeepScan(
  businessId: string,
): Promise<{ scanJobId: string; status: string }> {
  return apiRequest(`/deep-scan/${businessId}/pause`, { method: "POST" });
}

export function resumeDeepScan(
  businessId: string,
): Promise<{ scanJobId: string; status: string }> {
  return apiRequest(`/deep-scan/${businessId}/resume`, { method: "POST" });
}

// ─── Categories (auto-categorization) ───

export interface CategoriesResponse {
  categories: string[];
  vendorMappings: Array<{ vendorNameOriginal: string; category: string; correctionCount: number }>;
}

export function getDashboardCategories(businessId: string): Promise<CategoriesResponse> {
  return apiRequest(`/dashboard/${businessId}/categories`);
}

// ─── Missing Receipt Alerts ───

export interface MissingReceiptAlert {
  id: string;
  businessId: string;
  vendorPatternId: string;
  expectedMonth: string;
  status: string;
  vendorName: string;
  avgAmountCents: number;
  createdAt: string;
}

export function getDashboardAlerts(
  businessId: string,
): Promise<{ businessId: string; alerts: MissingReceiptAlert[] }> {
  return apiRequest(`/dashboard/${businessId}/alerts`);
}

export function dismissAlert(
  businessId: string,
  alertId: string,
): Promise<{ ok: boolean }> {
  return apiRequest(`/dashboard/${businessId}/alerts/${alertId}/dismiss`, { method: "PATCH" });
}

// ─── Billing ───

export function getBillingStatus(businessId: string): Promise<BillingStatus> {
  return apiRequest(`/billing/${businessId}/status`);
}

export function createCheckoutSession(
  businessId: string,
): Promise<{ checkoutUrl?: string; alreadyPaid?: boolean }> {
  return apiRequest(`/billing/${businessId}/create-checkout`, { method: "POST" });
}

export function createBillingPortal(
  businessId: string,
): Promise<{ portalUrl: string }> {
  return apiRequest(`/billing/${businessId}/portal`, { method: "POST" });
}

// ─── Auth ───

export interface AuthResponse {
  token: string;
  userId: string;
  businessId: string;
  email: string;
}

export function signupBusinessOwner(payload: {
  businessId: string;
  email: string;
  password: string;
  fullName?: string;
}): Promise<AuthResponse> {
  return apiRequest("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginBusinessOwner(payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

import { getAccountantToken } from "./accountant-session";
import type { DashboardSummaryResponse, DashboardDocument, DocumentFilter } from "./api";

async function accountantRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccountantToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 401) {
    throw new Error("Session expired — please login again");
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export interface AccountantClient {
  businessId: string;
  businessName: string;
  pendingCount: number;
  reviewCount: number;
  sentCount: number;
  totalCount: number;
  lastDocumentAt: string | null;
  health: "green" | "yellow" | "red";
}

export function sendMagicLink(email: string): Promise<{ ok: boolean; message: string }> {
  return fetch("/api/accountant/auth/send-magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((r) => r.json());
}

export function verifyMagicLink(token: string): Promise<{ ok: boolean; token: string; email: string }> {
  return fetch("/api/accountant/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).then((r) => {
    if (!r.ok) throw new Error("Invalid or expired link");
    return r.json();
  });
}

export function getAccountantClients(): Promise<{ email: string; clients: AccountantClient[] }> {
  return accountantRequest("/accountant/clients");
}

export function getClientSummary(businessId: string): Promise<DashboardSummaryResponse> {
  return accountantRequest(`/accountant/clients/${businessId}/summary`);
}

export function getClientDocuments(
  businessId: string,
  status: DocumentFilter = "all",
): Promise<{ businessId: string; documents: DashboardDocument[] }> {
  return accountantRequest(`/accountant/clients/${businessId}/documents?status=${status}`);
}

export async function downloadClientMonthlyPdf(businessId: string, month?: string): Promise<Blob> {
  const token = getAccountantToken();
  if (!token) throw new Error("Not authenticated");

  const params = month ? `?month=${encodeURIComponent(month)}` : "";
  const response = await fetch(`/api/accountant/clients/${businessId}/monthly-pdf${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("PDF download failed");
  return response.blob();
}

export async function downloadClientExport(businessId: string, status: DocumentFilter = "all"): Promise<Blob> {
  const token = getAccountantToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(`/api/accountant/clients/${businessId}/export?format=csv&status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Export failed");
  return response.blob();
}

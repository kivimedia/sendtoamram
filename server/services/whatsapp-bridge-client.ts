import { env } from "../config";

function getBridgeUrl(): string {
  if (!env.WHATSAPP_BRIDGE_URL) {
    throw new Error("WHATSAPP_BRIDGE_URL is not configured");
  }
  return env.WHATSAPP_BRIDGE_URL.replace(/\/$/, "");
}


async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getBridgeUrl()}${path}`;
  const headers: Record<string, string> = {};
  if (env.WHATSAPP_BRIDGE_SECRET) {
    headers["X-Bridge-Secret"] = env.WHATSAPP_BRIDGE_SECRET;
  }
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    headers,
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bridge API ${path} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

export interface BridgeSessionStatus {
  businessId: string;
  status: "idle" | "connecting" | "qr" | "connected" | "failed";
  qrDataUrl: string | null;
  connectedJid: string | null;
  lastError: string | null;
}

/**
 * Start a Baileys session for a business, triggers QR code generation.
 */
export async function bridgeConnect(
  businessId: string,
): Promise<BridgeSessionStatus> {
  return bridgeFetch(`/sessions/${businessId}/connect`, {
    method: "POST",
  });
}

/**
 * Get session status (QR code, connected status, etc.)
 */
export async function bridgeGetStatus(
  businessId: string,
): Promise<BridgeSessionStatus> {
  return bridgeFetch(`/sessions/${businessId}/status`);
}

/**
 * Send a text message via the bridge.
 */
export async function bridgeSendText(
  businessId: string,
  to: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string }> {
  return bridgeFetch(`/sessions/${businessId}/send`, {
    method: "POST",
    body: JSON.stringify({ to, text }),
  });
}

/**
 * Disconnect/destroy a Baileys session.
 */
export async function bridgeDisconnect(
  businessId: string,
): Promise<{ ok: boolean }> {
  return bridgeFetch(`/sessions/${businessId}`, {
    method: "DELETE",
  });
}

/**
 * Check if the bridge service is reachable.
 */
export async function bridgeHealthCheck(): Promise<boolean> {
  try {
    const data: any = await bridgeFetch("/health");
    return data.ok === true;
  } catch {
    return false;
  }
}

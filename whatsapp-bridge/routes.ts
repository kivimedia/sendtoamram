import { FastifyInstance } from "fastify";
import {
  startSession,
  getSessionStatus,
  sendMessage,
  disconnectSession,
  listActiveSessions,
} from "./sessions";

interface BridgeConfig {
  webhookUrl: string;
  bridgeSecret: string;
}

export function registerBridgeRoutes(app: FastifyInstance, config: BridgeConfig): void {
  // Callback for inbound messages → forward to Vercel webhook
  function onInboundMessage(
    businessId: string,
    fromPhone: string,
    text?: string,
    imageBase64?: string,
    mimeType?: string,
  ): void {
    if (!config.webhookUrl) {
      console.log(`[bridge] No webhook URL configured, skipping inbound from ${fromPhone}`);
      return;
    }

    const body: Record<string, any> = { businessId, fromPhone };
    if (text) body.text = text;
    if (imageBase64) {
      body.imageBase64 = imageBase64;
      body.mimeType = mimeType;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.bridgeSecret) {
      headers["X-Bridge-Secret"] = config.bridgeSecret;
    }

    fetch(config.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }).catch((err) => {
      console.error(`[bridge] Failed to forward inbound to webhook:`, err);
    });
  }

  // Start/connect a session
  app.post<{ Params: { businessId: string } }>(
    "/sessions/:businessId/connect",
    async (request) => {
      const { businessId } = request.params;
      await startSession(businessId, onInboundMessage);
      return getSessionStatus(businessId);
    },
  );

  // Get session status
  app.get<{ Params: { businessId: string } }>(
    "/sessions/:businessId/status",
    async (request) => {
      const { businessId } = request.params;
      return getSessionStatus(businessId);
    },
  );

  // Send a text message
  app.post<{ Params: { businessId: string }; Body: { to: string; text: string } }>(
    "/sessions/:businessId/send",
    async (request) => {
      const { businessId } = request.params;
      const { to, text } = request.body;
      return sendMessage(businessId, to, text);
    },
  );

  // Disconnect/destroy session
  app.delete<{ Params: { businessId: string } }>(
    "/sessions/:businessId",
    async (request) => {
      const { businessId } = request.params;
      await disconnectSession(businessId);
      return { ok: true };
    },
  );

  // List all active sessions
  app.get("/sessions", async () => {
    return { sessions: listActiveSessions() };
  });
}

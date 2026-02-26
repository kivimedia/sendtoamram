import { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config";
import {
  bridgeConnect,
  bridgeGetStatus,
  bridgeSendText,
  bridgeDisconnect,
  bridgeHealthCheck,
} from "../services/whatsapp-bridge-client";
import {
  handleWhatsAppInbound,
  handleWhatsAppMediaInbound,
} from "../services/whatsapp-chat";

const businessIdSchema = z.object({
  businessId: z.string().min(1),
});

const sendSchema = z.object({
  businessId: z.string().min(1),
  text: z.string().min(1),
});

const connectSchema = z.object({
  businessId: z.string().min(1),
  phoneE164: z.string().optional(),
  customerName: z.string().optional(),
});

const webhookInboundSchema = z.object({
  businessId: z.string().min(1),
  fromPhone: z.string().min(1),
  text: z.string().optional(),
  imageBase64: z.string().optional(),
  mimeType: z.string().optional(),
});

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  // Connect — start Baileys session via bridge
  app.post("/whatsapp/connect", async (request) => {
    const { businessId } = connectSchema.parse(request.body);

    if (!env.WHATSAPP_BRIDGE_URL) {
      throw new Error("WhatsApp bridge is not configured (missing WHATSAPP_BRIDGE_URL)");
    }

    const session = await bridgeConnect(businessId);
    return {
      businessId,
      provider: "baileys",
      session,
    };
  });

  // Get session status (QR code, connection state)
  app.get("/whatsapp/session/:businessId", async (request) => {
    const { businessId } = businessIdSchema.parse(request.params);

    if (!env.WHATSAPP_BRIDGE_URL) {
      return {
        provider: "baileys",
        status: "idle",
        businessId,
        mainPhoneE164: null,
        qrDataUrl: null,
        lastError: "WhatsApp bridge not configured",
        connectedJid: null,
        updatedAt: null,
      };
    }

    const session = await bridgeGetStatus(businessId);
    return {
      provider: "baileys",
      status: session.status,
      businessId,
      mainPhoneE164: null,
      qrDataUrl: session.qrDataUrl,
      lastError: session.lastError,
      connectedJid: session.connectedJid,
      updatedAt: new Date().toISOString(),
    };
  });

  // Send message
  app.post("/whatsapp/send", async (request) => {
    const { businessId, text } = sendSchema.parse(request.body);

    if (!env.WHATSAPP_BRIDGE_URL) {
      throw new Error("WhatsApp bridge is not configured");
    }

    const session = await bridgeGetStatus(businessId);
    if (session.status !== "connected" || !session.connectedJid) {
      throw new Error("WhatsApp session is not connected");
    }

    await bridgeSendText(businessId, session.connectedJid, text);
    return { ok: true };
  });

  // Disconnect session
  app.delete("/whatsapp/session/:businessId", async (request) => {
    const { businessId } = businessIdSchema.parse(request.params);
    await bridgeDisconnect(businessId);
    return { ok: true };
  });

  // Health check for bridge
  app.get("/whatsapp/bridge-health", async () => {
    const ok = await bridgeHealthCheck();
    return { ok, bridgeUrl: env.WHATSAPP_BRIDGE_URL ?? null };
  });

  // ─── Webhook: inbound messages from VPS bridge ───

  app.post("/whatsapp/webhook/inbound", async (request, reply) => {
    // Verify bridge secret
    const bridgeSecret = request.headers["x-bridge-secret"];
    if (env.WHATSAPP_BRIDGE_SECRET && bridgeSecret !== env.WHATSAPP_BRIDGE_SECRET) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const payload = webhookInboundSchema.parse(request.body);

    // Process asynchronously (don't block response)
    if (payload.imageBase64 && payload.mimeType) {
      handleWhatsAppMediaInbound(
        payload.businessId,
        payload.fromPhone,
        payload.imageBase64,
        payload.mimeType,
      ).catch((err) => console.error("[whatsapp-webhook] Media handler error:", err));
    } else if (payload.text) {
      handleWhatsAppInbound(
        payload.businessId,
        payload.fromPhone,
        payload.text,
      ).catch((err) => console.error("[whatsapp-webhook] Text handler error:", err));
    }

    return { ok: true };
  });
}

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as path from "path";
import * as fs from "fs";
import * as QRCode from "qrcode";

const SESSIONS_DIR = process.env.SESSIONS_DIR ?? "./sessions";

interface SessionInfo {
  socket: WASocket | null;
  status: "idle" | "connecting" | "qr" | "connected" | "failed";
  qrDataUrl: string | null;
  connectedJid: string | null;
  lastError: string | null;
  retryCount: number;
}

const sessions = new Map<string, SessionInfo>();

function getSessionDir(businessId: string): string {
  return path.join(SESSIONS_DIR, businessId);
}

function getSession(businessId: string): SessionInfo {
  if (!sessions.has(businessId)) {
    sessions.set(businessId, {
      socket: null,
      status: "idle",
      qrDataUrl: null,
      connectedJid: null,
      lastError: null,
      retryCount: 0,
    });
  }
  return sessions.get(businessId)!;
}

export function getSessionStatus(businessId: string): {
  businessId: string;
  status: string;
  qrDataUrl: string | null;
  connectedJid: string | null;
  lastError: string | null;
} {
  const session = getSession(businessId);
  return {
    businessId,
    status: session.status,
    qrDataUrl: session.qrDataUrl,
    connectedJid: session.connectedJid,
    lastError: session.lastError,
  };
}

export async function startSession(
  businessId: string,
  onInboundMessage?: (businessId: string, fromPhone: string, text?: string, imageBase64?: string, mimeType?: string) => void,
): Promise<SessionInfo> {
  const session = getSession(businessId);

  // Already connected or connecting
  if (session.status === "connected" || session.status === "connecting") {
    return session;
  }

  session.status = "connecting";
  session.lastError = null;
  session.qrDataUrl = null;

  const sessionDir = getSessionDir(businessId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ["SendToAmram", "Chrome", "1.0"],
    });

    session.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.status = "qr";
        session.qrDataUrl = await QRCode.toDataURL(qr);
        console.log(`[${businessId}] QR code generated`);
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        if (shouldReconnect && session.retryCount < 5) {
          session.retryCount++;
          session.status = "connecting";
          console.log(`[${businessId}] Reconnecting (attempt ${session.retryCount})...`);
          setTimeout(() => startSession(businessId, onInboundMessage), 3000);
        } else {
          session.status = "failed";
          session.lastError = `Connection closed: ${reason ?? "unknown"}`;
          session.socket = null;
          if (reason === DisconnectReason.loggedOut) {
            // Clean up session files
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
          console.log(`[${businessId}] Session ended: ${session.lastError}`);
        }
      }

      if (connection === "open") {
        session.status = "connected";
        session.connectedJid = socket.user?.id ?? null;
        session.retryCount = 0;
        session.qrDataUrl = null;
        console.log(`[${businessId}] Connected as ${session.connectedJid}`);
      }
    });

    // Handle inbound messages
    socket.ev.on("messages.upsert", async (m) => {
      if (!onInboundMessage) return;

      for (const msg of m.messages) {
        if (msg.key.fromMe) continue;
        const fromPhone = msg.key.remoteJid?.replace(/@.*$/, "") ?? "";
        if (!fromPhone) continue;

        // Text message
        const text = msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text;

        if (text) {
          onInboundMessage(businessId, fromPhone, text);
          continue;
        }

        // Image message
        const imageMessage = msg.message?.imageMessage;
        if (imageMessage) {
          try {
            const stream = await (socket as any).downloadMediaMessage(msg);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            const imageBuffer = Buffer.concat(chunks);
            const base64 = imageBuffer.toString("base64");
            const mimeType = imageMessage.mimetype ?? "image/jpeg";
            onInboundMessage(businessId, fromPhone, undefined, base64, mimeType);
          } catch (err) {
            console.error(`[${businessId}] Failed to download media:`, err);
          }
        }
      }
    });

    return session;
  } catch (error: any) {
    session.status = "failed";
    session.lastError = error.message;
    console.error(`[${businessId}] Failed to start session:`, error);
    return session;
  }
}

export async function sendMessage(
  businessId: string,
  to: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string }> {
  const session = getSession(businessId);
  if (session.status !== "connected" || !session.socket) {
    throw new Error("Session is not connected");
  }

  // Ensure phone number is in WhatsApp JID format
  const jid = to.includes("@") ? to : `${to.replace(/^\+/, "")}@s.whatsapp.net`;

  const result = await session.socket.sendMessage(jid, { text });
  return { ok: true, messageId: result?.key?.id };
}

export async function disconnectSession(businessId: string): Promise<void> {
  const session = getSession(businessId);
  if (session.socket) {
    session.socket.end(undefined);
    session.socket = null;
  }
  session.status = "idle";
  session.qrDataUrl = null;
  session.connectedJid = null;
  sessions.delete(businessId);
}

export function listActiveSessions(): Array<{
  businessId: string;
  status: string;
  connectedJid: string | null;
}> {
  return Array.from(sessions.entries()).map(([businessId, session]) => ({
    businessId,
    status: session.status,
    connectedJid: session.connectedJid,
  }));
}

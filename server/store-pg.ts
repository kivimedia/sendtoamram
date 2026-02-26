import { randomUUID } from "crypto";
import { pool } from "./db";
import type {
  OAuthProvider,
  InboxProvider,
  InboxStatus,
  InboxAuthMethod,
  DocumentSource,
  DocumentType,
  DocumentStatus,
  MessageDirection,
  MessageChannel,
  WhatsAppIntegrationStatus,
  WhatsAppProvider,
} from "./store";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, "");
  if (!compact) return "";
  return compact.startsWith("+") ? compact : `+${compact}`;
}

function monthKeyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function escapeCsv(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

const PROVIDER_MAP: Record<string, string> = {
  gmail: "GMAIL",
  outlook: "OUTLOOK",
  imap: "IMAP",
  yahoo: "YAHOO",
  icloud: "ICLOUD",
};

export class AppStorePg {
  // ─── helpers ───

  private async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  }

  private async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  private async getBusinessOrThrow(businessId: string) {
    const row = await this.queryOne(
      `SELECT id, name, accountant_display_name AS "accountantDisplayName",
              currency, timezone, onboarding_completed_at AS "onboardingCompletedAt",
              stripe_customer_id AS "stripeCustomerId",
              stripe_subscription_id AS "stripeSubscriptionId",
              subscription_status AS "subscriptionStatus",
              onboarding_paid AS "onboardingPaid",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM businesses WHERE id = $1`,
      [businessId],
    );
    if (!row) throw new Error("Business not found");
    return row;
  }

  private async getOwnerForBusiness(businessId: string) {
    return this.queryOne(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.phone,
              u.preferred_language AS "preferredLanguage",
              u.created_at AS "createdAt", u.updated_at AS "updatedAt"
       FROM users u
       JOIN business_members bm ON bm.user_id = u.id
       WHERE bm.business_id = $1 AND bm.role = 'OWNER'
       LIMIT 1`,
      [businessId],
    );
  }

  private async ensureAccountantContact(businessId: string, accountantName: string, accountantEmail?: string) {
    const existing = await this.queryOne(
      `SELECT * FROM accountant_contacts WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    if (existing) {
      if (accountantEmail && !existing.email) {
        await this.query(
          `UPDATE accountant_contacts SET email = $1, updated_at = now() WHERE id = $2`,
          [accountantEmail, existing.id],
        );
      }
      return this.queryOne(`SELECT * FROM accountant_contacts WHERE id = $1`, [existing.id]);
    }

    const id = randomUUID();
    await this.query(
      `INSERT INTO accountant_contacts (id, business_id, name, email)
       VALUES ($1, $2, $3, $4)`,
      [id, businessId, accountantName, accountantEmail ?? null],
    );
    return this.queryOne(`SELECT * FROM accountant_contacts WHERE id = $1`, [id]);
  }

  private async serializeConnectedInboxes(businessId: string) {
    const rows = await this.query(
      `SELECT ic.id, ic.email, ic.provider, ic.status, ic.auth_method AS "authMethod",
              ic.last_sync_at AS "lastSyncAt",
              COALESCE((SELECT COUNT(*) FROM documents d WHERE d.inbox_connection_id = ic.id), 0)::int AS "invoicesFound"
       FROM inbox_connections ic
       WHERE ic.business_id = $1 AND ic.status != 'DISCONNECTED'
       ORDER BY ic.created_at DESC`,
      [businessId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      provider: r.provider.toLowerCase(),
      status: r.status.toLowerCase(),
      authMethod: r.authMethod.toLowerCase(),
      lastSyncAt: r.lastSyncAt?.toISOString?.() ?? r.lastSyncAt,
      invoicesFound: r.invoicesFound,
    }));
  }

  private async serializeWhatsAppIntegration(businessId: string) {
    const row = await this.queryOne(
      `SELECT * FROM whatsapp_integrations WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider.toLowerCase(),
      customerPhoneE164: row.customer_phone_e164,
      customerName: row.customer_name,
      status: row.status.toLowerCase(),
      businessPhoneNumberId: row.business_phone_number_id,
      wabaId: row.waba_id,
      lastInboundAt: row.last_inbound_at?.toISOString?.() ?? row.last_inbound_at,
      lastOutboundAt: row.last_outbound_at?.toISOString?.() ?? row.last_outbound_at,
      lastError: row.last_error,
    };
  }

  private async integrationStatus(businessId: string) {
    const rows = await this.query(
      `SELECT provider, auth_method FROM inbox_connections
       WHERE business_id = $1 AND status = 'CONNECTED'`,
      [businessId],
    );
    const wa = await this.queryOne(
      `SELECT status FROM whatsapp_integrations WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    return {
      gmailConnected: rows.some((r: any) => r.provider === "GMAIL" && r.auth_method === "OAUTH"),
      outlookConnected: rows.some((r: any) => r.provider === "OUTLOOK" && r.auth_method === "OAUTH"),
      whatsappConnected: wa?.status === "CONNECTED",
    };
  }

  // ─── onboarding ───

  async startOnboarding(payload: {
    email?: string;
    fullName?: string;
    businessName?: string;
    accountantName?: string;
    accountantEmail?: string;
  }) {
    const email = normalizeEmail(payload.email ?? "demo@sendtoamram.co.il");
    const accountantName = payload.accountantName?.trim() || "עמרם";
    const accountantEmail = payload.accountantEmail?.trim() || undefined;

    let user = await this.queryOne(`SELECT * FROM users WHERE email = $1`, [email]);

    if (!user) {
      const userId = randomUUID();
      await this.query(
        `INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`,
        [userId, email, payload.fullName ?? null],
      );
      user = await this.queryOne(`SELECT * FROM users WHERE id = $1`, [userId]);
    } else if (payload.fullName !== undefined) {
      await this.query(
        `UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2`,
        [payload.fullName || null, user.id],
      );
      user = await this.queryOne(`SELECT * FROM users WHERE id = $1`, [user.id]);
    }

    let member = await this.queryOne(
      `SELECT * FROM business_members WHERE user_id = $1 AND role = 'OWNER' LIMIT 1`,
      [user.id],
    );

    let business: any;
    if (!member) {
      const businessId = randomUUID();
      await this.query(
        `INSERT INTO businesses (id, name, accountant_display_name) VALUES ($1, $2, $3)`,
        [businessId, payload.businessName?.trim() || "עסק חדש", accountantName],
      );
      business = await this.getBusinessOrThrow(businessId);

      const memberId = randomUUID();
      await this.query(
        `INSERT INTO business_members (id, business_id, user_id, role) VALUES ($1, $2, $3, 'OWNER')`,
        [memberId, businessId, user.id],
      );
      await this.ensureAccountantContact(businessId, accountantName, accountantEmail);
    } else {
      business = await this.getBusinessOrThrow(member.business_id);
      if (payload.businessName?.trim()) {
        await this.query(
          `UPDATE businesses SET name = $1, updated_at = now() WHERE id = $2`,
          [payload.businessName.trim(), business.id],
        );
      }
      if (payload.accountantName?.trim()) {
        await this.query(
          `UPDATE businesses SET accountant_display_name = $1, updated_at = now() WHERE id = $2`,
          [accountantName, business.id],
        );
        await this.query(
          `UPDATE accountant_contacts SET name = $1, updated_at = now() WHERE business_id = $2`,
          [accountantName, business.id],
        );
      }
      if (accountantEmail) {
        await this.query(
          `UPDATE accountant_contacts SET email = $1, updated_at = now() WHERE business_id = $2`,
          [accountantEmail, business.id],
        );
      }
      business = await this.getBusinessOrThrow(business.id);
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
      },
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
      },
      connectedInboxes: await this.serializeConnectedInboxes(business.id),
      whatsapp: await this.serializeWhatsAppIntegration(business.id),
      nextStep: "connect_inbox",
    };
  }

  async getOnboardingState(businessId: string) {
    const business = await this.getBusinessOrThrow(businessId);
    const owner = await this.getOwnerForBusiness(businessId);
    return {
      user: owner
        ? { id: owner.id, email: owner.email, fullName: owner.fullName }
        : null,
      business: {
        id: business.id,
        name: business.name,
        accountantName: business.accountantDisplayName,
      },
      connectedInboxes: await this.serializeConnectedInboxes(businessId),
      whatsapp: await this.serializeWhatsAppIntegration(businessId),
      nextStep: "connect_inbox",
    };
  }

  // ─── inbox ───

  async connectInbox(payload: {
    businessId: string;
    provider: string;
    email?: string;
  }) {
    await this.getBusinessOrThrow(payload.businessId);
    const provider = PROVIDER_MAP[payload.provider] ?? payload.provider;

    const existing = await this.query(
      `SELECT id FROM inbox_connections WHERE business_id = $1`,
      [payload.businessId],
    );
    const suffix = existing.length > 0 ? `+${existing.length + 1}` : "";
    const defaultEmail =
      payload.provider === "gmail" ? `you${suffix}@gmail.com`
      : payload.provider === "outlook" ? `you${suffix}@outlook.com`
      : payload.provider === "imap" ? `finance${suffix}@company.co.il`
      : payload.provider === "yahoo" ? `you${suffix}@yahoo.com`
      : `you${suffix}@icloud.com`;

    const email = normalizeEmail(payload.email ?? defaultEmail);
    const owner = await this.getOwnerForBusiness(payload.businessId);

    const inbox = await this.queryOne(
      `SELECT id FROM inbox_connections WHERE business_id = $1 AND LOWER(email) = $2`,
      [payload.businessId, email],
    );

    if (!inbox) {
      await this.query(
        `INSERT INTO inbox_connections (id, business_id, user_id, provider, email, status, auth_method, last_sync_at)
         VALUES ($1, $2, $3, $4, $5, 'CONNECTED', 'MANUAL', now())`,
        [randomUUID(), payload.businessId, owner?.id ?? null, provider, email],
      );
    } else {
      await this.query(
        `UPDATE inbox_connections SET provider = $1, status = 'CONNECTED', auth_method = 'MANUAL',
         oauth_connection_id = NULL, last_sync_at = now(), updated_at = now()
         WHERE id = $2`,
        [provider, inbox.id],
      );
    }

    return {
      businessId: payload.businessId,
      connectedInboxes: await this.serializeConnectedInboxes(payload.businessId),
    };
  }

  // ─── oauth inbox ───

  async upsertOAuthInbox(payload: {
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
    await this.getBusinessOrThrow(payload.businessId);
    const email = normalizeEmail(payload.email);
    const owner = await this.getOwnerForBusiness(payload.businessId);

    let oauthConn = await this.queryOne(
      `SELECT id, refresh_token FROM oauth_connections
       WHERE business_id = $1 AND provider = $2 AND LOWER(email) = $3`,
      [payload.businessId, payload.provider, email],
    );

    if (!oauthConn) {
      const oauthId = randomUUID();
      await this.query(
        `INSERT INTO oauth_connections
         (id, business_id, provider, external_account_id, email, access_token, refresh_token, token_type, scope, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          oauthId, payload.businessId, payload.provider, payload.externalAccountId,
          email, payload.accessToken, payload.refreshToken ?? null,
          payload.tokenType ?? null, payload.scope ?? null, payload.expiresAt ?? null,
        ],
      );
      oauthConn = { id: oauthId };
    } else {
      await this.query(
        `UPDATE oauth_connections SET
         external_account_id = $1, access_token = $2,
         refresh_token = COALESCE($3, refresh_token),
         token_type = COALESCE($4, token_type),
         scope = COALESCE($5, scope),
         expires_at = COALESCE($6, expires_at),
         updated_at = now()
         WHERE id = $7`,
        [
          payload.externalAccountId, payload.accessToken,
          payload.refreshToken, payload.tokenType,
          payload.scope, payload.expiresAt, oauthConn.id,
        ],
      );
    }

    const inboxProvider = payload.provider === "gmail" ? "GMAIL" : "OUTLOOK";
    let inbox = await this.queryOne(
      `SELECT id FROM inbox_connections WHERE business_id = $1 AND LOWER(email) = $2`,
      [payload.businessId, email],
    );

    if (!inbox) {
      await this.query(
        `INSERT INTO inbox_connections
         (id, business_id, user_id, provider, email, status, auth_method, oauth_connection_id, last_sync_at)
         VALUES ($1, $2, $3, $4, $5, 'CONNECTED', 'OAUTH', $6, now())`,
        [randomUUID(), payload.businessId, owner?.id ?? null, inboxProvider, email, oauthConn.id],
      );
    } else {
      await this.query(
        `UPDATE inbox_connections SET provider = $1, status = 'CONNECTED', auth_method = 'OAUTH',
         oauth_connection_id = $2, last_sync_at = now(), updated_at = now()
         WHERE id = $3`,
        [inboxProvider, oauthConn.id, inbox.id],
      );
    }

    return {
      businessId: payload.businessId,
      connectedInboxes: await this.serializeConnectedInboxes(payload.businessId),
    };
  }

  // ─── whatsapp ───

  async connectWhatsApp(payload: {
    businessId: string;
    phoneE164: string;
    customerName?: string;
    provider?: WhatsAppProvider;
    businessPhoneNumberId?: string | null;
    wabaId?: string | null;
    status?: WhatsAppIntegrationStatus;
    lastError?: string | null;
  }) {
    await this.getBusinessOrThrow(payload.businessId);
    const phone = normalizePhone(payload.phoneE164);

    const existing = await this.queryOne(
      `SELECT id FROM whatsapp_integrations WHERE business_id = $1 LIMIT 1`,
      [payload.businessId],
    );

    if (!existing) {
      await this.query(
        `INSERT INTO whatsapp_integrations
         (id, business_id, provider, customer_phone_e164, customer_name, status,
          business_phone_number_id, waba_id, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(), payload.businessId,
          payload.provider ?? "CLOUD_API", phone,
          payload.customerName ?? null, payload.status ?? "PENDING",
          payload.businessPhoneNumberId ?? null, payload.wabaId ?? null,
          payload.lastError ?? null,
        ],
      );
    } else {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (payload.provider) { sets.push(`provider = $${idx++}`); vals.push(payload.provider); }
      if (phone) { sets.push(`customer_phone_e164 = $${idx++}`); vals.push(phone); }
      if (payload.customerName !== undefined) { sets.push(`customer_name = $${idx++}`); vals.push(payload.customerName); }
      if (payload.status) { sets.push(`status = $${idx++}`); vals.push(payload.status); }
      if (payload.businessPhoneNumberId !== undefined) { sets.push(`business_phone_number_id = $${idx++}`); vals.push(payload.businessPhoneNumberId); }
      if (payload.wabaId !== undefined) { sets.push(`waba_id = $${idx++}`); vals.push(payload.wabaId); }
      if (payload.lastError !== undefined) { sets.push(`last_error = $${idx++}`); vals.push(payload.lastError); }
      sets.push(`updated_at = now()`);

      if (sets.length > 0) {
        vals.push(existing.id);
        await this.query(
          `UPDATE whatsapp_integrations SET ${sets.join(", ")} WHERE id = $${idx}`,
          vals,
        );
      }
    }

    return this.serializeWhatsAppIntegration(payload.businessId);
  }

  async markWhatsAppInbound(payload: { fromPhone: string; text: string }) {
    const phone = normalizePhone(payload.fromPhone);
    const integration = await this.queryOne(
      `SELECT id, business_id FROM whatsapp_integrations
       WHERE REPLACE(REPLACE(customer_phone_e164, ' ', ''), '-', '') = $1
       LIMIT 1`,
      [phone],
    );
    if (!integration) return null;

    await this.query(
      `UPDATE whatsapp_integrations SET status = 'CONNECTED', last_inbound_at = now(),
       last_error = NULL, updated_at = now() WHERE id = $1`,
      [integration.id],
    );
    await this.query(
      `INSERT INTO conversation_messages (id, business_id, channel, direction, text)
       VALUES ($1, $2, 'WHATSAPP', 'USER', $3)`,
      [randomUUID(), integration.business_id, payload.text],
    );
    return { businessId: integration.business_id };
  }

  async markWhatsAppOutbound(businessId: string, text: string) {
    await this.query(
      `UPDATE whatsapp_integrations SET status = 'CONNECTED', last_outbound_at = now(),
       last_error = NULL, updated_at = now() WHERE business_id = $1`,
      [businessId],
    );
    await this.query(
      `INSERT INTO conversation_messages (id, business_id, channel, direction, text)
       VALUES ($1, $2, 'WHATSAPP', 'BOT', $3)`,
      [randomUUID(), businessId, text],
    );
  }

  async markWhatsAppStatusByPhone(fromPhone: string, errorMessage?: string | null) {
    const phone = normalizePhone(fromPhone);
    await this.query(
      `UPDATE whatsapp_integrations
       SET last_outbound_at = now(),
           status = CASE WHEN $1::text IS NOT NULL THEN 'FAILED' ELSE 'CONNECTED' END,
           last_error = $1,
           updated_at = now()
       WHERE REPLACE(REPLACE(customer_phone_e164, ' ', ''), '-', '') = $2`,
      [errorMessage ?? null, phone],
    );
  }

  // ─── dashboard ───

  private async buildSummary(businessId: string) {
    const business = await this.getBusinessOrThrow(businessId);

    const totalsRow = await this.queryOne(
      `SELECT
         COUNT(*)::int AS documents,
         COALESCE(SUM(amount_cents), 0)::int AS "amountCents",
         COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'REVIEW')::int AS review
       FROM documents WHERE business_id = $1`,
      [businessId],
    );

    const inboxCountRow = await this.queryOne(
      `SELECT COUNT(*)::int AS cnt FROM inbox_connections
       WHERE business_id = $1 AND status = 'CONNECTED'`,
      [businessId],
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const currentRow = await this.queryOne(
      `SELECT COUNT(*)::int AS documents, COALESCE(SUM(amount_cents), 0)::int AS "amountCents"
       FROM documents WHERE business_id = $1 AND issued_at >= $2`,
      [businessId, monthStart.toISOString()],
    );

    const prevRow = await this.queryOne(
      `SELECT COUNT(*)::int AS documents, COALESCE(SUM(amount_cents), 0)::int AS "amountCents"
       FROM documents WHERE business_id = $1 AND issued_at >= $2 AND issued_at < $3`,
      [businessId, prevMonthStart.toISOString(), monthStart.toISOString()],
    );

    const currentAmount = currentRow?.amountCents ?? 0;
    const previousAmount = prevRow?.amountCents ?? 0;
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
        onboardingPaid: business.onboardingPaid ?? false,
        subscriptionStatus: business.subscriptionStatus ?? "free",
      },
      totals: {
        documents: totalsRow?.documents ?? 0,
        amountCents: totalsRow?.amountCents ?? 0,
        sent: totalsRow?.sent ?? 0,
        pending: totalsRow?.pending ?? 0,
        review: totalsRow?.review ?? 0,
        connectedInboxes: inboxCountRow?.cnt ?? 0,
      },
      month: {
        documents: currentRow?.documents ?? 0,
        amountCents: currentAmount,
        documentsDelta: (currentRow?.documents ?? 0) - (prevRow?.documents ?? 0),
        amountDeltaPercent: deltaPercent,
      },
    };
  }

  async runScan(payload: { businessId: string; targetCount?: number }) {
    const business = await this.getBusinessOrThrow(payload.businessId);

    if (!business.onboardingCompletedAt) {
      await this.query(
        `UPDATE businesses SET onboarding_completed_at = now(), updated_at = now() WHERE id = $1`,
        [payload.businessId],
      );
    }

    const summary = await this.buildSummary(payload.businessId);

    const monthKey = monthKeyFor(new Date());
    await this.query(
      `INSERT INTO monthly_summaries (id, business_id, month_key, total_documents, total_amount_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (business_id, month_key)
       DO UPDATE SET total_documents = $4, total_amount_cents = $5`,
      [randomUUID(), payload.businessId, monthKey, summary.month.documents, summary.month.amountCents],
    );

    return {
      businessId: payload.businessId,
      foundInvoices: summary.totals.documents,
      totalAmountCents: summary.totals.amountCents,
      accountantName: summary.business.accountantName,
      summary,
    };
  }

  async getDashboardSummary(businessId: string) {
    return this.buildSummary(businessId);
  }

  async getDashboardDocuments(businessId: string, status: string) {
    await this.getBusinessOrThrow(businessId);

    const statusFilter = status === "all" ? "" : "AND d.status = $2";
    const params: any[] = [businessId];
    if (status !== "all") {
      params.push(status.toUpperCase());
    }

    const rows = await this.query(
      `SELECT d.id, d.vendor_name AS vendor, d.amount_cents AS "amountCents",
              d.currency, d.issued_at AS "issuedAt", d.category,
              d.status, d.source, d.type, d.confidence,
              COALESCE(ic.provider, 'WHATSAPP') AS "inboxProvider"
       FROM documents d
       LEFT JOIN inbox_connections ic ON ic.id = d.inbox_connection_id
       WHERE d.business_id = $1 ${statusFilter}
       ORDER BY d.issued_at DESC`,
      params,
    );

    return {
      businessId,
      documents: rows.map((r: any) => ({
        id: r.id,
        vendor: r.vendor,
        amountCents: r.amountCents,
        currency: r.currency,
        issuedAt: r.issuedAt?.toISOString?.() ?? r.issuedAt,
        category: r.category ?? "כללי",
        status: r.status.toLowerCase(),
        source: r.source.toLowerCase(),
        provider: r.inboxProvider.toLowerCase(),
        type: r.type.toLowerCase(),
        confidence: parseFloat(r.confidence),
      })),
    };
  }

  async getDashboardDocumentDetail(businessId: string, documentId: string) {
    await this.getBusinessOrThrow(businessId);

    const row = await this.queryOne(
      `SELECT d.*, COALESCE(ic.provider, 'WHATSAPP') AS "inboxProvider"
       FROM documents d
       LEFT JOIN inbox_connections ic ON ic.id = d.inbox_connection_id
       WHERE d.business_id = $1 AND d.id = $2`,
      [businessId, documentId],
    );
    if (!row) throw new Error("Document not found");

    return {
      id: row.id,
      businessId: row.business_id,
      vendor: row.vendor_name,
      amountCents: row.amount_cents,
      currency: row.currency,
      vatCents: row.vat_cents,
      issuedAt: row.issued_at?.toISOString?.() ?? row.issued_at,
      status: row.status.toLowerCase(),
      source: row.source.toLowerCase(),
      provider: row.inboxProvider.toLowerCase(),
      type: row.type.toLowerCase(),
      category: row.category ?? "כללי",
      confidence: parseFloat(row.confidence),
      rawText: row.raw_text,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    };
  }

  async exportDashboardCsv(businessId: string, status: string = "all") {
    const data = await this.getDashboardDocuments(businessId, status);
    const header = ["id", "vendor", "amount_cents", "currency", "issued_at", "category", "status", "source", "provider", "type", "confidence"].join(",");
    const body = data.documents.map((row: any) =>
      [
        escapeCsv(row.id), escapeCsv(row.vendor), escapeCsv(row.amountCents),
        escapeCsv(row.currency), escapeCsv(row.issuedAt), escapeCsv(row.category),
        escapeCsv(row.status), escapeCsv(row.source), escapeCsv(row.provider),
        escapeCsv(row.type), escapeCsv(row.confidence),
      ].join(","),
    );
    return [header, ...body].join("\n");
  }

  // ─── chat ───

  async getDashboardChat(businessId: string) {
    await this.getBusinessOrThrow(businessId);
    const rows = await this.query(
      `SELECT id, direction, text, channel, created_at AS "createdAt"
       FROM conversation_messages
       WHERE business_id = $1
       ORDER BY created_at ASC
       LIMIT 50`,
      [businessId],
    );
    // Get last 50 by sorting asc then taking from end
    const last50 = rows.slice(-50);
    return {
      businessId,
      messages: last50.map((r: any) => ({
        id: r.id,
        from: r.direction === "USER" ? "user" : "bot",
        text: r.text,
        channel: r.channel.toLowerCase(),
        createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
      })),
    };
  }

  async postDashboardChat(payload: { businessId: string; text: string; userId?: string; channel?: string }) {
    await this.getBusinessOrThrow(payload.businessId);
    const channel = (payload.channel ?? "WEBCHAT").toUpperCase();

    await this.query(
      `INSERT INTO conversation_messages (id, business_id, user_id, channel, direction, text)
       VALUES ($1, $2, $3, $4, 'USER', $5)`,
      [randomUUID(), payload.businessId, payload.userId ?? null, channel, payload.text],
    );

    const summary = await this.buildSummary(payload.businessId);

    let replyText: string;
    try {
      const { isAiEnabled, chatResponse } = await import("./services/ai");
      if (isAiEnabled()) {
        const recentMsgs = await this.query(
          `SELECT direction, text FROM conversation_messages
           WHERE business_id = $1 ORDER BY created_at DESC LIMIT 10`,
          [payload.businessId],
        );
        const recentDocs = await this.query(
          `SELECT vendor_name AS vendor, amount_cents AS "amountCents", category, status, issued_at AS "issuedAt"
           FROM documents WHERE business_id = $1 ORDER BY issued_at DESC LIMIT 20`,
          [payload.businessId],
        );
        replyText = await chatResponse(
          payload.businessId,
          payload.text,
          (recentMsgs as any[]).reverse().map((m: any) => ({
            role: m.direction === "USER" ? "user" as const : "assistant" as const,
            text: m.text,
          })),
          {
            businessName: summary.business.name,
            accountantName: summary.business.accountantName,
            summary,
            recentDocs: recentDocs as any[],
          },
        );
      } else {
        throw new Error("AI not enabled");
      }
    } catch {
      replyText = payload.text.toLowerCase().includes("קיבל")
        ? `נשלחו ${summary.totals.sent} מסמכים ל-${summary.business.accountantName}.`
        : `החודש נקלטו ${summary.month.documents} מסמכים בסך ${(summary.month.amountCents / 100).toLocaleString("he-IL")} ש"ח.`;
    }

    const replyId = randomUUID();
    await this.query(
      `INSERT INTO conversation_messages (id, business_id, user_id, channel, direction, text)
       VALUES ($1, $2, $3, $4, 'BOT', $5)`,
      [replyId, payload.businessId, payload.userId ?? null, channel, replyText],
    );

    const reply = await this.queryOne(
      `SELECT id, text, created_at AS "createdAt" FROM conversation_messages WHERE id = $1`,
      [replyId],
    );

    return {
      businessId: payload.businessId,
      reply: {
        id: reply.id,
        from: "bot",
        text: reply.text,
        createdAt: reply.createdAt?.toISOString?.() ?? reply.createdAt,
      },
    };
  }

  // ─── settings ───

  async getSettings(businessId: string) {
    const business = await this.getBusinessOrThrow(businessId);
    const owner = await this.getOwnerForBusiness(businessId);
    const accountant = await this.ensureAccountantContact(businessId, business.accountantDisplayName);
    const flags = await this.integrationStatus(businessId);
    const wa = await this.queryOne(
      `SELECT provider FROM whatsapp_integrations WHERE business_id = $1 LIMIT 1`,
      [businessId],
    );
    const waName = wa?.provider === "BAILEYS" ? "WhatsApp (Baileys)" : "WhatsApp Cloud API";

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
      inboxes: await this.serializeConnectedInboxes(businessId),
      accountant: {
        name: accountant.name,
        email: accountant.email,
        phone: accountant.phone,
        firmName: accountant.firm_name,
        monthlyDeliveryDay: accountant.monthly_delivery_day,
        autoMonthlyDelivery: accountant.auto_monthly_delivery,
      },
      whatsapp: await this.serializeWhatsAppIntegration(businessId),
      integrations: [
        { name: "Gmail OAuth", connected: flags.gmailConnected },
        { name: "Outlook OAuth", connected: flags.outlookConnected },
        { name: waName, connected: flags.whatsappConnected },
        { name: "Google Drive", connected: false },
      ],
    };
  }

  async updateAccountSettings(payload: {
    businessId: string;
    fullName?: string;
    email?: string;
    phone?: string | null;
    businessName?: string;
    preferredLanguage?: string;
    currency?: string;
  }) {
    await this.getBusinessOrThrow(payload.businessId);
    const owner = await this.getOwnerForBusiness(payload.businessId);
    if (!owner) throw new Error("Business owner not found");

    if (payload.email && normalizeEmail(payload.email) !== owner.email) {
      const email = normalizeEmail(payload.email);
      const dup = await this.queryOne(
        `SELECT id FROM users WHERE email = $1 AND id != $2`,
        [email, owner.id],
      );
      if (dup) throw new Error("Email is already in use");
      await this.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, owner.id]);
    }
    if (payload.fullName !== undefined) {
      await this.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [payload.fullName?.trim() || null, owner.id]);
    }
    if (payload.phone !== undefined) {
      await this.query(`UPDATE users SET phone = $1 WHERE id = $2`, [payload.phone?.trim() || null, owner.id]);
    }
    if (payload.preferredLanguage !== undefined) {
      await this.query(`UPDATE users SET preferred_language = $1 WHERE id = $2`, [payload.preferredLanguage, owner.id]);
    }
    await this.query(`UPDATE users SET updated_at = now() WHERE id = $1`, [owner.id]);

    if (payload.businessName?.trim()) {
      await this.query(`UPDATE businesses SET name = $1, updated_at = now() WHERE id = $2`, [payload.businessName.trim(), payload.businessId]);
    }
    if (payload.currency?.trim()) {
      await this.query(`UPDATE businesses SET currency = $1, updated_at = now() WHERE id = $2`, [payload.currency.trim().toUpperCase(), payload.businessId]);
    }

    return this.getSettings(payload.businessId);
  }

  async updateAccountantSettings(payload: {
    businessId: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    firmName?: string | null;
    monthlyDeliveryDay?: number;
    autoMonthlyDelivery?: boolean;
  }) {
    const business = await this.getBusinessOrThrow(payload.businessId);
    const accountant = await this.ensureAccountantContact(payload.businessId, business.accountantDisplayName);

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (payload.name?.trim()) {
      sets.push(`name = $${idx++}`); vals.push(payload.name.trim());
      await this.query(
        `UPDATE businesses SET accountant_display_name = $1, updated_at = now() WHERE id = $2`,
        [payload.name.trim(), payload.businessId],
      );
    }
    if (payload.email !== undefined) { sets.push(`email = $${idx++}`); vals.push(payload.email?.trim() || null); }
    if (payload.phone !== undefined) { sets.push(`phone = $${idx++}`); vals.push(payload.phone?.trim() || null); }
    if (payload.firmName !== undefined) { sets.push(`firm_name = $${idx++}`); vals.push(payload.firmName?.trim() || null); }
    if (payload.monthlyDeliveryDay !== undefined) { sets.push(`monthly_delivery_day = $${idx++}`); vals.push(payload.monthlyDeliveryDay); }
    if (payload.autoMonthlyDelivery !== undefined) { sets.push(`auto_monthly_delivery = $${idx++}`); vals.push(payload.autoMonthlyDelivery); }
    sets.push(`updated_at = now()`);

    if (sets.length > 1) {
      vals.push(accountant.id);
      await this.query(
        `UPDATE accountant_contacts SET ${sets.join(", ")} WHERE id = $${idx}`,
        vals,
      );
    }

    return this.getSettings(payload.businessId);
  }

  async disconnectInbox(payload: { businessId: string; inboxId: string }) {
    await this.getBusinessOrThrow(payload.businessId);

    const inbox = await this.queryOne(
      `SELECT id, oauth_connection_id FROM inbox_connections
       WHERE business_id = $1 AND id = $2`,
      [payload.businessId, payload.inboxId],
    );
    if (!inbox) throw new Error("Inbox not found");

    await this.query(
      `UPDATE documents SET inbox_connection_id = NULL, updated_at = now()
       WHERE inbox_connection_id = $1`,
      [inbox.id],
    );
    await this.query(`DELETE FROM inbox_connections WHERE id = $1`, [inbox.id]);

    if (inbox.oauth_connection_id) {
      const stillUsed = await this.queryOne(
        `SELECT id FROM inbox_connections WHERE oauth_connection_id = $1 LIMIT 1`,
        [inbox.oauth_connection_id],
      );
      if (!stillUsed) {
        await this.query(`DELETE FROM oauth_connections WHERE id = $1`, [inbox.oauth_connection_id]);
      }
    }

    return {
      businessId: payload.businessId,
      connectedInboxes: await this.serializeConnectedInboxes(payload.businessId),
    };
  }

  // ─── new methods for sync ───

  async getInboxConnection(id: string) {
    return this.queryOne(
      `SELECT id, business_id AS "businessId", user_id AS "userId",
              provider, email, status, auth_method AS "authMethod",
              oauth_connection_id AS "oauthConnectionId",
              last_sync_at AS "lastSyncAt", gmail_history_id AS "gmailHistoryId",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM inbox_connections WHERE id = $1`,
      [id],
    );
  }

  async getOAuthConnection(id: string) {
    return this.queryOne(
      `SELECT id, business_id AS "businessId", provider,
              external_account_id AS "externalAccountId", email,
              access_token AS "accessToken", refresh_token AS "refreshToken",
              token_type AS "tokenType", scope, expires_at AS "expiresAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM oauth_connections WHERE id = $1`,
      [id],
    );
  }

  async updateOAuthTokens(id: string, tokens: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  }) {
    await this.query(
      `UPDATE oauth_connections SET
       access_token = $1, refresh_token = COALESCE($2, refresh_token),
       expires_at = $3, updated_at = now()
       WHERE id = $4`,
      [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, id],
    );
  }

  async getGmailInboxes(businessId: string) {
    return this.query(
      `SELECT id, business_id AS "businessId", provider, email, status,
              auth_method AS "authMethod", oauth_connection_id AS "oauthConnectionId",
              gmail_history_id AS "gmailHistoryId"
       FROM inbox_connections
       WHERE business_id = $1 AND provider = 'GMAIL' AND status = 'CONNECTED'
         AND auth_method = 'OAUTH' AND oauth_connection_id IS NOT NULL`,
      [businessId],
    );
  }

  async hasDocumentForGmailMessage(businessId: string, gmailMessageId: string): Promise<boolean> {
    const row = await this.queryOne(
      `SELECT 1 FROM documents WHERE business_id = $1 AND gmail_message_id = $2 LIMIT 1`,
      [businessId, gmailMessageId],
    );
    return Boolean(row);
  }

  async createDocument(doc: {
    businessId: string;
    inboxConnectionId?: string | null;
    source: string;
    type: string;
    status: string;
    vendorName: string;
    amountCents: number;
    currency: string;
    vatCents?: number | null;
    issuedAt: string;
    confidence: number;
    category?: string | null;
    rawText?: string | null;
    gmailMessageId?: string | null;
  }) {
    const id = randomUUID();
    await this.query(
      `INSERT INTO documents
       (id, business_id, inbox_connection_id, source, type, status,
        vendor_name, amount_cents, currency, vat_cents, issued_at,
        confidence, category, raw_text, gmail_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id, doc.businessId, doc.inboxConnectionId ?? null,
        doc.source, doc.type, doc.status,
        doc.vendorName, doc.amountCents, doc.currency,
        doc.vatCents ?? null, doc.issuedAt,
        doc.confidence, doc.category ?? null, doc.rawText ?? null,
        doc.gmailMessageId ?? null,
      ],
    );
    return { id };
  }

  async updateInboxSyncCursor(inboxConnectionId: string, gmailHistoryId: string) {
    await this.query(
      `UPDATE inbox_connections SET gmail_history_id = $1, last_sync_at = now(), updated_at = now()
       WHERE id = $2`,
      [gmailHistoryId, inboxConnectionId],
    );
  }

  async getConnectedWhatsAppIntegrations() {
    return this.query(
      `SELECT id, business_id AS "businessId", provider,
              customer_phone_e164 AS "customerPhoneE164", customer_name AS "customerName",
              status
       FROM whatsapp_integrations
       WHERE status = 'CONNECTED' AND provider = 'BAILEYS'`,
    );
  }

  async getAccountantForBusiness(businessId: string) {
    const business = await this.getBusinessOrThrow(businessId);
    return this.ensureAccountantContact(businessId, business.accountantDisplayName ?? business.name);
  }

  async markDocumentsSent(businessId: string, documentIds: string[]) {
    if (documentIds.length === 0) return 0;
    const placeholders = documentIds.map((_, i) => `$${i + 3}`).join(",");
    const result = await this.query(
      `UPDATE documents SET status = 'SENT', updated_at = $1
       WHERE business_id = $2 AND id IN (${placeholders}) AND status != 'SENT'`,
      [nowIso(), businessId, ...documentIds],
    );
    return (result as any).rowCount ?? documentIds.length;
  }

  async updateDocument(businessId: string, documentId: string, updates: {
    category?: string;
    comments?: string | null;
    amountCents?: number;
    vendorName?: string;
    status?: string;
  }) {
    await this.getBusinessOrThrow(businessId);
    const doc = await this.queryOne(
      `SELECT id FROM documents WHERE business_id = $1 AND id = $2`,
      [businessId, documentId],
    );
    if (!doc) throw new Error("Document not found");

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (updates.category !== undefined) { sets.push(`category = $${idx++}`); vals.push(updates.category); }
    if (updates.comments !== undefined) { sets.push(`comments = $${idx++}`); vals.push(updates.comments); }
    if (updates.amountCents !== undefined) { sets.push(`amount_cents = $${idx++}`); vals.push(updates.amountCents); }
    if (updates.vendorName !== undefined) { sets.push(`vendor_name = $${idx++}`); vals.push(updates.vendorName); }
    if (updates.status !== undefined) { sets.push(`status = $${idx++}`); vals.push(updates.status.toUpperCase()); }
    sets.push(`updated_at = now()`);

    vals.push(businessId, documentId);
    await this.query(
      `UPDATE documents SET ${sets.join(", ")} WHERE business_id = $${idx++} AND id = $${idx}`,
      vals,
    );

    // Auto-learn vendor→category mapping when category is corrected
    if (updates.category !== undefined) {
      const docRow = await this.queryOne(
        `SELECT vendor_name FROM documents WHERE id = $1`,
        [documentId],
      );
      if (docRow?.vendor_name) {
        await this.upsertVendorCategoryMapping(businessId, docRow.vendor_name, updates.category);
      }
    }

    return this.getDashboardDocumentDetail(businessId, documentId);
  }

  async createDocumentFromWhatsApp(payload: {
    businessId: string;
    filename: string;
    mimetype: string;
    caption: string;
  }) {
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

  // ─── deep scan methods ───

  async createScanJob(
    businessId: string,
    inboxConnectionId: string,
    gmailQuery: string,
    afterDate: string,
  ) {
    const id = randomUUID();
    await this.query(
      `INSERT INTO scan_jobs (id, business_id, inbox_connection_id, gmail_query, after_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, businessId, inboxConnectionId, gmailQuery, afterDate],
    );
    return { id };
  }

  async getActiveScanJob(businessId: string) {
    return this.queryOne(
      `SELECT id, business_id AS "businessId", inbox_connection_id AS "inboxConnectionId",
              status, current_pass AS "currentPass",
              gmail_query AS "gmailQuery", discovery_page_token AS "discoveryPageToken",
              total_discovered AS "totalDiscovered",
              total_to_process AS "totalToProcess", processed_count AS "processedCount",
              documents_created AS "documentsCreated", skipped_count AS "skippedCount",
              error_count AS "errorCount",
              ai_total AS "aiTotal", ai_processed AS "aiProcessed",
              after_date AS "afterDate", last_error AS "lastError",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM scan_jobs
       WHERE business_id = $1 AND status IN ('DISCOVERING', 'PROCESSING', 'AI_PASS')
       ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
  }

  async getScanJob(scanJobId: string) {
    return this.queryOne(
      `SELECT id, business_id AS "businessId", inbox_connection_id AS "inboxConnectionId",
              status, current_pass AS "currentPass",
              gmail_query AS "gmailQuery", discovery_page_token AS "discoveryPageToken",
              total_discovered AS "totalDiscovered",
              total_to_process AS "totalToProcess", processed_count AS "processedCount",
              documents_created AS "documentsCreated", skipped_count AS "skippedCount",
              error_count AS "errorCount",
              ai_total AS "aiTotal", ai_processed AS "aiProcessed",
              after_date AS "afterDate", last_error AS "lastError",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM scan_jobs WHERE id = $1`,
      [scanJobId],
    );
  }

  async getAllActiveScanJobs() {
    return this.query(
      `SELECT id, business_id AS "businessId", inbox_connection_id AS "inboxConnectionId",
              status, current_pass AS "currentPass",
              gmail_query AS "gmailQuery", discovery_page_token AS "discoveryPageToken",
              total_discovered AS "totalDiscovered",
              total_to_process AS "totalToProcess", processed_count AS "processedCount",
              documents_created AS "documentsCreated", skipped_count AS "skippedCount",
              error_count AS "errorCount",
              ai_total AS "aiTotal", ai_processed AS "aiProcessed",
              after_date AS "afterDate", last_error AS "lastError",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM scan_jobs
       WHERE status IN ('DISCOVERING', 'PROCESSING', 'AI_PASS')
       ORDER BY created_at ASC`,
    );
  }

  async updateScanJob(id: string, updates: Record<string, any>) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      sets.push(`${col} = $${idx++}`);
      vals.push(value);
    }
    sets.push(`updated_at = now()`);
    vals.push(id);
    await this.query(
      `UPDATE scan_jobs SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals,
    );
  }

  async insertScanMessages(scanJobId: string, gmailMessageIds: string[]) {
    if (gmailMessageIds.length === 0) return 0;
    let totalInserted = 0;
    // Batch in chunks of 150 to stay well under PG's 32,767 parameter limit (150 × 3 = 450 params)
    const CHUNK_SIZE = 150;
    for (let start = 0; start < gmailMessageIds.length; start += CHUNK_SIZE) {
      const chunk = gmailMessageIds.slice(start, start + CHUNK_SIZE);
      const values: string[] = [];
      const params: any[] = [];
      let idx = 1;
      for (const msgId of chunk) {
        values.push(`($${idx++}, $${idx++}, $${idx++})`);
        params.push(randomUUID(), scanJobId, msgId);
      }
      const result = await pool.query(
        `INSERT INTO scan_queue (id, scan_job_id, gmail_message_id)
         VALUES ${values.join(", ")}
         ON CONFLICT (scan_job_id, gmail_message_id) DO NOTHING`,
        params,
      );
      totalInserted += result.rowCount ?? 0;
    }
    return totalInserted;
  }

  async claimPendingMessages(scanJobId: string, limit: number) {
    return this.query(
      `UPDATE scan_queue SET status = 'PROCESSING'
       WHERE id IN (
         SELECT id FROM scan_queue
         WHERE scan_job_id = $1 AND status = 'PENDING'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, scan_job_id AS "scanJobId", gmail_message_id AS "gmailMessageId"`,
      [scanJobId, limit],
    );
  }

  async claimAiMessages(scanJobId: string, limit: number) {
    return this.query(
      `UPDATE scan_queue SET status = 'AI_PROCESSING'
       WHERE id IN (
         SELECT id FROM scan_queue
         WHERE scan_job_id = $1 AND status = 'REGEX_DONE' AND needs_ai = true
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, scan_job_id AS "scanJobId", gmail_message_id AS "gmailMessageId",
                 document_id AS "documentId"`,
      [scanJobId, limit],
    );
  }

  async updateScanMessage(id: string, updates: Record<string, any>) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      const col = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      sets.push(`${col} = $${idx++}`);
      vals.push(value);
    }
    vals.push(id);
    await this.query(
      `UPDATE scan_queue SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals,
    );
  }

  async getScanQueueCountByStatus(scanJobId: string) {
    const rows = await this.query(
      `SELECT status, COUNT(*)::int AS count, SUM(CASE WHEN needs_ai THEN 1 ELSE 0 END)::int AS "needsAi"
       FROM scan_queue WHERE scan_job_id = $1 GROUP BY status`,
      [scanJobId],
    );
    const result: Record<string, { count: number; needsAi: number }> = {};
    for (const r of rows) {
      result[r.status] = { count: r.count, needsAi: r.needsAi };
    }
    return result;
  }

  async hasActiveScanForInbox(inboxConnectionId: string): Promise<boolean> {
    const row = await this.queryOne(
      `SELECT 1 FROM scan_jobs
       WHERE inbox_connection_id = $1 AND status IN ('DISCOVERING', 'PROCESSING', 'AI_PASS')
       LIMIT 1`,
      [inboxConnectionId],
    );
    return Boolean(row);
  }

  async getLatestCompletedScanJob(businessId: string) {
    return this.queryOne(
      `SELECT id, business_id AS "businessId", inbox_connection_id AS "inboxConnectionId",
              status, current_pass AS "currentPass",
              discovery_page_token AS "discoveryPageToken",
              total_discovered AS "totalDiscovered",
              total_to_process AS "totalToProcess", processed_count AS "processedCount",
              documents_created AS "documentsCreated", skipped_count AS "skippedCount",
              error_count AS "errorCount",
              ai_total AS "aiTotal", ai_processed AS "aiProcessed",
              last_error AS "lastError",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM scan_jobs
       WHERE business_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
  }

  // ─── Billing ───

  async getBusinessBilling(businessId: string) {
    const biz = await this.getBusinessOrThrow(businessId);
    return {
      stripeCustomerId: biz.stripeCustomerId ?? null,
      stripeSubscriptionId: biz.stripeSubscriptionId ?? null,
      subscriptionStatus: biz.subscriptionStatus ?? "free",
      onboardingPaid: biz.onboardingPaid ?? false,
    };
  }

  async updateBusinessBilling(businessId: string, updates: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: string;
    onboardingPaid?: boolean;
  }) {
    const setClauses: string[] = ["updated_at = now()"];
    const params: any[] = [];
    let idx = 1;

    if (updates.stripeCustomerId !== undefined) {
      setClauses.push(`stripe_customer_id = $${idx++}`);
      params.push(updates.stripeCustomerId);
    }
    if (updates.stripeSubscriptionId !== undefined) {
      setClauses.push(`stripe_subscription_id = $${idx++}`);
      params.push(updates.stripeSubscriptionId);
    }
    if (updates.subscriptionStatus !== undefined) {
      setClauses.push(`subscription_status = $${idx++}`);
      params.push(updates.subscriptionStatus);
    }
    if (updates.onboardingPaid !== undefined) {
      setClauses.push(`onboarding_paid = $${idx++}`);
      params.push(updates.onboardingPaid);
    }

    params.push(businessId);
    await pool.query(
      `UPDATE businesses SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      params,
    );
  }

  async getBusinessByStripeCustomerId(stripeCustomerId: string) {
    return this.queryOne(
      `SELECT id, name, stripe_customer_id AS "stripeCustomerId",
              subscription_status AS "subscriptionStatus",
              onboarding_paid AS "onboardingPaid"
       FROM businesses WHERE stripe_customer_id = $1`,
      [stripeCustomerId],
    );
  }

  // ─── Vendor category mappings (auto-categorization) ───

  async upsertVendorCategoryMapping(
    businessId: string,
    vendorName: string,
    category: string,
  ): Promise<void> {
    const normalized = vendorName.trim().toLowerCase();
    await this.query(
      `INSERT INTO vendor_category_mappings
         (id, business_id, vendor_name_normalized, vendor_name_original, category)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (business_id, vendor_name_normalized)
       DO UPDATE SET category = $5,
                     correction_count = vendor_category_mappings.correction_count + 1,
                     updated_at = now()`,
      [randomUUID(), businessId, normalized, vendorName, category],
    );
  }

  async getVendorCategoryMapping(
    businessId: string,
    vendorName: string,
  ): Promise<{ category: string; correctionCount: number } | null> {
    const normalized = vendorName.trim().toLowerCase();
    return this.queryOne(
      `SELECT category, correction_count AS "correctionCount"
       FROM vendor_category_mappings
       WHERE business_id = $1 AND vendor_name_normalized = $2`,
      [businessId, normalized],
    );
  }

  async getVendorCategoryMappings(
    businessId: string,
  ): Promise<Array<{ vendorNameOriginal: string; category: string; correctionCount: number }>> {
    return this.query(
      `SELECT vendor_name_original AS "vendorNameOriginal",
              category,
              correction_count AS "correctionCount"
       FROM vendor_category_mappings
       WHERE business_id = $1
       ORDER BY correction_count DESC, updated_at DESC`,
      [businessId],
    );
  }

  /** Lightweight document lookup by ID (for deep scan vendor checks). */
  async getDocumentById(
    documentId: string,
  ): Promise<{ id: string; vendorName: string; businessId: string } | null> {
    return this.queryOne(
      `SELECT id, vendor_name AS "vendorName", business_id AS "businessId"
       FROM documents WHERE id = $1`,
      [documentId],
    );
  }

  /**
   * Returns the most common AI-extracted data for a vendor if we have 3+ high-confidence docs.
   * Used to skip AI for repeat vendors during deep scan.
   */
  async getKnownVendorExtraction(
    businessId: string,
    vendorName: string,
  ): Promise<{ vendorName: string; category: string; confidence: number } | null> {
    const normalized = vendorName.trim().toLowerCase();
    const row = await this.queryOne<{ cnt: string; vendorName: string; category: string; avgConf: number }>(
      `SELECT COUNT(*)::text AS cnt,
              vendor_name AS "vendorName",
              category,
              AVG(confidence) AS "avgConf"
       FROM documents
       WHERE business_id = $1
         AND LOWER(vendor_name) = $2
         AND confidence >= 0.6
         AND category IS NOT NULL
       GROUP BY vendor_name, category
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [businessId, normalized],
    );
    if (!row || parseInt(row.cnt) < 3) return null;
    return { vendorName: row.vendorName, category: row.category, confidence: row.avgConf };
  }

  // ─── Vendor patterns (missing receipt detection) ───

  async upsertVendorPattern(pattern: {
    businessId: string;
    vendorName: string;
    frequency: string;
    avgAmountCents: number;
    lastSeenAt: string;
    occurrenceCount: number;
  }): Promise<void> {
    await this.query(
      `INSERT INTO vendor_patterns
         (id, business_id, vendor_name, frequency, avg_amount_cents, last_seen_at, occurrence_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id, vendor_name)
       DO UPDATE SET frequency = $4, avg_amount_cents = $5, last_seen_at = $6,
                     occurrence_count = $7, updated_at = now()`,
      [
        randomUUID(), pattern.businessId, pattern.vendorName,
        pattern.frequency, pattern.avgAmountCents,
        pattern.lastSeenAt, pattern.occurrenceCount,
      ],
    );
  }

  async getTrackedVendorPatterns(businessId: string) {
    return this.query(
      `SELECT id, business_id AS "businessId", vendor_name AS "vendorName",
              frequency, avg_amount_cents AS "avgAmountCents",
              last_seen_at AS "lastSeenAt", occurrence_count AS "occurrenceCount",
              is_tracked AS "isTracked"
       FROM vendor_patterns
       WHERE business_id = $1 AND is_tracked = true
       ORDER BY occurrence_count DESC`,
      [businessId],
    );
  }

  async updateVendorPatternTracking(patternId: string, isTracked: boolean): Promise<void> {
    await this.query(
      `UPDATE vendor_patterns SET is_tracked = $1, updated_at = now() WHERE id = $2`,
      [isTracked, patternId],
    );
  }

  // ─── Missing receipt alerts ───

  async createMissingReceiptAlert(alert: {
    businessId: string;
    vendorPatternId: string;
    expectedMonth: string;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    await this.query(
      `INSERT INTO missing_receipt_alerts (id, business_id, vendor_pattern_id, expected_month)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vendor_pattern_id, expected_month) DO NOTHING`,
      [id, alert.businessId, alert.vendorPatternId, alert.expectedMonth],
    );
    return { id };
  }

  async getMissingReceiptAlerts(businessId: string, status?: string) {
    const statusFilter = status ? "AND a.status = $2" : "";
    const params: any[] = [businessId];
    if (status) params.push(status);

    return this.query(
      `SELECT a.id, a.business_id AS "businessId",
              a.vendor_pattern_id AS "vendorPatternId",
              a.expected_month AS "expectedMonth",
              a.status, a.notified_at AS "notifiedAt",
              a.resolved_at AS "resolvedAt",
              a.created_at AS "createdAt",
              vp.vendor_name AS "vendorName",
              vp.avg_amount_cents AS "avgAmountCents"
       FROM missing_receipt_alerts a
       JOIN vendor_patterns vp ON vp.id = a.vendor_pattern_id
       WHERE a.business_id = $1 ${statusFilter}
       ORDER BY a.created_at DESC`,
      params,
    );
  }

  async updateAlertStatus(alertId: string, status: string): Promise<void> {
    const extra = status === "notified" ? ", notified_at = now()" :
                  status === "resolved" ? ", resolved_at = now()" : "";
    await this.query(
      `UPDATE missing_receipt_alerts SET status = $1${extra} WHERE id = $2`,
      [status, alertId],
    );
  }

  async hasAlertForVendorMonth(vendorPatternId: string, expectedMonth: string): Promise<boolean> {
    const row = await this.queryOne(
      `SELECT 1 FROM missing_receipt_alerts
       WHERE vendor_pattern_id = $1 AND expected_month = $2 LIMIT 1`,
      [vendorPatternId, expectedMonth],
    );
    return Boolean(row);
  }

  // ─── Accountant portal ───

  async accountantEmailExists(email: string): Promise<boolean> {
    const row = await this.queryOne(
      `SELECT 1 FROM accountant_contacts WHERE LOWER(email) = $1 LIMIT 1`,
      [email.toLowerCase()],
    );
    return Boolean(row);
  }

  async getBusinessesForAccountant(accountantEmail: string) {
    return this.query(
      `SELECT b.id, b.name, b.created_at AS "createdAt",
              ac.name AS "accountantName",
              ac.auto_monthly_delivery AS "autoDelivery",
              ac.monthly_delivery_day AS "deliveryDay",
              ac.last_delivered_at AS "lastDeliveredAt"
       FROM accountant_contacts ac
       JOIN businesses b ON b.id = ac.business_id
       WHERE LOWER(ac.email) = $1
       ORDER BY b.name ASC`,
      [accountantEmail.toLowerCase()],
    );
  }

  async getClientHealthForAccountant(accountantEmail: string) {
    return this.query(
      `SELECT b.id AS "businessId", b.name AS "businessName",
              COUNT(d.id) FILTER (WHERE d.status = 'PENDING')::int AS "pendingCount",
              COUNT(d.id) FILTER (WHERE d.status = 'REVIEW')::int AS "reviewCount",
              COUNT(d.id) FILTER (WHERE d.status = 'SENT')::int AS "sentCount",
              COUNT(d.id)::int AS "totalCount",
              MAX(d.created_at) AS "lastDocumentAt"
       FROM accountant_contacts ac
       JOIN businesses b ON b.id = ac.business_id
       LEFT JOIN documents d ON d.business_id = b.id
       WHERE LOWER(ac.email) = $1
       GROUP BY b.id, b.name
       ORDER BY b.name ASC`,
      [accountantEmail.toLowerCase()],
    );
  }

  async getAllActiveBusinessIds(): Promise<string[]> {
    const rows = await this.query(
      `SELECT id FROM businesses WHERE onboarding_completed_at IS NOT NULL`,
    );
    return rows.map((r: any) => r.id);
  }

  async getVendorDocumentFrequency(businessId: string) {
    return this.query(
      `SELECT vendor_name AS "vendorName",
              COUNT(*)::int AS "occurrenceCount",
              AVG(amount_cents)::int AS "avgAmountCents",
              array_agg(DISTINCT to_char(issued_at, 'YYYY-MM') ORDER BY to_char(issued_at, 'YYYY-MM')) AS months,
              MAX(issued_at) AS "lastSeenAt"
       FROM documents
       WHERE business_id = $1
         AND issued_at > now() - interval '12 months'
         AND vendor_name IS NOT NULL
       GROUP BY vendor_name
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC`,
      [businessId],
    );
  }

  async hasDocumentForVendorInMonth(businessId: string, vendorName: string, monthKey: string): Promise<boolean> {
    const monthStart = new Date(`${monthKey}-01T00:00:00Z`);
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const row = await this.queryOne(
      `SELECT 1 FROM documents
       WHERE business_id = $1 AND LOWER(vendor_name) = $2
         AND issued_at >= $3 AND issued_at < $4
       LIMIT 1`,
      [businessId, vendorName.toLowerCase(), monthStart.toISOString(), nextMonth.toISOString()],
    );
    return Boolean(row);
  }
}

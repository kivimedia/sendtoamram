// Re-read receipts that were saved without a real AI read: before 19-Nov-2026 the sync skipped
// Gmail's mislabelled receipt PDFs and stored dollar amounts as shekels, so receipts in shekels
// (amount 0, or an amount whose currency may be wrong) are read again with the current reader.
//
//   npx tsx scripts/reread-receipts.ts --business <uuid> [--limit 500] [--concurrency 3] [--dry]
//                                      [--schema reread_19nov]
//
// The AI is reached through ANTHROPIC_BASE_URL (on the VPS: the subscription proxy). Usage is not
// written to ai_usage_log (it would record metered prices for subscription reads).
// Progress lives in <schema>.reread_results, so a run resumes where the last one stopped; rows in
// "error" are retried. <schema>.documents_before holds the rows as they were before the first run.
// Only amount, currency, VAT and confidence change (category only where none is set). A receipt
// the AI calls "not a receipt" is left as it is and only recorded.
//
// Exit: 0 nothing left to read, 2 some left (an inbox's Google sign-in is dead, or --limit hit),
// 3 stopped because the AI could not be reached.

import { pool } from "../server/db";
import { store } from "../server/store";
import { env } from "../server/config";
import { getValidAccessToken } from "../server/services/oauth";
import { fetchGmailMessage, extractDocumentFromEmail, readWithAi } from "../server/services/gmail-sync";
import { AI_SELFTEST_BUSINESS_ID, type VendorCategoryMapping } from "../server/services/ai";
import { writeFileSync, mkdirSync } from "fs";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const business = arg("business") ?? "";
const limit = Number(arg("limit", "100000"));
const concurrency = Math.max(1, Math.min(6, Number(arg("concurrency", "3"))));
const dry = process.argv.includes("--dry");
const schema = arg("schema", "reread_19nov")!;
if (!/^[0-9a-f-]{36}$/.test(business)) throw new Error("--business <uuid> is required");
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("--schema must be a plain name");

type Candidate = {
  id: string; gmail_message_id: string; amount_cents: number; currency: string; vat_cents: number | null;
  category: string | null; status: string; inbox_email: string;
};

async function setup(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.documents_before AS
    SELECT * FROM documents WHERE business_id = '${business}' AND currency = 'ILS'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.reread_results (
    doc_id uuid PRIMARY KEY, business_id uuid NOT NULL, inbox_email text, status text NOT NULL,
    before jsonb, after jsonb, error text, read_at timestamptz NOT NULL DEFAULT now())`);
}

async function candidates(): Promise<Candidate[]> {
  const r = await pool.query(
    `SELECT d.id, d.gmail_message_id, d.amount_cents, d.currency, d.vat_cents, d.category, d.status,
            lower(i.email) AS inbox_email
       FROM documents d JOIN inbox_connections i ON i.id = d.inbox_connection_id
      WHERE d.business_id = $1 AND d.currency = 'ILS' AND d.gmail_message_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${schema}.reread_results r WHERE r.doc_id = d.id AND r.status <> 'error')
      ORDER BY d.created_at DESC`,
    [business],
  );
  return r.rows;
}

/** A working Google sign-in for this mailbox, trying the newest connection first. */
async function tokenFor(email: string): Promise<{ token: string; inboxId: string } | null> {
  const r = await pool.query(
    `SELECT id, oauth_connection_id FROM inbox_connections
      WHERE business_id = $1 AND lower(email) = $2 AND oauth_connection_id IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST`,
    [business, email],
  );
  for (const row of r.rows) {
    try {
      const oauth = await store.getOAuthConnection(row.oauth_connection_id);
      if (!oauth) continue;
      return { token: await getValidAccessToken(oauth as any, store, env), inboxId: row.id };
    } catch {
      // dead sign-in (invalid_grant): try the next connection for this mailbox
    }
  }
  return null;
}

async function record(c: Candidate, status: string, after: unknown, error?: string): Promise<void> {
  if (dry) return;
  await pool.query(
    `INSERT INTO ${schema}.reread_results (doc_id, business_id, inbox_email, status, before, after, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (doc_id) DO UPDATE SET status = EXCLUDED.status, after = EXCLUDED.after,
       error = EXCLUDED.error, read_at = now()`,
    [c.id, business, c.inbox_email, status,
      JSON.stringify({ amountCents: c.amount_cents, currency: c.currency, vatCents: c.vat_cents, category: c.category }),
      after == null ? null : JSON.stringify(after), error ?? null],
  );
}

async function main(): Promise<number> {
  if (!dry) await setup();
  else await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`).then(() =>
    pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.reread_results (doc_id uuid PRIMARY KEY, business_id uuid NOT NULL,
      inbox_email text, status text NOT NULL, before jsonb, after jsonb, error text, read_at timestamptz NOT NULL DEFAULT now())`));

  const all = await candidates();
  const mappings: VendorCategoryMapping[] = (await store.getVendorCategoryMappings(business)).map((m: any) => ({
    vendorNameOriginal: m.vendorNameOriginal, category: m.category,
  }));

  const tokens = new Map<string, { token: string; inboxId: string } | null>();
  for (const email of new Set(all.map((c) => c.inbox_email))) tokens.set(email, await tokenFor(email));
  const waiting = [...tokens].filter(([, t]) => !t).map(([e]) => e);
  const queue = all.filter((c) => tokens.get(c.inbox_email)).slice(0, limit);
  console.log(`[reread] ${new Date().toISOString()} ${all.length} left, ${queue.length} readable now` +
    (waiting.length ? `, waiting for a Google sign-in: ${waiting.join(", ")}` : "") + (dry ? " (dry run)" : ""));

  const counts: Record<string, number> = {};
  let done = 0;
  let stopped = "";
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  async function one(c: Candidate): Promise<void> {
    const t = tokens.get(c.inbox_email)!;
    let message;
    try {
      message = await fetchGmailMessage(t.token, c.gmail_message_id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/404|not found/i.test(msg)) { bump("no_source"); await record(c, "no_source", null, msg.slice(0, 300)); return; }
      bump("error"); await record(c, "error", null, msg.slice(0, 300)); return;
    }
    const doc = extractDocumentFromEmail(message, { id: t.inboxId, businessId: business });
    if (!doc) { bump("no_source"); await record(c, "no_source", null); return; }
    try {
      const x = await readWithAi(t.token, c.gmail_message_id, doc, AI_SELFTEST_BUSINESS_ID, mappings);
      if (!x) { bump("no_source"); await record(c, "no_source", null); return; }
      if (x.isReceipt === false) { bump("not_receipt"); await record(c, "not_receipt", x); return; }
      if (!(x.amountCents > 0) || x.confidence <= 0.2) { bump("unchanged"); await record(c, "unchanged", x); return; }
      if (x.amountCents === c.amount_cents && x.currency === c.currency) { bump("unchanged"); await record(c, "unchanged", x); return; }
      if (!dry) {
        await pool.query(
          `UPDATE documents SET amount_cents = $3, currency = $4, vat_cents = $5, confidence = $6,
                  category = COALESCE(category, $7), updated_at = now()
            WHERE id = $1 AND business_id = $2`,
          [c.id, business, x.amountCents, x.currency, x.vatCents, x.confidence, x.category || null],
        );
      }
      bump("applied"); await record(c, "applied", x);
      if (dry) console.log(`[dry] ${c.id.slice(0, 8)} ${c.amount_cents} ${c.currency} -> ${x.amountCents} ${x.currency} (${x.vendorName})`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      bump("error"); await record(c, "error", null, msg.slice(0, 300));
      // The proxy answers 401 when no subscription account could take the read: stop, do not grind.
      if (/401|authentication|invalid x-api-key/i.test(msg)) stopped = msg.slice(0, 200);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < queue.length && !stopped) {
      await one(queue[next++]);
      if (++done % 25 === 0) console.log(`[reread] ${done}/${queue.length} ${JSON.stringify(counts)}`);
    }
  }));

  const left = dry ? all.length : (await candidates()).length;
  const totals = dry ? counts : Object.fromEntries((await pool.query(
    `SELECT status, count(*)::int n FROM ${schema}.reread_results WHERE business_id = $1 GROUP BY 1`, [business],
  )).rows.map((r: any) => [r.status, r.n]));
  const result = { at: new Date().toISOString(), thisRun: counts, totals, left, waitingForSignIn: waiting, stopped: stopped || null, dry };
  console.log(`RESULT ${JSON.stringify(result)}`);
  if (!dry) { mkdirSync("logs", { recursive: true }); writeFileSync("logs/last-result.json", JSON.stringify(result, null, 1)); }
  if (stopped) return 3;
  return left === 0 ? 0 : 2;
}

main()
  .then(async (code) => { await pool.end().catch(() => {}); process.exit(code); })
  .catch(async (e) => { console.error("[reread] failed:", e); await pool.end().catch(() => {}); process.exit(1); });

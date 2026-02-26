# SendToAmram

Automated invoice/receipt collection from Gmail for Israeli businesses. Scans emails, extracts document data (regex + AI), and delivers monthly reports to accountants.

**Live:** https://sendtoamram.co.il

## Stack

- **Frontend:** React + Vite + Tailwind + shadcn/ui (Hebrew RTL)
- **Backend:** Fastify (single serverless function)
- **Database:** Neon Postgres
- **Hosting:** Vercel (serverless + cron)
- **AI:** Claude (Sonnet for live sync, Haiku for deep scan)
- **Payments:** Stripe ($13 onboarding + $7/month)
- **Email:** Resend (monthly reports to accountants)

## Features

- **Gmail OAuth** — connect inbox via Google OAuth2
- **Deep historical scan** — 3 years of invoices, chunked via Postgres-as-queue (discovery → regex → AI)
- **Incremental sync** — Gmail History API, every 5 minutes via cron
- **AI extraction** — PDF/image attachments parsed by Claude for vendor, amount, date, category
- **Dashboard** — document list, filters, stats, search, inline editing
- **Monthly PDF reports** — auto-generated and emailed to accountant
- **Send to accountant** — on-demand email with document summary + CSV
- **AI chat** — ask questions about your documents in Hebrew
- **Billing** — Stripe Checkout with payment gate on all features
- **WhatsApp** — Baileys QR pairing or Meta Cloud API
- **Settings** — account, accountant, inbox management

## Quick Start (Local Dev)

```bash
npm install
cp .env.example .env   # fill in credentials
npm run dev
```

Frontend: `http://localhost:8080`
API: `http://localhost:3001`

Without `DATABASE_URL`, the app uses an in-memory JSON store (no deep scan, no cron).

## API Endpoints

### Onboarding
- `POST /api/onboarding/start` — create business + user
- `GET  /api/onboarding/state/:businessId` — get onboarding progress
- `POST /api/onboarding/connect-inbox` — connect an inbox
- `POST /api/onboarding/scan` — run initial scan

### OAuth
- `GET  /api/oauth/:provider/start?businessId=...` — start OAuth flow
- `GET  /api/oauth/:provider/callback` — OAuth callback

### Dashboard
- `GET  /api/dashboard/:businessId/summary` — stats + billing status
- `GET  /api/dashboard/:businessId/documents?status=...` — document list
- `GET  /api/dashboard/:businessId/documents/:id` — document detail
- `PATCH /api/dashboard/:businessId/documents/:id` — edit document
- `POST /api/dashboard/:businessId/sync` — trigger incremental sync
- `POST /api/dashboard/:businessId/send-to-accountant` — email accountant
- `GET  /api/dashboard/:businessId/export?format=csv&status=...` — CSV export
- `GET  /api/dashboard/:businessId/monthly-pdf?month=...` — download PDF
- `GET  /api/dashboard/:businessId/chat` — chat history
- `POST /api/dashboard/:businessId/chat` — send chat message

### Deep Scan
- `POST /api/deep-scan/:businessId/start` — start 3-year scan
- `GET  /api/deep-scan/:businessId/status` — scan progress
- `POST /api/deep-scan/:businessId/pause` — pause scan
- `POST /api/deep-scan/:businessId/resume` — resume scan

### Billing
- `GET  /api/billing/:businessId/status` — payment status
- `POST /api/billing/:businessId/create-checkout` — Stripe checkout
- `POST /api/billing/:businessId/portal` — Stripe billing portal

### Settings
- `GET   /api/settings/:businessId` — all settings
- `PATCH /api/settings/:businessId/account` — update account
- `PATCH /api/settings/:businessId/accountant` — update accountant
- `DELETE /api/settings/:businessId/inboxes/:inboxId` — disconnect inbox

### WhatsApp
- `POST /api/whatsapp/connect` — connect WhatsApp
- `GET  /api/whatsapp/session/:businessId` — session status
- `POST /api/whatsapp/send` — send message
- `GET  /api/whatsapp/webhook` — webhook verification
- `POST /api/whatsapp/webhook` — inbound messages

### Cron (protected by CRON_SECRET)
- `POST /api/cron/gmail-sync` — incremental Gmail sync (every 5 min)
- `POST /api/cron/deep-scan` — process deep scan jobs (every 1 min)
- `POST /api/cron/monthly-delivery` — monthly report delivery (daily 8 AM UTC)

### Health
- `GET /api/health` — health check

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod) | Neon Postgres connection string |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `OAUTH_STATE_SECRET` | Yes | Secret for signing OAuth state |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI extraction |
| `CRON_SECRET` | Yes (prod) | Protects cron endpoints |
| `STRIPE_SECRET_KEY` | Yes (prod) | Stripe live/test secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Stripe webhook signing secret |
| `RESEND_API_KEY` | Optional | Resend API key for email delivery |
| `FRONTEND_BASE_URL` | Yes | e.g. `https://sendtoamram.co.il` |
| `API_PUBLIC_BASE_URL` | Yes | e.g. `https://sendtoamram.co.il` |
| `CORS_ORIGIN` | Yes | Allowed CORS origins (comma-separated) |
| `MICROSOFT_CLIENT_ID` | Optional | Outlook OAuth |
| `MICROSOFT_CLIENT_SECRET` | Optional | Outlook OAuth |
| `WHATSAPP_PROVIDER` | Optional | `baileys` or `cloudapi` |

## Project Structure

```
server/
  app.ts                  # Fastify app setup + route registration
  config.ts               # Environment variable schema (Zod)
  index.ts                # Vercel serverless entry point
  store.ts                # In-memory JSON store (dev fallback)
  store-pg.ts             # Postgres store (production)
  routes/
    billing.ts            # Stripe checkout, webhook, portal
    dashboard.ts          # Documents, stats, chat, export, PDF
    deep-scan.ts          # Deep scan start/status/pause/resume
    health.ts             # Health check + cron endpoints
    onboarding.ts         # Business creation + inbox connect
    oauth.ts              # Google/Microsoft OAuth flows
    settings.ts           # Account + accountant settings
    whatsapp.ts           # WhatsApp connect/send/webhook
  services/
    ai.ts                 # Claude API (extract from PDF/image/text, chat)
    deep-scan.ts          # Discovery + regex + AI batch processing
    email.ts              # Resend email sending
    gmail-sync.ts         # Gmail OAuth, History API sync, message fetch
    monthly-delivery.ts   # Monthly PDF + email to accountant
    pdf.ts                # PDFKit report generation (Hebrew)
    whatsapp-baileys.ts   # Baileys WhatsApp adapter

src/
  pages/
    LandingPage.tsx       # Marketing landing page
    OnboardingPage.tsx    # 4-step onboarding wizard
    DashboardPage.tsx     # Main dashboard (stats, docs, chat)
    SettingsPage.tsx      # Account + accountant settings
  components/
    DeepScanProgress.tsx  # Scan progress bars + pause/resume
  lib/
    api.ts                # API client functions + TypeScript types
```

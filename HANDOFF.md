# Advertisely Leads — Handoff Document

Written for the next developer (human or AI) picking up the project.

## What this is

Advertisely Leads is an IUL (Indexed Universal Life insurance) lead marketplace + lightweight CRM. Life insurance agents sign in, buy leads by state and package, and receive them into a built-in CRM where they can call/text/email, manage disposition, and push to GoHighLevel.

**Live at:** https://advertisely.io
**Repository:** https://github.com/weylan8105/advertisely-leads

## Tech stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS, shadcn/ui, Framer Motion, Radix UI
- **Fonts:** Inter (sans) + Fraunces (serif display)
- **Database:** Postgres (Neon, via Vercel Storage integration)
- **ORM:** Prisma 6
- **Auth:** NextAuth v4 with Google OAuth (`@next-auth/prisma-adapter`)
- **Payments:** Stripe (Payment Intents + Elements — currently TEST mode)
- **Lead ingestion:** Meta Lead Ads webhook (code ready, not yet configured with real Meta app)
- **Deployment:** Vercel
- **Domain:** advertisely.io (DNS at GoDaddy)

## Current status — what works today

| Feature | Status | Notes |
|---|---|---|
| Marketing site (landing, /about, /marketplace) | ✅ Live | White/red/black brand with Fraunces serif |
| Google OAuth sign-in | ✅ Live | Users persist in Postgres (via Prisma adapter) |
| Postgres database | ✅ Live | Neon, connected via Vercel Storage; 13 tables live |
| Stripe checkout (test mode) | ✅ Cards process | Uses 4242 4242 4242 4242 for testing |
| Site design (white/red/black w/ serif accents) | ✅ Done | Fully redesigned recently |
| Favicon (logo A with red slash) | ✅ Done | app/icon.png + app/apple-icon.png |
| Admin UI for connecting Meta pages | ✅ Coded | Live at /admin → Meta ingestion tab |
| GHL integration UI | ✅ Coded | Live at /settings → Integrations |
| Lead CRM UI (list, kanban, detail, tasks, activity) | ✅ Coded | Uses mock data until real Meta lead flow starts |

## What's NOT yet done — remaining work

Priority order:

### 1. `STRIPE_WEBHOOK_SECRET` env var + Stripe webhook endpoint
- Without this, paid Stripe orders don't get saved to the Order table
- User needs to go to dashboard.stripe.com/test/webhooks → Add endpoint → URL: `https://advertisely.io/api/webhooks/stripe` → subscribe to `payment_intent.succeeded` + `payment_intent.payment_failed` → get signing secret → add to Vercel env vars → redeploy

### 2. Promote user to ADMIN role
- The current user account exists in the DB but has default role `AGENT`
- Run `npm run db:studio` locally → User table → change role to `ADMIN` → save
- After this, the /admin route becomes accessible

### 3. Meta Developer App + Page Access Token
- Not yet created
- Need to: Create app at developers.facebook.com → subscribe to `leadgen` webhook → point at `https://advertisely.io/api/webhooks/meta` → get App Secret, Verify Token, and long-lived Page Access Token
- Env vars to add to Vercel: `META_APP_SECRET`, `META_VERIFY_TOKEN`

### 4. Connect Facebook page + form mappings in the Advertisely admin UI
- Once Meta app is set up, go to advertisely.io/admin → Meta ingestion tab
- Add page (paste Page ID + Page Access Token)
- Map each Meta Lead Ad form to a package (form ID → package ID)

### 5. Meta Lead Ads campaigns
- Actually running ads that generate leads (marketing operations work, separate from code)
- Once running, leads flow: Meta ad opt-in → webhook → DB → fulfillment engine assigns to customer

### 6. Google Sheets integration (mentioned in UI but not built)
- Code stub exists, real integration would use Google service account (~2 hours work)

### 7. Go live on Stripe (when ready to take real money)
- Activate Stripe account (SSN or EIN)
- Swap the 3 Stripe env vars from `sk_test_*` to `sk_live_*`
- Add live-mode webhook, use live signing secret
- Redeploy

### 8. Publish Google OAuth consent screen
- Currently in "Testing" mode — only test users on the list can sign in
- To go public: OAuth consent screen → Publish App (may require verification for sensitive scopes; likely not needed for Google's default scopes)

## Code architecture

```
app/
  page.tsx                          Marketing landing page
  about/                            About Us page with VSL placeholder
  marketplace/                      Browse packages
  checkout/                         5-step wizard w/ Stripe Elements
  (auth)/                           login, signup (light UI, uses NextAuth)
  (app)/
    dashboard/                      Agent dashboard (mock data)
    leads/                          CRM lead list + kanban view
    leads/[id]/                     Lead detail with tabs
    orders/                         Order history
    settings/                       User + integrations config
    admin/                          Meta ingestion + queue mgmt (ADMIN only)
  api/
    auth/[...nextauth]/             NextAuth handler
    checkout/create-payment-intent/ Stripe PaymentIntent creation
    webhooks/stripe/                Stripe → creates Order in DB
    webhooks/meta/                  Meta → creates Lead in DB, triggers fulfillment
    orders/                         Order CRUD
    integrations/ghl/               Save/read/delete GHL creds per user
    exports/ghl/                    Push lead(s) to a user's GHL location
    admin/meta/pages/               Admin: manage Meta Page connections
    admin/meta/forms/               Admin: map form → package

lib/
  auth.ts                           NextAuth config (Google + Prisma adapter)
  prisma.ts                         Prisma client singleton, conditional
  stripe.ts                         Stripe server client, conditional
  meta.ts                           Meta webhook signature verify + Graph API fetch
  ghl.ts                            GoHighLevel v2 API client
  fulfillment.ts                    Order fulfillment engine (match leads → orders)
  utils.ts                          cn(), formatCurrency, formatDate, etc.

prisma/schema.prisma               13 tables: User, Account, Session, Lead, Order,
                                    MetaPageConnection, MetaFormMapping, Integration,
                                    ExportLog, LeadNote, LeadActivity, Task,
                                    VerificationToken

components/
  ui/                               shadcn primitives (Button, Card, Table, etc.)
  layout/                           Navbar, Footer, Sidebar, PageHeader, Logo
  marketing/                        Hero, HowItWorks, LeadQuality, VSLEmbed, etc.
  marketplace/                      LeadPackageCard, FilterSidebar
  leads/                            LeadTable, LeadKanban, TaskList, ActivityTimeline
  checkout/                         CheckoutFlow (5-step wizard), StripePaymentForm
  admin/                            MetaIntegrationManager, AdminLeadQueue
  settings/                         GHLConnectCard, CRMIntegrationCard
  auth/                             GoogleSignInButton (branded, calls NextAuth signIn)

data/                              Mock data (packages, leads, states, integrations)
types/                             TS type definitions
```

## Env vars required in Vercel

Set at Vercel → Project → Settings → Environment Variables:

```
NEXTAUTH_URL             https://advertisely.io
NEXTAUTH_SECRET          (generate with `openssl rand -base64 32`)
GOOGLE_CLIENT_ID         (from Google Cloud Console)
GOOGLE_CLIENT_SECRET     (from Google Cloud Console)

DATABASE_URL             (auto-injected by Vercel Storage / Neon)
POSTGRES_PRISMA_URL      (auto-injected, alias)
...and ~15 other POSTGRES_* / PG* vars from Neon

STRIPE_SECRET_KEY                     (from Stripe Dashboard)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY    (from Stripe Dashboard, note NEXT_PUBLIC prefix)
STRIPE_WEBHOOK_SECRET                 (from Stripe → Webhooks → endpoint signing secret)

META_APP_SECRET          (from Meta Developer app, once created)
META_VERIFY_TOKEN        (pick a random string, use same in Meta webhook config)
```

## Local dev setup

```bash
git clone https://github.com/weylan8105/advertisely-leads.git
cd advertisely-leads
npm install

# Set up Vercel CLI + link to project
npm install -g vercel
vercel login
vercel link
vercel env pull .env.local
cp .env.local .env      # Prisma looks for .env, not .env.local

# Verify DB connection + generate client
npx prisma generate
npx prisma db push       # only if schema has changed and needs syncing

# Run dev server
npm run dev
```

## Design notes

- Color palette: white background, red (#dc2626) accents, black panels for contrast sections
- Serif display: Fraunces (via next/font/google)
- Body font: Inter
- Section rhythm: alternate white and black panels for editorial feel
- Eyebrow labels use small red pill format: `<red dash><red pill><UPPERCASE tracking-wide LABEL>`
- Logo: black "A" with red slash. Files at `public/advertisely-logo.png`, `app/icon.png`, `app/apple-icon.png`

## Known issues / caveats

- Old codebase had `@auth/prisma-adapter` (for NextAuth v5); swapped to `@next-auth/prisma-adapter` (v4) — matches our NextAuth v4 install
- Prisma schema uses `DATABASE_URL` (modern Neon naming). Not `POSTGRES_PRISMA_URL`.
- `lib/prisma.ts` has fallback: checks both `DATABASE_URL` and `POSTGRES_PRISMA_URL`
- `lib/auth.ts` uses conditional Prisma adapter — falls back to JWT sessions if no DB
- The `about` page URL slug stayed as `/about` even though the nav label was updated to "About Us"

## Contact for questions about existing work

(You / user's contact info)

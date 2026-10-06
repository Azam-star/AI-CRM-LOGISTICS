# FreightDesk

MVP for AI driven CRM and logistics automation in freight brokerage: requirement to payment, with vendor
matching, AI voice and Tamil WhatsApp quoting, L1 rate suggestion, vendor lock-in, trip tracking, billing and
payment.

Built from the design document `AI_CRM_Logistics_POC.docx`.

## Quick start

```
npm install
npm run build
npm start            # API + client on http://localhost:4000
```

For development with hot reload: `npm run dev` (API on 4000, Vite on 5173).

First boot creates `data/freightdesk.db` (SQLite) and seeds it with sample vendors, customers, rate card
rows and six requirements across every lifecycle stage. **Data survives restarts**: the working set is
snapshotted to SQLite after every write and loaded again on boot. Delete `data/` to reset to the seed.

## Accounts

| Email | Role |
|---|---|---|
| admin@freightdesk.local | Administrator |
| sales@freightdesk.local | Sales |
| ops@freightdesk.local | Operations |
| finance@freightdesk.local | Finance |

On first boot, the API creates these accounts with randomly generated passwords and prints each password
once in the API terminal. Save them before restarting; passwords are not shown again. Sessions are HttpOnly
cookies with a configurable lifetime. Administrators can create users, reset passwords, deactivate accounts
and read the audit trail on the **Users and audit** screen.

## What is in the repo

```
shared/types.ts      Types shared by the API and the client
server/src/
  index.ts           Boot: open database, hydrate or seed, listen, persist on shutdown
  routes.ts          REST API: auth, requirements, quotes, trips, payments, admin, webhooks
  auth.ts            Password hashing (scrypt), sessions, role middleware
  db.ts              SQLite layer: schema, hydrate, snapshot persist
  audit.ts           Append-only audit log
  channels.ts        Outbound adapters (WhatsApp Cloud API, Twilio) with pure payload builders
  simulation.ts      Outreach and lock-in timelines, inbound reply application
  seed.ts            Sample master data and demo requirements
  domain/            Matching engine, quote parser, L1 aggregation, rate card (unit tested)
web/src/             React client: landing, console screens, login, admin console
scripts/smoke_test.py  End-to-end suite: auth, admin, webhooks, full business flow
```

## How the pieces work

**Matching.** Hard filters on the fifteen vendor attributes, then a weighted score
(availability 30%, reliability 30%, price 25%, response 15%). Excluded vendors carry the reasons.

**Outreach.** Each shortlisted vendor gets an attempt on their preferred channel. In simulation mode (the
default) replies arrive on timers; in live mode the message is actually sent and the reply arrives on the
webhook. Either way the reply text goes through the same rules parser: `"38500 podhum, toll extra"`,
`"ithu 41k"`, `Rs. 39,500` and Tamil numerals all parse to a rate with a confidence score. Replies under
0.80 confidence or more than 30% off the rate card reference are flagged and cannot reach L1 until a sales
agent verifies them.

**Pricing.** L1, L2, average and spread over the usable quotes; customer price is L1 plus the agent's
margin. The design document's worked example reproduces exactly: L1 37,800, average 39,760, spread 4,200,
customer price 40,824 at 8%.

**Lock-in to payment.** Top three vendors are offered the job, first acceptance wins with vehicle and
driver details, the trip moves through seven statuses to paid, the invoice is raised at billing with the
customer's credit terms, and the vendor payout is tracked separately.

**Audit.** Every sign-in, outreach run, verification, price, order, trip change, payment and user
management action is recorded with the acting user and shown to administrators.

## Going live with real channels

Outreach stays in simulation mode until credentials are present (see `.env.example`):

- **WhatsApp**: set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Outbound messages go to the Graph
  API; inbound replies must be forwarded to `POST /api/webhooks/whatsapp` with the `x-webhook-token`
  header set to `WEBHOOK_TOKEN` (the GET handshake on the same path answers Meta's verify challenge).
- **Voice**: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Calls are placed through
  Twilio reading the requirement script; a Twilio-formatted reply (`From`/`Body`) posted to
  `POST /api/webhooks/inbound` is parsed into a quote.

The payload builders and the inbound parser are unit tested; the calls themselves need real accounts and
have not been exercised against live providers from this machine.

## Tests

```
npm run typecheck     # server and client
npm test              # 45 unit tests: matching, parser, aggregation, rate card, db, auth, channels
python scripts/smoke_test.py   # 68 end-to-end checks against a running server
```

The smoke test needs the first-boot passwords from the API terminal in
`FREIGHTDESK_ADMIN_PASSWORD` and `FREIGHTDESK_SALES_PASSWORD`.

## Deployment

The build is `web/dist` (static) served by the single Node process:

```
npm run build
PORT=4000 DB_PATH=/var/lib/freightdesk/freightdesk.db WEBHOOK_TOKEN=... npm start
```

- Back up by copying the SQLite file (WAL mode; copy while the process is running is safe with
  `sqlite3 .backup`, or stop the process first).
- Termination signals persist the working set before exit.
- A Dockerfile is not included; the process needs Node 22+ and no other system dependencies.

## Known limitations

- Voice replies via webhook carry the transcribed text; a live voice conversation (barge-in, DTMF) is out
  of scope for this MVP.
- The store is a single SQLite file: one process, no clustering. Move to PostgreSQL before multiple
  instances.
- Lock-in acceptance is simulated even in live mode; it needs a vendor confirmation flow (reply keyword or
  an operator action) before running live.

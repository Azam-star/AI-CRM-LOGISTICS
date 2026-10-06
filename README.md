# FreightDesk

Proof of concept for AI driven CRM and logistics automation in freight brokerage: requirement to payment, with vendor
matching, AI voice and Tamil WhatsApp quoting, L1 rate suggestion, vendor lock-in, trip tracking, billing and payment.

Built from the POC design document `AI_CRM_Logistics_POC.docx`.

## What is in the repo

```
shared/types.ts      Types shared by the API and the client
server/              Express + TypeScript API, in-memory store, simulation timers
  src/domain/        Matching engine, quote parser, L1 aggregation, rate card
  src/domain/*.test  Unit tests run with the node test runner
web/                 Vite + React + TypeScript client
```

## Key features and project highlights

- AI-assisted requirement intake for freight brokerage workflows, including pricing and trip lifecycle tracking.
- Vendor matching based on route, service type, lane coverage, compliance, and commercial fit.
- Weighted shortlist generation to surface the most relevant vendors before outreach begins.
- AI-driven quote ingestion from voice and WhatsApp channels, with confidence scoring and anomaly flags.
- Margin-aware sales pricing and customer confirmation workflow before committing to a booking.
- L1 rate validation and vendor acceptance flow that supports automated trip creation.
- End-to-end trip execution from dispatch to proof of delivery, invoice, receipt, and vendor payout.
- Simulated real-world operational signals so the repo can be demoed without external telephony integrations.
- Testable domain logic for matching, parsing, aggregation, and rate-card checks to support ongoing iteration.

## Run it

```
npm install
npm run dev          # API on :4000, client on :5173
```

Production build and single process serving:

```
npm run build
npm start            # API also serves web/dist on :4000
```

Checks:

```
npm run typecheck
npm test             # 24 unit tests over matching, parsing, aggregation, rate card
```

## The flow the demo walks

1. Log a requirement (`/app/requirements/new`). The rate card answers instantly when a row matches.
2. Find vendors: hard filters, then a weighted score, top 8 shortlisted.
3. Start AI outreach: voice and WhatsApp attempts progress on timers, replies arrive as raw text.
4. Quotes are parsed into numbers with a confidence score. Low confidence or rates more than 30% away from the rate
   card reference are flagged and stay out of L1 until verified.
5. Add margin, save the customer price, then mark the customer confirmed.
6. The top three vendors are offered the L1 price. First valid acceptance wins and creates the trip.
7. Advance the trip through dispatch, transit, delivery with proof of delivery, invoice, receipt and vendor payout.

## Seeded sample data

- 70 vendors with the fifteen matching attributes from the POC
- 300 rate card rows, ten of them curated business rows for the routes quoted daily
- 6 requirements, one parked in every interesting stage: intake, shortlisted, quoted, in transit, billed, paid
- Customers with 15 to 45 day credit terms

Everything on the dashboard is computed from these records at request time. Restarting the API resets the data.

## What is simulated

Telephony and WhatsApp are simulated inside the API process with compressed timers, because real channels need a
Twilio or Exotel account and an approved WhatsApp Business number. The quote parser, matching engine, aggregation and
rate card lookup are real code with unit tests.

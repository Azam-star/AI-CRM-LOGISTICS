import { Router, type Request, type Response } from 'express';
import type { Invoice, Order, Requirement, Trip, TripStatus } from '../../shared/types';
import { CARGO_TYPES, TRIP_STATUS_ORDER, TRIP_STATUS_LABEL } from '../../shared/types';
import { summariseQuotes } from './domain/aggregation';
import { matchVendors } from './domain/matching';
import { lookupRate } from './domain/ratecard';
import { computeMetrics, lockInProgress, outreachInProgress } from './metrics';
import { applyRateCard } from './seed';
import { startLockIn, startOutreach } from './simulation';
import {
  attemptsFor,
  customerByName,
  getMatch,
  getRequirement,
  invoiceForOrder,
  orderFor,
  quotesFor,
  tripForOrder,
  type Store,
} from './store';

type Handler = (req: Request, res: Response) => void;

function wrap(handler: Handler): Handler {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      res.status(400).json({ error: message });
    }
  };
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: `${what} not found` });
}

const VEHICLE_TYPES = ['open_truck', 'container', 'trailer'] as const;
const AXLES = ['single', 'multi'] as const;
const BODY_SIZES = [14, 19, 22, 32, 40];

function requirementDetail(store: Store, id: string): Record<string, unknown> | null {
  const req = getRequirement(store, id);
  if (!req) return null;

  const match = getMatch(store, id);
  const quotes = quotesFor(store, id).slice().sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const summary = summariseQuotes(id, quotes, req.marginPct);
  const order = orderFor(store, id) ?? null;
  const trip = order ? tripForOrder(store, order.id) ?? null : null;
  const invoice = order ? invoiceForOrder(store, order.id) ?? null : null;

  return {
    requirement: req,
    match: match
      ? {
          limit: match.limit,
          matched: match.matched,
          excludedCount: match.excluded.length,
          excluded: match.excluded.map((e) => ({
            vendor: { id: e.vendor.id, name: e.vendor.name, active: e.vendor.active, kycDone: e.vendor.kycDone },
            reasons: e.reasons,
          })),
        }
      : null,
    attempts: attemptsFor(store, id),
    quotes,
    summary,
    order,
    trip,
    invoice,
    outreachRunning: outreachInProgress(store, id),
    lockInProgress: lockInProgress(store, id),
  };
}

function listRow(store: Store, req: Requirement): Record<string, unknown> {
  const quotes = quotesFor(store, req.id);
  const match = getMatch(store, req.id);
  const order = orderFor(store, req.id);
  const trip = order ? tripForOrder(store, order.id) : undefined;
  return {
    ...req,
    quoteCount: quotes.length,
    shortlistSize: match?.matched.length ?? 0,
    attemptCount: attemptsFor(store, req.id).length,
    orderId: order?.id ?? null,
    tripStatus: trip?.status ?? null,
  };
}

export function createApiRouter(store: Store): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'freightdesk-api', vendors: store.vendors.length, rateCardRows: store.rateCard.length });
  });

  router.get('/metrics', (_req, res) => {
    res.json(computeMetrics(store));
  });

  router.get('/customers', (_req, res) => {
    res.json(store.customers);
  });

  router.get('/hubs', (_req, res) => {
    const origins = Array.from(new Set(store.rateCard.map((r) => r.origin))).sort();
    const destinations = Array.from(new Set(store.rateCard.map((r) => r.destination))).sort();
    res.json({ origins, destinations });
  });

  router.get('/vendors', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase();
    const rows = store.vendors.filter(
      (v) =>
        q.length === 0 ||
        v.name.toLowerCase().includes(q) ||
        v.origins.some((o) => o.toLowerCase().includes(q)) ||
        v.corridors.some((c) => c.toLowerCase().includes(q)),
    );
    res.json({ total: rows.length, rows });
  });

  router.get('/ratecard', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase();
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    const rows = store.rateCard.filter(
      (r) =>
        q.length === 0 ||
        r.origin.toLowerCase().includes(q) ||
        r.destination.toLowerCase().includes(q) ||
        r.vehicleType.includes(q),
    );
    res.json({ total: rows.length, rows: rows.slice(0, limit) });
  });

  router.post(
    '/ratecard/lookup',
    wrap((req, res) => {
      const body = req.body as Record<string, unknown>;
      const origin = String(body.origin ?? '');
      const destination = String(body.destination ?? '');
      const weightT = Number(body.weightT ?? 0);
      const vehicleType = String(body.vehicleType ?? '');
      const axle = String(body.axle ?? '');
      const bodySizeFt = Number(body.bodySizeFt ?? 0);
      if (!origin || !destination || weightT <= 0) throw new Error('origin, destination and a positive weight are required');
      if (!VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number])) throw new Error('Unknown vehicle type');
      if (!AXLES.includes(axle as (typeof AXLES)[number])) throw new Error('Unknown axle configuration');
      res.json(
        lookupRate(store.rateCard, {
          origin,
          destination,
          vehicleType: vehicleType as (typeof VEHICLE_TYPES)[number],
          bodySizeFt,
          axle: axle as (typeof AXLES)[number],
          weightT,
        }),
      );
    }),
  );

  router.get('/requirements', (_req, res) => {
    const rows = store.requirements
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => listRow(store, r));
    res.json(rows);
  });

  router.get('/requirements/:id', (req, res) => {
    const detail = requirementDetail(store, String(req.params.id));
    if (!detail) return notFound(res, 'Requirement');
    res.json(detail);
  });

  router.post(
    '/requirements',
    wrap((req, res) => {
      const body = req.body as Record<string, unknown>;
      const customerName = String(body.customerName ?? '').trim();
      const origin = String(body.origin ?? '').trim();
      const destination = String(body.destination ?? '').trim();
      const cargo = String(body.cargo ?? '');
      const vehicleType = String(body.vehicleType ?? '');
      const axle = String(body.axle ?? '');
      const weightT = Number(body.weightT ?? 0);
      const bodySizeFt = Number(body.bodySizeFt ?? 0);
      const loadingDate = String(body.loadingDate ?? '');
      const loadingTime = String(body.loadingTime ?? '08:00');
      const notes = String(body.notes ?? '').trim();

      if (!customerName || !origin || !destination) throw new Error('Customer, origin and destination are required');
      if (!store.customers.some((c) => c.name === customerName)) throw new Error('Unknown customer');
      if (!(CARGO_TYPES as string[]).includes(cargo)) throw new Error('Unknown cargo type');
      if (!VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number])) throw new Error('Unknown vehicle type');
      if (!AXLES.includes(axle as (typeof AXLES)[number])) throw new Error('Unknown axle configuration');
      if (!BODY_SIZES.includes(bodySizeFt)) throw new Error('Body size must be one of 14, 19, 22, 32 or 40 ft');
      if (!(weightT > 0 && weightT <= 40)) throw new Error('Weight must be between 0 and 40 tonnes');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(loadingDate)) throw new Error('Loading date must be YYYY-MM-DD');

      store.counters.requirement += 1;
      const requirement: Requirement = {
        id: `REQ-${store.counters.requirement}`,
        customerName,
        origin,
        destination,
        cargo: cargo as Requirement['cargo'],
        weightT,
        vehicleType: vehicleType as Requirement['vehicleType'],
        bodySizeFt,
        axle: axle as Requirement['axle'],
        loadingDate,
        loadingTime,
        notes,
        status: 'intake',
        createdAt: new Date().toISOString(),
        rateCardRate: null,
        rateCardMatch: 'none',
        rateCardNote: '',
        marginPct: null,
        l1QuoteId: null,
      };
      applyRateCard(store, requirement);
      store.requirements.push(requirement);
      res.status(201).json(requirementDetail(store, requirement.id));
    }),
  );

  router.post(
    '/requirements/:id/match',
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, 'Requirement');
      if (requirement.status !== 'intake' && requirement.status !== 'shortlisted') {
        throw new Error(`Matching cannot run in status "${requirement.status}"`);
      }
      const limit = Math.min(20, Math.max(1, Number(req.body?.limit ?? 8) || 8));
      store.matches[id] = matchVendors(requirement, store.vendors, limit);
      requirement.status = 'shortlisted';
      res.json(requirementDetail(store, id));
    }),
  );

  router.post(
    '/requirements/:id/outreach',
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, 'Requirement');
      const outcome = startOutreach(store, id);
      res.json({ ...requirementDetail(store, id), started: outcome.attemptCount });
    }),
  );

  router.get('/requirements/:id/quotes', (req, res) => {
    const id = String(req.params.id);
    const requirement = getRequirement(store, id);
    if (!requirement) return notFound(res, 'Requirement');
    res.json(summariseQuotes(id, quotesFor(store, id), requirement.marginPct));
  });

  router.post(
    '/quotes/:id/verify',
    wrap((req, res) => {
      const quote = store.quotes.find((q) => q.id === String(req.params.id));
      if (!quote) return notFound(res, 'Quote');
      quote.verified = true;
      const requirement = getRequirement(store, quote.requirementId);
      res.json(summariseQuotes(quote.requirementId, quotesFor(store, quote.requirementId), requirement?.marginPct ?? null));
    }),
  );

  router.post(
    '/requirements/:id/pricing',
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, 'Requirement');
      if (requirement.status !== 'quoted' && requirement.status !== 'awaiting_customer') {
        throw new Error(`Pricing cannot run in status "${requirement.status}"`);
      }
      const marginPct = Number(req.body?.marginPct ?? 8);
      if (!(marginPct >= 0 && marginPct <= 50)) throw new Error('Margin must be between 0 and 50 percent');
      const summary = summariseQuotes(id, quotesFor(store, id), marginPct);
      if (!summary.l1) throw new Error('No usable quote to price from yet');
      requirement.marginPct = marginPct;
      requirement.l1QuoteId = summary.l1.id;
      requirement.status = 'awaiting_customer';
      res.json(requirementDetail(store, id));
    }),
  );

  router.post(
    '/requirements/:id/confirm',
    wrap((req, res) => {
      const id = String(req.params.id);
      const requirement = getRequirement(store, id);
      if (!requirement) return notFound(res, 'Requirement');
      if (requirement.status !== 'awaiting_customer') throw new Error('The customer quote must be priced first');
      if (orderFor(store, id)) throw new Error('An order already exists for this requirement');

      const summary = summariseQuotes(id, quotesFor(store, id), requirement.marginPct);
      if (!summary.l1 || summary.customerPrice === null) throw new Error('No L1 quote to confirm against');

      store.counters.order += 1;
      const order: Order = {
        id: `ORD-${store.counters.order}`,
        requirementId: id,
        vendorId: summary.l1.vendorId,
        vendorName: summary.l1.vendorName,
        l1Price: summary.l1.normalisedRate,
        customerPrice: summary.customerPrice,
        marginPct: requirement.marginPct ?? 0,
        status: 'locking',
        attempts: [],
        createdAt: new Date().toISOString(),
      };
      store.orders.push(order);
      requirement.status = 'locking';
      startLockIn(store, order.id);
      res.json(requirementDetail(store, id));
    }),
  );

  router.get('/orders/:id', (req, res) => {
    const order = store.orders.find((o) => o.id === String(req.params.id));
    if (!order) return notFound(res, 'Order');
    res.json({ order, trip: tripForOrder(store, order.id) ?? null, invoice: invoiceForOrder(store, order.id) ?? null });
  });

  router.get('/trips', (_req, res) => {
    const rows = store.trips
      .slice()
      .sort((a, b) => {
        const aLast = a.events[a.events.length - 1]?.at ?? '';
        const bLast = b.events[b.events.length - 1]?.at ?? '';
        return bLast.localeCompare(aLast);
      })
      .map((t) => ({ ...t, statusLabel: TRIP_STATUS_LABEL[t.status] }));
    res.json(rows);
  });

  router.post(
    '/trips/:id/advance',
    wrap((req, res) => {
      const trip = store.trips.find((t) => t.id === String(req.params.id));
      if (!trip) return notFound(res, 'Trip');
      const currentIndex = TRIP_STATUS_ORDER.indexOf(trip.status);
      const next = TRIP_STATUS_ORDER[currentIndex + 1];
      if (!next) throw new Error('Trip is already paid');
      if (next === 'delivered' && !trip.podFile) throw new Error('Upload the proof of delivery before marking delivery');

      const note = String(req.body?.note ?? '').trim() || defaultAdvanceNote(next, trip);
      trip.status = next;
      trip.events.push({ status: next, at: new Date().toISOString(), note });

      if (next === 'billed') ensureInvoice(store, trip);
      if (next === 'paid') {
        const invoice = store.invoices.find((i) => i.orderId === trip.orderId);
        if (invoice && invoice.status !== 'paid') {
          invoice.status = 'paid';
          invoice.paidOn = new Date().toISOString();
          invoice.tripStatus = 'paid';
        }
      }

      res.json({ trip, invoice: store.invoices.find((i) => i.orderId === trip.orderId) ?? null });
    }),
  );

  router.post(
    '/trips/:id/pod',
    wrap((req, res) => {
      const trip = store.trips.find((t) => t.id === String(req.params.id));
      if (!trip) return notFound(res, 'Trip');
      const file = String(req.body?.file ?? '').trim() || `POD_${trip.id}.pdf`;
      trip.podFile = file;
      res.json(trip);
    }),
  );

  router.get('/payments', (_req, res) => {
    const rows = store.invoices
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({
        ...i,
        daysToDue: Math.ceil((new Date(i.dueDate).getTime() - Date.now()) / 86400000),
      }));
    const summary = {
      receivableOutstanding: rows.filter((r) => r.status === 'unpaid').reduce((s, r) => s + r.amount, 0),
      payableOutstanding: rows.filter((r) => r.vendorPayoutStatus !== 'paid').reduce((s, r) => s + r.vendorPayout, 0),
      marginBooked: rows.reduce((s, r) => s + r.margin, 0),
    };
    res.json({ rows, summary });
  });

  router.post(
    '/payments/:id/pay',
    wrap((req, res) => {
      const invoice = store.invoices.find((i) => i.id === String(req.params.id));
      if (!invoice) return notFound(res, 'Invoice');
      if (invoice.status === 'paid') throw new Error('Invoice is already paid');
      invoice.status = 'paid';
      invoice.paidOn = new Date().toISOString();
      invoice.tripStatus = 'paid';
      const trip = store.trips.find((t) => t.orderId === invoice.orderId);
      if (trip && trip.status !== 'paid') {
        trip.status = 'paid';
        trip.events.push({ status: 'paid', at: invoice.paidOn, note: 'Payment recorded against the invoice.' });
      }
      res.json(invoice);
    }),
  );

  router.post(
    '/payments/:id/payout',
    wrap((req, res) => {
      const invoice = store.invoices.find((i) => i.id === String(req.params.id));
      if (!invoice) return notFound(res, 'Invoice');
      const status = String(req.body?.status ?? '');
      if (status !== 'approved' && status !== 'paid') throw new Error('Status must be approved or paid');
      invoice.vendorPayoutStatus = status;
      res.json(invoice);
    }),
  );

  return router;
}

function defaultAdvanceNote(status: TripStatus, trip: Trip): string {
  switch (status) {
    case 'vehicle_assigned':
      return `Vehicle ${trip.vehicleNo} and driver details captured.`;
    case 'dispatched':
      return 'Vehicle reached the pickup point and loading completed.';
    case 'in_transit':
      return 'Departure confirmed by the driver.';
    case 'delivered':
      return 'Delivery completed and proof of delivery uploaded.';
    case 'billed':
      return 'Invoice raised against the customer credit terms.';
    case 'paid':
      return 'Payment received from the customer.';
    default:
      return `Status changed to ${TRIP_STATUS_LABEL[status]}`;
  }
}

/** Invoices are raised when a trip reaches the billed status. */
function ensureInvoice(store: Store, trip: Trip): Invoice | undefined {
  const existing = store.invoices.find((i) => i.orderId === trip.orderId);
  if (existing) return existing;
  const order = store.orders.find((o) => o.id === trip.orderId);
  const requirement = order ? getRequirement(store, order.requirementId) : undefined;
  if (!order || !requirement) return undefined;

  const terms = customerByName(store, requirement.customerName)?.creditTermsDays ?? 30;
  const issuedAt = new Date();
  const invoice: Invoice = {
    id: `INV-${store.counters.invoice + 1}`,
    orderId: order.id,
    requirementId: requirement.id,
    customerName: requirement.customerName,
    route: `${requirement.origin} to ${requirement.destination}`,
    amount: order.customerPrice,
    vendorPayout: order.l1Price,
    margin: order.customerPrice - order.l1Price,
    issuedAt: issuedAt.toISOString(),
    dueDate: new Date(issuedAt.getTime() + terms * 86400000).toISOString(),
    status: 'unpaid',
    paidOn: null,
    vendorPayoutStatus: 'pending',
    tripStatus: trip.status,
  };
  store.counters.invoice += 1;
  store.invoices.push(invoice);
  return invoice;
}

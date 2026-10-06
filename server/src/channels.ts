import type { Channel } from '../../shared/types';
import { config, type AppConfig } from './config';

/**
 * Outbound channels.
 *
 * With no credentials configured everything runs in simulation mode, which is
 * the default and needs no accounts. When credentials are present the same call
 * sites send real traffic: WhatsApp through the Cloud API, voice through
 * Twilio. Replies from live channels arrive on the webhook endpoints and are
 * parsed by the same quote parser as simulated replies.
 *
 * The payload builders are pure functions of their config, so tests can verify
 * exactly what would be sent without any network access.
 */

export type ChannelMode = 'simulation' | 'live';

export interface SendResult {
  ok: boolean;
  provider: string;
  detail: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function modeFor(channel: Channel, cfg: AppConfig = config): ChannelMode {
  if (channel === 'whatsapp') return cfg.whatsapp ? 'live' : 'simulation';
  return cfg.twilio ? 'live' : 'simulation';
}

export function channelModes(cfg: AppConfig = config): Record<Channel, ChannelMode> {
  return { whatsapp: modeFor('whatsapp', cfg), voice: modeFor('voice', cfg) };
}

export function whatsappPayload(to: string, text: string, cfg: NonNullable<AppConfig['whatsapp']>): {
  url: string;
  init: RequestInit;
} {
  return {
    url: `https://graph.facebook.com/v20.0/${cfg.phoneNumberId}/messages`,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9]/g, ''),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    },
  };
}

export function twilioCallPayload(
  to: string,
  sayText: string,
  cfg: NonNullable<AppConfig['twilio']>,
): { url: string; init: RequestInit } {
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Karuwan">${escapeXml(
    sayText,
  )}</Say><Pause length="1"/><Say>Reply with your best rate.</Say></Response>`;
  const body = new URLSearchParams({ To: to, From: cfg.from, Twiml: twiml });
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`,
    init: {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendWhatsApp(
  to: string,
  text: string,
  cfg: AppConfig = config,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!cfg.whatsapp) return { ok: false, provider: 'whatsapp', detail: 'WhatsApp credentials are not configured' };
  const { url, init } = whatsappPayload(to, text, cfg.whatsapp);
  try {
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (!res.ok) return { ok: false, provider: 'whatsapp', detail: `Graph API ${res.status}: ${body.slice(0, 200)}` };
    return { ok: true, provider: 'whatsapp', detail: 'queued with the WhatsApp Cloud API' };
  } catch (err) {
    return { ok: false, provider: 'whatsapp', detail: err instanceof Error ? err.message : 'send failed' };
  }
}

export async function placeVoiceCall(
  to: string,
  sayText: string,
  cfg: AppConfig = config,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!cfg.twilio) return { ok: false, provider: 'voice', detail: 'Twilio credentials are not configured' };
  const { url, init } = twilioCallPayload(to, sayText, cfg.twilio);
  try {
    const res = await fetchImpl(url, init);
    const body = await res.text();
    if (!res.ok) return { ok: false, provider: 'voice', detail: `Twilio ${res.status}: ${body.slice(0, 200)}` };
    return { ok: true, provider: 'voice', detail: 'call queued with Twilio' };
  } catch (err) {
    return { ok: false, provider: 'voice', detail: err instanceof Error ? err.message : 'call failed' };
  }
}

/* --------------------------------------------------------------- inbound */

export interface InboundMessage {
  phone: string;
  text: string;
}

/** Normalises an Indian phone number to its last 10 digits for matching. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Extracts {phone, text} from the inbound shapes we accept:
 * - Twilio form posts (From / Body)
 * - WhatsApp Cloud API JSON (entry[0].changes[0].value.messages[0])
 * - plain JSON { from, text }
 */
export function parseInbound(body: unknown): InboundMessage | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;

  if (typeof obj.From === 'string' && typeof obj.Body === 'string') {
    return { phone: obj.From, text: obj.Body };
  }
  if (typeof obj.from === 'string' && typeof obj.text === 'string') {
    return { phone: obj.from, text: obj.text };
  }
  const entry = Array.isArray(obj.entry) ? obj.entry[0] : undefined;
  const entryChanges = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).changes : undefined;
  const change = Array.isArray(entryChanges) ? entryChanges[0] : undefined;
  const value = change && typeof change === 'object' ? (change as Record<string, unknown>).value : undefined;
  const messages = value && typeof value === 'object' ? (value as Record<string, unknown>).messages : undefined;
  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (first && typeof first === 'object') {
    const msg = first as Record<string, unknown>;
    const text = msg.text && typeof msg.text === 'object' ? (msg.text as Record<string, unknown>).body : undefined;
    if (typeof msg.from === 'string' && typeof text === 'string') {
      return { phone: msg.from, text };
    }
  }
  return null;
}

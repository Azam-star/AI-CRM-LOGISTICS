import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelModes,
  modeFor,
  parseInbound,
  phoneKey,
  placeVoiceCall,
  sendWhatsApp,
  twilioCallPayload,
  whatsappPayload,
  type FetchLike,
} from './channels';
import type { AppConfig } from './config';

function cfg(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 4000,
    dbPath: '/tmp/x.db',
    sessionTtlDays: 7,
    webhookToken: 'tok',
    replyTimeoutMs: 1000,
    twilio: { accountSid: 'AC123', authToken: 'secret', from: '+911100001111' },
    whatsapp: { token: 'wa-token', phoneNumberId: '445566' },
    ...overrides,
  };
}

test('mode is simulation without credentials and live with them', () => {
  assert.equal(modeFor('whatsapp', cfg()), 'live');
  assert.equal(modeFor('voice', cfg()), 'live');
  assert.equal(modeFor('whatsapp', cfg({ whatsapp: null })), 'simulation');
  assert.equal(modeFor('voice', cfg({ twilio: null })), 'simulation');
  assert.deepEqual(channelModes(cfg({ whatsapp: null, twilio: null })), { whatsapp: 'simulation', voice: 'simulation' });
});

test('whatsapp payload targets the Graph API with bearer auth', () => {
  const { url, init } = whatsappPayload('+91 98400 11223', 'Best rate?', cfg().whatsapp!);
  assert.equal(url, 'https://graph.facebook.com/v20.0/445566/messages');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer wa-token');
  const body = JSON.parse(String(init.body));
  assert.equal(body.to, '919840011223');
  assert.equal(body.type, 'text');
  assert.equal(body.text.body, 'Best rate?');
  assert.equal(body.messaging_product, 'whatsapp');
});

test('twilio payload posts urlencoded TwiML with basic auth and escapes XML', () => {
  const { url, init } = twilioCallPayload('+919840011223', 'Rate <now> & go', cfg().twilio!);
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from('AC123:secret').toString('base64')}`);
  assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(String(init.body));
  assert.equal(params.get('To'), '+919840011223');
  assert.equal(params.get('From'), '+911100001111');
  const twiml = params.get('Twiml') ?? '';
  assert.ok(twiml.includes('Rate &lt;now&gt; &amp; go'));
  assert.ok(twiml.startsWith('<?xml'));
});

test('sendWhatsApp reports success and failure from the provider', async () => {
  const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"messages":[{"id":"1"}]}' });
  const ok = await sendWhatsApp('+919840011223', 'hi', cfg(), okFetch);
  assert.equal(ok.ok, true);
  assert.equal(ok.provider, 'whatsapp');

  const failFetch: FetchLike = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  const fail = await sendWhatsApp('+919840011223', 'hi', cfg(), failFetch);
  assert.equal(fail.ok, false);
  assert.ok(fail.detail.includes('401'));

  const noCreds = await sendWhatsApp('+919840011223', 'hi', cfg({ whatsapp: null }), okFetch);
  assert.equal(noCreds.ok, false);
  assert.ok(noCreds.detail.includes('not configured'));
});

test('placeVoiceCall posts to Twilio and surfaces errors', async () => {
  const okFetch: FetchLike = async () => ({ ok: true, status: 201, text: async () => '{"sid":"CA1"}' });
  const ok = await placeVoiceCall('+919840011223', 'hello', cfg(), okFetch);
  assert.equal(ok.ok, true);

  const boom: FetchLike = async () => {
    throw new Error('network down');
  };
  const err = await placeVoiceCall('+919840011223', 'hello', cfg(), boom);
  assert.equal(err.ok, false);
  assert.equal(err.detail, 'network down');

  const noCreds = await placeVoiceCall('+919840011223', 'hello', cfg({ twilio: null }), okFetch);
  assert.equal(noCreds.ok, false);
});

test('parseInbound handles Twilio form, WhatsApp JSON and plain JSON', () => {
  assert.deepEqual(parseInbound({ From: '+919840011223', Body: '38500 podhum' }), {
    phone: '+919840011223',
    text: '38500 podhum',
  });
  assert.deepEqual(parseInbound({ from: '+919840011223', text: '41000' }), {
    phone: '+919840011223',
    text: '41000',
  });
  const whatsapp = {
    entry: [{ changes: [{ value: { messages: [{ from: '919840011223', text: { body: 'Rs. 39,500' } }] } }] }],
  };
  assert.deepEqual(parseInbound(whatsapp), { phone: '919840011223', text: 'Rs. 39,500' });
  assert.equal(parseInbound(null), null);
  assert.equal(parseInbound({}), null);
  assert.equal(parseInbound({ from: 'x' }), null);
});

test('phoneKey reduces any format to the last 10 digits', () => {
  assert.equal(phoneKey('+91 98400 11223'), '9840011223');
  assert.equal(phoneKey('919840011223'), '9840011223');
  assert.equal(phoneKey('9840011223'), '9840011223');
});

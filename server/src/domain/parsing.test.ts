import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIDENCE_THRESHOLD, flagReason, parseQuoteReply } from './parsing';

test('parses a plain Tanglish voice reply', () => {
  const parsed = parseQuoteReply('38500 podhum, toll extra');
  assert.equal(parsed.rate, 38500);
  assert.equal(parsed.tollIncluded, false);
  assert.ok(parsed.conditions.includes('Toll extra'));
  assert.ok(parsed.confidence >= CONFIDENCE_THRESHOLD, `confidence ${parsed.confidence}`);
});

test('parses shorthand rates like 41k', () => {
  const parsed = parseQuoteReply('ithu 41k, toll extra');
  assert.equal(parsed.rate, 41000);
  assert.equal(parsed.tollIncluded, false);
});

test('parses comma grouped rates with a currency marker', () => {
  const parsed = parseQuoteReply('Rs. 39,500, all inclusive, vehicle ready tomorrow');
  assert.equal(parsed.rate, 39500);
  assert.equal(parsed.tollIncluded, true);
  assert.equal(parsed.availableOnDate, true);
  assert.ok(parsed.confidence >= CONFIDENCE_THRESHOLD, `confidence ${parsed.confidence}`);
});

test('parses Tamil digits and Tamil currency words', () => {
  const parsed = parseQuoteReply('௪௧,௦௦௦ ரூபாய், நாளைக்கு வண்டி ரெடி');
  assert.equal(parsed.rate, 41000);
  assert.equal(parsed.availableOnDate, true);
});

test('a reply without a number yields no rate and low confidence', () => {
  const parsed = parseQuoteReply('Call pannunga sir, rate solren');
  assert.equal(parsed.rate, null);
  assert.ok(parsed.confidence < CONFIDENCE_THRESHOLD);
  assert.equal(flagReason(parsed.rate, parsed.confidence, null), 'No rate could be parsed from the reply');
});

test('flags a rate far away from the rate card reference', () => {
  const parsed = parseQuoteReply('Rs. 95,000, all inclusive', 41500);
  assert.ok(parsed.confidence < 0.9);
  const flag = flagReason(parsed.rate, parsed.confidence, 41500);
  assert.ok(flag !== null && flag.includes('away from the rate card reference'), flag ?? 'expected a flag');
});

test('accepts a rate close to the rate card reference', () => {
  const parsed = parseQuoteReply('Rs. 41,000, all inclusive', 41500);
  assert.equal(flagReason(parsed.rate, parsed.confidence, 41500), null);
});

test('flags low confidence parses for an agent to verify', () => {
  const flag = flagReason(38000, 0.6, null);
  assert.ok(flag !== null && flag.includes('below'), flag ?? 'expected a flag');
});

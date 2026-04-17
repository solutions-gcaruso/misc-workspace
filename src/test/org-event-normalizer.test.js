const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeUrl,
  parseCost,
  parseEventDateTime
} = require('../lib/org-event-normalizer');

test('canonicalizeUrl strips tracking params and hashes', () => {
  assert.equal(
    canonicalizeUrl('http://www.example.org/events?id=1&utm_source=newsletter#details'),
    'https://example.org/events?id=1'
  );
});

test('parseEventDateTime keeps explicit time and infers future year', () => {
  const parsed = parseEventDateTime({
    rawDateText: 'June 10',
    rawTimeText: '8:30 AM',
    timezone: 'America/Chicago',
    now: new Date('2026-04-10T12:00:00Z')
  });

  assert.equal(parsed.eventDateUtc, '2026-06-10T13:30:00.000Z');
  assert.equal(parsed.hasExactTime, true);
  assert.equal(parsed.usedNoonFallback, false);
});

test('parseCost recognizes free events', () => {
  const cost = parseCost('Free for members');

  assert.equal(cost.cost, 0);
});

test('parseEventDateTime does not mistake event time for a two-digit year', () => {
  const parsed = parseEventDateTime({
    rawDateText: 'SEP 21',
    rawTimeText: '10:00 AM',
    timezone: 'America/Chicago',
    now: new Date('2026-04-10T12:00:00Z')
  });

  assert.equal(parsed.eventDateUtc, '2026-09-21T15:00:00.000Z');
});

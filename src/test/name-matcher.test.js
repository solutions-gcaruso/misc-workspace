const test = require('node:test');
const assert = require('node:assert/strict');

const { matchAttendeesToClients, normalizeCompanyName, normalizeName } = require('../lib/name-matcher');
const { applyManualExclusions, loadOptionalManualExclusions, mergeEvents, parseArgs } = require('../scripts/sync-airtable-event');

const nicknameMap = {
  john: ['john', 'johnny', 'jon', 'jonathan'],
  tim: ['tim', 'timmy', 'timothy']
};

test('normalizeName trims punctuation, whitespace, and casing', () => {
  const normalized = normalizeName('  John\u00a0Doe, Jr.  ');

  assert.equal(normalized.normalizedFull, 'john doe');
  assert.equal(normalized.first, 'john');
  assert.equal(normalized.last, 'doe');
});

test('normalizeCompanyName strips punctuation and legal suffixes', () => {
  assert.equal(normalizeCompanyName('Acme, Inc.'), 'acme');
});

test('nickname matches auto when last name is exact', () => {
  const attendee = normalizeName('Tim Smith');
  const client = { id: 'rec1', clientName: 'Timothy Smith', events: [], ...normalizeName('Timothy Smith') };
  const results = matchAttendeesToClients([attendee], [client], nicknameMap);

  assert.equal(results.autoMatches.length, 1);
  assert.equal(results.autoMatches[0].airtableRecordId, 'rec1');
  assert.equal(results.autoMatches[0].matchType, 'nickname');
});

test('review queue catches typo-based fuzzy match', () => {
  const attendee = normalizeName('Jon Smyth');
  const client = { id: 'rec1', clientName: 'John Smith', events: [], ...normalizeName('John Smith') };
  const results = matchAttendeesToClients([attendee], [client], nicknameMap);

  assert.equal(results.reviewMatches.length, 1);
  assert.equal(results.reviewMatches[0].status, 'review');
});

test('company match disambiguates otherwise similar review candidates', () => {
  const attendee = {
    ...normalizeName('Jon Smyth'),
    companyName: 'Acme, Inc.'
  };
  const clients = [
    {
      id: 'rec1',
      clientName: 'John Smith',
      companyNames: ['Acme'],
      events: [],
      ...normalizeName('John Smith')
    },
    {
      id: 'rec2',
      clientName: 'Josh Smith',
      companyNames: ['Beta LLC'],
      events: [],
      ...normalizeName('Josh Smith')
    }
  ];
  const results = matchAttendeesToClients([attendee], clients, nicknameMap);

  assert.equal(results.reviewMatches.length, 1);
  assert.equal(results.reviewMatches[0].airtableRecordId, 'rec1');
  assert.match(results.reviewMatches[0].reason, /company match/);
});

test('mergeEvents preserves existing values and avoids duplicates', () => {
  assert.deepEqual(mergeEvents([], 'ICSC - Phoenix 2026'), ['ICSC - Phoenix 2026']);
  assert.deepEqual(
    mergeEvents(['NGLN - Scottsdale 2025'], 'ICSC - Phoenix 2026'),
    ['NGLN - Scottsdale 2025', 'ICSC - Phoenix 2026']
  );
  assert.deepEqual(
    mergeEvents(['ICSC - Phoenix 2026'], 'ICSC - Phoenix 2026'),
    ['ICSC - Phoenix 2026']
  );
});

test('manual exclusions remove flagged review matches', () => {
  const results = applyManualExclusions(
    {
      autoMatches: [],
      reviewMatches: [
        {
          attendeeName: 'Andrew Kline',
          airtableRecordId: 'recwk9EJYhVTra2UN',
          airtableClientName: 'Andy Klink',
          score: 0.91,
          reason: 'nickname + slight last-name typo'
        }
      ],
      skipped: []
    },
    [
      {
        attendeeName: 'Andrew Kline',
        airtableRecordId: 'recwk9EJYhVTra2UN'
      }
    ]
  );

  assert.equal(results.reviewMatches.length, 0);
  assert.equal(results.skipped.length, 1);
  assert.equal(results.skipped[0].reason, 'manually excluded match');
});

test('parseArgs supports file and event overrides', () => {
  const args = parseArgs(['--file', 'custom.xlsx', '--event', 'ICSC - Phoenix 2027', '--apply']);

  assert.equal(args.filePath, 'custom.xlsx');
  assert.equal(args.eventValue, 'ICSC - Phoenix 2027');
  assert.equal(args.applyMode, true);
});

test('loadOptionalManualExclusions returns an empty list when config is absent', () => {
  const exclusions = loadOptionalManualExclusions(__dirname);
  assert.deepEqual(exclusions, []);
});

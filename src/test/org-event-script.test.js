const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/sync-org-events-from-airtable');

test('parseArgs supports apply mode, limit, and organization filter', () => {
  const args = parseArgs(['--apply', '--limit', '5', '--org', 'NAIOP']);

  assert.equal(args.applyMode, true);
  assert.equal(args.limit, 5);
  assert.equal(args.organizationName, 'NAIOP');
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyClientNameCleanupPlan,
  buildClientNameCleanupPlan,
  ensureClientNameFieldExists,
  normalizeClientName,
  runClientNameCleanup
} = require('../lib/client-name-cleanup');
const { parseArgs } = require('../scripts/normalize-airtable-client-names');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'client-name-cleanup-test-'));
}

test('parseArgs supports apply mode', () => {
  const args = parseArgs(['--apply']);

  assert.equal(args.applyMode, true);
});

test('normalizeClientName removes formatting noise while preserving punctuation', () => {
  const result = normalizeClientName("  Danielle\n\tRichardson\u00a0-Smith, Jr.  ");

  assert.equal(result.normalizedName, 'Danielle Richardson -Smith, Jr.');
  assert.equal(result.changeType, 'newline_removed+nbsp_removed+multi_space_collapsed+trim');
  assert.equal(result.isChanged, true);
});

test('buildClientNameCleanupPlan reports only changed, non-empty names for update', () => {
  const plan = buildClientNameCleanupPlan({
    records: [
      { id: 'rec1', fields: { 'Client Name': 'Danielle\n  Richardson ' } },
      { id: 'rec2', fields: { 'Client Name': 'Already Clean' } },
      { id: 'rec3', fields: { 'Client Name': '   ' } }
    ]
  });

  assert.equal(plan.summary.recordsScanned, 3);
  assert.equal(plan.summary.unchangedCount, 1);
  assert.equal(plan.summary.skippedEmptyCount, 1);
  assert.equal(plan.summary.updateCount, 1);
  assert.deepEqual(plan.updates, [
    {
      id: 'rec1',
      fields: {
        'Client Name': 'Danielle Richardson'
      }
    }
  ]);
  assert.equal(plan.auditRows[0].changeType, 'newline_removed+multi_space_collapsed+trim');
  assert.equal(plan.auditRows[1].status, 'skip-empty');
});

test('ensureClientNameFieldExists validates schema before cleanup', async () => {
  const fakeClient = {
    async listTables() {
      return [
        {
          name: 'Clients',
          fields: [{ name: 'Client Name', type: 'singleLineText' }]
        }
      ];
    }
  };

  await assert.doesNotReject(() => ensureClientNameFieldExists({ airtableClient: fakeClient }));
});

test('runClientNameCleanup writes dry-run audit reports without updating Airtable', async () => {
  const tempDir = makeTempDir();
  let updateCalls = 0;
  const fakeClient = {
    async listTables() {
      return [
        {
          name: 'Clients',
          fields: [{ name: 'Client Name', type: 'singleLineText' }]
        }
      ];
    },
    async fetchAllRecords() {
      return [
        { id: 'rec1', fields: { 'Client Name': 'Danielle\n  Richardson ' } },
        { id: 'rec2', fields: { 'Client Name': "Anne-Marie O'Neil" } }
      ];
    },
    async updateRecords() {
      updateCalls += 1;
      throw new Error('updateRecords should not be called in dry run');
    }
  };

  const { plan, applyResult } = await runClientNameCleanup({
    airtableClient: fakeClient,
    outputDir: tempDir,
    applyMode: false
  });

  assert.equal(applyResult, null);
  assert.equal(plan.summary.updateCount, 1);
  assert.equal(updateCalls, 0);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-name-cleanup-summary.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-name-cleanup-audit.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-name-cleanup-audit.csv')), true);
});

test('applyClientNameCleanupPlan updates changed names in Airtable batches', async () => {
  const calls = [];
  const fakeClient = {
    async updateRecords({ tableName, records }) {
      calls.push({
        tableName,
        records: JSON.parse(JSON.stringify(records))
      });
      return { records: [] };
    }
  };

  const result = await applyClientNameCleanupPlan({
    airtableClient: fakeClient,
    outputDir: makeTempDir(),
    plan: {
      updates: [
        { id: 'rec1', fields: { 'Client Name': 'Danielle Richardson' } },
        { id: 'rec2', fields: { 'Client Name': "Anne-Marie O'Neil" } }
      ]
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tableName, 'Clients');
  assert.deepEqual(result.successfulRecordIds, ['rec1', 'rec2']);
});

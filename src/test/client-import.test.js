const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyImportPlan,
  buildClientFields,
  findExistingClientDecision,
  mapClientRecord,
  mapCompanyRecord,
  planClientImport,
  resolveCompanyDecision,
  runClientImport
} = require('../lib/client-import');
const { parseArgs } = require('../scripts/import-airtable-clients');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'client-import-test-'));
}

test('parseArgs supports file override and apply mode', () => {
  const args = parseArgs(['--file', 'custom.xlsx', '--apply']);

  assert.equal(args.filePath, 'custom.xlsx');
  assert.equal(args.applyMode, true);
});

test('buildClientFields omits empty fields and rounds estimated age', () => {
  const fields = buildClientFields(
    {
      Name: 'Jay Sears',
      Position: 'Managing Partner',
      Phone: '',
      'City/State': 'Houston, TX',
      'LinkedIn Headline': 'Owner, NewQuest',
      'LinkedIn About': '',
      'LinkedIn Experience Summary': '- Owner @ NewQuest',
      'LinkedIn Alumni': '',
      'LinkedIn Total Experience Years': '12.8',
      'LinkedIn Profile Image URL': '',
      'LinkedIn Email': ''
    },
    'recCompany1'
  );

  assert.deepEqual(fields.Company, ['recCompany1']);
  assert.equal(fields['Estimated Age'], '33');
  assert.equal(fields['Phone Number'], undefined);
  assert.equal(fields['Professional/Business Notes (Handwritten)'], 'Headline: Owner, NewQuest\n\nExperience: - Owner @ NewQuest');
  assert.equal(fields.Email, undefined);
});

test('findExistingClientDecision prefers exact email matches', () => {
  const clients = [
    {
      id: 'rec1',
      clientName: 'Jay Sears',
      email: 'jsears@newquest.com',
      events: [],
      ...require('../lib/name-matcher').normalizeName('Jay Sears')
    }
  ];
  const indexes = {
    emailToClients: new Map([['jsears@newquest.com', clients]]),
    normalizedNameToClients: new Map([[clients[0].normalizedFull, clients]])
  };
  const decision = findExistingClientDecision(
    {
      rowNumber: 2,
      Name: 'James Sears',
      'LinkedIn Email': 'jsears@newquest.com'
    },
    clients,
    indexes
  );

  assert.equal(decision.status, 'existing');
  assert.equal(decision.matchType, 'email');
  assert.equal(decision.airtableRecordId, 'rec1');
});

test('findExistingClientDecision sends fuzzy matches to review', () => {
  const normalized = require('../lib/name-matcher').normalizeName('Timothy Smith');
  const clients = [
    {
      id: 'rec1',
      clientName: 'Timothy Smith',
      email: '',
      events: [],
      ...normalized
    }
  ];
  const indexes = {
    emailToClients: new Map(),
    normalizedNameToClients: new Map()
  };
  const decision = findExistingClientDecision(
    {
      rowNumber: 2,
      Name: 'Tim Smith',
      'LinkedIn Email': ''
    },
    clients,
    indexes
  );

  assert.equal(decision.status, 'review');
  assert.equal(decision.airtableClientName, 'Timothy Smith');
});

test('resolveCompanyDecision supports exact, alias, review, and create paths', () => {
  const companies = [
    mapCompanyRecord({ id: 'rec1', fields: { 'Company Name': 'Agree Realty Company' } }),
    mapCompanyRecord({ id: 'rec2', fields: { 'Company Name': 'UrbanStreet Group  LLC' } }),
    mapCompanyRecord({ id: 'rec3', fields: { 'Company Name': 'Bucksbaum Retail Properties  LLC' } })
  ];
  const indexes = {
    normalizedNameToCompanies: new Map(companies.map(company => [company.normalizedCompanyName, [company]])),
    coreKeyToCompanies: new Map(companies.map(company => [company.coreKey, [company]]))
  };
  const aliases = {
    'bucksbaum properties': 'Bucksbaum Retail Properties  LLC'
  };

  const exactDecision = resolveCompanyDecision(
    { rowNumber: 2, Name: 'Test User', Company: 'Agree Realty Company' },
    companies,
    indexes,
    aliases
  );
  const aliasDecision = resolveCompanyDecision(
    { rowNumber: 3, Name: 'Test User', Company: 'BUCKSBAUM PROPERTIES' },
    companies,
    indexes,
    aliases
  );
  const reviewDecision = resolveCompanyDecision(
    { rowNumber: 4, Name: 'Test User', Company: 'Bucksbaum Retail Property' },
    companies,
    indexes,
    aliases
  );
  const createDecision = resolveCompanyDecision(
    { rowNumber: 5, Name: 'Test User', Company: 'NewQuest' },
    companies,
    indexes,
    aliases
  );

  assert.equal(exactDecision.status, 'existing');
  assert.equal(aliasDecision.status, 'existing');
  assert.equal(reviewDecision.status, 'review');
  assert.equal(createDecision.status, 'create');
});

test('runClientImport writes dry-run reports without creating Airtable records', async () => {
  const tempDir = makeTempDir();
  const workbookPath = path.join(tempDir, 'Attendees.xlsx');
  const xlsx = require('xlsx');
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet([
    {
      Name: 'Jay Sears',
      Position: 'Managing Partner',
      Company: 'NewQuest',
      Phone: '555-111-2222',
      'City/State': 'Houston, TX',
      'LinkedIn Headline': 'Owner, NewQuest',
      'LinkedIn About': '',
      'LinkedIn Experience Summary': '- Owner @ NewQuest',
      'LinkedIn Alumni': '',
      'LinkedIn Total Experience Years': '12.8',
      'LinkedIn Profile Image URL': '',
      'LinkedIn Email': 'jsears@newquest.com'
    }
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Attendees');
  xlsx.writeFile(workbook, workbookPath);

  const fakeClient = {
    createCalls: 0,
    async fetchAllRecords({ tableName }) {
      if (tableName === 'Clients') {
        return [];
      }

      return [];
    },
    async createRecords() {
      this.createCalls += 1;
      throw new Error('createRecords should not be called in dry run');
    }
  };

  const { plan, applyResult } = await runClientImport({
    airtableClient: fakeClient,
    filePath: workbookPath,
    outputDir: tempDir,
    applyMode: false,
    workingDirectory: tempDir
  });

  assert.equal(applyResult, null);
  assert.equal(plan.summary.clientsReadyToCreate, 1);
  assert.equal(fakeClient.createCalls, 0);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-import-summary.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-create-preview.json')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'client-review-queue.csv')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'company-review-queue.csv')), true);
});

test('applyImportPlan creates companies before clients and links created company ids', async () => {
  const rows = [
    {
      rowNumber: 2,
      Name: 'Jay Sears',
      Position: 'Managing Partner',
      Company: 'NewQuest',
      Phone: '555-111-2222',
      'City/State': 'Houston, TX',
      'LinkedIn Headline': 'Owner, NewQuest',
      'LinkedIn About': '',
      'LinkedIn Experience Summary': '- Owner @ NewQuest',
      'LinkedIn Alumni': '',
      'LinkedIn Total Experience Years': '12.8',
      'LinkedIn Profile Image URL': '',
      'LinkedIn Email': 'jsears@newquest.com'
    }
  ];
  const plan = planClientImport({
    rows,
    clients: [],
    companies: [],
    companyAliases: {},
    spreadsheetPath: 'Attendees.xlsx',
    mode: 'apply'
  });
  const calls = [];
  const fakeClient = {
    async createRecords({ tableName, records }) {
      calls.push({
        tableName,
        records: JSON.parse(JSON.stringify(records))
      });

      if (tableName === 'Companies') {
        return {
          records: [{ id: 'recCompany1' }]
        };
      }

      return {
        records: [{ id: 'recClient1' }]
      };
    }
  };

  const result = await applyImportPlan({
    airtableClient: fakeClient,
    outputDir: makeTempDir(),
    plan
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].tableName, 'Companies');
  assert.equal(calls[1].tableName, 'Clients');
  assert.deepEqual(calls[1].records[0].fields.Company, ['recCompany1']);
  assert.deepEqual(result.successfulCompanyIds, ['recCompany1']);
  assert.deepEqual(result.successfulClientIds, ['recClient1']);
});

test('mapClientRecord preserves normalized name and email', () => {
  const client = mapClientRecord({
    id: 'rec1',
    fields: {
      'Client Name': 'Maria Toliopoulos',
      Email: 'MTOLIOPOULOS@ULTA.COM',
      Events: ['ICSC - Phoenix 2026']
    }
  });

  assert.equal(client.normalizedFull, 'maria toliopoulos');
  assert.equal(client.email, 'mtoliopoulos@ulta.com');
});

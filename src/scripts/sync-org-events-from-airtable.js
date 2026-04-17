const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const { AirtableClient } = require('../lib/airtable-client');
const { writeCsv, writeJson } = require('../lib/report-writer');
const { scrapeOrganizationEvents } = require('../lib/org-event-scraper');
const { buildInvalidEventAuditPlan, buildPastEventRemovalPlan, buildUpsertPlan } = require('../lib/org-event-upsert');

const REQUIRED_FIELDS = {
  Organizations: [
    { name: 'Source URL', type: 'url' }
  ],
  Events: [
    { name: 'Event URL', type: 'url' }
  ]
};
const ALLOW_ALL_REGION_ORGANIZATIONS = new Set([
  '7x24',
  'harold e. eisenberg foundation',
  'icsc-national'
]);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    applyMode: false,
    limit: null,
    organizationName: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      options.applyMode = true;
      continue;
    }

    if (arg === '--dry-run') {
      continue;
    }

    if (arg === '--limit') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected a number after --limit');
      }

      options.limit = Number.parseInt(nextArg, 10);
      index += 1;
      continue;
    }

    if (arg === '--org') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected an organization name after --org');
      }

      options.organizationName = nextArg.trim();
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error('Expected --limit to be a positive integer');
  }

  return options;
}

function printHelp() {
  console.log('Usage: node src/scripts/sync-org-events-from-airtable.js [--apply] [--limit <count>] [--org "<name>"]');
  console.log('Dry run is the default. Add --apply to write Airtable records.');
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function applyBatches(action, items, size = 10) {
  const batches = chunk(items, size);
  const results = [];

  for (let index = 0; index < batches.length; index += 1) {
    results.push(await action(batches[index], index));
    if (index < batches.length - 1) {
      await sleep(250);
    }
  }

  return results;
}

function ensureOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function getTableFieldNames(table) {
  return new Set((table && Array.isArray(table.fields) ? table.fields : []).map(field => field.name));
}

function pickExistingFields(table, desiredFields) {
  const existingFieldNames = getTableFieldNames(table);
  return desiredFields.filter(field => existingFieldNames.has(field));
}

async function ensureRequiredFields(airtableClient, tablesByName, { applyMode }) {
  const createdFields = [];
  const missingFields = [];

  for (const [tableName, fieldDefinitions] of Object.entries(REQUIRED_FIELDS)) {
    const table = tablesByName.get(tableName);
    if (!table) {
      throw new Error(`Missing Airtable table: ${tableName}`);
    }

    const existingFieldNames = new Set(table.fields.map(field => field.name));
    for (const fieldDefinition of fieldDefinitions) {
      if (existingFieldNames.has(fieldDefinition.name)) {
        continue;
      }

      missingFields.push({ tableName, fieldName: fieldDefinition.name });
      if (applyMode) {
        await airtableClient.createField({
          tableId: table.id,
          field: fieldDefinition
        });
        createdFields.push({ tableName, fieldName: fieldDefinition.name });
        existingFieldNames.add(fieldDefinition.name);
      }
    }
  }

  return { createdFields, missingFields };
}

function mapOrganizationRecord(record) {
  return {
    id: record.id,
    organizationName: record.fields['Organization Name'] || '',
    sourceUrl: record.fields['Source URL'] || ''
  };
}

function createReviewRow(review) {
  return [
    review.type || 'review',
    review.organizationName || '',
    review.eventName || '',
    review.sourceUrl || '',
    review.eventUrl || '',
    review.reason || ''
  ];
}

function buildSummary({
  options,
  organizations,
  scrapedEvents,
  upsertPlan,
  auditPlan,
  removalPlan,
  reviewItems,
  missingFields,
  createdFields
}) {
  return {
    generatedAt: new Date().toISOString(),
    mode: options.applyMode ? 'apply' : 'dry-run',
    organizationCount: organizations.length,
    scrapedEventCount: scrapedEvents.length,
    eventCreateCount: upsertPlan.creates.length,
    eventUpdateCount: upsertPlan.updates.length,
    eventAuditDeleteCount: auditPlan.deletes.length,
    eventPastDeleteCount: removalPlan.deletes.length,
    eventDeleteCount: auditPlan.deletes.length + removalPlan.deletes.length,
    reviewCount: reviewItems.length,
    createdFields,
    missingFields
  };
}

async function main({ argv = process.argv.slice(2) } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const apiKey = requireEnv('AIRTABLE_API_KEY');
  const baseId = requireEnv('ORG_EVENTS_BASE_ID');
  const organizationTableName = requireEnv('ORG_EVENTS_ORGS_TABLE');
  const eventTableName = requireEnv('ORG_EVENTS_EVENTS_TABLE');
  const timezone = process.env.ORG_EVENTS_TIMEZONE || 'America/Chicago';
  const outputDir = path.resolve(process.cwd(), 'output');
  ensureOutputDir(outputDir);

  const airtableClient = new AirtableClient({ apiKey, baseId });
  let tables = await airtableClient.listTables();
  let tablesByName = new Map(tables.map(table => [table.name, table]));
  const { createdFields, missingFields } = await ensureRequiredFields(airtableClient, tablesByName, options);
  if (createdFields.length > 0) {
    tables = await airtableClient.listTables();
    tablesByName = new Map(tables.map(table => [table.name, table]));
  }

  let organizations = await airtableClient.fetchAllRecords({
    tableName: organizationTableName,
    fields: pickExistingFields(tablesByName.get(organizationTableName), ['Organization Name', 'Source URL'])
  });
  organizations = organizations.map(mapOrganizationRecord);

  if (options.organizationName) {
    const normalizedFilter = options.organizationName.toLowerCase();
    organizations = organizations.filter(record => record.organizationName.toLowerCase().includes(normalizedFilter));
  }

  if (options.limit) {
    organizations = organizations.slice(0, options.limit);
  }

  const reviewItems = [];
  const scrapedEvents = [];

  for (const organization of organizations) {
    if (!organization.sourceUrl) {
      reviewItems.push({
        type: 'source',
        organizationName: organization.organizationName,
        sourceUrl: '',
        eventUrl: '',
        reason: 'organization is missing Source URL'
      });
      continue;
    }

    try {
      const scraped = await scrapeOrganizationEvents(organization, {
        timezone,
        allowAllRegions: ALLOW_ALL_REGION_ORGANIZATIONS.has(organization.organizationName.toLowerCase())
      });
      scrapedEvents.push(...scraped.events);
      reviewItems.push(...scraped.reviewItems);
      if (scraped.events.length === 0) {
        reviewItems.push({
          type: 'event',
          organizationName: organization.organizationName,
          sourceUrl: organization.sourceUrl,
          eventUrl: '',
          reason: 'no upcoming events found on source page'
        });
      }
      console.log(`[org-events] ${organization.organizationName}: ${scraped.events.length} events, ${scraped.reviewItems.length} review items.`);
    } catch (error) {
      reviewItems.push({
        type: 'source',
        organizationName: organization.organizationName,
        sourceUrl: organization.sourceUrl,
        eventUrl: '',
        reason: `source page failed: ${error.message}`
      });
      console.log(`[org-events] ${organization.organizationName}: scrape failed (${error.message}).`);
    }
  }

  const existingEvents = await airtableClient.fetchAllRecords({
    tableName: eventTableName,
    fields: pickExistingFields(tablesByName.get(eventTableName), [
      'Event Name',
      'Organization',
      'Event Date',
      'Location',
      'Cost',
      'Event Status',
      'Event Notes',
      'Event URL'
    ])
  });

  const upsertPlan = buildUpsertPlan({
    scrapedEvents,
    existingRecords: existingEvents
  });
  const auditPlan = buildInvalidEventAuditPlan({
    existingRecords: existingEvents
  });
  const removalPlan = buildPastEventRemovalPlan({
    existingRecords: existingEvents.filter(record => !auditPlan.deletes.includes(record.id))
  });
  reviewItems.push(...upsertPlan.reviewItems);

  const summary = buildSummary({
    options,
    organizations,
    scrapedEvents,
    upsertPlan,
    auditPlan,
    removalPlan,
    reviewItems,
    missingFields,
    createdFields
  });

  writeJson(outputDir, 'org-events-summary.json', summary);
  writeJson(outputDir, 'org-events-scraped.json', scrapedEvents);
  writeJson(outputDir, 'org-events-updates-preview.json', upsertPlan.updatePreview);
  writeJson(outputDir, 'org-events-audit-preview.json', auditPlan.deletePreview);
  writeJson(outputDir, 'org-events-deletes-preview.json', removalPlan.deletePreview);
  writeCsv(
    outputDir,
    'org-events-review.csv',
    ['type', 'organization_name', 'event_name', 'source_url', 'event_url', 'reason'],
    reviewItems.map(createReviewRow)
  );

  if (!options.applyMode) {
    console.log('Dry run complete. No Airtable records were changed.');
    return;
  }

  if (upsertPlan.creates.length > 0) {
    await applyBatches(batch => airtableClient.createRecords({
      tableName: eventTableName,
      records: batch
    }), upsertPlan.creates);
  }

  if (upsertPlan.updates.length > 0) {
    await applyBatches(batch => airtableClient.updateRecords({
      tableName: eventTableName,
      records: batch
    }), upsertPlan.updates);
  }

  if (auditPlan.deletes.length > 0) {
    await applyBatches(batch => airtableClient.deleteRecords({
      tableName: eventTableName,
      recordIds: batch
    }), auditPlan.deletes);
  }

  if (removalPlan.deletes.length > 0) {
    await applyBatches(batch => airtableClient.deleteRecords({
      tableName: eventTableName,
      recordIds: batch
    }), removalPlan.deletes);
  }

  console.log(
    `Created ${upsertPlan.creates.length} event(s), updated ${upsertPlan.updates.length} event(s), removed ${auditPlan.deletes.length} invalid event(s), and removed ${removalPlan.deletes.length} past event(s).`
  );
}

module.exports = {
  main,
  parseArgs
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

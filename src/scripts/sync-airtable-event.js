const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const nicknameMap = require('../../config/nickname-map.json');
const { AirtableClient } = require('../lib/airtable-client');
const { loadAttendees } = require('../lib/attendee-loader');
const { matchAttendeesToClients, normalizeName } = require('../lib/name-matcher');
const { writeFailureSummary, writeReports } = require('../lib/report-writer');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv, defaults = {}) {
  const options = {
    applyMode: false,
    filePath: defaults.filePath || path.join('inputs', 'active', 'Attendees.xlsx'),
    eventValue: defaults.eventValue || process.env.AIRTABLE_EVENT_VALUE || ''
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

    if (arg === '--file') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected a file path after --file');
      }

      options.filePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === '--event') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected an event value after --event');
      }

      options.eventValue = nextArg;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log('Usage: node src/scripts/sync-airtable-event.js [--file <xlsx-path>] [--event <event-name>] [--apply]');
  console.log('Defaults:');
  console.log('  --file inputs/active/Attendees.xlsx');
  console.log('  --event uses AIRTABLE_EVENT_VALUE from .env if not provided');
  console.log('  dry run is the default; add --apply to update Airtable');
}

function mergeEvents(existingEvents, eventToAdd) {
  const events = Array.isArray(existingEvents) ? existingEvents : [];
  return events.includes(eventToAdd) ? events : [...events, eventToAdd];
}

function buildExclusionSet(exclusions) {
  return new Set(
    exclusions.map(exclusion => `${exclusion.attendeeName}::${exclusion.airtableRecordId}`)
  );
}

function applyManualExclusions(matchResults, exclusions) {
  const exclusionSet = buildExclusionSet(exclusions);

  const isExcluded = match => exclusionSet.has(`${match.attendeeName}::${match.airtableRecordId}`);
  const excludedReviews = matchResults.reviewMatches.filter(isExcluded);
  const excludedAutos = matchResults.autoMatches.filter(isExcluded);

  return {
    autoMatches: matchResults.autoMatches.filter(match => !isExcluded(match)),
    reviewMatches: matchResults.reviewMatches.filter(match => !isExcluded(match)),
    skipped: [
      ...matchResults.skipped,
      ...excludedAutos.map(match => ({
        status: 'skip',
        attendeeName: match.attendeeName,
        score: match.score,
        reason: 'manually excluded match',
        airtableRecordId: match.airtableRecordId,
        airtableClientName: match.airtableClientName
      })),
      ...excludedReviews.map(match => ({
        status: 'skip',
        attendeeName: match.attendeeName,
        score: match.score,
        reason: 'manually excluded match',
        airtableRecordId: match.airtableRecordId,
        airtableClientName: match.airtableClientName
      }))
    ]
  };
}

function loadOptionalManualExclusions(workingDirectory) {
  const configPath = path.join(workingDirectory, 'config', 'manual-match-exclusions.json');
  if (!fs.existsSync(configPath)) {
    return [];
  }

  const contents = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(contents);
}

function buildUpdatePayloads(autoMatches, clientsById, eventValue, eventsField) {
  const updates = [];
  const alreadyTagged = [];

  for (const match of autoMatches) {
    const client = clientsById.get(match.airtableRecordId);
    const mergedEvents = mergeEvents(client.events, eventValue);

    if (mergedEvents.length === client.events.length) {
      alreadyTagged.push(match);
      continue;
    }

    updates.push({
      id: client.id,
      fields: {
        [eventsField]: mergedEvents
      }
    });
  }

  return { updates, alreadyTagged };
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

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [value];
}

function mapClientRecord(record, nameField, eventsField, companyField) {
  const clientName = record.fields[nameField];
  const normalized = normalizeName(clientName);

  if (!normalized) {
    return null;
  }

  return {
    id: record.id,
    clientName,
    events: Array.isArray(record.fields[eventsField]) ? record.fields[eventsField] : [],
    companyNames: companyField ? toArray(record.fields[companyField]).map(value => String(value).trim()).filter(Boolean) : [],
    ...normalized
  };
}

function createSummary({
  mode,
  attendees,
  clients,
  matchResults,
  updatePayloads,
  spreadsheetPath,
  eventValue
}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    spreadsheetPath,
    eventValue,
    attendeeCount: attendees.length,
    airtableClientCount: clients.length,
    exactAutoMatches: matchResults.autoMatches.filter(match => match.matchType === 'exact').length,
    nicknameAutoMatches: matchResults.autoMatches.filter(match => match.matchType === 'nickname').length,
    reviewQueueCount: matchResults.reviewMatches.length,
    alreadyTaggedCount: updatePayloads.alreadyTagged.length,
    updateCount: updatePayloads.updates.length,
    skippedCount: matchResults.skipped.length,
    updateRecordIds: updatePayloads.updates.map(update => update.id),
    alreadyTaggedRecords: updatePayloads.alreadyTagged.map(match => ({
      attendeeName: match.attendeeName,
      airtableClientName: match.airtableClientName,
      recordId: match.airtableRecordId
    }))
  };
}

function printSummary(summary) {
  console.log(`Spreadsheet: ${summary.spreadsheetPath}`);
  console.log(`Event value: ${summary.eventValue}`);
  console.log(`Attendees processed: ${summary.attendeeCount}`);
  console.log(`Airtable clients loaded: ${summary.airtableClientCount}`);
  console.log(`Exact auto matches: ${summary.exactAutoMatches}`);
  console.log(`Nickname auto matches: ${summary.nicknameAutoMatches}`);
  console.log(`Auto matches ready to update: ${summary.updateCount}`);
  console.log(`Already tagged: ${summary.alreadyTaggedCount}`);
  console.log(`Review queue: ${summary.reviewQueueCount}`);
  console.log(`Skipped: ${summary.skippedCount}`);
}

async function updateClientsInBatches(client, tableName, updates, outputDir) {
  const batches = chunk(updates, 10);
  const successfulRecordIds = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];

    try {
      await client.updateRecords({ tableName, records: batch });
      successfulRecordIds.push(...batch.map(record => record.id));
    } catch (error) {
      writeFailureSummary(outputDir, {
        generatedAt: new Date().toISOString(),
        failedBatchIndex: index,
        failedRecordIds: batch.map(record => record.id),
        successfulRecordIds,
        error: error.message
      });
      throw error;
    }

    if (index < batches.length - 1) {
      await sleep(250);
    }
  }
}

async function main({ argv = process.argv.slice(2), defaults = {} } = {}) {
  const options = parseArgs(argv, defaults);

  if (options.help) {
    printHelp();
    return;
  }

  const apiKey = requireEnv('AIRTABLE_API_KEY');
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const tableName = requireEnv('AIRTABLE_TABLE_NAME');
  const eventValue = options.eventValue || requireEnv('AIRTABLE_EVENT_VALUE');
  const nameField = requireEnv('AIRTABLE_NAME_FIELD');
  const eventsField = requireEnv('AIRTABLE_EVENTS_FIELD');
  const companyField = process.env.AIRTABLE_COMPANY_FIELD || '';

  const workingDirectory = process.cwd();
  const attendeesPath = path.resolve(workingDirectory, options.filePath);
  const outputDir = path.resolve(workingDirectory, 'output');
  const manualMatchExclusions = loadOptionalManualExclusions(workingDirectory);
  const airtableClient = new AirtableClient({ apiKey, baseId });

  const attendees = loadAttendees(attendeesPath, { normalizeName });
  const rawClientRecords = await airtableClient.fetchAllRecords({
    tableName,
    fields: [nameField, eventsField, ...(companyField ? [companyField] : [])]
  });
  const clients = rawClientRecords
    .map(record => mapClientRecord(record, nameField, eventsField, companyField))
    .filter(Boolean);
  const clientsById = new Map(clients.map(client => [client.id, client]));

  const rawMatchResults = matchAttendeesToClients(attendees, clients, nicknameMap);
  const matchResults = applyManualExclusions(rawMatchResults, manualMatchExclusions);
  const updatePayloads = buildUpdatePayloads(matchResults.autoMatches, clientsById, eventValue, eventsField);
  const summary = createSummary({
    mode: options.applyMode ? 'apply' : 'dry-run',
    attendees,
    clients,
    matchResults,
    updatePayloads,
    spreadsheetPath: attendeesPath,
    eventValue
  });

  writeReports({
    outputDir,
    summary,
    reviewMatches: matchResults.reviewMatches
  });
  printSummary(summary);

  if (!options.applyMode) {
    console.log('Dry run complete. No Airtable records were changed.');
    return;
  }

  await updateClientsInBatches(airtableClient, tableName, updatePayloads.updates, outputDir);
  console.log(`Updated ${updatePayloads.updates.length} Airtable records.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  applyManualExclusions,
  buildUpdatePayloads,
  loadOptionalManualExclusions,
  main,
  mergeEvents,
  parseArgs
};

const path = require('path');

require('dotenv').config({ quiet: true });

const { AirtableClient } = require('../lib/airtable-client');
const { runClientImport } = require('../lib/client-import');

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
    filePath: defaults.filePath || path.join('output', 'Phoenix 2026 Attendees-priorities.generic.enriched.xlsx')
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

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log('Usage: node src/scripts/import-airtable-clients.js [--file <xlsx-path>] [--apply]');
  console.log('Defaults:');
  console.log('  --file output/Phoenix 2026 Attendees-priorities.generic.enriched.xlsx');
  console.log('  dry run is the default; add --apply to create Airtable records');
}

function printSummary(summary, applyResult) {
  console.log(`Spreadsheet: ${summary.spreadsheetPath}`);
  console.log(`Rows processed: ${summary.totalSpreadsheetRows}`);
  console.log(`Airtable clients loaded: ${summary.airtableClientCount}`);
  console.log(`Airtable companies loaded: ${summary.airtableCompanyCount}`);
  console.log(`Existing clients skipped: ${summary.existingClientsSkipped}`);
  console.log(`Client review queue: ${summary.clientReviewCount}`);
  console.log(`Company review queue: ${summary.companyReviewCount}`);
  console.log(`Companies to create: ${summary.companiesToCreate}`);
  console.log(`Clients ready to create: ${summary.clientsReadyToCreate}`);

  if (applyResult) {
    console.log(`Companies created: ${applyResult.successfulCompanyIds.length}`);
    console.log(`Clients created: ${applyResult.successfulClientIds.length}`);
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
  const workingDirectory = process.cwd();
  const outputDir = path.resolve(workingDirectory, 'output');
  const filePath = path.resolve(workingDirectory, options.filePath);
  const airtableClient = new AirtableClient({ apiKey, baseId });
  const clientTableName = process.env.AIRTABLE_TABLE_NAME || 'Clients';

  const { plan, applyResult } = await runClientImport({
    airtableClient,
    filePath,
    outputDir,
    applyMode: options.applyMode,
    clientTableName,
    companyTableName: 'Companies',
    workingDirectory
  });

  printSummary(plan.summary, applyResult);

  if (!options.applyMode) {
    console.log('Dry run complete. No Airtable records were changed.');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs
};

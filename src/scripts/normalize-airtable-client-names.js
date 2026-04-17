const path = require('path');

require('dotenv').config({ quiet: true });

const { AirtableClient } = require('../lib/airtable-client');
const { runClientNameCleanup } = require('../lib/client-name-cleanup');

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    applyMode: false
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

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log('Usage: node src/scripts/normalize-airtable-client-names.js [--apply]');
  console.log('Defaults:');
  console.log('  dry run is the default; add --apply to update Airtable');
}

function printSummary(summary, applyResult) {
  console.log(`Airtable records scanned: ${summary.recordsScanned}`);
  console.log(`Names already clean: ${summary.unchangedCount}`);
  console.log(`Names skipped as empty after normalization: ${summary.skippedEmptyCount}`);
  console.log(`Names ready to update: ${summary.updateCount}`);

  if (applyResult) {
    console.log(`Names updated: ${applyResult.successfulRecordIds.length}`);
  }
}

async function main({ argv = process.argv.slice(2) } = {}) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return;
  }

  const apiKey = requireEnv('AIRTABLE_API_KEY');
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const workingDirectory = process.cwd();
  const outputDir = path.resolve(workingDirectory, 'output');
  const airtableClient = new AirtableClient({ apiKey, baseId });
  const tableName = process.env.AIRTABLE_TABLE_NAME || 'Clients';

  const { plan, applyResult } = await runClientNameCleanup({
    airtableClient,
    outputDir,
    applyMode: options.applyMode,
    tableName
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

const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const { ApifyClient } = require('../lib/apify-client');
const { loadAttendeeSheet } = require('../lib/attendee-sheet-loader');
const {
  createMatchingConfig,
  DEFAULT_GOOGLE_ACTOR_ID,
  DEFAULT_LINKEDIN_ACTOR_ID,
  ENRICHMENT_COLUMNS,
  normalizeLinkedInUrl,
  runGoogleLinkedInSearch,
  runLinkedInScrape,
  mergeEnrichment
} = require('../lib/linkedin-enrichment');
const { writeEnrichedWorkbook } = require('../lib/workbook-writer');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv, defaults = {}) {
  const options = {
    filePath: defaults.filePath || path.join('inputs', 'active', 'Attendees.xlsx'),
    outputPath: defaults.outputPath || null,
    payloadPath: defaults.payloadPath || null,
    googleActorId: process.env.APIFY_GOOGLE_ACTOR_ID || defaults.googleActorId || DEFAULT_GOOGLE_ACTOR_ID,
    linkedInActorId: process.env.APIFY_LINKEDIN_ACTOR_ID || defaults.linkedInActorId || DEFAULT_LINKEDIN_ACTOR_ID,
    limit: null,
    resume: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--file') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected a file path after --file');
      }

      options.filePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === '--output') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected an output path after --output');
      }

      options.outputPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === '--payload') {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error('Expected a payload path after --payload');
      }

      options.payloadPath = nextArg;
      index += 1;
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

    if (arg === '--resume') {
      options.resume = true;
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
  console.log('Usage: node src/scripts/enrich-attendee-linkedin.js [options]');
  console.log('Options:');
  console.log('  --file <path>     Source workbook path (default: inputs/active/Attendees.xlsx)');
  console.log('  --output <path>   Output workbook path (default: output/<input>.enriched.xlsx)');
  console.log('  --payload <path>  Base Google actor payload JSON (default: bundled payload)');
  console.log('  --limit <n>       Only process the first n attendees');
  console.log('  --resume          Reuse output/google-search-results.json and output/linkedin-profile-results.json when possible');
  console.log('  --help            Show this help text');
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return readJsonFile(filePath);
}

function csvEscape(value) {
  const stringValue = String(value ?? '');

  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeReviewCsv(filePath, reviewQueue) {
  const lines = [
    'row_number,attendee_name,stage,status,linkedin_url,reason'
  ];

  for (const item of reviewQueue) {
    lines.push([
      csvEscape(item.rowNumber),
      csvEscape(item.attendeeName),
      csvEscape(item.stage),
      csvEscape(item.status),
      csvEscape(item.linkedInUrl),
      csvEscape(item.reason)
    ].join(','));
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function resolveBundledPath(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

function resolveDefaultOutputPath(filePath) {
  const parsed = path.parse(filePath);
  return path.join('output', `${parsed.name}.enriched${parsed.ext || '.xlsx'}`);
}

function loadResumeCache(options, outputDir) {
  if (!options.resume) {
    return {
      googleCache: {},
      linkedInCache: {}
    };
  }

  const googleArtifact = readOptionalJson(path.join(outputDir, 'google-search-results.json'));
  const linkedInArtifact = readOptionalJson(path.join(outputDir, 'linkedin-profile-results.json'));

  return {
    googleCache: Object.fromEntries(
      (googleArtifact && Array.isArray(googleArtifact.rows) ? googleArtifact.rows : [])
        .map(entry => [String(entry.rowNumber), entry])
    ),
    linkedInCache: Object.fromEntries(
      (linkedInArtifact && Array.isArray(linkedInArtifact.profiles) ? linkedInArtifact.profiles : [])
        .map(entry => [normalizeLinkedInUrl(entry.requestedUrl), entry])
    )
  };
}

function loadMatchingConfig(workingDirectory) {
  const configDir = path.join(workingDirectory, 'config');
  const nameAliases = readOptionalJson(path.join(configDir, 'name-aliases.json')) || {};
  const companyAliases = readOptionalJson(path.join(configDir, 'company-aliases.json')) || {};

  return createMatchingConfig({
    nameAliases,
    companyAliases
  });
}

function createSummary({
  sourceFile,
  outputFile,
  attendees,
  searchResults,
  profileResultsByUrl,
  reviewQueue,
  resumeUsed
}) {
  return {
    generatedAt: new Date().toISOString(),
    sourceFile,
    outputFile,
    attendeeCount: attendees.length,
    linkedInUrlCount: searchResults.filter(result => result.linkedInUrl).length,
    foundSearchCount: searchResults.filter(result => result.searchStatus === 'found').length,
    reviewSearchCount: searchResults.filter(result => result.searchStatus === 'review').length,
    invalidSearchCount: searchResults.filter(result => result.searchStatus === 'invalid_first_result').length,
    notFoundSearchCount: searchResults.filter(result => result.searchStatus === 'not_found').length,
    profileScrapeCount: [...profileResultsByUrl.values()].filter(result => result.scrapeStatus === 'scraped').length,
    partialProfileCount: [...profileResultsByUrl.values()].filter(result => result.scrapeStatus === 'partial').length,
    missingProfileCount: [...profileResultsByUrl.values()].filter(result => result.scrapeStatus === 'not_found').length,
    reviewQueueCount: reviewQueue.length,
    resumeUsed
  };
}

function printSummary(summary) {
  console.log(`Rows processed: ${summary.attendeeCount}`);
  console.log(`LinkedIn URLs found: ${summary.linkedInUrlCount}`);
  console.log(`Profiles scraped: ${summary.profileScrapeCount}`);
  console.log(`Profiles partial: ${summary.partialProfileCount}`);
  console.log(`Review required: ${summary.reviewQueueCount}`);
  console.log(`Resume used: ${summary.resumeUsed ? 'yes' : 'no'}`);
  console.log(`Output workbook: ${summary.outputFile}`);
}

async function main({ argv = process.argv.slice(2), defaults = {} } = {}) {
  const options = parseArgs(argv, defaults);

  if (options.help) {
    printHelp();
    return;
  }

  const apifyClient = new ApifyClient({
    token: requireEnv('APIFY_API_TOKEN')
  });
  const workingDirectory = process.cwd();
  const sourceFile = path.resolve(workingDirectory, options.filePath);
  const payloadPath = options.payloadPath
    ? path.resolve(workingDirectory, options.payloadPath)
    : resolveBundledPath('assets', 'google-search-base.json');
  const outputFile = path.resolve(workingDirectory, options.outputPath || resolveDefaultOutputPath(options.filePath));
  const outputDir = path.dirname(outputFile);
  const payloadTemplate = readJsonFile(payloadPath);
  const { attendees: loadedAttendees, sheetName } = loadAttendeeSheet(sourceFile);
  const attendees = options.limit ? loadedAttendees.slice(0, options.limit) : loadedAttendees;
  const attendeesByRow = new Map(attendees.map(attendee => [attendee.rowNumber, attendee]));
  const { googleCache, linkedInCache } = loadResumeCache(options, outputDir);
  const matchingConfig = loadMatchingConfig(workingDirectory);

  if (attendees.length === 0) {
    throw new Error('No attendee rows found in workbook');
  }

  ensureDirectory(outputDir);

  const { results: searchResults, rawResults: googleRows } = await runGoogleLinkedInSearch(attendees, {
    apifyClient,
    actorId: options.googleActorId,
    payloadTemplate,
    matchingConfig,
    cacheEntries: googleCache,
    onProgress: attendee => {
      console.log(`Google search: ${attendee.searchContext.name}`);
    }
  });

  const { resultsByUrl: profileResultsByUrl, rawResults: linkedInProfiles } = await runLinkedInScrape(searchResults, attendeesByRow, {
    apifyClient,
    actorId: options.linkedInActorId,
    matchingConfig,
    cacheEntries: linkedInCache,
    onProgress: urls => {
      const batch = Array.isArray(urls) ? urls : [urls];
      console.log(`LinkedIn scrape batch: ${batch.length} URL(s)`);
    }
  });

  const { enrichedRows, reviewQueue } = mergeEnrichment(attendees, searchResults, profileResultsByUrl);

  writeEnrichedWorkbook({
    sourceFile,
    outputFile,
    enrichedRows,
    sheetName,
    enrichmentColumns: ENRICHMENT_COLUMNS
  });

  const summary = createSummary({
    sourceFile,
    outputFile,
    attendees,
    searchResults,
    profileResultsByUrl,
    reviewQueue,
    resumeUsed: options.resume
  });

  writeJson(path.join(outputDir, 'google-search-results.json'), {
    generatedAt: new Date().toISOString(),
    actorId: options.googleActorId,
    rows: googleRows
  });
  writeJson(path.join(outputDir, 'linkedin-profile-results.json'), {
    generatedAt: new Date().toISOString(),
    actorId: options.linkedInActorId,
    profiles: linkedInProfiles
  });
  writeJson(path.join(outputDir, 'linkedin-review-queue.json'), reviewQueue);
  writeReviewCsv(path.join(outputDir, 'linkedin-review-queue.csv'), reviewQueue);
  writeJson(path.join(outputDir, 'linkedin-enrichment-summary.json'), summary);

  printSummary(summary);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  resolveDefaultOutputPath
};

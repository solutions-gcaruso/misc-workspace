const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { distance } = require('fastest-levenshtein');

const nicknameMap = require('../../config/nickname-map.json');
const { matchAttendeesToClients, normalizeName, normalizeText } = require('./name-matcher');
const {
  writeClientImportFailureSummary,
  writeClientImportReports
} = require('./report-writer');

const DEFAULT_EVENT_VALUE = 'ICSC - Phoenix 2026';
const CLIENT_BATCH_SIZE = 10;
const COMPANY_BATCH_SIZE = 10;
const COMPANY_REVIEW_LIMIT = 3;
const COMPANY_LEGAL_SUFFIXES = new Set([
  'llc',
  'inc',
  'corp',
  'corporation',
  'company',
  'co',
  'ltd',
  'limited',
  'pllc',
  'lp',
  'llp'
]);
const COMPANY_GENERIC_TOKENS = new Set([
  'company',
  'co',
  'corporation',
  'corp',
  'group',
  'properties',
  'property',
  'realty',
  'commercial',
  'holdings',
  'investments',
  'investment',
  'partners',
  'partner',
  'development',
  'developers',
  'reit'
]);

function normalizeEmail(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || '';
}

function splitCamelCase(value) {
  return String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function normalizeCompanyName(value) {
  return normalizeText(splitCamelCase(value));
}

function stripCompanySuffixTokens(tokens) {
  const trimmed = [...tokens];

  while (trimmed.length > 1 && COMPANY_LEGAL_SUFFIXES.has(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }

  return trimmed;
}

function tokenizeCompanyName(value, { stripLegalSuffixes = false } = {}) {
  const normalized = normalizeCompanyName(value);

  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(' ').filter(Boolean);
  return stripLegalSuffixes ? stripCompanySuffixTokens(tokens) : tokens;
}

function buildCompanyCoreKey(value) {
  const tokens = tokenizeCompanyName(value, { stripLegalSuffixes: true });
  return tokens.join('');
}

function getSignificantCompanyTokens(value) {
  return tokenizeCompanyName(value, { stripLegalSuffixes: true }).filter(
    token => !COMPANY_GENERIC_TOKENS.has(token)
  );
}

function similarityScore(valueA, valueB) {
  const maxLength = Math.max(valueA.length, valueB.length);

  if (maxLength === 0) {
    return 1;
  }

  return 1 - distance(valueA, valueB) / maxLength;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
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

function loadOptionalCompanyAliases(workingDirectory) {
  const configPath = path.join(workingDirectory, 'config', 'company-aliases.json');

  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function loadImportRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    ...row
  }));
}

function mapClientRecord(record) {
  const clientName = record.fields['Client Name'];
  const normalized = normalizeName(clientName);

  if (!normalized) {
    return null;
  }

  return {
    id: record.id,
    clientName,
    email: normalizeEmail(record.fields.Email),
    events: Array.isArray(record.fields.Events) ? record.fields.Events : [],
    ...normalized
  };
}

function mapCompanyRecord(record) {
  const companyName = String(record.fields['Company Name'] ?? '').trim();
  const normalizedCompanyName = normalizeCompanyName(companyName);

  if (!normalizedCompanyName) {
    return null;
  }

  return {
    id: record.id,
    companyName,
    normalizedCompanyName,
    coreKey: buildCompanyCoreKey(companyName),
    significantTokens: getSignificantCompanyTokens(companyName)
  };
}

function buildClientIndexes(clients) {
  const emailToClients = new Map();
  const normalizedNameToClients = new Map();

  for (const client of clients) {
    if (client.email) {
      if (!emailToClients.has(client.email)) {
        emailToClients.set(client.email, []);
      }

      emailToClients.get(client.email).push(client);
    }

    if (!normalizedNameToClients.has(client.normalizedFull)) {
      normalizedNameToClients.set(client.normalizedFull, []);
    }

    normalizedNameToClients.get(client.normalizedFull).push(client);
  }

  return { emailToClients, normalizedNameToClients };
}

function buildCompanyIndexes(companies) {
  const normalizedNameToCompanies = new Map();
  const coreKeyToCompanies = new Map();

  for (const company of companies) {
    if (!normalizedNameToCompanies.has(company.normalizedCompanyName)) {
      normalizedNameToCompanies.set(company.normalizedCompanyName, []);
    }

    normalizedNameToCompanies.get(company.normalizedCompanyName).push(company);

    if (company.coreKey) {
      if (!coreKeyToCompanies.has(company.coreKey)) {
        coreKeyToCompanies.set(company.coreKey, []);
      }

      coreKeyToCompanies.get(company.coreKey).push(company);
    }
  }

  return { normalizedNameToCompanies, coreKeyToCompanies };
}

function buildClientReviewDecision(row, match) {
  return {
    status: 'review',
    rowNumber: row.rowNumber,
    attendeeName: row.Name,
    airtableRecordId: match.airtableRecordId,
    airtableClientName: match.airtableClientName,
    score: match.score,
    reason: match.reason
  };
}

function findExistingClientDecision(row, clients, indexes) {
  const attendee = normalizeName(row.Name);

  if (!attendee) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      reason: 'missing or invalid attendee name'
    };
  }

  const attendeeEmail = normalizeEmail(row['LinkedIn Email']);

  if (attendeeEmail) {
    const emailMatches = indexes.emailToClients.get(attendeeEmail) || [];

    if (emailMatches.length === 1) {
      return {
        status: 'existing',
        rowNumber: row.rowNumber,
        attendeeName: row.Name,
        matchType: 'email',
        airtableRecordId: emailMatches[0].id,
        airtableClientName: emailMatches[0].clientName,
        reason: 'exact email match'
      };
    }

    if (emailMatches.length > 1) {
      return {
        status: 'review',
        rowNumber: row.rowNumber,
        attendeeName: row.Name,
        reason: 'multiple Airtable clients share the same email',
        matches: emailMatches
      };
    }
  }

  const nameMatches = indexes.normalizedNameToClients.get(attendee.normalizedFull) || [];

  if (nameMatches.length === 1) {
    return {
      status: 'existing',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      matchType: 'name',
      airtableRecordId: nameMatches[0].id,
      airtableClientName: nameMatches[0].clientName,
      reason: 'exact normalized full-name match'
    };
  }

  if (nameMatches.length > 1) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      reason: 'multiple Airtable clients share the same normalized name',
      matches: nameMatches
    };
  }

  const fuzzyMatches = matchAttendeesToClients([attendee], clients, nicknameMap);
  const fuzzyMatch = fuzzyMatches.autoMatches[0] || fuzzyMatches.reviewMatches[0];

  if (fuzzyMatch) {
    return buildClientReviewDecision(row, fuzzyMatch);
  }

  return {
    status: 'new',
    rowNumber: row.rowNumber,
    attendeeName: row.Name
  };
}

function calculateTokenJaccard(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const union = new Set([...left, ...right]);

  if (union.size === 0) {
    return 0;
  }

  let intersectionSize = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersectionSize += 1;
    }
  }

  return intersectionSize / union.size;
}

function findCompanyReviewCandidates(companyName, companies) {
  const normalizedCompanyName = normalizeCompanyName(companyName);
  const coreKey = buildCompanyCoreKey(companyName);
  const significantTokens = getSignificantCompanyTokens(companyName);

  return companies
    .map(company => {
      const sharedTokens = significantTokens.filter(token => company.significantTokens.includes(token));

      if (sharedTokens.length === 0) {
        return null;
      }

      const normalizedSimilarity = similarityScore(normalizedCompanyName, company.normalizedCompanyName);
      const coreSimilarity = similarityScore(coreKey, company.coreKey);
      const tokenJaccard = calculateTokenJaccard(significantTokens, company.significantTokens);
      const score = Number(Math.max(normalizedSimilarity, coreSimilarity, tokenJaccard).toFixed(3));

      if (tokenJaccard < 0.5 && normalizedSimilarity < 0.62 && coreSimilarity < 0.72) {
        return null;
      }

      return {
        id: company.id,
        companyName: company.companyName,
        score,
        sharedTokens
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, COMPANY_REVIEW_LIMIT);
}

function resolveCompanyDecision(row, companies, indexes, aliases) {
  const companyName = String(row.Company ?? '').trim();

  if (!companyName) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      candidates: [],
      reason: 'missing company name'
    };
  }

  const normalizedCompanyName = normalizeCompanyName(companyName);
  const exactMatches = indexes.normalizedNameToCompanies.get(normalizedCompanyName) || [];

  if (exactMatches.length === 1) {
    return {
      status: 'existing',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      reason: 'exact normalized company name match',
      company: exactMatches[0]
    };
  }

  if (exactMatches.length > 1) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      candidates: exactMatches.map(match => ({
        id: match.id,
        companyName: match.companyName,
        score: 1
      })),
      reason: 'multiple Airtable company records share the same normalized name'
    };
  }

  const aliasTargetName = aliases[normalizedCompanyName];

  if (aliasTargetName) {
    const aliasMatches = indexes.normalizedNameToCompanies.get(normalizeCompanyName(aliasTargetName)) || [];

    if (aliasMatches.length === 1) {
      return {
        status: 'existing',
        rowNumber: row.rowNumber,
        attendeeName: row.Name,
        companyName,
        reason: 'company alias match',
        company: aliasMatches[0]
      };
    }

    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      candidates: aliasMatches.map(match => ({
        id: match.id,
        companyName: match.companyName,
        score: 1
      })),
      reason: 'company alias points to zero or multiple Airtable companies'
    };
  }

  const coreKey = buildCompanyCoreKey(companyName);
  const coreMatches = indexes.coreKeyToCompanies.get(coreKey) || [];

  if (coreMatches.length === 1) {
    return {
      status: 'existing',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      reason: 'company core-name match after stripping suffix noise',
      company: coreMatches[0]
    };
  }

  if (coreMatches.length > 1) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      candidates: coreMatches.map(match => ({
        id: match.id,
        companyName: match.companyName,
        score: 1
      })),
      reason: 'multiple Airtable companies share the same core name'
    };
  }

  const reviewCandidates = findCompanyReviewCandidates(companyName, companies);

  if (reviewCandidates.length > 0) {
    return {
      status: 'review',
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      companyName,
      candidates: reviewCandidates,
      reason: 'plausible Airtable company variants need review'
    };
  }

  return {
    status: 'create',
    rowNumber: row.rowNumber,
    attendeeName: row.Name,
    companyName,
    normalizedCompanyName
  };
}

function buildClientFields(row, companyRecordId) {
  const notes = [
    row['LinkedIn Headline'] && `Headline: ${row['LinkedIn Headline']}`,
    row['LinkedIn About'] && `About: ${row['LinkedIn About']}`,
    row['LinkedIn Experience Summary'] && `Experience: ${row['LinkedIn Experience Summary']}`
  ]
    .filter(Boolean)
    .join('\n\n');
  const years = Number.parseFloat(row['LinkedIn Total Experience Years']);
  const age = Number.isFinite(years) ? String(Math.round(years + 20)) : undefined;

  return compactObject({
    'Client Name': String(row.Name ?? '').trim() || undefined,
    Company: companyRecordId ? [companyRecordId] : undefined,
    'Job Title': String(row.Position ?? '').trim() || undefined,
    Priority: '00 - Target',
    Events: [DEFAULT_EVENT_VALUE],
    'Phone Number': String(row.Phone ?? '').trim() || undefined,
    'Current Location': String(row['City/State'] ?? '').trim() || undefined,
    'Professional/Business Notes (Handwritten)': notes || undefined,
    Alumni: String(row['LinkedIn Alumni'] ?? '').trim() || undefined,
    'Estimated Age': age,
    Headshot: String(row['LinkedIn Profile Image URL'] ?? '').trim() || undefined,
    Email: normalizeEmail(row['LinkedIn Email']) || undefined
  });
}

function buildClientPreviewFields(row, companyReference) {
  const companyValue = companyReference.type === 'existing'
    ? [companyReference.id]
    : [`__planned_company__:${companyReference.companyName}`];

  return buildClientFields(row, companyValue[0]);
}

function createSummary({
  mode,
  spreadsheetPath,
  rows,
  clients,
  companies,
  existingClients,
  clientReviews,
  companyReviews,
  companyCreates,
  clientCreatePayloads
}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    spreadsheetPath,
    eventValue: DEFAULT_EVENT_VALUE,
    totalSpreadsheetRows: rows.length,
    airtableClientCount: clients.length,
    airtableCompanyCount: companies.length,
    existingClientsSkipped: existingClients.length,
    clientReviewCount: clientReviews.length,
    companyReviewCount: companyReviews.length,
    companiesToCreate: companyCreates.length,
    clientsReadyToCreate: clientCreatePayloads.length,
    existingClientMatches: existingClients.map(item => ({
      rowNumber: item.rowNumber,
      attendeeName: item.attendeeName,
      airtableClientName: item.airtableClientName,
      airtableRecordId: item.airtableRecordId,
      matchType: item.matchType,
      reason: item.reason
    }))
  };
}

function buildPreview(companyCreates, clientCreatePayloads) {
  return {
    companyCreates: companyCreates.map(companyCreate => ({
      companyName: companyCreate.companyName,
      sourceRows: companyCreate.sourceRows,
      record: companyCreate.record
    })),
    clientCreates: clientCreatePayloads.map(payload => ({
      rowNumber: payload.rowNumber,
      attendeeName: payload.attendeeName,
      companyReference: payload.companyReference,
      record: {
        fields: buildClientPreviewFields(payload.row, payload.companyReference)
      }
    }))
  };
}

function planClientImport({
  rows,
  clients,
  companies,
  companyAliases,
  spreadsheetPath,
  mode
}) {
  const clientIndexes = buildClientIndexes(clients);
  const companyIndexes = buildCompanyIndexes(companies);
  const existingClients = [];
  const clientReviews = [];
  const companyReviews = [];
  const companyCreates = [];
  const clientCreatePayloads = [];
  const plannedCompaniesByName = new Map();

  for (const row of rows) {
    const clientDecision = findExistingClientDecision(row, clients, clientIndexes);

    if (clientDecision.status === 'existing') {
      existingClients.push(clientDecision);
      continue;
    }

    if (clientDecision.status === 'review') {
      clientReviews.push(clientDecision);
      continue;
    }

    const companyDecision = resolveCompanyDecision(row, companies, companyIndexes, companyAliases);

    if (companyDecision.status === 'review') {
      companyReviews.push(companyDecision);
      continue;
    }

    let companyReference;

    if (companyDecision.status === 'existing') {
      companyReference = {
        type: 'existing',
        id: companyDecision.company.id,
        companyName: companyDecision.company.companyName
      };
    } else {
      const createKey = companyDecision.normalizedCompanyName;
      let plannedCompany = plannedCompaniesByName.get(createKey);

      if (!plannedCompany) {
        plannedCompany = {
          key: createKey,
          companyName: companyDecision.companyName,
          sourceRows: [row.rowNumber],
          record: {
            fields: {
              'Company Name': companyDecision.companyName
            }
          }
        };
        plannedCompaniesByName.set(createKey, plannedCompany);
        companyCreates.push(plannedCompany);
      } else if (!plannedCompany.sourceRows.includes(row.rowNumber)) {
        plannedCompany.sourceRows.push(row.rowNumber);
      }

      companyReference = {
        type: 'planned',
        key: plannedCompany.key,
        companyName: plannedCompany.companyName
      };
    }

    clientCreatePayloads.push({
      rowNumber: row.rowNumber,
      attendeeName: row.Name,
      row,
      companyReference
    });
  }

  const summary = createSummary({
    mode,
    spreadsheetPath,
    rows,
    clients,
    companies,
    existingClients,
    clientReviews,
    companyReviews,
    companyCreates,
    clientCreatePayloads
  });

  return {
    rows,
    summary,
    existingClients,
    clientReviews,
    companyReviews,
    companyCreates,
    clientCreatePayloads,
    preview: buildPreview(companyCreates, clientCreatePayloads)
  };
}

function resolveCompanyRecordId(companyReference, createdCompanyIds) {
  if (companyReference.type === 'existing') {
    return companyReference.id;
  }

  return createdCompanyIds.get(companyReference.key);
}

function buildClientRecords(clientCreatePayloads, createdCompanyIds) {
  return clientCreatePayloads.map(payload => ({
    rowNumber: payload.rowNumber,
    attendeeName: payload.attendeeName,
    record: {
      fields: buildClientFields(
        payload.row,
        resolveCompanyRecordId(payload.companyReference, createdCompanyIds)
      )
    }
  }));
}

async function createRecordsInBatches({
  airtableClient,
  tableName,
  records,
  batchSize,
  delayMs,
  onSuccess
}) {
  const batches = chunk(records, batchSize);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const response = await airtableClient.createRecords({
      tableName,
      records: batch.map(item => item.record)
    });

    if (onSuccess) {
      onSuccess({ batchIndex: index, batch, response });
    }

    if (index < batches.length - 1) {
      await sleep(delayMs);
    }
  }
}

async function applyImportPlan({
  airtableClient,
  outputDir,
  plan,
  clientTableName = 'Clients',
  companyTableName = 'Companies'
}) {
  const createdCompanyIds = new Map();
  const successfulCompanyIds = [];
  const successfulClientIds = [];
  const successfulClientRows = new Set();

  try {
    await createRecordsInBatches({
      airtableClient,
      tableName: companyTableName,
      records: plan.companyCreates.map(companyCreate => ({
        key: companyCreate.key,
        record: companyCreate.record
      })),
      batchSize: COMPANY_BATCH_SIZE,
      delayMs: 250,
      onSuccess: ({ batch, response }) => {
        response.records.forEach((record, index) => {
          const batchItem = batch[index];
          createdCompanyIds.set(batchItem.key, record.id);
          successfulCompanyIds.push(record.id);
        });
      }
    });

    const clientRecords = buildClientRecords(plan.clientCreatePayloads, createdCompanyIds);

    await createRecordsInBatches({
      airtableClient,
      tableName: clientTableName,
      records: clientRecords,
      batchSize: CLIENT_BATCH_SIZE,
      delayMs: 250,
      onSuccess: ({ batch, response }) => {
        response.records.forEach((record, index) => {
          successfulClientIds.push(record.id);
          successfulClientRows.add(batch[index].rowNumber);
        });
      }
    });

    return {
      createdCompanyIds,
      successfulCompanyIds,
      successfulClientIds
    };
  } catch (error) {
    writeClientImportFailureSummary(outputDir, {
      generatedAt: new Date().toISOString(),
      error: error.message,
      successfulCompanyIds,
      successfulClientIds,
      remainingCompanyCreates: plan.companyCreates
        .filter(companyCreate => !createdCompanyIds.has(companyCreate.key))
        .map(companyCreate => companyCreate.companyName),
      remainingClientCreates: plan.clientCreatePayloads
        .filter(payload => !successfulClientRows.has(payload.rowNumber))
        .map(payload => ({
          rowNumber: payload.rowNumber,
          attendeeName: payload.attendeeName
        }))
    });
    throw error;
  }
}

async function runClientImport({
  airtableClient,
  filePath,
  outputDir,
  applyMode,
  clientTableName = 'Clients',
  companyTableName = 'Companies',
  workingDirectory = process.cwd()
}) {
  const rows = loadImportRows(filePath);
  const companyAliases = loadOptionalCompanyAliases(workingDirectory);
  const [rawClients, rawCompanies] = await Promise.all([
    airtableClient.fetchAllRecords({
      tableName: clientTableName,
      fields: ['Client Name', 'Email', 'Company', 'Events']
    }),
    airtableClient.fetchAllRecords({
      tableName: companyTableName,
      fields: ['Company Name']
    })
  ]);
  const clients = rawClients.map(mapClientRecord).filter(Boolean);
  const companies = rawCompanies.map(mapCompanyRecord).filter(Boolean);
  const plan = planClientImport({
    rows,
    clients,
    companies,
    companyAliases,
    spreadsheetPath: filePath,
    mode: applyMode ? 'apply' : 'dry-run'
  });

  writeClientImportReports({
    outputDir,
    summary: plan.summary,
    clientReviews: plan.clientReviews,
    companyReviews: plan.companyReviews,
    preview: plan.preview
  });

  if (!applyMode) {
    return {
      plan,
      applyResult: null
    };
  }

  const applyResult = await applyImportPlan({
    airtableClient,
    outputDir,
    plan,
    clientTableName,
    companyTableName
  });

  return { plan, applyResult };
}

module.exports = {
  DEFAULT_EVENT_VALUE,
  applyImportPlan,
  buildClientFields,
  buildCompanyCoreKey,
  buildClientRecords,
  findCompanyReviewCandidates,
  findExistingClientDecision,
  loadImportRows,
  loadOptionalCompanyAliases,
  mapClientRecord,
  mapCompanyRecord,
  normalizeCompanyName,
  normalizeEmail,
  planClientImport,
  resolveCompanyDecision,
  runClientImport
};

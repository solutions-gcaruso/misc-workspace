const { writeCsv, writeFailureSummary, writeJson } = require('./report-writer');

const CLIENT_BATCH_SIZE = 10;

function normalizeClientName(value) {
  const rawValue = String(value ?? '');
  const changeTypes = [];

  if (/[\r\n]/.test(rawValue)) {
    changeTypes.push('newline_removed');
  }

  if (/\u00a0/.test(rawValue)) {
    changeTypes.push('nbsp_removed');
  }

  const spaceNormalized = rawValue
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\u00a0/g, ' ');

  if (/\s{2,}/.test(spaceNormalized)) {
    changeTypes.push('multi_space_collapsed');
  }

  const normalizedName = spaceNormalized.replace(/\s+/g, ' ').trim();

  if (rawValue !== rawValue.trim()) {
    changeTypes.push('trim');
  }

  return {
    originalName: rawValue,
    normalizedName,
    changeTypes,
    changeType: changeTypes.length === 0 ? 'none' : changeTypes.join('+'),
    isChanged: normalizedName !== rawValue,
    isEmptyAfterNormalization: normalizedName.length === 0
  };
}

function mapClientNameRecord(record, nameField = 'Client Name') {
  return {
    id: record.id,
    clientName: String(record.fields?.[nameField] ?? '')
  };
}

function buildClientNameCleanupPlan({
  records,
  nameField = 'Client Name',
  mode = 'dry-run'
}) {
  const auditRows = [];
  const updates = [];
  let unchangedCount = 0;
  let skippedEmptyCount = 0;

  for (const record of records) {
    const mappedRecord = mapClientNameRecord(record, nameField);
    const normalization = normalizeClientName(mappedRecord.clientName);

    if (!normalization.isChanged) {
      unchangedCount += 1;
      continue;
    }

    const auditRow = {
      recordId: mappedRecord.id,
      currentClientName: normalization.originalName,
      normalizedClientName: normalization.normalizedName,
      changeType: normalization.changeType,
      willUpdate: !normalization.isEmptyAfterNormalization
    };

    if (normalization.isEmptyAfterNormalization) {
      skippedEmptyCount += 1;
      auditRows.push({
        ...auditRow,
        status: 'skip-empty'
      });
      continue;
    }

    updates.push({
      id: mappedRecord.id,
      fields: {
        [nameField]: normalization.normalizedName
      }
    });

    auditRows.push({
      ...auditRow,
      status: mode === 'apply' ? 'applied-pending' : 'ready'
    });
  }

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      mode,
      nameField,
      recordsScanned: records.length,
      unchangedCount,
      skippedEmptyCount,
      updateCount: updates.length,
      updateRecordIds: updates.map(update => update.id)
    },
    updates,
    auditRows
  };
}

function writeClientNameCleanupReports({ outputDir, plan }) {
  writeJson(outputDir, 'client-name-cleanup-summary.json', plan.summary);
  writeJson(outputDir, 'client-name-cleanup-audit.json', plan.auditRows);
  writeCsv(
    outputDir,
    'client-name-cleanup-audit.csv',
    ['record_id', 'current_client_name', 'normalized_client_name', 'change_type', 'status', 'will_update'],
    plan.auditRows.map(row => [
      row.recordId,
      row.currentClientName,
      row.normalizedClientName,
      row.changeType,
      row.status,
      row.willUpdate ? 'yes' : 'no'
    ])
  );
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function applyClientNameCleanupPlan({
  airtableClient,
  outputDir,
  plan,
  tableName = 'Clients'
}) {
  const successfulRecordIds = [];
  const batches = chunk(plan.updates, CLIENT_BATCH_SIZE);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];

    try {
      await airtableClient.updateRecords({
        tableName,
        records: batch
      });
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
  }

  return {
    successfulRecordIds
  };
}

async function ensureClientNameFieldExists({
  airtableClient,
  tableName = 'Clients',
  nameField = 'Client Name'
}) {
  const tables = await airtableClient.listTables();
  const table = tables.find(candidate => candidate.name === tableName);

  if (!table) {
    throw new Error(`Missing Airtable table: ${tableName}`);
  }

  const field = (table.fields || []).find(candidate => candidate.name === nameField);

  if (!field) {
    throw new Error(`Missing Airtable field: ${tableName}.${nameField}`);
  }

  if (field.type !== 'singleLineText') {
    throw new Error(`Expected Airtable field ${tableName}.${nameField} to be singleLineText, received ${field.type}`);
  }
}

async function runClientNameCleanup({
  airtableClient,
  outputDir,
  applyMode,
  tableName = 'Clients',
  nameField = 'Client Name'
}) {
  await ensureClientNameFieldExists({ airtableClient, tableName, nameField });

  const records = await airtableClient.fetchAllRecords({
    tableName,
    fields: [nameField]
  });

  const plan = buildClientNameCleanupPlan({
    records,
    nameField,
    mode: applyMode ? 'apply' : 'dry-run'
  });

  writeClientNameCleanupReports({ outputDir, plan });

  if (!applyMode) {
    return {
      plan,
      applyResult: null
    };
  }

  const applyResult = await applyClientNameCleanupPlan({
    airtableClient,
    outputDir,
    plan,
    tableName
  });

  return {
    plan,
    applyResult
  };
}

module.exports = {
  applyClientNameCleanupPlan,
  buildClientNameCleanupPlan,
  ensureClientNameFieldExists,
  mapClientNameRecord,
  normalizeClientName,
  runClientNameCleanup,
  writeClientNameCleanupReports
};

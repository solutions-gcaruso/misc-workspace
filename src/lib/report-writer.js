const fs = require('fs');
const path = require('path');

function ensureOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function writeReviewQueue(outputDir, reviewMatches) {
  const lines = [
    'attendee_name,attendee_company,candidate_client_name,candidate_company_names,record_id,score,reason'
  ];

  for (const match of reviewMatches) {
    lines.push([
      csvEscape(match.attendeeName),
      csvEscape(match.attendeeCompanyName),
      csvEscape(match.airtableClientName),
      csvEscape(Array.isArray(match.airtableCompanyNames) ? match.airtableCompanyNames.join(' | ') : ''),
      csvEscape(match.airtableRecordId),
      csvEscape(match.score),
      csvEscape(match.reason)
    ].join(','));
  }

  fs.writeFileSync(path.join(outputDir, 'review-queue.csv'), `${lines.join('\n')}\n`);
}

function writeSummary(outputDir, summary) {
  fs.writeFileSync(
    path.join(outputDir, 'sync-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
}

function writeFailureSummary(outputDir, summary) {
  fs.writeFileSync(
    path.join(outputDir, 'sync-failure.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
}

function writeJson(outputDir, filename, payload) {
  ensureOutputDir(outputDir);
  fs.writeFileSync(
    path.join(outputDir, filename),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

function writeCsv(outputDir, filename, header, rows) {
  ensureOutputDir(outputDir);
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(row.map(value => csvEscape(value)).join(','));
  }

  fs.writeFileSync(path.join(outputDir, filename), `${lines.join('\n')}\n`);
}

function writeReports({ outputDir, summary, reviewMatches }) {
  ensureOutputDir(outputDir);
  writeSummary(outputDir, summary);
  writeReviewQueue(outputDir, reviewMatches);
}

function writeClientImportReports({
  outputDir,
  summary,
  clientReviews,
  companyReviews,
  preview
}) {
  writeJson(outputDir, 'client-import-summary.json', summary);
  writeJson(outputDir, 'client-create-preview.json', preview);
  writeCsv(
    outputDir,
    'client-review-queue.csv',
    ['row_number', 'attendee_name', 'candidate_client_name', 'record_id', 'score', 'reason'],
    clientReviews.map(review => [
      review.rowNumber,
      review.attendeeName,
      review.airtableClientName,
      review.airtableRecordId,
      review.score,
      review.reason
    ])
  );
  writeCsv(
    outputDir,
    'company-review-queue.csv',
    ['row_number', 'attendee_name', 'company_name', 'candidate_company_names', 'candidate_company_ids', 'reason'],
    companyReviews.map(review => [
      review.rowNumber,
      review.attendeeName,
      review.companyName,
      review.candidates.map(candidate => candidate.companyName).join(' | '),
      review.candidates.map(candidate => candidate.id).join(' | '),
      review.reason
    ])
  );
}

function writeClientImportFailureSummary(outputDir, summary) {
  writeJson(outputDir, 'client-import-failure.json', summary);
}

module.exports = {
  csvEscape,
  writeCsv,
  writeClientImportFailureSummary,
  writeClientImportReports,
  writeFailureSummary,
  writeJson,
  writeReports
};

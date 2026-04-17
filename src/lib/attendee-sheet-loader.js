const XLSX = require('xlsx');

function normalizeCell(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchContext(row) {
  return {
    name: normalizeCell(row.Name),
    position: normalizeCell(row.Position),
    company: normalizeCell(row.Company)
  };
}

function loadAttendeeSheet(filePath, { sheetName = 'Attendees' } = {}) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const targetSheetName = workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];

  if (!sheet) {
    throw new Error(`Worksheet not found in ${filePath}`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const attendees = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const searchContext = buildSearchContext(row);

    if (!searchContext.name) {
      continue;
    }

    attendees.push({
      rowNumber: index + 2,
      source: row,
      searchContext
    });
  }

  return {
    sheetName: targetSheetName,
    attendees,
    headers: Object.keys(rows[0] || {})
  };
}

module.exports = {
  buildSearchContext,
  loadAttendeeSheet,
  normalizeCell
};

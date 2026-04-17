const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DEFAULT_COLUMN_WIDTHS = {
  'LinkedIn URL': 38,
  'LinkedIn Search Status': 20,
  'LinkedIn Search Notes': 48,
  'LinkedIn Headline': 40,
  'LinkedIn Current Title': 30,
  'LinkedIn Current Company': 30,
  'LinkedIn Job Started On': 18,
  'LinkedIn Location': 28,
  'LinkedIn About': 60,
  'LinkedIn Experience Summary': 60,
  'LinkedIn Alumni': 42,
  'LinkedIn Organizations': 42,
  'LinkedIn Total Experience Years': 22,
  'LinkedIn Followers': 16,
  'LinkedIn Email': 30,
  'LinkedIn Profile Image URL': 42,
  'LinkedIn Scrape Status': 20,
  'LinkedIn Review Required': 18
};

function ensureOutputDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function setCell(sheet, rowIndex, columnIndex, value) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const stringValue = String(value ?? '');

  sheet[address] = {
    t: 's',
    v: stringValue,
    s: stringValue.includes('\n')
      ? {
          alignment: {
            wrapText: true,
            vertical: 'top'
          }
        }
      : undefined
  };
}

function getSheetRange(sheet) {
  return XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
}

function buildHeaderMap(sheet) {
  const range = getSheetRange(sheet);
  const headerMap = new Map();

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: columnIndex });
    const cell = sheet[address];
    const header = cell ? String(cell.v ?? '').trim() : '';

    if (header) {
      headerMap.set(header, columnIndex);
    }
  }

  return headerMap;
}

function ensureHeaders(sheet, headers) {
  const range = getSheetRange(sheet);
  const headerMap = buildHeaderMap(sheet);
  let nextColumnIndex = range.e.c + 1;

  for (const header of headers) {
    if (headerMap.has(header)) {
      continue;
    }

    setCell(sheet, 0, nextColumnIndex, header);
    headerMap.set(header, nextColumnIndex);
    nextColumnIndex += 1;
  }

  range.e.c = Math.max(range.e.c, nextColumnIndex - 1);
  sheet['!ref'] = XLSX.utils.encode_range(range);

  return headerMap;
}

function ensureColumnWidths(sheet, headerMap) {
  const cols = Array.isArray(sheet['!cols']) ? sheet['!cols'] : [];

  for (const [header, width] of Object.entries(DEFAULT_COLUMN_WIDTHS)) {
    const columnIndex = headerMap.get(header);
    if (columnIndex === undefined) {
      continue;
    }

    cols[columnIndex] = {
      ...(cols[columnIndex] || {}),
      wch: Math.max(width, cols[columnIndex] && cols[columnIndex].wch ? cols[columnIndex].wch : 0)
    };
  }

  sheet['!cols'] = cols;
}

function writeEnrichedWorkbook({
  sourceFile,
  outputFile,
  enrichedRows,
  sheetName = 'Attendees',
  enrichmentColumns
}) {
  const workbook = XLSX.readFile(sourceFile, { cellStyles: true, raw: false });
  const targetSheetName = workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];

  if (!sheet) {
    throw new Error(`Worksheet not found in ${sourceFile}`);
  }

  const headerMap = ensureHeaders(sheet, enrichmentColumns);
  const range = getSheetRange(sheet);

  for (const row of enrichedRows) {
    const rowIndex = row.rowNumber - 1;

    for (const [header, value] of Object.entries(row.enrichmentFields)) {
      setCell(sheet, rowIndex, headerMap.get(header), value);
    }

    range.e.r = Math.max(range.e.r, rowIndex);
  }

  sheet['!ref'] = XLSX.utils.encode_range(range);
  ensureColumnWidths(sheet, headerMap);
  ensureOutputDir(outputFile);
  XLSX.writeFile(workbook, outputFile);
}

module.exports = {
  writeEnrichedWorkbook
};

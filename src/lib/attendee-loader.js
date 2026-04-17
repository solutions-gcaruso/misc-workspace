const XLSX = require('xlsx');

const ADDRESS_HINT_PATTERN = /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|suite|ste|way|lane|ln|parkway|pkwy|highway|hwy|circle|cir|court|ct|place|pl)\b/i;

function getRawAttendeeName(row) {
  if (row.Name) {
    return row.Name;
  }

  const firstName = String(row['First Name'] || '').trim();
  const lastName = String(row['Last Name'] || '').trim();
  return `${firstName} ${lastName}`.trim();
}

function looksLikePlaceholderCompany(value) {
  return /^[0-9\s]+$/.test(value);
}

function looksLikeAddress(value) {
  return /\d/.test(value) && ADDRESS_HINT_PATTERN.test(value);
}

function selectLikelyCompanyValue(primary, fallback) {
  const primaryValue = String(primary || '').trim();
  const fallbackValue = String(fallback || '').trim();

  if (!primaryValue) {
    return fallbackValue;
  }

  if (looksLikePlaceholderCompany(primaryValue) || looksLikeAddress(primaryValue)) {
    return fallbackValue || primaryValue;
  }

  return primaryValue;
}

function getRawAttendeeCompany(row) {
  return selectLikelyCompanyValue(row.Company, row.Title);
}

function loadAttendees(filePath, { normalizeName }) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const uniqueAttendees = new Map();

  for (const row of rows) {
    const attendee = normalizeName(getRawAttendeeName(row));
    if (!attendee) {
      continue;
    }

    attendee.companyName = getRawAttendeeCompany(row);

    if (!uniqueAttendees.has(attendee.normalizedFull)) {
      uniqueAttendees.set(attendee.normalizedFull, attendee);
    }
  }

  return [...uniqueAttendees.values()];
}

module.exports = {
  getRawAttendeeCompany,
  getRawAttendeeName,
  loadAttendees,
  looksLikeAddress,
  looksLikePlaceholderCompany,
  selectLikelyCompanyValue
};

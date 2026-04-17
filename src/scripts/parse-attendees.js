const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputFile = process.argv[2] || './Parser-Results.json';
const outputFile = path.join(path.dirname(inputFile), 'Attendees.xlsx');

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const attendees = [];

// Each object is a rectangle (attendee slot on the PDF page)
// Each pageIndex within an object is a different page
// So each (object, pageIndex) = one attendee
for (const obj of data.objects) {
  // Group rows by pageIndex
  const pages = new Map();
  for (const r of obj.rows) {
    const pi = r.column1.pageIndex;
    if (!pages.has(pi)) pages.set(pi, []);
    pages.get(pi).push(r);
  }

  for (const [pi, pageRows] of [...pages].sort((a, b) => a[0] - b[0])) {
    const vals = pageRows.map(r => r.column1.value);
    const col2vals = pageRows.map(r => (r.column2 && r.column2.value) || '');
    const count = vals.length;

    let name = '', position = '', company = '', address1 = '', address2 = '', cityState = '', phone = '';

    // First two are always Name and Position; last two are always City/State and Phone
    name = vals[0];
    position = vals[1];
    phone = vals[count - 1];
    cityState = vals[count - 2];

    if (count === 5) {
      // No Company, no Address2
      address1 = vals[2];
    } else if (count === 6) {
      // Company present, no Address2
      company = vals[2];
      address1 = vals[3];
    } else if (count === 7) {
      // All fields present
      company = vals[2];
      address1 = vals[3];
      address2 = vals[4];
    }

    // Check column2 for suite info on any row - merge into address2
    for (let i = 0; i < pageRows.length; i++) {
      const c2 = col2vals[i].trim();
      if (c2) {
        if (!address2) {
          address2 = c2;
        } else if (!address2.includes(c2)) {
          address2 += ', ' + c2;
        }
      }
    }

    attendees.push({ Name: name, Position: position, Company: company, Address1: address1, Address2: address2, 'City/State': cityState, Phone: phone });
  }
}

// Create workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(attendees);

// Set column widths
ws['!cols'] = [
  { wch: 22 }, // Name
  { wch: 40 }, // Position
  { wch: 35 }, // Company
  { wch: 30 }, // Address1
  { wch: 20 }, // Address2
  { wch: 38 }, // City/State
  { wch: 18 }, // Phone
];

XLSX.utils.book_append_sheet(wb, ws, 'Attendees');
XLSX.writeFile(wb, outputFile);

console.log(`Generated ${outputFile} with ${attendees.length} attendees`);

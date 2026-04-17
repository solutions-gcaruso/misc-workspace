const { loadAttendeeSheet, normalizeCell } = require('./attendee-sheet-loader');

function loadPhoenixAttendees(filePath, options = {}) {
  return loadAttendeeSheet(filePath, options);
}

module.exports = {
  loadPhoenixAttendees,
  normalizeCell
};

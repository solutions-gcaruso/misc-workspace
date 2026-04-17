const { main } = require('./sync-airtable-event');

if (require.main === module) {
  main({
    argv: process.argv.slice(2),
    defaults: {
      filePath: 'inputs/active/Attendees.xlsx',
      eventValue: 'ICSC - Phoenix 2026'
    }
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

const { main, parseArgs } = require('./enrich-attendee-linkedin');

if (require.main === module) {
  main({
    argv: process.argv.slice(2),
    defaults: {
      filePath: 'inputs/active/Phoenix 2026 Attendees-priorities.xlsx',
      outputPath: 'output/Phoenix 2026 Attendees-priorities.enriched.xlsx'
    }
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs
};

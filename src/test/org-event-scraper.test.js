const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractEventsFromHtml,
  normalizeExtractedEvents
} = require('../lib/org-event-scraper');

test('extractEventsFromHtml reads schema.org Event entries', () => {
  const events = extractEventsFromHtml({
    html: `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Event",
              "name": "Spring Mixer",
              "startDate": "2026-06-10T17:30:00-05:00",
              "url": "/events/spring-mixer",
              "description": "Networking and cocktails",
              "location": {
                "@type": "Place",
                "name": "River Club"
              },
              "offers": {
                "price": "25",
                "priceCurrency": "USD",
                "url": "/tickets"
              }
            }
          </script>
        </head>
      </html>
    `,
    url: 'https://example.org/events'
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventName, 'Spring Mixer');
  assert.equal(events[0].eventUrl, 'https://example.org/events/spring-mixer');
  assert.equal(events[0].registrationUrl, 'https://example.org/tickets');
});

test('normalizeExtractedEvents keeps upcoming events and stores notes for fallback time', () => {
  const result = normalizeExtractedEvents(
    [{
      eventName: 'Annual Breakfast',
      eventUrl: 'https://example.org/annual-breakfast',
      rawDateText: 'June 12, 2026',
      rawTimeText: '',
      location: 'Chicago, IL',
      rawCostText: '',
      rawDescription: 'A great event.',
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'detail'
    }],
    {
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/calendar',
      timezone: 'America/Chicago',
      now: new Date('2026-04-10T12:00:00Z')
    }
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].organizationId, 'recOrg1');
  assert.match(result.events[0].notes, /placeholder/i);
});

test('normalizeExtractedEvents excludes clearly non-midwest events', () => {
  const result = normalizeExtractedEvents(
    [{
      eventName: 'Las Vegas Retail Summit',
      eventUrl: 'https://example.org/las-vegas',
      rawDateText: 'June 12, 2026',
      rawTimeText: '',
      location: 'Las Vegas, NV',
      rawCostText: '',
      rawDescription: 'Commercial real estate event in Las Vegas, Nevada.',
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'detail'
    }],
    {
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/calendar',
      timezone: 'America/Chicago',
      now: new Date('2026-04-10T12:00:00Z')
    }
  );

  assert.equal(result.events.length, 0);
});

test('normalizeExtractedEvents can allow non-midwest events for opted-in organizations', () => {
  const result = normalizeExtractedEvents(
    [{
      eventName: 'Las Vegas Retail Summit',
      eventUrl: 'https://example.org/las-vegas',
      rawDateText: 'June 12, 2026',
      rawTimeText: '',
      location: 'Las Vegas, NV',
      rawCostText: '',
      rawDescription: 'Commercial real estate event in Las Vegas, Nevada.',
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'detail'
    }],
    {
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/calendar',
      timezone: 'America/Chicago',
      now: new Date('2026-04-10T12:00:00Z'),
      allowAllRegions: true
    }
  );

  assert.equal(result.events.length, 1);
});

test('normalizeExtractedEvents allows plausible events with blank dates', () => {
  const result = normalizeExtractedEvents(
    [{
      eventName: 'Spring Member Appreciation',
      eventUrl: 'https://example.org/events/spring-appreciation',
      rawDateText: '',
      rawTimeText: '',
      location: 'Aurora, IL',
      rawCostText: '',
      rawDescription: 'Join us for our annual member appreciation networking event in Aurora, IL.',
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'detail'
    }],
    {
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/calendar',
      timezone: 'America/Chicago',
      now: new Date('2026-04-10T12:00:00Z')
    }
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventDateUtc, '');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractDetailPageDataFromHtml,
  mergeEventDetails
} = require('../lib/org-event-detail-scraper');

test('extractDetailPageDataFromHtml captures rich event details', () => {
  const detail = extractDetailPageDataFromHtml({
    html: `
      <html>
        <body>
          <h1>Spring Networking Breakfast</h1>
          <div class="date">June 12, 2026</div>
          <div class="time">8:00 AM</div>
          <div class="location">River Club, Chicago, IL</div>
          <div class="cost">$55</div>
          <div class="event-description">Join us for breakfast, speakers, and market updates.</div>
          <a href="/register-now">Register</a>
        </body>
      </html>
    `,
    url: 'https://example.org/events/spring-breakfast'
  });

  assert.equal(detail.eventName, 'Spring Networking Breakfast');
  assert.equal(detail.location, 'River Club, Chicago, IL');
  assert.equal(detail.registrationUrl, 'https://example.org/register-now');
  assert.match(detail.rawDescription, /market updates/i);
});

test('mergeEventDetails prefers richer detail page values', () => {
  const merged = mergeEventDetails(
    {
      eventName: 'Breakfast',
      eventUrl: 'https://example.org/events',
      rawDateText: 'June 12, 2026',
      rawTimeText: '',
      location: '',
      rawCostText: '',
      rawDescription: '',
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'list'
    },
    {
      eventName: 'Spring Networking Breakfast',
      eventUrl: 'https://example.org/events/spring-breakfast',
      rawDateText: 'June 12, 2026',
      rawTimeText: '8:00 AM',
      location: 'Chicago, IL',
      rawCostText: '$55',
      rawDescription: 'Full detail',
      registrationUrl: 'https://example.org/register',
      notes: [],
      scrapeDepth: 'detail'
    }
  );

  assert.equal(merged.eventName, 'Spring Networking Breakfast');
  assert.equal(merged.scrapeDepth, 'detail');
  assert.equal(merged.registrationUrl, 'https://example.org/register');
});

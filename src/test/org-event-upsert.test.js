const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInvalidEventAuditPlan,
  buildPastEventRemovalPlan,
  buildUpsertPlan,
  isClearlyInvalidEvent,
  isPastEvent,
  scoreEventCompleteness
} = require('../lib/org-event-upsert');

test('buildUpsertPlan creates a new Airtable record for unmatched events', () => {
  const plan = buildUpsertPlan({
    scrapedEvents: [{
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/events',
      eventName: 'Spring Mixer',
      eventUrl: 'https://example.org/events/spring-mixer',
      eventDateUtc: '2026-06-10T22:30:00.000Z',
      location: 'Chicago, IL',
      cost: 25,
      status: 'Scheduled',
      notes: '',
      rawDescription: 'Networking and cocktails',
      registrationUrl: '',
      scrapeDepth: 'detail'
    }],
    existingRecords: []
  });

  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('buildUpsertPlan updates existing event when new scrape is richer', () => {
  const plan = buildUpsertPlan({
    scrapedEvents: [{
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/events',
      eventName: 'Spring Mixer',
      eventUrl: 'https://example.org/events/spring-mixer',
      eventDateUtc: '2026-06-10T22:30:00.000Z',
      location: 'River Club, Chicago, IL',
      cost: 25,
      status: 'Scheduled',
      notes: '',
      rawDescription: 'Networking and cocktails with speakers.',
      registrationUrl: 'https://example.org/register',
      scrapeDepth: 'detail'
    }],
    existingRecords: [{
      id: 'recEvent1',
      fields: {
        'Event Name': 'Spring Mixer',
        Organization: ['recOrg1'],
        'Event Date': '2026-06-10T17:00:00.000Z',
        Location: '',
        Cost: undefined,
        'Event Status': 'Planned',
        'Event Notes': '',
        'Event URL': 'https://example.org/events'
      }
    }]
  });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].fields.Location, 'River Club, Chicago, IL');
  assert.equal(plan.updates[0].fields.Cost, 25);
  assert.equal(plan.updates[0].fields['Event URL'], 'https://example.org/events/spring-mixer');
  assert.match(plan.updates[0].fields['Event Notes'], /Registration URL/i);
});

test('scoreEventCompleteness prefers detail-rich events', () => {
  const listScore = scoreEventCompleteness({
    eventName: 'Mixer',
    eventDateUtc: '2026-06-10T22:30:00.000Z',
    location: '',
    cost: undefined,
    eventUrl: '',
    notes: '',
    rawDescription: '',
    registrationUrl: '',
    scrapeDepth: 'list'
  });
  const detailScore = scoreEventCompleteness({
    eventName: 'Mixer',
    eventDateUtc: '2026-06-10T22:30:00.000Z',
    location: 'Chicago, IL',
    cost: 25,
    eventUrl: 'https://example.org/events/mixer',
    notes: '',
    rawDescription: 'Long description with event details and agenda.',
    registrationUrl: 'https://example.org/register',
    scrapeDepth: 'detail'
  });

  assert.ok(detailScore > listScore);
});

test('buildUpsertPlan creates records even when event date is blank', () => {
  const plan = buildUpsertPlan({
    scrapedEvents: [{
      organizationId: 'recOrg1',
      organizationName: 'Example Org',
      sourceUrl: 'https://example.org/events',
      eventName: 'Spring Member Appreciation',
      eventUrl: 'https://example.org/events/spring-member-appreciation',
      eventDateUtc: '',
      location: 'Aurora, IL',
      cost: undefined,
      status: 'Planned',
      notes: '',
      rawDescription: 'Networking event in Aurora, IL.',
      registrationUrl: '',
      scrapeDepth: 'detail'
    }],
    existingRecords: []
  });

  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].fields['Event Date'], undefined);
});

test('isPastEvent only flags records with a past timestamp', () => {
  assert.equal(isPastEvent({ eventDateUtc: '2026-04-01T12:00:00.000Z' }, { now: '2026-04-02T00:00:00.000Z' }), true);
  assert.equal(isPastEvent({ eventDateUtc: '2026-04-03T12:00:00.000Z' }, { now: '2026-04-02T00:00:00.000Z' }), false);
  assert.equal(isPastEvent({ eventDateUtc: '' }, { now: '2026-04-02T00:00:00.000Z' }), false);
});

test('buildPastEventRemovalPlan only removes events that have already passed', () => {
  const plan = buildPastEventRemovalPlan({
    now: '2026-04-16T12:00:00.000Z',
    existingRecords: [
      {
        id: 'recPast',
        fields: {
          'Event Name': 'Spring Breakfast',
          Organization: ['recOrg1'],
          'Event Date': '2026-04-10T14:00:00.000Z',
          'Event Status': 'Scheduled',
          'Event URL': 'https://example.org/past'
        }
      },
      {
        id: 'recFuture',
        fields: {
          'Event Name': 'Summer Panel',
          Organization: ['recOrg1'],
          'Event Date': '2026-05-10T14:00:00.000Z',
          'Event Status': 'Scheduled',
          'Event URL': 'https://example.org/future'
        }
      },
      {
        id: 'recNoDate',
        fields: {
          'Event Name': 'TBD Roundtable',
          Organization: ['recOrg1'],
          'Event Date': '',
          'Event Status': 'Planned',
          'Event URL': 'https://example.org/tbd'
        }
      }
    ]
  });

  assert.deepEqual(plan.deletes, ['recPast']);
  assert.deepEqual(plan.deletePreview, [{
    recordId: 'recPast',
    eventName: 'Spring Breakfast',
    eventDateUtc: '2026-04-10T14:00:00.000Z',
    eventStatus: 'Scheduled',
    eventUrl: 'https://example.org/past'
  }]);
});

test('isClearlyInvalidEvent flags obvious false-positive event records', () => {
  assert.equal(isClearlyInvalidEvent({
    eventName: 'Sponsors',
    eventUrl: 'https://ifma-chicago.starchapter.com/meetinginfo.php?p_or_f=p'
  }), true);
  assert.equal(isClearlyInvalidEvent({
    eventName: 'Commercial Real Estate Events',
    eventUrl: 'https://bisnow.com/events/chicago'
  }), true);
  assert.equal(isClearlyInvalidEvent({
    eventName: 'Spring Summit',
    eventUrl: 'https://members.chicagolandagc.org/calendar/Details/2026-spring-summit-1636141?sourceTypeId=Website'
  }), false);
});

test('buildInvalidEventAuditPlan removes only clearly invalid records', () => {
  const plan = buildInvalidEventAuditPlan({
    existingRecords: [
      {
        id: 'recInvalid1',
        fields: {
          'Event Name': 'Sponsors',
          Organization: ['recOrg1'],
          'Event URL': 'https://ifma-chicago.starchapter.com/meetinginfo.php?p_or_f=p'
        }
      },
      {
        id: 'recInvalid2',
        fields: {
          'Event Name': 'Apr 2026',
          Organization: ['recOrg1'],
          'Event URL': 'https://chicagolandagc.org/'
        }
      },
      {
        id: 'recValid',
        fields: {
          'Event Name': 'Spring Summit',
          Organization: ['recOrg1'],
          'Event Date': '2026-05-13T16:30:00.000Z',
          'Event URL': 'https://members.chicagolandagc.org/calendar/Details/2026-spring-summit-1636141?sourceTypeId=Website'
        }
      }
    ]
  });

  assert.deepEqual(plan.deletes, ['recInvalid1', 'recInvalid2']);
  assert.deepEqual(plan.deletePreview, [
    {
      recordId: 'recInvalid1',
      eventName: 'Sponsors',
      eventDateUtc: '',
      eventStatus: '',
      eventUrl: 'https://ifma-chicago.starchapter.com/meetinginfo.php?p_or_f=p'
    },
    {
      recordId: 'recInvalid2',
      eventName: 'Apr 2026',
      eventDateUtc: '',
      eventStatus: '',
      eventUrl: 'https://chicagolandagc.org/'
    }
  ]);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMatchingConfig,
  buildGoogleActorInput,
  isLikelyLinkedInProfile,
  mergeEnrichment,
  normalizeLinkedInProfileResult,
  runGoogleLinkedInSearch,
  runLinkedInScrape,
  selectFirstLinkedInOrganicResult,
  summarizeEducation,
  summarizeExperience,
  summarizeOrganizations
} = require('../lib/linkedin-enrichment');
const { parseArgs, resolveDefaultOutputPath } = require('../scripts/enrich-attendee-linkedin');

function createAttendee(overrides = {}) {
  return {
    rowNumber: 2,
    source: {
      Name: 'Jay Sears',
      Position: 'Managing Partner',
      Company: 'NewQuest'
    },
    searchContext: {
      name: 'Jay Sears',
      position: 'Managing Partner',
      company: 'NewQuest'
    },
    ...overrides
  };
}

test('buildGoogleActorInput fills payload template placeholders', () => {
  const attendee = createAttendee();
  const input = buildGoogleActorInput(attendee, {
    queries: '{{name}} {{position}} {{company}} LinkedIn profile',
    nested: {
      label: '{{company}}'
    }
  });

  assert.equal(input.queries, 'Jay Sears Managing Partner NewQuest LinkedIn profile');
  assert.equal(input.nested.label, 'NewQuest');
});

test('isLikelyLinkedInProfile accepts /in/ URLs and rejects company pages', () => {
  assert.equal(isLikelyLinkedInProfile('https://www.linkedin.com/in/jay-sears-0121a38/'), true);
  assert.equal(isLikelyLinkedInProfile('https://www.linkedin.com/company/newquest-properties/'), false);
});

test('selectFirstLinkedInOrganicResult keeps valid first result', () => {
  const attendee = createAttendee();
  const result = selectFirstLinkedInOrganicResult(attendee, {
    organicResults: [
      {
        title: 'Jay Sears - Owner, NewQuest Properties',
        url: 'https://www.linkedin.com/in/jay-sears-0121a38',
        description: 'Owner at NewQuest Properties',
        displayedUrl: 'LinkedIn > Jay Sears'
      }
    ]
  });

  assert.equal(result.linkedInUrl, 'https://linkedin.com/in/jay-sears-0121a38');
  assert.equal(result.searchStatus, 'found');
  assert.equal(result.reviewRequired, false);
});

test('selectFirstLinkedInOrganicResult accepts configured first-name aliases', () => {
  const attendee = createAttendee({
    searchContext: {
      name: 'Jeffrey Moore',
      position: 'Vice President',
      company: 'NewQuest'
    }
  });
  const result = selectFirstLinkedInOrganicResult(attendee, {
    organicResults: [
      {
        title: 'Jeff Moore - Vice President',
        url: 'https://www.linkedin.com/in/jeff-moore-123456',
        description: 'Vice President at NewQuest'
      }
    ]
  }, createMatchingConfig());

  assert.equal(result.searchStatus, 'found');
  assert.equal(result.reviewRequired, false);
});

test('selectFirstLinkedInOrganicResult flags non-profile first result', () => {
  const attendee = createAttendee();
  const result = selectFirstLinkedInOrganicResult(attendee, {
    organicResults: [
      {
        title: 'NewQuest company page',
        url: 'https://www.linkedin.com/company/newquest-properties/',
        description: 'Company profile'
      }
    ]
  });

  assert.equal(result.linkedInUrl, '');
  assert.equal(result.searchStatus, 'invalid_first_result');
  assert.equal(result.reviewRequired, true);
});

test('summaries flatten experience and education arrays', () => {
  assert.equal(
    summarizeExperience([
      { title: 'Owner', companyName: 'NewQuest Properties' },
      { title: 'Partner', companyName: 'Another Company' }
    ]),
    '- Owner @ NewQuest Properties\n- Partner @ Another Company'
  );

  assert.equal(
    summarizeEducation([
      { title: 'Rice University', subtitle: 'MBA' }
    ]),
    '- Rice University - MBA'
  );

  assert.equal(
    summarizeOrganizations([
      { title: 'ICSC', subtitle: 'Member' }
    ]),
    '- ICSC - Member'
  );
});

test('normalizeLinkedInProfileResult flattens the actor profile shape', () => {
  const attendee = createAttendee();
  const normalized = normalizeLinkedInProfileResult({
    linkedinPublicUrl: 'https://linkedin.com/in/jay-sears-0121a38',
    fullName: 'Jay Sears',
    headline: 'Owner at NewQuest Properties',
    jobTitle: 'Owner',
    jobStartedOn: '2-2014',
    companyName: 'NewQuest Properties',
    addressWithCountry: 'Houston, Texas, United States',
    about: 'Retail real estate executive.',
    followers: 3300,
    totalExperienceYears: 27.2,
    profilePicHighQuality: 'https://images.example/jay.jpg',
    experiences: [
      { title: 'Owner', companyName: 'NewQuest Properties' }
    ],
    educations: [
      { title: 'Texas A&M University', subtitle: 'Business' }
    ],
    organizations: [
      { title: 'ICSC', subtitle: 'Member' }
    ],
    email: 'jay@newquest.com'
  }, {
    attendee,
    requestedUrl: 'https://www.linkedin.com/in/jay-sears-0121a38'
  });

  assert.equal(normalized.linkedInUrl, 'https://linkedin.com/in/jay-sears-0121a38');
  assert.equal(normalized.currentTitle, 'Owner');
  assert.equal(normalized.currentCompany, 'NewQuest Properties');
  assert.equal(normalized.jobStartedOn, '2-2014');
  assert.equal(normalized.location, 'Houston, Texas, United States');
  assert.equal(normalized.experienceSummary, '- Owner @ NewQuest Properties');
  assert.equal(normalized.alumni, '- Texas A&M University - Business');
  assert.equal(normalized.organizations, '- ICSC - Member');
  assert.equal(normalized.totalExperienceYears, '27.2');
  assert.equal(normalized.followers, '3,300');
  assert.equal(normalized.email, 'jay@newquest.com');
  assert.equal(normalized.scrapeStatus, 'scraped');
  assert.equal(normalized.reviewRequired, false);
});

test('normalizeLinkedInProfileResult accepts nickname-equivalent first names', () => {
  const attendee = createAttendee({
    searchContext: {
      name: 'Robert Burk',
      position: 'Vice President',
      company: 'Company'
    }
  });
  const normalized = normalizeLinkedInProfileResult({
    linkedinPublicUrl: 'https://linkedin.com/in/bob-burk-7197282a',
    fullName: 'Bob Burk',
    headline: 'Vice President',
    jobTitle: 'Vice President',
    companyName: 'Company'
  }, {
    attendee,
    requestedUrl: 'https://linkedin.com/in/bob-burk-7197282a',
    matchingConfig: createMatchingConfig()
  });

  assert.equal(normalized.reviewRequired, false);
});

test('mergeEnrichment combines search and profile data into workbook fields', () => {
  const attendee = createAttendee();
  const { enrichedRows, reviewQueue } = mergeEnrichment(
    [attendee],
    [{
      rowNumber: 2,
      attendeeName: 'Jay Sears',
      linkedInUrl: 'https://linkedin.com/in/jay-sears-0121a38',
      searchStatus: 'found',
      searchNotes: '',
      reviewRequired: false
    }],
    new Map([
      ['https://linkedin.com/in/jay-sears-0121a38', {
        linkedInUrl: 'https://linkedin.com/in/jay-sears-0121a38',
        headline: 'Owner at NewQuest Properties',
        currentTitle: 'Owner',
        currentCompany: 'NewQuest Properties',
        jobStartedOn: '2-2014',
        location: 'Houston, Texas, United States',
        about: 'Retail real estate executive.',
        experienceSummary: '- Owner @ NewQuest Properties',
        alumni: '- Texas A&M University - Business',
        organizations: '- ICSC - Member',
        totalExperienceYears: '27.2',
        followers: '3,300',
        email: 'jay@newquest.com',
        profileImageUrl: 'https://images.example/jay.jpg',
        scrapeStatus: 'scraped',
        reviewRequired: false,
        reviewReasons: []
      }]
    ])
  );

  assert.equal(enrichedRows.length, 1);
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Job Started On'], '2-2014');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Current Company'], 'NewQuest Properties');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Alumni'], '- Texas A&M University - Business');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Organizations'], '- ICSC - Member');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Total Experience Years'], '27.2');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Email'], 'jay@newquest.com');
  assert.equal(enrichedRows[0].enrichmentFields['LinkedIn Scrape Status'], 'scraped');
  assert.deepEqual(reviewQueue, []);
});

test('runGoogleLinkedInSearch and runLinkedInScrape support mocked integration flow', async () => {
  const attendee = createAttendee();
  const apifyClient = {
    async runActorAndGetItems({ actorId, input }) {
      if (actorId === 'google') {
        assert.equal(input.queries, 'Jay Sears Managing Partner NewQuest LinkedIn profile');
        return {
          run: { id: 'run-google' },
          items: [{
            organicResults: [{
              title: 'Jay Sears - Owner, NewQuest Properties',
              url: 'https://www.linkedin.com/in/jay-sears-0121a38',
              description: 'Owner at NewQuest Properties'
            }]
          }]
        };
      }

      assert.deepEqual(input.profileUrls, ['https://linkedin.com/in/jay-sears-0121a38']);
      return {
        run: { id: 'run-linkedin' },
        items: [{
          linkedinPublicUrl: 'https://www.linkedin.com/in/jay-sears-0121a38',
          fullName: 'Jay Sears',
          headline: 'Owner at NewQuest Properties',
          jobTitle: 'Owner',
          jobStartedOn: '2-2014',
          companyName: 'NewQuest Properties',
          addressWithCountry: 'Houston, Texas, United States',
          about: 'Retail real estate executive.',
          experiences: [{ title: 'Owner', companyName: 'NewQuest Properties' }],
          educations: [{ title: 'Texas A&M University', subtitle: 'Business' }],
          organizations: [{ title: 'ICSC', subtitle: 'Member' }],
          totalExperienceYears: 27.2,
          email: 'jay@newquest.com'
        }]
      };
    }
  };

  const { results: searchResults } = await runGoogleLinkedInSearch([attendee], {
    apifyClient,
    actorId: 'google',
    payloadTemplate: {
      queries: '{{name}} {{position}} {{company}} LinkedIn profile'
    }
  });
  const { resultsByUrl } = await runLinkedInScrape(searchResults, new Map([[2, attendee]]), {
    apifyClient,
    actorId: 'linkedin'
  });

  assert.equal(searchResults[0].linkedInUrl, 'https://linkedin.com/in/jay-sears-0121a38');
  assert.equal(resultsByUrl.get('https://linkedin.com/in/jay-sears-0121a38').currentTitle, 'Owner');
  assert.equal(resultsByUrl.get('https://linkedin.com/in/jay-sears-0121a38').jobStartedOn, '2-2014');
  assert.equal(resultsByUrl.get('https://linkedin.com/in/jay-sears-0121a38').email, 'jay@newquest.com');
});

test('runLinkedInScrape rebuilds cached profile results from raw cached profile data', async () => {
  const attendee = createAttendee();
  const searchResults = [{
    rowNumber: 2,
    attendeeName: 'Jay Sears',
    linkedInUrl: 'https://linkedin.com/in/jay-sears-0121a38',
    searchStatus: 'found',
    searchNotes: '',
    reviewRequired: false
  }];

  const { resultsByUrl } = await runLinkedInScrape(searchResults, new Map([[2, attendee]]), {
    apifyClient: {
      async runActorAndGetItems() {
        throw new Error('Expected cached profile to avoid actor run');
      }
    },
    cacheEntries: {
      'https://linkedin.com/in/jay-sears-0121a38': {
        requestedUrl: 'https://linkedin.com/in/jay-sears-0121a38',
        profile: {
          linkedinPublicUrl: 'https://linkedin.com/in/jay-sears-0121a38',
          fullName: 'Jay Sears',
          headline: 'Owner at NewQuest Properties',
          jobTitle: 'Owner',
          companyName: 'NewQuest Properties',
          email: 'jay@newquest.com'
        },
        result: {
          linkedInUrl: 'https://linkedin.com/in/jay-sears-0121a38',
          currentTitle: 'Owner',
          email: ''
        }
      }
    }
  });

  assert.equal(resultsByUrl.get('https://linkedin.com/in/jay-sears-0121a38').email, 'jay@newquest.com');
});

test('parseArgs handles resume and limit flags', () => {
  const options = parseArgs(['--file', 'custom.xlsx', '--output', 'out.xlsx', '--limit', '5', '--resume']);

  assert.equal(options.filePath, 'custom.xlsx');
  assert.equal(options.outputPath, 'out.xlsx');
  assert.equal(options.limit, 5);
  assert.equal(options.resume, true);
});

test('resolveDefaultOutputPath derives an enriched workbook filename', () => {
  assert.equal(resolveDefaultOutputPath('Phoenix 2026 Attendees-priorities.xlsx'), 'output\\Phoenix 2026 Attendees-priorities.enriched.xlsx');
});

const { normalizeName, normalizeText } = require('./name-matcher');

const DEFAULT_GOOGLE_ACTOR_ID = 'nFJndFXA5zjCTuudP';
const DEFAULT_LINKEDIN_ACTOR_ID = '2SyF0bVxmgGr8IVCZ';
const DEFAULT_NAME_ALIASES = {
  bob: ['bob', 'bobby', 'rob', 'robert', 'robbie'],
  christine: ['christine', 'christina'],
  dave: ['dave', 'david'],
  jeff: ['jeff', 'jeffery', 'jeffrey'],
  jim: ['jim', 'james'],
  mike: ['michael', 'mike'],
  nick: ['nicholas', 'nick'],
  rob: ['rob', 'robert'],
  scott: ['scott', 'scot'],
  tom: ['thomas', 'tom']
};
const DEFAULT_COMPANY_ALIASES = {
  'newquest properties': ['newquest', 'newquest properties'],
  'phillips edison & company': ['phillips edison', 'phillips edison & company'],
  'trademark property company': ['trademark', 'trademark property company']
};
const ENRICHMENT_COLUMNS = [
  'LinkedIn URL',
  'LinkedIn Search Status',
  'LinkedIn Search Notes',
  'LinkedIn Headline',
  'LinkedIn Current Title',
  'LinkedIn Current Company',
  'LinkedIn Job Started On',
  'LinkedIn Location',
  'LinkedIn About',
  'LinkedIn Experience Summary',
  'LinkedIn Alumni',
  'LinkedIn Organizations',
  'LinkedIn Total Experience Years',
  'LinkedIn Followers',
  'LinkedIn Email',
  'LinkedIn Profile Image URL',
  'LinkedIn Scrape Status',
  'LinkedIn Review Required'
];
const COMPANY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'co',
  'company',
  'corp',
  'corporation',
  'estate',
  'group',
  'holdings',
  'inc',
  'incorporated',
  'llc',
  'llp',
  'lp',
  'ltd',
  'partners',
  'properties',
  'property',
  'real',
  'services',
  'solutions',
  'the'
]);

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeAliasList(values) {
  return values
    .map(value => normalizeText(value))
    .filter(Boolean);
}

function mergeAliasMaps(defaults = {}, overrides = {}) {
  const merged = {};
  const canonicalKeys = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);

  for (const key of canonicalKeys) {
    const mergedValues = [
      ...(Array.isArray(defaults[key]) ? defaults[key] : []),
      ...(Array.isArray(overrides[key]) ? overrides[key] : [])
    ];
    merged[key] = [...new Set(mergedValues)];
  }

  return merged;
}

function buildAliasLookup(aliasMap = {}) {
  const lookup = new Map();

  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    const normalizedValues = normalizeAliasList([canonical, ...(Array.isArray(aliases) ? aliases : [])]);

    for (const value of normalizedValues) {
      lookup.set(value, normalizedValues);
    }
  }

  return lookup;
}

function createMatchingConfig({ nameAliases = {}, companyAliases = {} } = {}) {
  const mergedNameAliases = mergeAliasMaps(DEFAULT_NAME_ALIASES, nameAliases);
  const mergedCompanyAliases = mergeAliasMaps(DEFAULT_COMPANY_ALIASES, companyAliases);

  return {
    nameAliasLookup: buildAliasLookup(mergedNameAliases),
    companyAliasLookup: buildAliasLookup(mergedCompanyAliases)
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyTemplate(value, replacements) {
  if (typeof value === 'string') {
    return value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => replacements[key] ?? '');
  }

  if (Array.isArray(value)) {
    return value.map(entry => applyTemplate(entry, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, applyTemplate(nestedValue, replacements)])
    );
  }

  return value;
}

function buildGoogleActorInput(attendee, payloadTemplate) {
  const template = deepClone(payloadTemplate);
  return applyTemplate(template, {
    name: attendee.searchContext.name,
    position: attendee.searchContext.position,
    company: attendee.searchContext.company
  });
}

function buildLinkedInActorInput(profileUrls) {
  return { profileUrls };
}

function normalizeLinkedInUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = '';
    parsed.search = '';
    parsed.host = parsed.host.toLowerCase().replace(/^www\./, '');
    parsed.protocol = 'https:';
    parsed.pathname = (parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`).replace(/\/+/g, '/');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url).trim().replace(/\/$/, '');
  }
}

function isLikelyLinkedInProfile(url = '') {
  const normalizedUrl = normalizeLinkedInUrl(url);
  return /linkedin\.com\/(in|pub)\//i.test(normalizedUrl);
}

function areEquivalentByAlias(left, right, aliasLookup) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftAliases = aliasLookup.get(normalizedLeft);
  const rightAliases = aliasLookup.get(normalizedRight);

  if (!leftAliases || !rightAliases) {
    return false;
  }

  return leftAliases.some(alias => rightAliases.includes(alias));
}

function textContainsAlias(text, value, aliasLookup) {
  const normalizedText = normalizeText(text);
  const normalizedValue = normalizeText(value);

  if (!normalizedText || !normalizedValue) {
    return false;
  }

  const aliases = aliasLookup.get(normalizedValue) || [normalizedValue];
  return aliases.some(alias => normalizedText.includes(alias));
}

function tokenizeCompany(company) {
  return normalizeText(company)
    .split(' ')
    .filter(token => token.length >= 3)
    .filter(token => !COMPANY_STOP_WORDS.has(token));
}

function expandCompanyTokens(company, companyAliasLookup) {
  const normalizedCompany = normalizeText(company);
  const aliasValues = companyAliasLookup.get(normalizedCompany) || [];
  const values = aliasValues.length > 0 ? aliasValues : [company];
  return [...new Set(values.flatMap(tokenizeCompany))];
}

function assessSearchResult(attendee, result, matchingConfig = createMatchingConfig()) {
  const attendeeName = normalizeName(attendee.searchContext.name);
  const haystack = normalizeText([
    result.title,
    result.description,
    result.displayedUrl,
    result.personalInfo && result.personalInfo.rawText
  ].filter(Boolean).join(' '));
  const urlText = normalizeText(result.url);
  const issues = [];

  if (attendeeName) {
    if (!haystack.includes(attendeeName.last) && !urlText.includes(attendeeName.last)) {
      issues.push('search result last name does not match attendee');
    }

    const firstNameMatches = haystack.includes(attendeeName.first)
      || urlText.includes(attendeeName.first)
      || textContainsAlias(result.title, attendeeName.first, matchingConfig.nameAliasLookup)
      || textContainsAlias(result.description, attendeeName.first, matchingConfig.nameAliasLookup)
      || textContainsAlias(result.url, attendeeName.first, matchingConfig.nameAliasLookup);

    if (!firstNameMatches) {
      issues.push('search result first name does not match attendee');
    }
  }

  const companyTokens = expandCompanyTokens(attendee.searchContext.company, matchingConfig.companyAliasLookup);
  const resultCompanyText = normalizeText(
    result.personalInfo && result.personalInfo.companyName
      ? result.personalInfo.companyName
      : ''
  );

  if (
    companyTokens.length > 0
    && resultCompanyText
    && !companyTokens.some(token => haystack.includes(token) || resultCompanyText.includes(token))
  ) {
    issues.push('search result company does not clearly match attendee company');
  }

  return {
    reviewRequired: issues.length > 0,
    issues
  };
}

function selectFirstLinkedInOrganicResult(attendee, searchItem, matchingConfig = createMatchingConfig()) {
  const organicResults = Array.isArray(searchItem && searchItem.organicResults)
    ? searchItem.organicResults
    : [];
  const firstResult = organicResults[0];

  if (!firstResult) {
    return {
      rowNumber: attendee.rowNumber,
      attendeeName: attendee.searchContext.name,
      linkedInUrl: '',
      searchStatus: 'not_found',
      searchNotes: 'No organic search result returned by the Google actor.',
      reviewRequired: true,
      selectedResult: null
    };
  }

  if (!isLikelyLinkedInProfile(firstResult.url)) {
    return {
      rowNumber: attendee.rowNumber,
      attendeeName: attendee.searchContext.name,
      linkedInUrl: '',
      searchStatus: 'invalid_first_result',
      searchNotes: `First organic result was not a LinkedIn profile URL: ${firstResult.url}`,
      reviewRequired: true,
      selectedResult: firstResult
    };
  }

  const assessment = assessSearchResult(attendee, firstResult, matchingConfig);

  return {
    rowNumber: attendee.rowNumber,
    attendeeName: attendee.searchContext.name,
    linkedInUrl: normalizeLinkedInUrl(firstResult.url),
    searchStatus: assessment.reviewRequired ? 'review' : 'found',
    searchNotes: assessment.issues.join('; '),
    reviewRequired: assessment.reviewRequired,
    selectedResult: firstResult
  };
}

function summarizeExperience(experiences = []) {
  return summarizeBulletList(experiences.slice(0, 5), item => [item.title, item.companyName].filter(Boolean).join(' @ '));
}

function summarizeEducation(educations = []) {
  return summarizeBulletList(educations.slice(0, 5), item => [item.title, item.subtitle].filter(Boolean).join(' - '));
}

function summarizeOrganizations(organizations = []) {
  return summarizeBulletList(organizations.slice(0, 5), item => {
    if (typeof item === 'string') {
      return item;
    }

    return [
      item.title,
      item.subtitle,
      item.description
    ].filter(Boolean).join(' - ');
  });
}

function summarizeBulletList(items = [], formatter) {
  return items
    .map(formatter)
    .filter(Boolean)
    .map(item => `- ${item}`)
    .join('\n');
}

function formatTotalExperienceYears(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  return String(value).trim();
}

function formatFollowers(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('en-US');
  }

  return String(value).trim();
}

function extractProfileUrls(profile) {
  return [
    profile && profile.linkedinPublicUrl,
    profile && profile.linkedinUrl
  ]
    .map(normalizeLinkedInUrl)
    .filter(Boolean);
}

function namesMateriallyDiffer(attendeeName, profileName, matchingConfig = createMatchingConfig()) {
  const normalizedAttendee = normalizeName(attendeeName);
  const normalizedProfile = normalizeName(profileName);

  if (!normalizedAttendee || !normalizedProfile) {
    return false;
  }

  return normalizedAttendee.last !== normalizedProfile.last
    || !areEquivalentByAlias(normalizedAttendee.first, normalizedProfile.first, matchingConfig.nameAliasLookup);
}

function normalizeLinkedInProfileResult(profile, { attendee, requestedUrl, matchingConfig = createMatchingConfig() }) {
  const normalizedRequestedUrl = normalizeLinkedInUrl(requestedUrl);
  const normalizedResultUrl = normalizeLinkedInUrl(profile.linkedinPublicUrl || profile.linkedinUrl || requestedUrl);
  const profileName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const reviewReasons = [];

  if (normalizedResultUrl && normalizedRequestedUrl && normalizedResultUrl !== normalizedRequestedUrl) {
    reviewReasons.push('scraped profile URL differs from requested URL');
  }

  if (namesMateriallyDiffer(attendee.searchContext.name, profileName, matchingConfig)) {
    reviewReasons.push('scraped profile name does not match attendee name');
  }

  const hasCoreContent = Boolean(
    profile.headline
    || profile.jobTitle
    || profile.companyName
    || profile.about
    || (Array.isArray(profile.experiences) && profile.experiences.length > 0)
  );

  return {
    requestedUrl: normalizedRequestedUrl,
    linkedInUrl: normalizedResultUrl || normalizedRequestedUrl,
    fullName: profileName,
    headline: profile.headline || '',
    currentTitle: profile.jobTitle || '',
    currentCompany: profile.companyName || '',
    jobStartedOn: profile.jobStartedOn || '',
    location: profile.addressWithCountry || profile.addressWithoutCountry || profile.addressCountryOnly || '',
    about: profile.about || '',
    experienceSummary: summarizeExperience(profile.experiences),
    alumni: summarizeEducation(profile.educations),
    organizations: summarizeOrganizations(profile.organizations),
    totalExperienceYears: formatTotalExperienceYears(profile.totalExperienceYears),
    followers: formatFollowers(profile.followers),
    email: profile.email || '',
    profileImageUrl: profile.profilePicHighQuality || profile.profilePic || '',
    scrapeStatus: hasCoreContent ? 'scraped' : 'partial',
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    rawProfile: profile
  };
}

function createProfileNotFoundResult({ attendee, requestedUrl, reason }) {
  return {
    requestedUrl: normalizeLinkedInUrl(requestedUrl),
    linkedInUrl: normalizeLinkedInUrl(requestedUrl),
    fullName: '',
    headline: '',
    currentTitle: '',
    currentCompany: '',
    jobStartedOn: '',
    location: '',
    about: '',
    experienceSummary: '',
    alumni: '',
    organizations: '',
    totalExperienceYears: '',
    followers: '',
    email: '',
    profileImageUrl: '',
    scrapeStatus: 'not_found',
    reviewRequired: true,
    reviewReasons: [reason || 'LinkedIn actor did not return a profile for this URL.'],
    rawProfile: null,
    attendeeName: attendee.searchContext.name
  };
}

async function runGoogleLinkedInSearch(attendees, {
  apifyClient,
  actorId = DEFAULT_GOOGLE_ACTOR_ID,
  payloadTemplate,
  concurrency = 2,
  matchingConfig = createMatchingConfig(),
  cacheEntries = {},
  onProgress
}) {
  const rawResults = [];

  const results = await mapWithConcurrency(attendees, concurrency, async attendee => {
    const cachedEntry = cacheEntries[String(attendee.rowNumber)];
    if (cachedEntry && cachedEntry.result) {
      rawResults.push(cachedEntry);

      if (typeof onProgress === 'function') {
        onProgress(attendee, 'cached');
      }

      return cachedEntry.result;
    }

    const input = buildGoogleActorInput(attendee, payloadTemplate);
    const { run, items } = await apifyClient.runActorAndGetItems({ actorId, input });
    const searchItem = items[0] || null;
    const result = selectFirstLinkedInOrganicResult(attendee, searchItem, matchingConfig);
    const rawEntry = {
      rowNumber: attendee.rowNumber,
      attendeeName: attendee.searchContext.name,
      actorRunId: run.id,
      input,
      searchItem,
      result
    };

    rawResults.push(rawEntry);

    if (typeof onProgress === 'function') {
      onProgress(attendee, result.searchStatus);
    }

    return result;
  });

  return { results, rawResults };
}

async function runLinkedInScrape(searchResults, attendeesByRow, {
  apifyClient,
  actorId = DEFAULT_LINKEDIN_ACTOR_ID,
  batchSize = 5,
  matchingConfig = createMatchingConfig(),
  cacheEntries = {},
  onProgress
}) {
  const candidateRows = searchResults.filter(result => result.linkedInUrl);
  const uniqueUrls = [...new Set(candidateRows.map(result => normalizeLinkedInUrl(result.linkedInUrl)).filter(Boolean))];
  const rawResults = [];
  const resultsByUrl = new Map();
  const missingUrls = [];

  for (const url of uniqueUrls) {
    const cachedEntry = cacheEntries[url];
    if (!cachedEntry || !cachedEntry.result) {
      missingUrls.push(url);
      continue;
    }

    const matchedRow = candidateRows.find(result => normalizeLinkedInUrl(result.linkedInUrl) === url);
    const attendee = matchedRow ? attendeesByRow.get(matchedRow.rowNumber) : null;
    const cachedResult = cachedEntry.profile && attendee
      ? normalizeLinkedInProfileResult(cachedEntry.profile, {
          attendee,
          requestedUrl: url,
          matchingConfig
        })
      : cachedEntry.result;

    rawResults.push(cachedEntry);
    resultsByUrl.set(url, cachedResult);

    if (typeof onProgress === 'function') {
      onProgress(url, 'cached');
    }
  }

  for (const batch of chunk(missingUrls, batchSize)) {
    const { run, items } = await apifyClient.runActorAndGetItems({
      actorId,
      input: buildLinkedInActorInput(batch)
    });

    const remaining = new Set(batch);

    for (const item of items) {
      const matchingUrl = batch.find(url => extractProfileUrls(item).includes(url));

      if (!matchingUrl) {
        continue;
      }

      const matchedRow = candidateRows.find(result => normalizeLinkedInUrl(result.linkedInUrl) === matchingUrl);
      const attendee = attendeesByRow.get(matchedRow.rowNumber);
      const normalizedResult = normalizeLinkedInProfileResult(item, {
        attendee,
        requestedUrl: matchingUrl,
        matchingConfig
      });

      remaining.delete(matchingUrl);
      resultsByUrl.set(matchingUrl, normalizedResult);
      rawResults.push({
        requestedUrl: matchingUrl,
        actorRunId: run.id,
        profile: item,
        result: normalizedResult
      });
    }

    for (const url of remaining) {
      const matchedRow = candidateRows.find(result => normalizeLinkedInUrl(result.linkedInUrl) === url);
      const attendee = attendeesByRow.get(matchedRow.rowNumber);
      const normalizedResult = createProfileNotFoundResult({
        attendee,
        requestedUrl: url
      });

      resultsByUrl.set(url, normalizedResult);
      rawResults.push({
        requestedUrl: url,
        actorRunId: run.id,
        profile: null,
        result: normalizedResult
      });
    }

    if (typeof onProgress === 'function') {
      onProgress(batch, 'scraped');
    }
  }

  return { resultsByUrl, rawResults };
}

function toEnrichmentFields(searchResult, profileResult) {
  const reviewRequired = Boolean(searchResult.reviewRequired || (profileResult && profileResult.reviewRequired));

  return {
    'LinkedIn URL': searchResult.linkedInUrl || '',
    'LinkedIn Search Status': searchResult.searchStatus || '',
    'LinkedIn Search Notes': [
      searchResult.searchNotes,
      profileResult && profileResult.reviewReasons && profileResult.reviewReasons.join('; ')
    ].filter(Boolean).join('; '),
    'LinkedIn Headline': profileResult ? profileResult.headline : '',
    'LinkedIn Current Title': profileResult ? profileResult.currentTitle : '',
    'LinkedIn Current Company': profileResult ? profileResult.currentCompany : '',
    'LinkedIn Job Started On': profileResult ? profileResult.jobStartedOn : '',
    'LinkedIn Location': profileResult ? profileResult.location : '',
    'LinkedIn About': profileResult ? profileResult.about : '',
    'LinkedIn Experience Summary': profileResult ? profileResult.experienceSummary : '',
    'LinkedIn Alumni': profileResult ? profileResult.alumni : '',
    'LinkedIn Organizations': profileResult ? profileResult.organizations : '',
    'LinkedIn Total Experience Years': profileResult ? profileResult.totalExperienceYears : '',
    'LinkedIn Followers': profileResult ? profileResult.followers : '',
    'LinkedIn Email': profileResult ? profileResult.email : '',
    'LinkedIn Profile Image URL': profileResult ? profileResult.profileImageUrl : '',
    'LinkedIn Scrape Status': profileResult ? profileResult.scrapeStatus : '',
    'LinkedIn Review Required': reviewRequired ? 'Yes' : ''
  };
}

function mergeEnrichment(attendees, searchResults, profileResultsByUrl) {
  const searchResultsByRow = new Map(searchResults.map(result => [result.rowNumber, result]));
  const enrichedRows = [];
  const reviewQueue = [];

  for (const attendee of attendees) {
    const searchResult = searchResultsByRow.get(attendee.rowNumber) || {
      rowNumber: attendee.rowNumber,
      linkedInUrl: '',
      searchStatus: 'not_run',
      searchNotes: '',
      reviewRequired: true
    };
    const profileResult = searchResult.linkedInUrl
      ? profileResultsByUrl.get(normalizeLinkedInUrl(searchResult.linkedInUrl))
      : null;
    const enrichmentFields = toEnrichmentFields(searchResult, profileResult);

    enrichedRows.push({
      rowNumber: attendee.rowNumber,
      source: attendee.source,
      enrichmentFields
    });

    if (searchResult.reviewRequired) {
      reviewQueue.push({
        rowNumber: attendee.rowNumber,
        attendeeName: attendee.searchContext.name,
        stage: 'google-search',
        linkedInUrl: searchResult.linkedInUrl || '',
        status: searchResult.searchStatus,
        reason: searchResult.searchNotes || 'Search result requires manual review.'
      });
    }

    if (profileResult && profileResult.reviewRequired) {
      reviewQueue.push({
        rowNumber: attendee.rowNumber,
        attendeeName: attendee.searchContext.name,
        stage: 'linkedin-profile',
        linkedInUrl: profileResult.linkedInUrl || searchResult.linkedInUrl || '',
        status: profileResult.scrapeStatus,
        reason: profileResult.reviewReasons.join('; ')
      });
    }
  }

  return { enrichedRows, reviewQueue };
}

module.exports = {
  createMatchingConfig,
  DEFAULT_GOOGLE_ACTOR_ID,
  DEFAULT_COMPANY_ALIASES,
  DEFAULT_LINKEDIN_ACTOR_ID,
  DEFAULT_NAME_ALIASES,
  ENRICHMENT_COLUMNS,
  buildGoogleActorInput,
  buildLinkedInActorInput,
  chunk,
  isLikelyLinkedInProfile,
  mapWithConcurrency,
  mergeEnrichment,
  normalizeLinkedInProfileResult,
  normalizeLinkedInUrl,
  runGoogleLinkedInSearch,
  runLinkedInScrape,
  selectFirstLinkedInOrganicResult,
  summarizeEducation,
  summarizeExperience,
  summarizeOrganizations
};

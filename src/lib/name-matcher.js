const { distance } = require('fastest-levenshtein');

const TITLE_TOKENS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof']);
const SUFFIX_TOKENS = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const AUTO_AMBIGUITY_MARGIN = 0.02;
const REVIEW_AMBIGUITY_MARGIN = 0.03;
const COMPANY_LEGAL_SUFFIXES = new Set([
  'llc',
  'inc',
  'corp',
  'corporation',
  'company',
  'co',
  'ltd',
  'limited',
  'pllc',
  'lp',
  'llp'
]);

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeName(rawName) {
  const cleaned = normalizeText(rawName);
  if (!cleaned) {
    return null;
  }

  const tokens = cleaned
    .split(' ')
    .filter(Boolean)
    .filter(token => !TITLE_TOKENS.has(token));

  while (tokens.length > 1 && SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length === 0) {
    return null;
  }

  const normalizedFull = tokens.join(' ');
  const first = tokens[0];
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : tokens[0];

  return {
    originalName: String(rawName ?? '').trim(),
    normalizedFull,
    tokens,
    first,
    last,
    middle: tokens.slice(1, -1)
  };
}

function normalizeCompanyName(rawCompany) {
  const cleaned = normalizeText(rawCompany);
  if (!cleaned) {
    return '';
  }

  const tokens = cleaned.split(' ').filter(Boolean);
  while (tokens.length > 1 && COMPANY_LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ');
}

function buildNicknameLookup(nicknameMap) {
  const lookup = new Map();

  for (const [groupName, aliases] of Object.entries(nicknameMap)) {
    const canonical = normalizeText(groupName);
    lookup.set(canonical, canonical);

    for (const alias of aliases) {
      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias) {
        lookup.set(normalizedAlias, canonical);
      }
    }
  }

  return lookup;
}

function areNicknamesEquivalent(firstA, firstB, nicknameLookup) {
  if (!firstA || !firstB) {
    return false;
  }

  if (firstA === firstB) {
    return true;
  }

  const canonicalA = nicknameLookup.get(firstA);
  const canonicalB = nicknameLookup.get(firstB);
  return Boolean(canonicalA && canonicalB && canonicalA === canonicalB);
}

function similarityScore(valueA, valueB) {
  const maxLength = Math.max(valueA.length, valueB.length);
  if (maxLength === 0) {
    return 1;
  }

  return 1 - distance(valueA, valueB) / maxLength;
}

function scoreCandidate(attendee, client, nicknameLookup) {
  const exactFull = attendee.normalizedFull === client.normalizedFull;
  const exactFirst = attendee.first === client.first;
  const exactLast = attendee.last === client.last;
  const firstNicknameMatch = areNicknamesEquivalent(attendee.first, client.first, nicknameLookup);
  const firstDistance = distance(attendee.first, client.first);
  const lastDistance = distance(attendee.last, client.last);
  const fullSimilarity = similarityScore(attendee.normalizedFull, client.normalizedFull);
  const sameFirstInitial = attendee.first[0] === client.first[0];
  const sameLastInitial = attendee.last[0] === client.last[0];
  const attendeeCompany = normalizeCompanyName(attendee.companyName);
  const candidateCompanies = Array.isArray(client.companyNames) ? client.companyNames : [];
  const matchingCompany = attendeeCompany
    ? candidateCompanies.find(companyName => normalizeCompanyName(companyName) === attendeeCompany)
    : '';

  if (exactFull) {
    return {
      tier: 'auto',
      score: matchingCompany ? 1.01 : 1,
      matchType: 'exact',
      reason: matchingCompany ? 'exact normalized full name + exact company match' : 'exact normalized full name'
    };
  }

  if (exactLast && exactFirst) {
    return {
      tier: 'auto',
      score: matchingCompany ? 1 : 0.99,
      matchType: 'exact',
      reason: matchingCompany ? 'exact first + exact last name + exact company match' : 'exact first + exact last name'
    };
  }

  if (exactLast && firstNicknameMatch) {
    return {
      tier: 'auto',
      score: matchingCompany ? 0.985 : 0.97,
      matchType: 'nickname',
      reason: matchingCompany ? 'nickname + exact last name + exact company match' : 'nickname + exact last name'
    };
  }

  if (exactLast && firstDistance <= 2 && sameFirstInitial) {
    return {
      tier: 'review',
      score: 0.93 - firstDistance * 0.01 + (matchingCompany ? 0.02 : 0),
      matchType: 'review',
      reason: matchingCompany ? 'first-name typo with exact last name + exact company match' : 'first-name typo with exact last name'
    };
  }

  if (exactFirst && lastDistance === 1 && sameLastInitial) {
    return {
      tier: 'review',
      score: 0.92 + (matchingCompany ? 0.02 : 0),
      matchType: 'review',
      reason: matchingCompany ? 'slight last-name typo with exact first name + exact company match' : 'slight last-name typo with exact first name'
    };
  }

  if (firstNicknameMatch && lastDistance === 1 && sameLastInitial) {
    return {
      tier: 'review',
      score: 0.91 + (matchingCompany ? 0.02 : 0),
      matchType: 'review',
      reason: matchingCompany ? 'nickname + slight last-name typo + exact company match' : 'nickname + slight last-name typo'
    };
  }

  if (fullSimilarity >= 0.9 && sameFirstInitial && sameLastInitial) {
    return {
      tier: 'review',
      score: Number((fullSimilarity + (matchingCompany ? 0.02 : 0)).toFixed(3)),
      matchType: 'review',
      reason: matchingCompany ? 'high full-name similarity + exact company match' : 'high full-name similarity'
    };
  }

  return null;
}

function resolveOutcome(attendee, candidates) {
  if (candidates.length === 0) {
    return {
      status: 'skip',
      attendeeName: attendee.originalName,
      score: 0,
      reason: 'no plausible Airtable match'
    };
  }

  const topCandidate = candidates[0];
  const secondCandidate = candidates[1];
  const ambiguityMargin = topCandidate.tier === 'auto' ? AUTO_AMBIGUITY_MARGIN : REVIEW_AMBIGUITY_MARGIN;

  if (secondCandidate && topCandidate.score - secondCandidate.score < ambiguityMargin) {
    return {
      status: 'review',
      attendeeName: attendee.originalName,
      attendeeCompanyName: attendee.companyName || '',
      airtableRecordId: topCandidate.client.id,
      airtableClientName: topCandidate.client.clientName,
      airtableCompanyNames: topCandidate.client.companyNames || [],
      score: topCandidate.score,
      reason: 'multiple similarly strong Airtable candidates',
      matchType: 'review'
    };
  }

  return {
    status: topCandidate.tier,
    attendeeName: attendee.originalName,
    attendeeCompanyName: attendee.companyName || '',
    airtableRecordId: topCandidate.client.id,
    airtableClientName: topCandidate.client.clientName,
    airtableCompanyNames: topCandidate.client.companyNames || [],
    score: topCandidate.score,
    reason: topCandidate.reason,
    matchType: topCandidate.matchType
  };
}

function matchAttendeesToClients(attendees, clients, nicknameMap) {
  const nicknameLookup = buildNicknameLookup(nicknameMap);
  const autoMatches = [];
  const reviewMatches = [];
  const skipped = [];
  const claimedRecordIds = new Set();

  for (const attendee of attendees) {
    const candidates = clients
      .map(client => {
        const candidate = scoreCandidate(attendee, client, nicknameLookup);
        if (!candidate) {
          return null;
        }

        return { ...candidate, client };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    const outcome = resolveOutcome(attendee, candidates);

    if (outcome.status === 'auto') {
      if (claimedRecordIds.has(outcome.airtableRecordId)) {
        reviewMatches.push({
          ...outcome,
          status: 'review',
          matchType: 'review',
          reason: 'multiple attendee names resolved to the same Airtable record'
        });
        continue;
      }

      claimedRecordIds.add(outcome.airtableRecordId);
      autoMatches.push(outcome);
      continue;
    }

    if (outcome.status === 'review') {
      reviewMatches.push(outcome);
      continue;
    }

    skipped.push(outcome);
  }

  return { autoMatches, reviewMatches, skipped };
}

module.exports = {
  matchAttendeesToClients,
  normalizeCompanyName,
  normalizeName,
  normalizeText
};

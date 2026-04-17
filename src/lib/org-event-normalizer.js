const { normalizeText } = require('./name-matcher');

const MONTH_LOOKUP = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};
const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term'
]);
const MIDWEST_STATES = [
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'michigan',
  'minnesota',
  'missouri',
  'nebraska',
  'north dakota',
  'ohio',
  'south dakota',
  'wisconsin'
];
const MIDWEST_ABBREVIATIONS = ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'];
const NON_MIDWEST_LOCATION_SIGNALS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'mississippi', 'montana', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'tennessee',
  'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wyoming', 'district of columbia',
  'canada', 'quebec', 'montreal', 'las vegas', 'phoenix', 'atlanta', 'los angeles', 'san francisco',
  'dallas', 'houston', 'miami', 'boston', 'new york city', 'dc', 'washington d c',
  'sacramento', 'rocky mountain', 'new england', 'arizona', 'colorado'
];
const EVENT_POSITIVE_KEYWORDS = [
  'event', 'events', 'conference', 'summit', 'breakfast', 'luncheon', 'lunch', 'dinner', 'cocktail',
  'happy hour', 'networking', 'golf', 'outing', 'seminar', 'webinar', 'forum', 'meeting', 'panel',
  'tour', 'workshop', 'training', 'roundtable', 'appreciation', 'challenge', 'speed mentoring', 'pub crawl'
];
const EVENT_NEGATIVE_PHRASES = [
  'event calendar',
  'events calendar',
  'upcoming events',
  'view all events',
  'calendar view',
  'list view',
  'meeting information',
  'member area login',
  'about the event calendar',
  'commercial real estate events',
  'search asce',
  'search',
  'sponsor an event',
  'apply to speak',
  'event sponsorship',
  'publications & news',
  'civil engineering source',
  'codes & standards',
  'career & growth',
  'who we are',
  'our mission',
  'leadership',
  'find members',
  'connections networking',
  'groups and committees',
  'volunteer',
  'chapters'
];
const STRONG_EVENT_SIGNAL_PATTERN = /\b(conference|summit|breakfast|luncheon|lunch|dinner|cocktail|happy hour|networking|golf|outing|seminar|webinar|forum|meeting|panel|tour|workshop|training|roundtable|appreciation|challenge|mentoring|pub crawl|reception|awards?|scholarship|charity)\b/i;

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ' ')));
}

function normalizeComparableText(value) {
  return normalizeText(normalizeWhitespace(value));
}

function canonicalizeUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(decodeHtmlEntities(String(value).trim()));
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const preserveHashRoute = /^#!\//i.test(url.hash || '') || /^#!(?:event|events|calendar|meeting|details?)/i.test(url.hash || '');
    if (!preserveHashRoute) {
      url.hash = '';
    }

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.pathname = url.pathname.replace(/\/+/g, '/');
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return decodeHtmlEntities(normalizeWhitespace(value));
  }
}

function absoluteUrl(baseUrl, value) {
  if (!value) {
    return '';
  }

  try {
    return canonicalizeUrl(new URL(value, baseUrl).toString());
  } catch {
    return canonicalizeUrl(value);
  }
}

function parseCost(rawCostText) {
  const cleaned = normalizeWhitespace(rawCostText);
  if (!cleaned) {
    return {
      cost: undefined,
      rawCostText: ''
    };
  }

  if (/free/i.test(cleaned)) {
    return {
      cost: 0,
      rawCostText: cleaned
    };
  }

  const amountMatches = [...cleaned.matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)/g)]
    .map(match => Number.parseFloat(match[1]))
    .filter(Number.isFinite);
  const normalized = cleaned.toLowerCase();

  if (amountMatches.length === 1 && !normalized.includes('/') && !normalized.includes('member')) {
    return {
      cost: amountMatches[0],
      rawCostText: cleaned
    };
  }

  return {
    cost: undefined,
    rawCostText: cleaned
  };
}

function parseTimeText(rawValue) {
  const cleaned = normalizeWhitespace(rawValue).toLowerCase();
  if (!cleaned) {
    return null;
  }

  const match = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) {
    return null;
  }

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] || '0', 10);
  const meridiem = match[3] ? match[3].toLowerCase() : '';

  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  }

  if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  if (!meridiem && hour >= 1 && hour <= 7 && /evening|night/.test(cleaned)) {
    hour += 12;
  }

  return { hour, minute, hasExplicitTime: true };
}

function normalizeYear(rawValue) {
  const numeric = Number.parseInt(rawValue, 10);
  if (numeric < 100) {
    return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  }

  return numeric;
}

function parseMonthNameDate(cleaned) {
  const match = cleaned.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)?(\d{2,4})?/i);
  if (!match) {
    return null;
  }

  const month = MONTH_LOOKUP[match[1].toLowerCase().replace('.', '')];
  const day = Number.parseInt(match[2], 10);
  const rawYear = match[3];
  const year = rawYear ? normalizeYear(rawYear) : undefined;
  return { year, month, day };
}

function parseNumericDate(cleaned) {
  const match = cleaned.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  const year = match[3] ? normalizeYear(match[3]) : undefined;
  return { year, month, day };
}

function inferYear(parts, now = new Date()) {
  if (parts.year) {
    return parts.year;
  }

  const currentYear = now.getUTCFullYear();
  const thisYearCandidate = Date.UTC(currentYear, parts.month - 1, parts.day, 12, 0);
  const cutoff = now.getTime() - 45 * 24 * 60 * 60 * 1000;
  return thisYearCandidate < cutoff ? currentYear + 1 : currentYear;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  const utcEquivalent = Date.UTC(
    Number.parseInt(parts.year, 10),
    Number.parseInt(parts.month, 10) - 1,
    Number.parseInt(parts.day, 10),
    Number.parseInt(parts.hour, 10),
    Number.parseInt(parts.minute, 10),
    Number.parseInt(parts.second, 10)
  );
  return utcEquivalent - date.getTime();
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function parseEventDateTime({
  rawDateText,
  rawTimeText = '',
  timezone = 'America/Chicago',
  now = new Date()
}) {
  const dateText = stripTags(rawDateText);
  const timeText = stripTags(rawTimeText);
  const combined = normalizeWhitespace([dateText, timeText].filter(Boolean).join(' '));

  if (!combined || /\b(tbd|to be determined|coming soon)\b/i.test(combined)) {
    return {
      eventDateUtc: '',
      hasExactTime: false,
      usedNoonFallback: false,
      parseError: 'missing event date'
    };
  }

  const explicitIso = combined.match(/\b(\d{4}-\d{2}-\d{2})(?:[t\s](\d{2}:\d{2})(?::\d{2})?(z|[+-]\d{2}:?\d{2})?)?/i);
  if (explicitIso) {
    const value = explicitIso[0].includes('T') || explicitIso[3]
      ? new Date(explicitIso[0].replace(' ', 'T'))
      : zonedTimeToUtc({
          year: Number.parseInt(explicitIso[1].slice(0, 4), 10),
          month: Number.parseInt(explicitIso[1].slice(5, 7), 10),
          day: Number.parseInt(explicitIso[1].slice(8, 10), 10),
          hour: explicitIso[2] ? Number.parseInt(explicitIso[2].slice(0, 2), 10) : 12,
          minute: explicitIso[2] ? Number.parseInt(explicitIso[2].slice(3, 5), 10) : 0
        }, timezone);

    return {
      eventDateUtc: value.toISOString(),
      hasExactTime: Boolean(explicitIso[2]),
      usedNoonFallback: !explicitIso[2],
      parseError: ''
    };
  }

  const parts = parseMonthNameDate(dateText)
    || parseNumericDate(dateText)
    || parseMonthNameDate(combined)
    || parseNumericDate(combined);
  if (!parts) {
    return {
      eventDateUtc: '',
      hasExactTime: false,
      usedNoonFallback: false,
      parseError: `unable to parse date: ${combined}`
    };
  }

  const year = inferYear(parts, now);
  const parsedTime = parseTimeText(timeText)
    || (/[ap]m|:/.test(dateText.toLowerCase()) ? parseTimeText(dateText) : null);
  const hour = parsedTime ? parsedTime.hour : 12;
  const minute = parsedTime ? parsedTime.minute : 0;
  const value = zonedTimeToUtc({
    year,
    month: parts.month,
    day: parts.day,
    hour,
    minute
  }, timezone);

  return {
    eventDateUtc: value.toISOString(),
    hasExactTime: Boolean(parsedTime && parsedTime.hasExplicitTime),
    usedNoonFallback: !parsedTime,
    parseError: ''
  };
}

function isUpcomingEvent(eventDateUtc, now = new Date()) {
  if (!eventDateUtc) {
    return false;
  }

  const eventTime = new Date(eventDateUtc).getTime();
  return Number.isFinite(eventTime) && eventTime + (24 * 60 * 60 * 1000) >= now.getTime();
}

function normalizeLocation(value) {
  return stripTags(value);
}

function extractLocationSnippet(text) {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) {
    return '';
  }

  const explicitVenueMatch = cleaned.match(/\b(?:at|hosted by)\s+([A-Z0-9][A-Za-z0-9&'().,\- ]{3,80},\s*[A-Z][A-Za-z .'-]+,\s*(?:IL|IN|IA|KS|MI|MN|MO|NE|ND|OH|SD|WI|Illinois|Indiana|Iowa|Kansas|Michigan|Minnesota|Missouri|Nebraska|North Dakota|Ohio|South Dakota|Wisconsin)\b[^.]*)/i);
  if (explicitVenueMatch) {
    return normalizeWhitespace(explicitVenueMatch[1]);
  }

  const addressMatch = cleaned.match(/\b([A-Z0-9][A-Za-z0-9&'().,\- ]{2,80}(?:\||,)\s*\d{1,6}[^,|]+,\s*[A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z]+)\s+\d{5}(?:-\d{4})?)/);
  if (addressMatch) {
    return normalizeWhitespace(addressMatch[1].replace(/\|/g, ', '));
  }

  const cityStateMatch = cleaned.match(/\b([A-Z][A-Za-z .'-]+,\s*(?:IL|IN|IA|KS|MI|MN|MO|NE|ND|OH|SD|WI|Illinois|Indiana|Iowa|Kansas|Michigan|Minnesota|Missouri|Nebraska|North Dakota|Ohio|South Dakota|Wisconsin))\b/);
  if (cityStateMatch) {
    return normalizeWhitespace(cityStateMatch[1]);
  }

  return '';
}

function classifyRegion(text) {
  const raw = normalizeWhitespace(text);
  const cleaned = normalizeComparableText(text);
  if (!cleaned) {
    return 'unknown';
  }

  if (/\b(chicago|illinois|midwest|aurora|itasca|schaumburg|rosemont|oak brook|naperville|milwaukee|madison|minneapolis|st louis|omaha|des moines|indianapolis|detroit|cleveland|columbus|kansas city)\b/i.test(cleaned)) {
    return 'midwest';
  }

  for (const state of MIDWEST_STATES) {
    if (cleaned.includes(state)) {
      return 'midwest';
    }
  }

  for (const abbreviation of MIDWEST_ABBREVIATIONS) {
    if (new RegExp(`,\\s*${abbreviation}\\b`, 'i').test(raw)) {
      return 'midwest';
    }
  }

  for (const signal of NON_MIDWEST_LOCATION_SIGNALS) {
    if (cleaned.includes(signal)) {
      return 'non_midwest';
    }
  }

  return 'unknown';
}

function soundsLikeActualEvent({ title = '', description = '', location = '', organizationName = '', url = '' }) {
  const titleText = normalizeWhitespace(title);
  const descriptionText = normalizeWhitespace(description);
  const haystack = normalizeComparableText([titleText, descriptionText, location, organizationName, url].filter(Boolean).join(' '));
  const normalizedTitle = normalizeComparableText(titleText);
  const hasStrongTitleSignal = EVENT_POSITIVE_KEYWORDS.some(keyword => normalizedTitle.includes(keyword))
    || STRONG_EVENT_SIGNAL_PATTERN.test(titleText)
    || hasDetailEventPath(url);

  if (!titleText) {
    return false;
  }

  if (EVENT_NEGATIVE_PHRASES.some(phrase => haystack.includes(phrase)) && !hasStrongTitleSignal) {
    return false;
  }

  if (/^(home|about|contact|events|calendar|search)$/i.test(titleText)) {
    return false;
  }

  if (/^(view this event|view details|learn more|register now|show details|too many requests)$/i.test(titleText)) {
    return false;
  }

  if (EVENT_POSITIVE_KEYWORDS.some(keyword => haystack.includes(keyword))) {
    return true;
  }

  return STRONG_EVENT_SIGNAL_PATTERN.test(`${titleText} ${descriptionText}`) || (titleText.split(/\s+/).length >= 3 && /[A-Z]/.test(titleText));
}

function hasStrongEventSignals({ title = '', description = '', url = '', registrationUrl = '', location = '' }) {
  const combined = [title, description, url, registrationUrl, location].filter(Boolean).join(' ');
  if (EVENT_NEGATIVE_PHRASES.some(phrase => normalizeComparableText(combined).includes(phrase))) {
    return false;
  }

  if (STRONG_EVENT_SIGNAL_PATTERN.test(combined)) {
    return true;
  }

  if (/\/(events\/details|events\/[a-z0-9-]+-\d{3,}|calendar\/details|meetinginfo\.php)(?:[/?#-]|$)/i.test(url) || /#!event\//i.test(url) || /\/event-\d{5,}/i.test(url)) {
    return true;
  }

  return Boolean(registrationUrl);
}

function hasDetailEventPath(url) {
  const value = String(url || '');
  return /\/(events\/details|events\/[a-z0-9-]+-\d{3,}|calendar\/details|meetinginfo\.php)(?:[/?#-]|$)/i.test(value)
    || /#!event\//i.test(value)
    || /\/event-\d{5,}/i.test(value)
    || /\/event\//i.test(value);
}

function createEventStatus({ eventDateUtc, hasExactTime, rawText = '' }) {
  const normalizedRaw = normalizeComparableText(rawText);
  if (normalizedRaw.includes('cancel')) {
    return 'Cancelled';
  }

  if (!eventDateUtc) {
    return 'Planned';
  }

  const eventTime = new Date(eventDateUtc).getTime();
  if (Number.isFinite(eventTime) && eventTime < Date.now() && !normalizedRaw.includes('upcoming')) {
    return 'Completed';
  }

  return hasExactTime ? 'Scheduled' : 'Planned';
}

function summarizeText(value, maxLength = 500) {
  const cleaned = stripTags(value);
  if (!cleaned) {
    return '';
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function buildEventIdentity({ organizationId, eventName, eventDateUtc, eventUrl }) {
  return [
    organizationId || '',
    normalizeComparableText(eventName),
    String(eventDateUtc || '').slice(0, 10),
    canonicalizeUrl(eventUrl || '')
  ].join('::');
}

module.exports = {
  absoluteUrl,
  buildEventIdentity,
  canonicalizeUrl,
  classifyRegion,
  createEventStatus,
  decodeHtmlEntities,
  extractLocationSnippet,
  hasStrongEventSignals,
  hasDetailEventPath,
  isUpcomingEvent,
  normalizeComparableText,
  normalizeLocation,
  normalizeWhitespace,
  parseCost,
  parseEventDateTime,
  soundsLikeActualEvent,
  stripTags,
  summarizeText
};

const cheerio = require('cheerio');

const {
  absoluteUrl,
  canonicalizeUrl,
  extractLocationSnippet,
  normalizeLocation,
  normalizeWhitespace,
  stripTags,
  summarizeText
} = require('./org-event-normalizer');

function extractTextFromSelectors($root, selectors) {
  const select = typeof $root === 'function'
    ? selector => $root(selector).first()
    : selector => $root.find(selector).first();

  for (const selector of selectors) {
    const element = select(selector);
    if (!element || element.length === 0) {
      continue;
    }

    const text = normalizeWhitespace(element.text());
    if (text) {
      return text;
    }

    const attrValue = normalizeWhitespace(element.attr('datetime'));
    if (attrValue) {
      return attrValue;
    }
  }

  return '';
}

function collectDescription($) {
  const selectors = [
    '[class*="description"]',
    '[class*="event-description"]',
    '.tribe-events-single-event-description',
    '.mec-single-event-description',
    'article .entry-content',
    'main article',
    'main'
  ];

  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element || element.length === 0) {
      continue;
    }

    const summary = summarizeText(element.text(), 900);
    if (summary && summary.length >= 40) {
      return summary;
    }
  }

  return '';
}

function findRegistrationUrl($, pageUrl) {
  let registrationUrl = '';

  $('a[href]').each((_, element) => {
    if (registrationUrl) {
      return;
    }

    const text = normalizeWhitespace($(element).text()).toLowerCase();
    const href = $(element).attr('href');
    if (!href) {
      return;
    }

    if (/register|tickets|sign up|rsvp|get tickets/.test(text)) {
      registrationUrl = absoluteUrl(pageUrl, href);
    }
  });

  return registrationUrl;
}

function chooseEventHeading($) {
  const candidates = [
    normalizeWhitespace($('meta[property="og:title"]').attr('content')),
    ...$('h1, h2, h3, .event-title, .tribe-events-single-event-title, .mec-single-title')
      .toArray()
      .map(element => normalizeWhitespace($(element).text()))
  ].filter(Boolean);

  return candidates.find(value => !/^(meeting information|meeting\/event information|member area login|future meetings|previous meetings|events?)$/i.test(value))
    || candidates[0]
    || '';
}

function extractDetailPageDataFromHtml({ html, url }) {
  const $ = cheerio.load(html);
  const bodyText = normalizeWhitespace($('body').text());
  const eventName = chooseEventHeading($);
  const rawDateText = extractTextFromSelectors($, [
    'time',
    '[itemprop="startDate"]',
    '.date',
    '.event-date',
    '.tribe-event-date-start',
    '.tribe-events-start-date',
    '.mec-start-date-label',
    '.mec-time-details'
  ]) || (bodyText.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i)?.[0] || '');
  const rawTimeText = extractTextFromSelectors($, [
    '.time',
    '.event-time',
    '.tribe-events-start-time',
    '.tribe-event-time',
    '.mec-time'
  ]) || (bodyText.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b(?:\s*[-–]\s*\d{1,2}:\d{2}\s*(?:am|pm)\b)?/i)?.[0] || '');
  const location = extractTextFromSelectors($, [
    '.location',
    '.event-location',
    '.tribe-venue',
    '.tribe-events-venue-details',
    '[itemprop="location"]',
    '.mec-location'
  ]) || extractLocationSnippet(bodyText);
  const rawCostText = extractTextFromSelectors($, [
    '.cost',
    '.event-cost',
    '.tribe-events-event-cost',
    '.price'
  ]) || normalizeWhitespace($.text().match(/\b(?:free|\$\s*\d+(?:\.\d{1,2})?(?:\s*\/\s*\$\s*\d+(?:\.\d{1,2})?)?)/i)?.[0] || '');
  const description = collectDescription($) || summarizeText(bodyText.replace(eventName, ''), 900);
  const registrationUrl = findRegistrationUrl($, url);

  return {
    eventName: stripTags(eventName),
    eventUrl: canonicalizeUrl(url),
    rawDateText,
    rawTimeText,
    location: normalizeLocation(location),
    rawCostText,
    rawDescription: description,
    registrationUrl,
    notes: [],
    scrapeDepth: 'detail'
  };
}

function mergeEventDetails(listEvent, detailEvent) {
  if (!detailEvent) {
    return listEvent;
  }

  return {
    ...listEvent,
    eventName: detailEvent.eventName || listEvent.eventName,
    eventUrl: detailEvent.eventUrl || listEvent.eventUrl,
    rawDateText: detailEvent.rawDateText || listEvent.rawDateText,
    rawTimeText: detailEvent.rawTimeText || listEvent.rawTimeText,
    location: detailEvent.location || listEvent.location,
    rawCostText: detailEvent.rawCostText || listEvent.rawCostText,
    rawDescription: detailEvent.rawDescription || listEvent.rawDescription,
    registrationUrl: detailEvent.registrationUrl || listEvent.registrationUrl,
    notes: [...(listEvent.notes || []), ...(detailEvent.notes || [])],
    scrapeDepth: detailEvent.scrapeDepth || 'detail'
  };
}

module.exports = {
  extractDetailPageDataFromHtml,
  mergeEventDetails
};

const cheerio = require('cheerio');
const { chromium } = require('playwright');

const {
  absoluteUrl,
  canonicalizeUrl,
  classifyRegion,
  createEventStatus,
  extractLocationSnippet,
  hasDetailEventPath,
  hasStrongEventSignals,
  isUpcomingEvent,
  normalizeLocation,
  normalizeWhitespace,
  parseCost,
  parseEventDateTime,
  soundsLikeActualEvent,
  stripTags,
  summarizeText
} = require('./org-event-normalizer');
const {
  extractDetailPageDataFromHtml,
  mergeEventDetails
} = require('./org-event-detail-scraper');

const GENERIC_EVENT_TITLE_PATTERNS = [
  /^events?$/i,
  /^event calendar$/i,
  /^main calendar$/i,
  /^events calendar$/i,
  /^upcoming events$/i,
  /^calendar view$/i,
  /^list view$/i,
  /^show details$/i,
  /^view details/i,
  /^view this event$/i,
  /^register now$/i,
  /^register for /i,
  /^join waitlist$/i,
  /^about the .*event calendar$/i,
  /^meeting\/event information$/i,
  /^too many requests$/i,
  /^chicago chapter events$/i,
  /^events calendar$/i,
  /^view all events$/i,
  /^events?\s*[-:|]/i
  ,
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}$/i
];

function extractTextFromSelectors($root, selectors) {
  for (const selector of selectors) {
    const element = $root.find(selector).first();
    if (!element || element.length === 0) {
      continue;
    }

    const value = normalizeWhitespace(element.text());
    if (value) {
      return value;
    }

    const attrValue = normalizeWhitespace(element.attr('datetime'));
    if (attrValue) {
      return attrValue;
    }
  }

  return '';
}

function collectCandidateNodes($) {
  const selectors = [
    '[data-event-id]',
    '.event-card',
    '.event',
    '.eventItem',
    '.event-item',
    '.tribe-events-calendar-list__event-row',
    '.mec-event-article',
    '.eventon_list_event',
    '.eo-event',
    '.event-listing',
    '.type-event',
    'article'
  ];
  const nodes = [];
  const seen = new Set();

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      if (seen.has(element)) {
        return;
      }

      seen.add(element);
      nodes.push(element);
    });
  }

  return nodes;
}

async function fetchHtml(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      html: await response.text()
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonLdEvents($, baseUrl) {
  const events = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const values = Array.isArray(parsed)
      ? parsed
      : [parsed, ...(Array.isArray(parsed['@graph']) ? parsed['@graph'] : [])];

    for (const value of values.flat()) {
      if (!value || !value['@type']) {
        continue;
      }

      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (!types.some(type => String(type).toLowerCase().includes('event'))) {
        continue;
      }

      const location = value.location && typeof value.location === 'object'
        ? [value.location.name, value.location.address && value.location.address.streetAddress].filter(Boolean).join(', ')
        : value.location;

      const description = summarizeText(value.description || value.about || '', 900);
      const registrationUrl = absoluteUrl(baseUrl, value.offers && value.offers.url);

      events.push({
        eventName: stripTags(value.name),
        eventUrl: absoluteUrl(baseUrl, value.url || registrationUrl),
        rawDateText: value.startDate || '',
        rawTimeText: '',
        location: normalizeLocation(location),
        rawCostText: value.offers && (value.offers.priceCurrency && value.offers.price
          ? `${value.offers.priceCurrency} ${value.offers.price}`
          : value.offers.price),
        rawDescription: description,
        registrationUrl,
        notes: [],
        scrapeDepth: 'list'
      });
    }
  });

  return events;
}

function extractGenericEvents($, baseUrl) {
  const events = [];

  for (const node of collectCandidateNodes($)) {
    const $node = $(node);
    const title = extractTextFromSelectors($node, [
      'h1', 'h2', 'h3', 'h4',
      '.event-title', '.tribe-event-title', '.mec-event-title',
      '.card-title', 'a'
    ]);
    const dateText = extractTextFromSelectors($node, [
      'time',
      '.date', '.event-date', '.tribe-event-date-start', '.mec-start-date-label',
      '[itemprop="startDate"]'
    ]);
    const timeText = extractTextFromSelectors($node, [
      '.time', '.event-time', '.tribe-event-time', '.mec-time'
    ]);
    const text = normalizeWhitespace($node.text());
    const fallbackDateText = dateText || text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?/i)?.[0] || '';
    const link = $node.find('a[href]').first().attr('href');
    const location = extractTextFromSelectors($node, [
      '.location', '.event-location', '.tribe-events-venue-details', '[itemprop="location"]'
    ]);
    const costText = text.match(/\b(?:free|tbd|\$\s*\d+(?:\.\d{1,2})?(?:\s*\/\s*\$\s*\d+(?:\.\d{1,2})?)?)/i)?.[0] || '';
    const description = summarizeText(
      $node.find('.description, .event-description, p').first().text() || text,
      500
    );

    if (!title || !fallbackDateText) {
      continue;
    }

    events.push({
      eventName: title,
      eventUrl: absoluteUrl(baseUrl, link),
      rawDateText: fallbackDateText,
      rawTimeText: timeText,
      location,
      rawCostText: costText,
      rawDescription: description,
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'list'
    });
  }

  return events;
}

function cleanCandidateTitle(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s+/i, '')
    .replace(/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}\s+/i, '')
    .replace(/\b(?:learn more|show details|register now|view details ?►?|join waitlist|add to calendar)\b.*$/i, '')
  );
}

function looksLikeGenericTitle(title) {
  const cleaned = normalizeWhitespace(title);
  if (!cleaned) {
    return true;
  }

  return GENERIC_EVENT_TITLE_PATTERNS.some(pattern => pattern.test(cleaned));
}

function findDateSnippet(text) {
  const cleaned = normalizeWhitespace(text);
  const monthMatch = cleaned.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:\s*-\s*\d{1,2})?(?:,\s*\d{2,4})?/i);
  if (monthMatch) {
    return monthMatch[0];
  }

  const numericMatch = cleaned.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/);
  return numericMatch ? numericMatch[0] : '';
}

function findDateFromHref(href) {
  const value = String(href || '');
  const routeMatch = value.match(/(?:#!?event|\/event)[/-](\d{4})[/-](\d{1,2})[/-](\d{1,2})/i);
  if (routeMatch) {
    const year = routeMatch[1];
    const month = routeMatch[2].padStart(2, '0');
    const day = routeMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

function findTimeSnippet(text) {
  const cleaned = normalizeWhitespace(text);
  const match = cleaned.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i);
  return match ? match[0] : '';
}

function isLikelyEventHref(url) {
  const value = String(url || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  if (value.startsWith('javascript:') || value.startsWith('mailto:') || value.startsWith('tel:')) {
    return false;
  }

  if (/\.(ics|vcs|pdf)(?:$|\?)/.test(value)) {
    return false;
  }

  if (/\/(register|registration|meet-reg1(?:\.php)?|joinwaitlist)(?:[./?]|$)/.test(value)) {
    return false;
  }

  return /^https?:/i.test(value);
}

function deriveTitleFromContext(context, href) {
  const cleaned = normalizeWhitespace(context);
  if (!cleaned) {
    return '';
  }

  const datePrefixMatch = cleaned.match(
    /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)$/i
  );
  const source = datePrefixMatch ? datePrefixMatch[1] : cleaned;
  const stopPatterns = [
    /\b(?:register now|register today|register|learn more|view details ?►?|add to calendar)\b/i,
    /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i,
    /\b(?:venue website|directions|tickets?)\b/i
  ];

  let candidate = source;
  for (const pattern of stopPatterns) {
    const match = candidate.match(pattern);
    if (match && typeof match.index === 'number') {
      candidate = candidate.slice(0, match.index);
      break;
    }
  }

  candidate = cleanCandidateTitle(candidate);
  if (looksLikeGenericTitle(candidate)) {
    return '';
  }

  if (candidate.split(/\s+/).length < 2 && !hasDetailEventPath(href)) {
    return '';
  }

  return candidate;
}

function buildRawEventFromCandidate(candidate, sourceUrl) {
  let title = cleanCandidateTitle(candidate.title || candidate.contextTitle || '');
  const context = normalizeWhitespace(candidate.context || '');
  const description = summarizeText(context, 700);
  const rawDateText = findDateFromHref(candidate.href) || findDateSnippet(context);
  const rawTimeText = findTimeSnippet(context);
  const location = extractLocationSnippet(context);

  if ((!title || looksLikeGenericTitle(title)) && hasDetailEventPath(candidate.href)) {
    title = deriveTitleFromContext(context, candidate.href);
  }

  if (!title || looksLikeGenericTitle(title) || !isLikelyEventHref(candidate.href)) {
    return null;
  }

  if (!soundsLikeActualEvent({
    title,
    description,
    location,
    url: candidate.href
  })) {
    return null;
  }

  if (!rawDateText && !(hasDetailEventPath(candidate.href) || hasStrongEventSignals({
    title,
    description,
    url: candidate.href,
    location
  }))) {
    return null;
  }

  return {
    eventName: title,
    eventUrl: absoluteUrl(sourceUrl, candidate.href),
    rawDateText,
    rawTimeText,
    location,
    rawCostText: '',
    rawDescription: description,
    registrationUrl: '',
    notes: [],
    scrapeDepth: 'list'
  };
}

async function extractPlaywrightLinkEvents(page, sourceUrl) {
  const candidates = await page.evaluate(() => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function firstText(element) {
      if (!element) {
        return '';
      }

      const preferred = element.querySelector('h1, h2, h3, h4, .title, .event-title, .name');
      if (preferred && normalize(preferred.textContent)) {
        return normalize(preferred.textContent);
      }

      const lines = normalize(element.innerText).split('  ').map(part => normalize(part)).filter(Boolean);
      return lines[0] || '';
    }

    return Array.from(document.querySelectorAll('a[href]')).map(anchor => {
      const container = anchor.closest('article, li, tr, .event, .event-item, .event-card, .tribe-events-calendar-list__event-row, .mec-event-article, .eventon_list_event, .card, .row, .list-group-item, .media, .summary, .views-row, .g-group');
      return {
        title: normalize(anchor.textContent),
        href: anchor.href,
        context: normalize((container || anchor.parentElement || anchor).innerText).slice(0, 1200),
        contextTitle: firstText(container || anchor.parentElement || anchor)
      };
    });
  });

  return candidates
    .map(candidate => buildRawEventFromCandidate(candidate, sourceUrl))
    .filter(Boolean);
}

async function extract7x24Events(page, sourceUrl) {
  const candidates = await page.evaluate(() => Array.from(
    document.querySelectorAll('a[href*="meetinginfo.php?id="]')
  ).map(anchor => {
    const card = anchor.closest('article, li, tr, .event, .event-item, .event-card, .card, .row, .summary, .media')
      || anchor.parentElement;
    return {
      href: anchor.href,
      context: String((card || anchor).innerText || '').replace(/\s+/g, ' ').trim()
    };
  }).filter(item => item.href && item.context));

  return dedupeRawEvents(candidates.map(candidate => {
    const titleMatch = candidate.context.match(
      /^(?:[A-Z]{3,9}\s+\d{1,2})\s+(.+?)\s+(?:\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)|View Details|REGISTER)\b/i
    );
    const dateMatch = candidate.context.match(/^(?:[A-Z]{3,9}\s+\d{1,2})/i);
    const timeMatch = candidate.context.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
    const title = cleanCandidateTitle(titleMatch ? titleMatch[1] : deriveTitleFromContext(candidate.context, candidate.href));

    if (!title || looksLikeGenericTitle(title)) {
      return null;
    }

    return {
      eventName: title,
      eventUrl: absoluteUrl(sourceUrl, candidate.href),
      rawDateText: dateMatch ? dateMatch[0] : findDateSnippet(candidate.context),
      rawTimeText: timeMatch ? timeMatch[0] : findTimeSnippet(candidate.context),
      location: extractLocationSnippet(candidate.context),
      rawCostText: '',
      rawDescription: summarizeText(candidate.context, 700),
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'list'
    };
  }).filter(Boolean));
}

async function extractEisenbergEvents(page, sourceUrl) {
  const candidates = await page.evaluate(() => Array.from(
    document.querySelectorAll('a[href*="/event/"]')
  ).map(anchor => {
    const card = anchor.closest('article, li, .event, .event-item, .event-card, .card, .row, .summary, .media, .g-group')
      || anchor.parentElement;
    return {
      href: anchor.href,
      title: String(anchor.textContent || '').replace(/\s+/g, ' ').trim(),
      context: String((card || anchor).innerText || '').replace(/\s+/g, ' ').trim()
    };
  }).filter(item => item.href && item.context));

  return dedupeRawEvents(candidates.map(candidate => {
    const title = cleanCandidateTitle(candidate.title.split(/Event Date:|SPRING \d{4}|FALL \d{4}/i)[0] || deriveTitleFromContext(candidate.context, candidate.href));
    if (!title || looksLikeGenericTitle(title)) {
      return null;
    }

    return {
      eventName: title,
      eventUrl: absoluteUrl(sourceUrl, candidate.href),
      rawDateText: findDateSnippet(candidate.context),
      rawTimeText: findTimeSnippet(candidate.context),
      location: extractLocationSnippet(candidate.context),
      rawCostText: '',
      rawDescription: summarizeText(candidate.context, 700),
      registrationUrl: '',
      notes: [],
      scrapeDepth: 'list'
    };
  }).filter(Boolean));
}

function isPlausibleDetailEvent(detailEvent) {
  return Boolean(
    detailEvent
    && detailEvent.eventName
    && !looksLikeGenericTitle(detailEvent.eventName)
    && soundsLikeActualEvent({
      title: detailEvent.eventName,
      description: detailEvent.rawDescription,
      location: detailEvent.location,
      url: detailEvent.eventUrl
    })
    && isLikelyEventHref(detailEvent.eventUrl || '')
  );
}

function dedupeRawEvents(events) {
  const deduped = new Map();

  for (const event of events) {
    const canonicalUrl = canonicalizeUrl(event.eventUrl || '');
    const key = canonicalUrl || [
      normalizeWhitespace(event.eventName).toLowerCase(),
      normalizeWhitespace(event.rawDateText).toLowerCase()
    ].join('::');
    const existing = deduped.get(key);
    if (!existing || (event.rawDescription || '').length > (existing.rawDescription || '').length) {
      deduped.set(key, event);
    }
  }

  return [...deduped.values()];
}

function normalizeExtractedEvents(rawEvents, {
  organizationId,
  organizationName,
  sourceUrl,
  timezone = 'America/Chicago',
  now = new Date(),
  allowAllRegions = false
}) {
  const events = [];
  const reviewItems = [];

  for (const rawEvent of rawEvents) {
    if (!soundsLikeActualEvent({
      title: rawEvent.eventName,
      description: rawEvent.rawDescription,
      location: rawEvent.location,
      organizationName,
      url: rawEvent.eventUrl
    })) {
      continue;
    }

    const region = classifyRegion([
      rawEvent.location,
      rawEvent.rawDescription,
      rawEvent.eventName,
      rawEvent.eventUrl
    ].filter(Boolean).join(' '));
    if (!allowAllRegions && region === 'non_midwest') {
      continue;
    }

    const parsedDate = parseEventDateTime({
      rawDateText: rawEvent.rawDateText,
      rawTimeText: rawEvent.rawTimeText,
      timezone,
      now
    });

    if (!parsedDate.eventDateUtc && !(
      hasDetailEventPath(rawEvent.eventUrl)
      || rawEvent.registrationUrl
      || (rawEvent.location && hasStrongEventSignals({
      title: rawEvent.eventName,
      description: rawEvent.rawDescription,
      url: rawEvent.eventUrl,
      registrationUrl: rawEvent.registrationUrl,
      location: rawEvent.location
    }))
    )) {
      continue;
    }

    if (parsedDate.eventDateUtc && !isUpcomingEvent(parsedDate.eventDateUtc, now)) {
      continue;
    }

    const cost = parseCost(rawEvent.rawCostText);
    const notes = [...(Array.isArray(rawEvent.notes) ? rawEvent.notes : [])];

    if (parsedDate.usedNoonFallback) {
      notes.push('Exact event time was not available on the source page; stored with a 12:00 PM America/Chicago placeholder.');
    }

    if (cost.rawCostText && cost.cost === undefined) {
      notes.push(`Raw pricing: ${cost.rawCostText}`);
    }

    events.push({
      organizationId,
      organizationName,
      sourceUrl,
      eventName: normalizeWhitespace(rawEvent.eventName),
      eventUrl: rawEvent.eventUrl || sourceUrl,
      eventDateUtc: parsedDate.eventDateUtc || '',
      rawDateText: normalizeWhitespace(rawEvent.rawDateText),
      location: normalizeLocation(rawEvent.location || extractLocationSnippet(rawEvent.rawDescription || '')),
      cost: cost.cost,
      rawCostText: cost.rawCostText,
      notes: notes.join('\n'),
      rawDescription: rawEvent.rawDescription || '',
      registrationUrl: rawEvent.registrationUrl || '',
      scrapeDepth: rawEvent.scrapeDepth || 'list',
      status: createEventStatus({
        eventDateUtc: parsedDate.eventDateUtc,
        hasExactTime: parsedDate.hasExactTime,
        rawText: [rawEvent.rawDescription, rawEvent.rawDateText, rawEvent.rawTimeText].filter(Boolean).join(' ')
      }),
      regionAssessment: region
    });
  }

  return { events, reviewItems };
}

function isSameOrigin(sourceUrl, targetUrl) {
  try {
    return new URL(sourceUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

async function enrichEventsWithDetails({
  browser,
  events,
  sourceUrl,
  pageLimit = 12
}) {
  const reviewItems = [];
  const enrichedEvents = [];
  const uniqueUrls = new Set();

  for (const event of events) {
    if (event.eventUrl && isSameOrigin(sourceUrl, event.eventUrl)) {
      uniqueUrls.add(event.eventUrl);
    }
  }

  const allowedUrls = new Set([...uniqueUrls].slice(0, pageLimit));
  const page = await browser.newPage();

  try {
    for (const event of events) {
      if (!event.eventUrl || !allowedUrls.has(event.eventUrl)) {
        enrichedEvents.push(event);
        continue;
      }

      try {
        await page.goto(event.eventUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const html = await page.content();
        const detailEvent = extractDetailPageDataFromHtml({
          html,
          url: page.url()
        });
        if (isPlausibleDetailEvent(detailEvent)) {
          enrichedEvents.push(mergeEventDetails(event, detailEvent));
        } else {
          reviewItems.push({
            type: 'event',
            organizationName: event.organizationName,
            sourceUrl,
            eventName: event.eventName,
            eventUrl: event.eventUrl,
            reason: 'detail page returned non-event content; kept list-page event data'
          });
          enrichedEvents.push(event);
        }
      } catch (error) {
        reviewItems.push({
          type: 'event',
          organizationName: event.organizationName,
          sourceUrl,
          eventName: event.eventName,
          eventUrl: event.eventUrl,
          reason: `detail page failed: ${error.message}`
        });
        enrichedEvents.push(event);
      }
    }
  } finally {
    await page.close();
  }

  return {
    events: enrichedEvents,
    reviewItems
  };
}

function extractEventsFromHtml({ html, url }) {
  const $ = cheerio.load(html);
  return dedupeRawEvents([
    ...extractJsonLdEvents($, url),
    ...extractGenericEvents($, url)
  ]);
}

async function scrapeOrganizationEvents(organization, {
  timezone = 'America/Chicago',
  now = new Date(),
  fetchTimeoutMs = 15000,
  browserTimeoutMs = 30000,
  detailPageLimit = 12,
  allowAllRegions = false
} = {}) {
  let response = null;

  try {
    response = await fetchHtml(organization.sourceUrl, { timeoutMs: fetchTimeoutMs });
  } catch {
    response = null;
  }

  let listEvents = [];
  let finalUrl = organization.sourceUrl;
  let scrapeMethod = 'fetch';

  if (response && response.ok) {
    finalUrl = response.finalUrl;
    listEvents = extractEventsFromHtml({
      html: response.html,
      url: response.finalUrl
    }).filter(event => !looksLikeGenericTitle(event.eventName) && isLikelyEventHref(event.eventUrl));
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(organization.sourceUrl, { waitUntil: 'domcontentloaded', timeout: browserTimeoutMs });
    await page.waitForTimeout(2500);
    finalUrl = page.url();

    const browserHtml = await page.content();
    const renderedListEvents = extractEventsFromHtml({
      html: browserHtml,
      url: finalUrl
    }).filter(event => !looksLikeGenericTitle(event.eventName) && isLikelyEventHref(event.eventUrl));
    const linkEvents = await extractPlaywrightLinkEvents(page, finalUrl);
    const specializedEvents = dedupeRawEvents([
      ...(organization.organizationName === '7X24' ? await extract7x24Events(page, finalUrl) : []),
      ...(organization.organizationName === 'Harold E. Eisenberg Foundation' ? await extractEisenbergEvents(page, finalUrl) : [])
    ]);
    const pageDetailEvent = extractDetailPageDataFromHtml({
      html: browserHtml,
      url: finalUrl
    });

    listEvents = dedupeRawEvents([
      ...listEvents,
      ...renderedListEvents,
      ...linkEvents,
      ...specializedEvents,
      ...(isPlausibleDetailEvent(pageDetailEvent) ? [pageDetailEvent] : [])
    ]);
    if (response === null || !response.ok || linkEvents.length > 0 || renderedListEvents.length > 0) {
      scrapeMethod = 'playwright';
    }
    await page.close();

    const detailResult = await enrichEventsWithDetails({
      browser,
      events: listEvents.map(event => ({
        ...event,
        organizationId: organization.id,
        organizationName: organization.organizationName,
        sourceUrl: finalUrl
      })),
      sourceUrl: finalUrl,
      pageLimit: detailPageLimit
    });

    const normalized = normalizeExtractedEvents(detailResult.events, {
      organizationId: organization.id,
      organizationName: organization.organizationName,
      sourceUrl: finalUrl,
      timezone,
      now,
      allowAllRegions
    });
    return {
      events: normalized.events,
      reviewItems: [...normalized.reviewItems, ...detailResult.reviewItems],
      sourceUrl: finalUrl,
      scrapeMethod
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  extractEventsFromHtml,
  normalizeExtractedEvents,
  scrapeOrganizationEvents
};

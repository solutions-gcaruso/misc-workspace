const {
  buildEventIdentity,
  canonicalizeUrl,
  normalizeComparableText,
  normalizeWhitespace
} = require('./org-event-normalizer');

function mapExistingEventRecord(record) {
  return {
    id: record.id,
    organizationIds: Array.isArray(record.fields.Organization) ? record.fields.Organization : [],
    eventName: record.fields['Event Name'] || '',
    eventDateUtc: record.fields['Event Date'] || '',
    location: record.fields.Location || '',
    cost: record.fields.Cost,
    status: record.fields['Event Status'] || '',
    notes: record.fields['Event Notes'] || '',
    eventUrl: record.fields['Event URL'] || ''
  };
}

function scoreEventCompleteness(event) {
  let score = 0;
  if (event.eventName) score += 2;
  if (event.eventDateUtc) score += 3;
  if (event.location) score += 2;
  if (event.cost !== undefined && event.cost !== null) score += 1;
  if (event.eventUrl) score += 2;
  if (event.notes && event.notes.length > 40) score += 2;
  if (event.rawDescription && event.rawDescription.length > 40) score += 2;
  if (event.registrationUrl) score += 1;
  if (event.scrapeDepth === 'detail') score += 2;
  return score;
}

function sameDay(left, right) {
  return String(left || '').slice(0, 10) === String(right || '').slice(0, 10);
}

function chooseBetterText(existingValue, scrapedValue) {
  const existing = normalizeWhitespace(existingValue);
  const scraped = normalizeWhitespace(scrapedValue);

  if (!scraped) return existingValue || '';
  if (!existing) return scrapedValue;
  if (normalizeComparableText(existing) === normalizeComparableText(scraped)) {
    return existingValue;
  }

  return scraped.length > existing.length ? scrapedValue : existingValue;
}

function isUsefulDescription(value) {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) {
    return false;
  }

  if (cleaned.length > 900) {
    return false;
  }

  return !/skip to content|privacy promise|view this event|eventsupcoming eventscalendar|var _mnisq|you are viewing this design in preview mode/i.test(cleaned);
}

function appendNotes(existingNotes, scrapedEvent) {
  const existing = normalizeWhitespace(existingNotes);
  const candidateLines = [];

  if (scrapedEvent.notes) {
    candidateLines.push(scrapedEvent.notes);
  }

  if (isUsefulDescription(scrapedEvent.rawDescription)) {
    candidateLines.push(`Description: ${scrapedEvent.rawDescription}`);
  }

  if (scrapedEvent.registrationUrl) {
    candidateLines.push(`Registration URL: ${scrapedEvent.registrationUrl}`);
  }

  const candidate = normalizeWhitespace(candidateLines.filter(Boolean).join('\n'));
  if (!candidate) {
    return existingNotes || '';
  }

  if (!existing) {
    return candidate;
  }

  if (existing.includes(candidate) || normalizeComparableText(existing) === normalizeComparableText(candidate)) {
    return existingNotes;
  }

  return `${existing}\n\n${candidate}`.trim();
}

function createExistingIndexes(existingEvents) {
  const byUrl = new Map();
  const byNameDay = new Map();
  const byName = new Map();

  for (const record of existingEvents) {
    const organizationId = record.organizationIds[0] || '';
    if (!organizationId) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(record.eventUrl || '');
    if (canonicalUrl) {
      const urlKey = `${organizationId}::${canonicalUrl}`;
      const matches = byUrl.get(urlKey) || [];
      matches.push(record);
      byUrl.set(urlKey, matches);
    }

    const nameDayKey = `${organizationId}::${normalizeComparableText(record.eventName)}::${String(record.eventDateUtc || '').slice(0, 10)}`;
    const dayMatches = byNameDay.get(nameDayKey) || [];
    dayMatches.push(record);
    byNameDay.set(nameDayKey, dayMatches);

    const nameKey = `${organizationId}::${normalizeComparableText(record.eventName)}`;
    const nameMatches = byName.get(nameKey) || [];
    nameMatches.push(record);
    byName.set(nameKey, nameMatches);
  }

  return { byUrl, byNameDay, byName };
}

function findExistingMatches(scrapedEvent, indexes) {
  const organizationId = scrapedEvent.organizationId;
  const url = canonicalizeUrl(scrapedEvent.eventUrl || '');
  if (organizationId && url) {
    const urlMatches = indexes.byUrl.get(`${organizationId}::${url}`) || [];
    if (urlMatches.length > 0) {
      return urlMatches;
    }
  }

  const nameDayKey = `${organizationId}::${normalizeComparableText(scrapedEvent.eventName)}::${String(scrapedEvent.eventDateUtc || '').slice(0, 10)}`;
  const dayMatches = indexes.byNameDay.get(nameDayKey) || [];
  if (dayMatches.length > 0) {
    return dayMatches;
  }

  if (!scrapedEvent.eventDateUtc) {
    return indexes.byName.get(`${organizationId}::${normalizeComparableText(scrapedEvent.eventName)}`) || [];
  }

  return [];
}

function buildEventFields(scrapedEvent) {
  const fields = {
    'Event Name': scrapedEvent.eventName,
    Organization: [scrapedEvent.organizationId],
    'Event Status': scrapedEvent.status || 'Scheduled',
    'Event Notes': appendNotes('', scrapedEvent)
  };

  if (scrapedEvent.eventDateUtc) {
    fields['Event Date'] = scrapedEvent.eventDateUtc;
  }

  if (scrapedEvent.location) {
    fields.Location = scrapedEvent.location;
  }

  if (scrapedEvent.cost !== undefined && scrapedEvent.cost !== null) {
    fields.Cost = scrapedEvent.cost;
  }

  if (scrapedEvent.eventUrl) {
    fields['Event URL'] = scrapedEvent.eventUrl;
  }

  return fields;
}

function detectDateConflict(existingEvent, scrapedEvent) {
  if (!existingEvent.eventDateUtc || !scrapedEvent.eventDateUtc) {
    return false;
  }

  return !sameDay(existingEvent.eventDateUtc, scrapedEvent.eventDateUtc);
}

function getExistingValueForField(existingEvent, field) {
  if (field === 'Event Name') return existingEvent.eventName;
  if (field === 'Event Date') return existingEvent.eventDateUtc;
  if (field === 'Event Status') return existingEvent.status;
  if (field === 'Event Notes') return existingEvent.notes;
  if (field === 'Event URL') return existingEvent.eventUrl;
  if (field === 'Location') return existingEvent.location;
  if (field === 'Cost') return existingEvent.cost;
  return '';
}

function mergeIntoUpdate(existingEvent, scrapedEvent) {
  const changedFields = {};
  const reasons = [];

  const betterName = chooseBetterText(existingEvent.eventName, scrapedEvent.eventName);
  const existingNameLooksGeneric = /^(main calendar|events calendar|about the .*event calendar|view this event|meeting\/event information)$/i.test(existingEvent.eventName || '');
  const scrapedNameLooksSpecific = !/^(main calendar|events calendar|view this event|meeting\/event information)$/i.test(scrapedEvent.eventName || '');
  if (betterName && betterName !== existingEvent.eventName && existingNameLooksGeneric && scrapedNameLooksSpecific) {
    changedFields['Event Name'] = betterName;
    reasons.push('expanded event title');
  }

  if (!existingEvent.eventDateUtc && scrapedEvent.eventDateUtc) {
    changedFields['Event Date'] = scrapedEvent.eventDateUtc;
    reasons.push('filled missing event date');
  } else if (existingEvent.eventDateUtc && scrapedEvent.eventDateUtc && sameDay(existingEvent.eventDateUtc, scrapedEvent.eventDateUtc)) {
    const existingHasPlaceholderNoon = String(existingEvent.eventDateUtc).endsWith('T17:00:00.000Z') || String(existingEvent.eventDateUtc).endsWith('T18:00:00.000Z');
    const scrapedHasExactTime = !String(scrapedEvent.notes || '').includes('12:00 PM America/Chicago placeholder');
    if (existingHasPlaceholderNoon && scrapedHasExactTime && existingEvent.eventDateUtc !== scrapedEvent.eventDateUtc) {
      changedFields['Event Date'] = scrapedEvent.eventDateUtc;
      reasons.push('added exact event time from detail page');
    }
  }

  const betterLocation = chooseBetterText(existingEvent.location, scrapedEvent.location);
  if (betterLocation && betterLocation !== existingEvent.location) {
    changedFields.Location = betterLocation;
    reasons.push(existingEvent.location ? 'improved event location detail' : 'filled missing location');
  }

  if (
    (existingEvent.cost === undefined || existingEvent.cost === null || (existingEvent.cost === 0 && Number(scrapedEvent.cost) !== 0))
    && scrapedEvent.cost !== undefined
    && scrapedEvent.cost !== null
  ) {
    changedFields.Cost = scrapedEvent.cost;
    reasons.push(existingEvent.cost === 0 ? 'replaced placeholder cost' : 'filled missing cost');
  }

  if (!existingEvent.status && scrapedEvent.status) {
    changedFields['Event Status'] = scrapedEvent.status;
    reasons.push('filled missing event status');
  }

  const currentUrl = canonicalizeUrl(existingEvent.eventUrl || '');
  const scrapedUrl = canonicalizeUrl(scrapedEvent.eventUrl || '');
  if (scrapedUrl && (!currentUrl || (scrapedUrl !== currentUrl && scrapedEvent.scrapeDepth === 'detail'))) {
    changedFields['Event URL'] = scrapedEvent.eventUrl;
    reasons.push(currentUrl ? 'replaced listing URL with detail URL' : 'filled missing event URL');
  }

  const mergedNotes = appendNotes(existingEvent.notes, scrapedEvent);
  if (mergedNotes && mergedNotes !== (existingEvent.notes || '')) {
    changedFields['Event Notes'] = mergedNotes;
    reasons.push(existingEvent.notes ? 'expanded notes from detail page content' : 'filled missing event notes');
  }

  return {
    changedFields,
    reasons
  };
}

function isPastEvent(existingEvent, { now = new Date() } = {}) {
  if (!existingEvent.eventDateUtc) {
    return false;
  }

  const eventTime = Date.parse(existingEvent.eventDateUtc);
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(eventTime) || !Number.isFinite(nowTime)) {
    return false;
  }

  return eventTime < nowTime;
}

function buildPastEventRemovalPlan({ existingRecords, now = new Date() }) {
  const existingEvents = existingRecords.map(mapExistingEventRecord);
  const deletes = [];
  const deletePreview = [];

  for (const existingEvent of existingEvents) {
    if (!isPastEvent(existingEvent, { now })) {
      continue;
    }

    deletes.push(existingEvent.id);
    deletePreview.push({
      recordId: existingEvent.id,
      eventName: existingEvent.eventName,
      eventDateUtc: existingEvent.eventDateUtc,
      eventStatus: existingEvent.status,
      eventUrl: existingEvent.eventUrl
    });
  }

  return {
    deletes,
    deletePreview
  };
}

function normalizeAuditValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isClearlyInvalidEvent(existingEvent) {
  const name = normalizeAuditValue(existingEvent.eventName);
  const url = String(existingEvent.eventUrl || '').trim();

  if (!name && !url) {
    return false;
  }

  const exactNameMatches = new Set([
    'sponsors',
    'commercial real estate events',
    'past events',
    'apr 2026',
    'https://www.harborsidegolf.com/'
  ]);

  if (exactNameMatches.has(name)) {
    return true;
  }

  const invalidUrlPatterns = [
    /\/attendees$/i,
    /ifma-chicago(?:\.starchapter)?\.com\/meetinginfo\.php(?:$|\?(?:(?:[^#]*\bp_or_f=)|$))/i,
    /bisnow\.com\/events\/(?:chicago|national)$/i,
    /(?:www\.)?chicagolandagc\.org\/?$/i,
    /crewnetwork\.org\/resources\/open-forum/i,
    /(?:www\.)?harborsidegolf\.com\/?$/i,
    /asce\.org\/education-and-events\/events\/meetings\/student-symposium\/?$/i
  ];

  return invalidUrlPatterns.some(pattern => pattern.test(url));
}

function buildInvalidEventAuditPlan({ existingRecords }) {
  const existingEvents = existingRecords.map(mapExistingEventRecord);
  const deletes = [];
  const deletePreview = [];

  for (const existingEvent of existingEvents) {
    if (!isClearlyInvalidEvent(existingEvent)) {
      continue;
    }

    deletes.push(existingEvent.id);
    deletePreview.push({
      recordId: existingEvent.id,
      eventName: existingEvent.eventName,
      eventDateUtc: existingEvent.eventDateUtc,
      eventStatus: existingEvent.status,
      eventUrl: existingEvent.eventUrl
    });
  }

  return {
    deletes,
    deletePreview
  };
}

function buildUpsertPlan({ scrapedEvents, existingRecords }) {
  const existingEvents = existingRecords.map(mapExistingEventRecord);
  const indexes = createExistingIndexes(existingEvents);
  const creates = [];
  const updates = [];
  const reviews = [];
  const updatePreview = [];
  const processedKeys = new Set();

  for (const scrapedEvent of scrapedEvents) {
    const dedupeKey = buildEventIdentity(scrapedEvent);
    if (processedKeys.has(dedupeKey)) {
      reviews.push({
        type: 'event',
        organizationName: scrapedEvent.organizationName,
        eventName: scrapedEvent.eventName,
        sourceUrl: scrapedEvent.sourceUrl,
        eventUrl: scrapedEvent.eventUrl,
        reason: 'duplicate scraped event candidate in current run'
      });
      continue;
    }
    processedKeys.add(dedupeKey);

    const matches = findExistingMatches(scrapedEvent, indexes);
    if (matches.length > 1) {
      reviews.push({
        type: 'event',
        organizationName: scrapedEvent.organizationName,
        eventName: scrapedEvent.eventName,
        sourceUrl: scrapedEvent.sourceUrl,
        eventUrl: scrapedEvent.eventUrl,
        reason: 'multiple Airtable events matched the scraped event'
      });
      continue;
    }

    if (matches.length === 0) {
      creates.push({
        fields: buildEventFields(scrapedEvent)
      });
      continue;
    }

    const existingEvent = matches[0];
    if (detectDateConflict(existingEvent, scrapedEvent)) {
      reviews.push({
        type: 'event',
        organizationName: scrapedEvent.organizationName,
        eventName: scrapedEvent.eventName,
        sourceUrl: scrapedEvent.sourceUrl,
        eventUrl: scrapedEvent.eventUrl,
        reason: 'scraped event date conflicts with existing Airtable record'
      });
      continue;
    }

    if (
      existingEvent.cost !== undefined
      && existingEvent.cost !== null
      && scrapedEvent.cost !== undefined
      && scrapedEvent.cost !== null
      && Number(existingEvent.cost) !== Number(scrapedEvent.cost)
    ) {
      reviews.push({
        type: 'event',
        organizationName: scrapedEvent.organizationName,
        eventName: scrapedEvent.eventName,
        sourceUrl: scrapedEvent.sourceUrl,
        eventUrl: scrapedEvent.eventUrl,
        reason: 'scraped event cost conflicts with existing Airtable record'
      });
      continue;
    }

    const mergeResult = mergeIntoUpdate(existingEvent, scrapedEvent);
    if (Object.keys(mergeResult.changedFields).length === 0) {
      continue;
    }

    const existingScore = scoreEventCompleteness(existingEvent);
    const scrapedScore = scoreEventCompleteness(scrapedEvent);
    if (scrapedScore < existingScore && !Object.keys(mergeResult.changedFields).some(field => ['Event Date', 'Location', 'Cost', 'Event URL'].includes(field))) {
      continue;
    }

    updates.push({
      id: existingEvent.id,
      fields: mergeResult.changedFields
    });
    updatePreview.push({
      recordId: existingEvent.id,
      organizationName: scrapedEvent.organizationName,
      eventName: scrapedEvent.eventName,
      changedFields: Object.entries(mergeResult.changedFields).map(([field, after]) => ({
        field,
        before: getExistingValueForField(existingEvent, field),
        after
      })),
      reasons: mergeResult.reasons
    });
  }

  return {
    creates,
    updates: mergeUpdatesByRecordId(updates),
    reviewItems: reviews,
    updatePreview
  };
}

function mergeUpdatesByRecordId(updates) {
  const merged = new Map();

  for (const update of updates) {
    const existing = merged.get(update.id);
    if (!existing) {
      merged.set(update.id, {
        id: update.id,
        fields: { ...update.fields }
      });
      continue;
    }

    merged.set(update.id, {
      id: update.id,
      fields: {
        ...existing.fields,
        ...update.fields
      }
    });
  }

  return [...merged.values()];
}

module.exports = {
  buildUpsertPlan,
  buildInvalidEventAuditPlan,
  buildPastEventRemovalPlan,
  isClearlyInvalidEvent,
  isPastEvent,
  mapExistingEventRecord,
  scoreEventCompleteness
};

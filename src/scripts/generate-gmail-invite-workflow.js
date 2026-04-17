const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sampleText = [
  '________________________________',
  'From: Gianluca Caruso <GCaruso@atwell.com>',
  'Sent: Wednesday, March 25, 2026 10:19:42 AM (UTC-06:00) Central Time (US & Canada)',
  'To: Jared S. Placek <placek.jared.crm@gmail.com>; Grant Wasielewski <gwasielewski@atwell.com>',
  'Subject: test2',
  'When: Wednesday, March 25, 2026 12:30 PM-1:00 PM.',
  'Where: Microsoft Teams Meeting',
  '',
  'Test 2',
  '',
  '________________________________________________________________________________',
  'Microsoft Teams meeting',
  'Join: https://teams.microsoft.com/meet/2974581219040?p=EGTB6CDyi5NqDcKFoH',
  'Meeting ID: 297 458 121 904 0',
  'Passcode: Wk2gh25G',
  '________________________________',
  'Need help?<https://aka.ms/JoinTeamsMeeting?omkt=en-US> | System reference<https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDExZDk4N2ItZGIwYy00NGU2LWI5NjctNzA2OGZmMzI2NTc3%40thread.v2/0?context=%7b%22Tid%22%3a%22e30a316f-6658-4c4d-8940-2255dcac397f%22%2c%22Oid%22%3a%22e0bc9806-a4fb-42de-befe-374cdb742f44%22%7d>',
  'For organizers: Meeting options<https://teams.microsoft.com/meetingOptions/?organizerId=e0bc9806-a4fb-42de-befe-374cdb742f44&tenantId=e30a316f-6658-4c4d-8940-2255dcac397f&threadId=19_meeting_ZDExZDk4N2ItZGIwYy00NGU2LWI5NjctNzA2OGZmMzI2NTc3@thread.v2&messageId=0&language=en-US>',
].join('\n');

const sampleGmailItem = {
  id: '19d2594ecf766f88',
  threadId: '19d2594ecf766f88',
  subject: 'FW: test2',
  date: '2026-03-25T15:20:06.000Z',
  from: {
    value: [
      {
        address: 'GCaruso@atwell.com',
        name: 'Gianluca Caruso',
      },
    ],
    text: '"Gianluca Caruso" <GCaruso@atwell.com>',
  },
  text: sampleText,
};

const sampleCanceledGmailItem = {
  id: '19d25eb43992c880',
  threadId: '19d25eb43992c880',
  subject: 'Canceled: test2',
  date: '2026-03-25T16:54:24.000Z',
  headers: {
    subject: 'Subject: Canceled: test2',
  },
  from: {
    value: [
      {
        address: 'GCaruso@atwell.com',
        name: 'Gianluca Caruso',
      },
    ],
  },
  to: {
    value: [
      {
        address: 'JPlacek@atwell.com',
        name: 'Jared S. Placek',
      },
      {
        address: 'gwasielewski@atwell.com',
        name: 'Grant Wasielewski',
      },
    ],
  },
  cc: {
    value: [
      {
        address: 'placek.jared.crm@gmail.com',
        name: '',
      },
    ],
  },
  text: '\n\nConfidential Notice: This is a confidential communication.\n',
};

const loadSampleCode = `return [{ json: ${JSON.stringify(sampleGmailItem, null, 2)} }];`;

const classifyMessageCode = String.raw`const item = $input.first().json;

function cleanHeaderSubject(value) {
  return String(value || '')
    .replace(/^Subject:\s*/i, '')
    .trim();
}

const subject = String(item.subject || cleanHeaderSubject(item.headers?.subject) || '').trim();
const rawText = String(item.text || item.plainText || item.body || '');
const meetingForwardHeader = String(item.headers?.['x-ms-exchange-meetingforward-message'] || '').trim();

const isCanceled = /^(canceled|cancelled)\s*:/i.test(subject)
  || /(^|\b)(canceled|cancelled)\s*:/i.test(cleanHeaderSubject(item.headers?.subject));

const hasMeetingForwardHeader = /forward/i.test(meetingForwardHeader);
const hasBodyInviteMarkers = /(^|\n)\s*When:/i.test(rawText) && /(^|\n)\s*Where:/i.test(rawText);
const hasInviteKeywords = /(Microsoft Teams meeting|Join:|Zoom|Google Meet|Webex|GoToMeeting)/i.test(rawText);

const isMeetingInvite = hasMeetingForwardHeader || hasBodyInviteMarkers || hasInviteKeywords;
const shouldProcessMeetingInvite = isMeetingInvite && !isCanceled;

return [{
  json: {
    ...item,
    messageClassification: {
      subject,
      isCanceled,
      hasMeetingForwardHeader,
      hasBodyInviteMarkers,
      hasInviteKeywords,
      isMeetingInvite,
      shouldProcessMeetingInvite,
    },
    shouldProcessMeetingInvite,
  },
}];`;

const parseInviteCode = String.raw`const item = $input.first().json;
const timezone = 'America/Chicago';
const rawText = String(item.text || item.plainText || item.body || '');
const internalEmailAllowlist = new Set([
  'placek.jared.crm@gmail.com',
]);

function extractHeader(text, label) {
  const regex = new RegExp('^' + label + ':\\s*(.+)$', 'im');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function cleanName(value) {
  if (!value) {
    return null;
  }
  const cleaned = String(value).replace(/\s+/g, ' ').replace(/^["']+|["']+$/g, '').trim();
  return cleaned || null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function isInternalEmail(value) {
  const email = normalizeEmail(value);
  if (!email) {
    return false;
  }
  return email.endsWith('@atwell.com') || internalEmailAllowlist.has(email);
}

function parseAddressEntry(entry, source) {
  const trimmed = String(entry || '').trim();
  if (!trimmed) {
    return null;
  }

  const angleMatch = trimmed.match(/^(?:"?([^"<]+?)"?\s*)?<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: cleanName(angleMatch[1]),
      email: normalizeEmail(angleMatch[2]),
      source,
    };
  }

  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    const email = normalizeEmail(emailMatch[0]);
    const name = cleanName(
      trimmed
        .replace(emailMatch[0], '')
        .replace(/[<>"]/g, '')
        .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    );
    return {
      name,
      email,
      source,
    };
  }

  return {
    name: cleanName(trimmed),
    email: null,
    source,
  };
}

function parseAddressList(value, source) {
  if (!value) {
    return [];
  }
  return value
    .split(/\s*;\s*/)
    .map((entry) => parseAddressEntry(entry, source))
    .filter(Boolean);
}

function dedupePeople(people) {
  const seen = new Set();
  const output = [];

  for (const person of people) {
    const emailKey = person.email ? 'email:' + normalizeEmail(person.email) : null;
    const nameKey = person.name ? 'name:' + normalizeText(person.name) : null;
    const key = emailKey || nameKey;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      name: person.name || null,
      email: person.email || null,
      source: person.source || null,
    });
  }

  return output;
}

function cleanupUrl(url) {
  return String(url || '').replace(/[>)\].,]+$/g, '');
}

function pickJoinLink(text, html) {
  const combined = [text || '', html || ''].join('\n');
  const urls = Array.from(combined.matchAll(/https?:\/\/[^\s<>"')\]]+/g), (match) => cleanupUrl(match[0]));
  const virtualUrl = urls.find((url) => /(teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com|gotomeeting\.com|bluejeans\.com)/i.test(url));
  return virtualUrl || urls[0] || null;
}

function parseClock(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hours !== 12) {
    hours += 12;
  }
  if (meridiem === 'AM' && hours === 12) {
    hours = 0;
  }
  return { hours, minutes };
}

function parseMonth(value) {
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return months[String(value || '').toLowerCase()] || null;
}

function getTimezoneOffsetMinutes(timeZone, timestamp) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const tzName = formatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return sign * ((hours * 60) + minutes);
}

function toIsoInTimeZone(parts, timeZone) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  const offsetMinutes = getTimezoneOffsetMinutes(timeZone, utcGuess);
  return new Date(utcGuess - (offsetMinutes * 60 * 1000)).toISOString();
}

function parseWhen(whenRawValue, fallbackDate) {
  if (!whenRawValue) {
    return {
      startDateTime: fallbackDate || new Date().toISOString(),
      endDateTime: null,
      durationSeconds: null,
    };
  }

  const cleaned = String(whenRawValue).replace(/\.$/, '').trim();
  const rangeMatch = cleaned.match(/^(?:[A-Za-z]+,\s+)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)(?:\s*-\s*(\d{1,2}:\d{2}\s*[AP]M))?$/i);
  if (!rangeMatch) {
    return {
      startDateTime: fallbackDate || new Date().toISOString(),
      endDateTime: null,
      durationSeconds: null,
    };
  }

  const month = parseMonth(rangeMatch[1]);
  const day = Number(rangeMatch[2]);
  const year = Number(rangeMatch[3]);
  const startClock = parseClock(rangeMatch[4]);
  const endClock = parseClock(rangeMatch[5]);

  if (!month || !startClock) {
    return {
      startDateTime: fallbackDate || new Date().toISOString(),
      endDateTime: null,
      durationSeconds: null,
    };
  }

  const startDateTime = toIsoInTimeZone(
    {
      year,
      month,
      day,
      hour: startClock.hours,
      minute: startClock.minutes,
    },
    timezone
  );

  let endDateTime = null;
  let durationSeconds = null;

  if (endClock) {
    const startMillis = Date.parse(startDateTime);
    let endCandidate = Date.parse(
      toIsoInTimeZone(
        {
          year,
          month,
          day,
          hour: endClock.hours,
          minute: endClock.minutes,
        },
        timezone
      )
    );
    if (endCandidate <= startMillis) {
      endCandidate += 24 * 60 * 60 * 1000;
    }
    endDateTime = new Date(endCandidate).toISOString();
    durationSeconds = Math.round((endCandidate - startMillis) / 1000);
  }

  return {
    startDateTime,
    endDateTime,
    durationSeconds,
  };
}

function formatPerson(person) {
  if (!person) {
    return null;
  }
  if (person.name && person.email) {
    return person.name + ' <' + person.email + '>';
  }
  return person.name || person.email || null;
}

const fromHeader = extractHeader(rawText, 'From');
const toHeader = extractHeader(rawText, 'To');
const ccHeader = extractHeader(rawText, 'Cc');
const whenRaw = extractHeader(rawText, 'When');
const location = extractHeader(rawText, 'Where');
const forwardedSubject = extractHeader(rawText, 'Subject');

const organizer = parseAddressList(fromHeader, 'from')[0]
  || {
    name: item.from?.value?.[0]?.name || null,
    email: normalizeEmail(item.from?.value?.[0]?.address || null),
    source: 'from',
  };

const invitees = dedupePeople([
  organizer,
  ...parseAddressList(toHeader, 'to'),
  ...parseAddressList(ccHeader, 'cc'),
]);

const externalAttendees = invitees
  .filter((person) => {
    return person.email ? !isInternalEmail(person.email) : true;
  })
  .map((person) => ({ name: person.name || null, email: person.email || null }));

const internalAttendees = invitees
  .filter((person) => {
    return isInternalEmail(person.email);
  })
  .map((person) => ({ name: person.name || null, email: person.email || null }));

const joinLink = pickJoinLink(rawText, item.html);
const timeParse = parseWhen(whenRaw, item.date || new Date().toISOString());
const activityType = joinLink || /(teams|zoom|google meet|meet|webex|virtual|conference call)/i.test(String(location || ''))
  ? 'Virtual Meeting'
  : null;

const emailSubject = item.subject || forwardedSubject || null;
const summaryLines = [
  'Meeting subject: ' + (emailSubject || 'Untitled'),
  organizer ? 'Organizer: ' + formatPerson(organizer) : null,
  whenRaw ? 'When: ' + whenRaw : null,
  timeParse.startDateTime ? 'Start (ISO): ' + timeParse.startDateTime : null,
  timeParse.endDateTime ? 'End (ISO): ' + timeParse.endDateTime : null,
  location ? 'Where: ' + location : null,
  joinLink ? 'Join link: ' + joinLink : null,
  'External attendees: ' + (externalAttendees.length ? externalAttendees.map(formatPerson).join('; ') : 'None detected'),
  'Internal attendees: ' + (internalAttendees.length ? internalAttendees.map(formatPerson).join('; ') : 'None detected'),
].filter(Boolean);

return [{
  json: {
    gmailMessageId: item.id || item.messageId || null,
    gmailThreadId: item.threadId || null,
    emailSubject,
    rawText,
    organizer: organizer
      ? {
          name: organizer.name || null,
          email: organizer.email || null,
        }
      : {
          name: null,
          email: null,
        },
    invitees,
    location: location || null,
    joinLink,
    whenRaw: whenRaw || null,
    startDateTime: timeParse.startDateTime,
    endDateTime: timeParse.endDateTime,
    durationSeconds: timeParse.durationSeconds,
    externalAttendees,
    internalAttendees,
    activityType,
    conversationSummary: summaryLines.join('\n'),
  },
}];`;

const tagParsedCode = String.raw`return [{
  json: {
    recordType: 'parsed',
    data: $input.first().json,
  },
}];`;

const tagClientCode = String.raw`return $input.all().map((item) => ({
  json: {
    recordType: 'client',
    record: item.json,
  },
}));`;

const tagCompanyCode = String.raw`return $input.all().map((item) => ({
  json: {
    recordType: 'company',
    record: item.json,
  },
}));`;

const tagEmployeeCode = String.raw`return $input.all().map((item) => ({
  json: {
    recordType: 'employee',
    record: item.json,
  },
}));`;

const matchRecordsCode = String.raw`const payload = $input.all().map((item) => item.json);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function pushToMap(map, key, value) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

const parsed = payload.find((entry) => entry.recordType === 'parsed')?.data;
if (!parsed) {
  throw new Error('Parsed invite payload was not found.');
}

const clients = payload.filter((entry) => entry.recordType === 'client').map((entry) => entry.record);
const companies = payload.filter((entry) => entry.recordType === 'company').map((entry) => entry.record);
const employees = payload.filter((entry) => entry.recordType === 'employee').map((entry) => entry.record);

const clientIds = new Set();
const matchedClientIds = [];
const matchedEmployeeIds = [];
const unmatchedExternal = [];
const clientsToCreate = [];
const queuedCreateKeys = new Set();

const clientsByEmail = new Map();
const clientsByName = new Map();
const companiesByName = new Map();
const employeesByName = new Map();

for (const client of clients) {
  pushToMap(clientsByEmail, normalizeEmail(client.Email), client);
  pushToMap(clientsByName, normalizeText(client['Client Name']), client);
}

for (const company of companies) {
  pushToMap(companiesByName, normalizeText(company['Company Name']), company);
}

for (const employee of employees) {
  pushToMap(employeesByName, normalizeText(employee['Employee Name']), employee);
}

for (const attendee of parsed.externalAttendees || []) {
  const attendeeEmail = normalizeEmail(attendee.email);
  const attendeeName = normalizeText(attendee.name);

  const emailMatches = attendeeEmail ? (clientsByEmail.get(attendeeEmail) || []) : [];
  const nameMatches = attendeeName ? (clientsByName.get(attendeeName) || []) : [];

  if (emailMatches.length === 1) {
    const recordId = emailMatches[0].id;
    if (!clientIds.has(recordId)) {
      clientIds.add(recordId);
      matchedClientIds.push(recordId);
    }
    continue;
  }

  if (emailMatches.length > 1) {
    unmatchedExternal.push({
      name: attendee.name || null,
      email: attendee.email || null,
      reason: 'multiple CRM client records share this email',
    });
    continue;
  }

  if (nameMatches.length === 1) {
    const recordId = nameMatches[0].id;
    if (!clientIds.has(recordId)) {
      clientIds.add(recordId);
      matchedClientIds.push(recordId);
    }
    continue;
  }

  if (nameMatches.length > 1) {
    unmatchedExternal.push({
      name: attendee.name || null,
      email: attendee.email || null,
      reason: 'multiple CRM client records share this name',
    });
    continue;
  }

  if (!attendee.name && !attendee.email) {
    unmatchedExternal.push({
      name: null,
      email: null,
      reason: 'attendee had no usable name or email',
    });
    continue;
  }

  const createKey = attendeeEmail || attendeeName;
  if (!createKey || queuedCreateKeys.has(createKey)) {
    continue;
  }
  queuedCreateKeys.add(createKey);

  const companyName = attendee.companyName || null;
  const companyMatch = companyName ? (companiesByName.get(normalizeText(companyName)) || []) : [];

  clientsToCreate.push({
    clientName: attendee.name || attendee.email || 'Unknown Attendee',
    email: attendee.email || null,
    companyId: companyMatch.length === 1 ? companyMatch[0].id : null,
    companyName: companyMatch.length === 1 ? companyMatch[0]['Company Name'] : (companyName || null),
  });
}

const employeeIds = new Set();
for (const attendee of parsed.internalAttendees || []) {
  const matches = employeesByName.get(normalizeText(attendee.name)) || [];
  if (matches.length === 1) {
    const recordId = matches[0].id;
    if (!employeeIds.has(recordId)) {
      employeeIds.add(recordId);
      matchedEmployeeIds.push(recordId);
    }
  }
}

return [{
  json: {
    ...parsed,
    matchedClientIds,
    clientsToCreate,
    matchedEmployeeIds,
    unmatchedExternal,
  },
}];`;

const emitClientsToCreateCode = String.raw`const plan = $input.first().json;

return (plan.clientsToCreate || []).map((client) => ({
  json: {
    plan,
    clientName: client.clientName,
    email: client.email || null,
    companyIds: client.companyId ? [client.companyId] : [],
    companyName: client.companyName || null,
  },
}));`;

const finalizeWithNewClientsCode = String.raw`const items = $input.all();
if (!items.length) {
  throw new Error('No client creation results were returned.');
}

const plan = items.find((item) => item.json?.plan)?.json.plan
  || $items('If Needs New Clients', 0, 0)?.[0]?.json
  || $items('Emit Clients To Create', 0, 0)?.[0]?.json?.plan;

if (!plan) {
  throw new Error('Could not recover the client matching plan for finalization.');
}

const createdClientIds = items.map((item) => item.json.id).filter(Boolean);
const allClientIds = Array.from(new Set([...(plan.matchedClientIds || []), ...createdClientIds]));

return [{
  json: {
    ...plan,
    createdClientIds,
    allClientIds,
  },
}];`;

const finalizeExistingClientsCode = String.raw`const plan = $input.first().json;

return [{
  json: {
    ...plan,
    createdClientIds: [],
    allClientIds: Array.from(new Set(plan.matchedClientIds || [])),
  },
}];`;

const skipInternalOnlyCode = String.raw`const invite = $input.first().json;
return [{
  json: {
    status: 'skipped',
    reason: 'No external attendees were detected, so no Airtable records were created.',
    gmailMessageId: invite.gmailMessageId || null,
    gmailThreadId: invite.gmailThreadId || null,
    internalAttendees: invite.internalAttendees || [],
  },
}];`;

const skipNonMeetingInviteCode = String.raw`const item = $input.first().json;
return [{
  json: {
    status: 'skipped',
    reason: item.messageClassification?.isCanceled
      ? 'Message was identified as a canceled calendar event.'
      : 'Message was not identified as an active meeting invite.',
    gmailMessageId: item.id || item.messageId || null,
    gmailThreadId: item.threadId || null,
    subject: item.subject || item.messageClassification?.subject || null,
    messageClassification: item.messageClassification || null,
  },
}];`;

const skipNoLinkedClientsCode = String.raw`const invite = $input.first().json;
return [{
  json: {
    status: 'skipped',
    reason: 'External attendees were found, but none could be matched or created as CRM clients.',
    gmailMessageId: invite.gmailMessageId || null,
    unmatchedExternal: invite.unmatchedExternal || [],
  },
}];`;

function airtableRef(value, cachedResultName, cachedResultUrl) {
  return {
    __rl: true,
    value,
    mode: 'list',
    cachedResultName,
    cachedResultUrl,
  };
}

const workflow = {
  name: 'Gmail Forwarded Invite to Airtable Conversations',
  nodes: [
    {
      parameters: {},
      id: 'cbf79f7d-7adc-4889-a3b7-013e6fa6939b',
      name: 'When clicking Execute workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [160, 260],
    },
    {
      parameters: {
        jsCode: loadSampleCode,
      },
      id: '8f1f3b80-32c3-4ce8-a62e-3312ab9dc223',
      name: 'Load Sample Gmail Item',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [400, 260],
    },
    {
      parameters: {},
      id: 'b8f05e4f-c3f8-4322-a68d-ca3c8e4105d2',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.1,
      position: [160, 420],
    },
    {
      parameters: {
        jsCode: classifyMessageCode,
      },
      id: '5d1bd38c-9138-4883-9ff8-ed2fbe9b3b9e',
      name: 'Classify Message Type',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [640, 340],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'b09bccfc-6f13-4c95-8e0d-a9ae0b27f9b1',
              leftValue: '={{ String($json.shouldProcessMeetingInvite) }}',
              rightValue: 'true',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'be38523b-4b4d-4251-88c7-dce2c2805dae',
      name: 'If Is Active Meeting Invite',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [880, 340],
    },
    {
      parameters: {
        jsCode: skipNonMeetingInviteCode,
      },
      id: 'ecf41eca-261e-4f48-b2b2-a8934efee31c',
      name: 'Skip Non-Meeting or Canceled Message',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1120, 500],
    },
    {
      parameters: {
        jsCode: parseInviteCode,
      },
      id: 'fcf15453-9f8a-4c3a-9c15-a1f863f5f181',
      name: 'Parse Forwarded Invite',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1120, 340],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: '5f0069f8-70f8-42af-ac48-27c55a47ce20',
              leftValue: '={{ $json.externalAttendees[0]?.email || $json.externalAttendees[0]?.name || "" }}',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'notEmpty',
                singleValue: true,
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: '1594cdaa-a770-4daa-a758-817857347d66',
      name: 'If Has External Attendees',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [880, 340],
    },
    {
      parameters: {
        jsCode: skipInternalOnlyCode,
      },
      id: '510d4d8d-e984-4129-b29d-6c2b73f6bc8c',
      name: 'Skip Internal Only Invite',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1360, 500],
    },
    {
      parameters: {
        jsCode: tagParsedCode,
      },
      id: 'ee47779e-b43f-4528-b8e5-97ceb93fce10',
      name: 'Tag Parsed Invite',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1360, 120],
    },
    {
      parameters: {
        authentication: 'airtableOAuth2Api',
        operation: 'search',
        base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
        table: airtableRef('tblpwZCI6iGrESUDI', 'Clients', 'https://airtable.com/appxCuCg2znbMJx2v/tblpwZCI6iGrESUDI'),
        options: {},
      },
      id: '1852ae71-d40b-4f54-a1ad-aa3e0ce70777',
      name: 'Get Client Records',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      position: [1360, 260],
    },
    {
      parameters: {
        jsCode: tagClientCode,
      },
      id: '436a3854-f20d-43d0-885f-7d65ad5758d0',
      name: 'Tag Client Records',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1600, 260],
    },
    {
      parameters: {
        authentication: 'airtableOAuth2Api',
        operation: 'search',
        base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
        table: airtableRef('tblHPdSrAS7VV8utO', 'Companies', 'https://airtable.com/appxCuCg2znbMJx2v/tblHPdSrAS7VV8utO'),
        options: {},
      },
      id: 'ba00c1f8-b765-4d59-bb8a-3201ac0e3b50',
      name: 'Get Company Records',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      position: [1360, 340],
    },
    {
      parameters: {
        jsCode: tagCompanyCode,
      },
      id: '1d1e8808-f2a2-45d4-ba9a-55c420e0b439',
      name: 'Tag Company Records',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1600, 340],
    },
    {
      parameters: {
        authentication: 'airtableOAuth2Api',
        operation: 'search',
        base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
        table: airtableRef('tblAFg2j2lRJXv0V8', 'Manhard Employees', 'https://airtable.com/appxCuCg2znbMJx2v/tblAFg2j2lRJXv0V8'),
        options: {},
      },
      id: '74106ecb-cb6c-44e2-a7cf-512cb3614d92',
      name: 'Get Employee Records',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      position: [1360, 420],
    },
    {
      parameters: {
        jsCode: tagEmployeeCode,
      },
      id: '3c78c8b4-89db-4f8f-83fd-95031ee62d44',
      name: 'Tag Employee Records',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1600, 420],
    },
    {
      parameters: {
        mode: 'append',
      },
      id: '1c93fe4b-4ec4-4b84-a111-d0e021bd7229',
      name: 'Merge Parsed and Clients',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [1840, 240],
    },
    {
      parameters: {
        mode: 'append',
      },
      id: '7240fdde-577d-4862-9875-f840c0ff0bf3',
      name: 'Merge Companies',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [2080, 280],
    },
    {
      parameters: {
        mode: 'append',
      },
      id: '7d960885-50b3-468d-9f01-9d9774e4ff36',
      name: 'Merge Employees',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [2320, 320],
    },
    {
      parameters: {
        jsCode: matchRecordsCode,
      },
      id: 'dc8bc953-c7d1-49a4-b5af-d4480d983348',
      name: 'Match CRM Records',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2560, 320],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: '0b59d79c-dc5d-4ea0-bdbf-91d356991145',
              leftValue: '={{ $json.clientsToCreate[0]?.clientName || "" }}',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'notEmpty',
                singleValue: true,
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: '5af04a0f-8184-424f-b4a7-22bbbd10c96c',
      name: 'If Needs New Clients',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2800, 320],
    },
    {
      parameters: {
        jsCode: emitClientsToCreateCode,
      },
      id: 'a23dd566-825a-4f4f-afb0-97d463fdf8ea',
      name: 'Emit Clients To Create',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2800, 240],
    },
    {
      parameters: {
        authentication: 'airtableOAuth2Api',
        operation: 'create',
        base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
        table: airtableRef('tblpwZCI6iGrESUDI', 'Clients', 'https://airtable.com/appxCuCg2znbMJx2v/tblpwZCI6iGrESUDI'),
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Client Name': '={{ $json.clientName }}',
            Company: '={{ $json.companyIds }}',
            Email: '={{ $json.email }}',
          },
          matchingColumns: [],
          schema: [
            {
              id: 'Client Name',
              displayName: 'Client Name',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'string',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Company',
              displayName: 'Company',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'array',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Email',
              displayName: 'Email',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'string',
              readOnly: false,
              removed: false,
            },
          ],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {
          typecast: true,
        },
      },
      id: 'fb9d6ce2-daa5-43ff-bf3a-afcdb4326f6e',
      name: 'Create Missing Clients',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      position: [3040, 240],
    },
    {
      parameters: {
        jsCode: finalizeWithNewClientsCode,
      },
      id: '01e0cc86-7196-4405-8c3a-b4d045f4e65a',
      name: 'Finalize With New Clients',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3280, 240],
    },
    {
      parameters: {
        jsCode: finalizeExistingClientsCode,
      },
      id: 'bdb4634d-15b5-4d3f-a651-17268f67f82c',
      name: 'Finalize Existing Clients',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2800, 400],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: '0f57fcef-4e62-40fb-84fd-d5638bceb747',
              leftValue: '={{ $json.allClientIds[0] || "" }}',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'exists',
                singleValue: true,
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'cd1b391a-8457-4618-aa78-c6f6b6f81289',
      name: 'If Has Linked Clients',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [3520, 320],
    },
    {
      parameters: {
        authentication: 'airtableOAuth2Api',
        operation: 'create',
        base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
        table: airtableRef('tblhj8ZhO5XRFABom', 'Conversations', 'https://airtable.com/appxCuCg2znbMJx2v/tblhj8ZhO5XRFABom'),
        columns: {
          mappingMode: 'defineBelow',
          value: {
            Date: '={{ $json.startDateTime }}',
            'Duration (minutes)': '={{ $json.durationSeconds }}',
            Client: '={{ $json.allClientIds }}',
            'Conversation Summary': '={{ $json.conversationSummary }}',
            'Activity Type': '={{ $json.activityType }}',
            'Internal Attendance': '={{ $json.matchedEmployeeIds }}',
          },
          matchingColumns: [],
          schema: [
            {
              id: 'Date',
              displayName: 'Date',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'dateTime',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Duration (minutes)',
              displayName: 'Duration (minutes)',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'number',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Client',
              displayName: 'Client',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'array',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Conversation Summary',
              displayName: 'Conversation Summary',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'string',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Activity Type',
              displayName: 'Activity Type',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'options',
              readOnly: false,
              removed: false,
            },
            {
              id: 'Internal Attendance',
              displayName: 'Internal Attendance',
              required: false,
              defaultMatch: false,
              canBeUsedToMatch: true,
              display: true,
              type: 'array',
              readOnly: false,
              removed: false,
            },
          ],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {
          typecast: true,
        },
      },
      id: '772e7daa-d18c-4ec6-82b1-86fcdad3da40',
      name: 'Create Conversation Record',
      type: 'n8n-nodes-base.airtable',
      typeVersion: 2.1,
      position: [3760, 240],
    },
    {
      parameters: {
        jsCode: skipNoLinkedClientsCode,
      },
      id: '2f944783-eb79-4f45-a0ee-bf700e3c0330',
      name: 'Skip When No Clients Could Link',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3760, 400],
    },
  ],
  connections: {
    'When clicking Execute workflow': {
      main: [
        [
          {
            node: 'Load Sample Gmail Item',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Load Sample Gmail Item': {
      main: [
        [
          {
            node: 'Classify Message Type',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'When Executed by Another Workflow': {
      main: [
        [
          {
            node: 'Classify Message Type',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Classify Message Type': {
      main: [
        [
          {
            node: 'If Is Active Meeting Invite',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'If Is Active Meeting Invite': {
      main: [
        [
          {
            node: 'Parse Forwarded Invite',
            type: 'main',
            index: 0,
          },
        ],
        [
          {
            node: 'Skip Non-Meeting or Canceled Message',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Parse Forwarded Invite': {
      main: [
        [
          {
            node: 'If Has External Attendees',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'If Has External Attendees': {
      main: [
        [
          {
            node: 'Tag Parsed Invite',
            type: 'main',
            index: 0,
          },
          {
            node: 'Get Client Records',
            type: 'main',
            index: 0,
          },
          {
            node: 'Get Company Records',
            type: 'main',
            index: 0,
          },
          {
            node: 'Get Employee Records',
            type: 'main',
            index: 0,
          },
        ],
        [
          {
            node: 'Skip Internal Only Invite',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Tag Parsed Invite': {
      main: [
        [
          {
            node: 'Merge Parsed and Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Get Client Records': {
      main: [
        [
          {
            node: 'Tag Client Records',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Tag Client Records': {
      main: [
        [
          {
            node: 'Merge Parsed and Clients',
            type: 'main',
            index: 1,
          },
        ],
      ],
    },
    'Merge Parsed and Clients': {
      main: [
        [
          {
            node: 'Merge Companies',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Get Company Records': {
      main: [
        [
          {
            node: 'Tag Company Records',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Tag Company Records': {
      main: [
        [
          {
            node: 'Merge Companies',
            type: 'main',
            index: 1,
          },
        ],
      ],
    },
    'Merge Companies': {
      main: [
        [
          {
            node: 'Merge Employees',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Get Employee Records': {
      main: [
        [
          {
            node: 'Tag Employee Records',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Tag Employee Records': {
      main: [
        [
          {
            node: 'Merge Employees',
            type: 'main',
            index: 1,
          },
        ],
      ],
    },
    'Merge Employees': {
      main: [
        [
          {
            node: 'Match CRM Records',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Match CRM Records': {
      main: [
        [
          {
            node: 'If Needs New Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'If Needs New Clients': {
      main: [
        [
          {
            node: 'Emit Clients To Create',
            type: 'main',
            index: 0,
          },
        ],
        [
          {
            node: 'Finalize Existing Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Emit Clients To Create': {
      main: [
        [
          {
            node: 'Create Missing Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Create Missing Clients': {
      main: [
        [
          {
            node: 'Finalize With New Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Finalize With New Clients': {
      main: [
        [
          {
            node: 'If Has Linked Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'Finalize Existing Clients': {
      main: [
        [
          {
            node: 'If Has Linked Clients',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
    'If Has Linked Clients': {
      main: [
        [
          {
            node: 'Create Conversation Record',
            type: 'main',
            index: 0,
          },
        ],
        [
          {
            node: 'Skip When No Clients Could Link',
            type: 'main',
            index: 0,
          },
        ],
      ],
    },
  },
  pinData: {},
  settings: {
    executionOrder: 'v1',
  },
  meta: {
    templateCredsSetupCompleted: true,
  },
};

function runCodeNode(jsCode, inputItems, extraContext = {}) {
  const $input = {
    first: () => inputItems[0],
    all: () => inputItems,
  };
  const $items = extraContext.$items || (() => []);
  const fn = new Function('$input', '$items', jsCode);
  return fn($input, $items);
}

const activeClassification = runCodeNode(classifyMessageCode, [{ json: sampleGmailItem }]);
assert.equal(activeClassification[0].json.shouldProcessMeetingInvite, true, 'Active meeting invite sample should pass the meeting filter');

const canceledClassification = runCodeNode(classifyMessageCode, [{ json: sampleCanceledGmailItem }]);
assert.equal(canceledClassification[0].json.shouldProcessMeetingInvite, false, 'Canceled event sample should be excluded by the meeting filter');
assert.equal(canceledClassification[0].json.messageClassification.isCanceled, true, 'Canceled event sample should be marked as canceled');

const parseResult = runCodeNode(parseInviteCode, [{ json: sampleGmailItem }]);
assert.equal(parseResult.length, 1, 'Parse code should emit one item');
assert.equal(parseResult[0].json.activityType, 'Virtual Meeting', 'Sample invite should be classified as a virtual meeting');
assert.equal(parseResult[0].json.durationSeconds, 1800, 'Sample invite should parse as a 30 minute meeting');
assert.equal(parseResult[0].json.startDateTime, '2026-03-25T17:30:00.000Z', 'Sample invite should convert to the correct UTC start time');
assert.equal(parseResult[0].json.internalAttendees.length, 3, 'Organizer plus recipients should be classified as internal');
assert.equal(parseResult[0].json.externalAttendees.length, 0, 'Sample invite should have no external attendees');

const finalizeResult = runCodeNode(
  finalizeWithNewClientsCode,
  [
    {
      json: {
        id: 'recNewClient1',
      },
    },
  ],
  {
    $items: (nodeName) => {
      if (nodeName === 'If Needs New Clients') {
        return [
          {
            json: {
              matchedClientIds: ['recExistingClient1'],
            },
          },
        ];
      }
      return [];
    },
  }
);
assert.deepEqual(
  finalizeResult[0].json.allClientIds,
  ['recExistingClient1', 'recNewClient1'],
  'Finalize With New Clients should merge existing and newly created client IDs'
);

const outputPath = path.join(__dirname, '..', '..', 'output', 'gmail-forwarded-invite-to-airtable.workflow.json');
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(outputPath);

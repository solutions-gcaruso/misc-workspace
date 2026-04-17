const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sampleQuoPayload = {
  event: {
    id: 'quo-call-123',
    startedAt: '2026-03-26T15:00:00.000Z',
    durationSeconds: 1800,
    title: 'Lease Review Call',
    summary: 'Discussed next steps and timing for follow-up outreach.',
    transcript: 'Gianluca: Thanks for hopping on.\nJane: Happy to connect.\nBrett: I will send the revised timing this week.',
    participants: [
      {
        contactName: 'Jane Smith',
        phoneNumber: '+1 (312) 555-1212',
      },
      {
        contactName: 'Mom',
        phoneNumber: '(555) 000-0000',
      },
      {
        contactName: 'Gianluca Caruso',
        phoneNumber: '+1 773 555 4444',
        email: 'gcaruso@atwell.com',
        isInternal: true,
      },
      {
        contactName: 'Brett Newcontact',
        phoneNumber: '214-555-7777',
      },
    ],
  },
};

const invalidSampleQuoPayload = {
  event: {
    title: 'Missing identifiers',
    participants: [],
  },
};

const loadSampleCode = `return [{ json: ${JSON.stringify(sampleQuoPayload, null, 2)} }];`;

const captureRawPayloadCode = String.raw`const item = $input.first().json;

return [{
  json: {
    rawPayload: item,
    capturedAt: new Date().toISOString(),
  },
}];`;

const normalizeQuoPayloadCode = String.raw`const item = $input.first().json;
const raw = item.rawPayload ?? item;

function getValueAtPath(source, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => {
      if (value == null) {
        return undefined;
      }
      return value[key];
    }, source);
}

function getFirstValue(source, paths) {
  for (const candidatePath of paths) {
    const value = getValueAtPath(source, candidatePath);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
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

function buildPhoneKeys(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return [];
  }
  const keys = new Set([digits]);

  if (digits.length === 11 && digits.startsWith('1')) {
    keys.add(digits.slice(1));
  }

  if (digits.length === 10) {
    keys.add('1' + digits);
  }

  return Array.from(keys);
}

function cleanName(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function cleanMultiline(value) {
  const cleaned = String(value || '').replace(/\r\n/g, '\n').trim();
  return cleaned || null;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
}

function readDurationSeconds(source) {
  const durationSecondsValue = getFirstValue(source, [
    'durationSeconds',
    'durationSec',
    'durationInSeconds',
    'call.durationSeconds',
    'call.durationInSeconds',
    'event.durationSeconds',
    'event.durationInSeconds',
    'data.durationSeconds',
    'data.durationInSeconds',
  ]);
  if (durationSecondsValue !== undefined) {
    const numeric = Number(durationSecondsValue);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const durationMinutesValue = getFirstValue(source, [
    'durationMinutes',
    'durationInMinutes',
    'call.durationMinutes',
    'event.durationMinutes',
    'data.durationMinutes',
  ]);
  if (durationMinutesValue !== undefined) {
    const numeric = Number(durationMinutesValue);
    return Number.isFinite(numeric) ? numeric * 60 : null;
  }

  return null;
}

function normalizeParticipant(input) {
  if (typeof input === 'string') {
    const name = cleanName(input);
    return name
      ? {
          name,
          phoneRaw: null,
          phoneKeys: [],
          email: null,
          companyName: null,
          isInternal: false,
          role: null,
        }
      : null;
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const name = cleanName(getFirstValue(input, [
    'name',
    'fullName',
    'contactName',
    'participantName',
    'displayName',
    'personName',
  ]));
  const phoneRaw = cleanName(getFirstValue(input, [
    'phone',
    'phoneNumber',
    'number',
    'contactPhone',
    'mobilePhone',
    'mobile',
    'callerPhone',
    'phone_number',
    'e164Phone',
  ]));
  const email = normalizeEmail(getFirstValue(input, [
    'email',
    'emailAddress',
    'contactEmail',
  ]));
  const companyName = cleanName(getFirstValue(input, [
    'companyName',
    'company',
    'organization',
    'organizationName',
  ]));
  const role = cleanName(getFirstValue(input, [
    'role',
    'participantType',
    'type',
  ]));
  const explicitInternal = Boolean(
    getFirstValue(input, ['internal', 'isInternal', 'employee', 'isEmployee'])
  );
  const normalizedRole = normalizeText(role);
  const isInternal = explicitInternal
    || normalizedRole === 'internal'
    || normalizedRole === 'employee';

  if (!name && !phoneRaw && !email) {
    return null;
  }

  return {
    name,
    phoneRaw,
    phoneKeys: buildPhoneKeys(phoneRaw),
    email,
    companyName,
    isInternal,
    role,
  };
}

function dedupeParticipants(participants) {
  const seen = new Set();
  const output = [];

  for (const participant of participants) {
    const phoneKey = participant.phoneKeys?.[0] ? 'phone:' + participant.phoneKeys[0] : null;
    const emailKey = participant.email ? 'email:' + participant.email : null;
    const nameKey = participant.name ? 'name:' + normalizeText(participant.name) : null;
    const key = phoneKey || emailKey || nameKey;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({
      name: participant.name || null,
      phoneRaw: participant.phoneRaw || null,
      phoneKeys: participant.phoneKeys || [],
      email: participant.email || null,
      companyName: participant.companyName || null,
      isInternal: Boolean(participant.isInternal),
      role: participant.role || null,
    });
  }

  return output;
}

const participantsRaw = getFirstValue(raw, [
  'participants',
  'contacts',
  'attendees',
  'call.participants',
  'call.contacts',
  'event.participants',
  'event.contacts',
  'data.participants',
  'data.contacts',
  'payload.participants',
]);

const participants = dedupeParticipants(
  toArray(participantsRaw)
    .map((entry) => normalizeParticipant(entry))
    .filter(Boolean)
);

const quoCallId = cleanName(getFirstValue(raw, [
  'quoCallId',
  'callId',
  'eventId',
  'id',
  'call.id',
  'event.id',
  'data.callId',
  'data.eventId',
  'data.id',
]));
const title = cleanName(getFirstValue(raw, [
  'title',
  'callTitle',
  'subject',
  'call.title',
  'event.title',
  'data.title',
  'data.subject',
])) || 'Untitled Quo Call';
const occurredAt = cleanName(getFirstValue(raw, [
  'occurredAt',
  'startedAt',
  'startTime',
  'callTime',
  'timestamp',
  'date',
  'call.occurredAt',
  'call.startedAt',
  'event.occurredAt',
  'event.startedAt',
  'data.occurredAt',
  'data.startedAt',
  'data.timestamp',
]));
const durationSeconds = readDurationSeconds(raw);
const summary = cleanMultiline(getFirstValue(raw, [
  'summary',
  'callSummary',
  'notes',
  'call.summary',
  'event.summary',
  'data.summary',
  'data.callSummary',
]));
const transcript = cleanMultiline(getFirstValue(raw, [
  'transcript',
  'transcriptText',
  'fullTranscript',
  'call.transcript',
  'event.transcript',
  'data.transcript',
  'data.transcriptText',
]));

const missingRequiredFields = [];
if (!quoCallId) {
  missingRequiredFields.push('quoCallId');
}
if (!occurredAt) {
  missingRequiredFields.push('occurredAt');
}
if (!summary && !transcript) {
  missingRequiredFields.push('summaryOrTranscript');
}
if (!participants.length) {
  missingRequiredFields.push('participants');
}

return [{
  json: {
    rawPayload: raw,
    capturedAt: item.capturedAt || new Date().toISOString(),
    quoCallId,
    title,
    occurredAt,
    durationSeconds,
    summary,
    transcript,
    participants,
    excludedParticipants: [],
    shouldProcessCall: missingRequiredFields.length === 0,
    missingRequiredFields,
    activityType: 'Phone Call',
    sourceSystem: 'Quo',
  },
}];`;

const tagParsedCode = String.raw`return [{
  json: {
    recordType: 'parsed',
    data: $input.first().json,
  },
}];`;

const loadExclusionConfigCode = String.raw`return [{
  json: {
    recordType: 'config',
    config: {
      excludedExactNames: ['Mom', 'Dad'],
      excludedExactPhones: [],
    },
  },
}];`;

const filterExcludedParticipantsCode = String.raw`const payload = $input.all().map((item) => item.json);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhoneKey(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

const parsed = payload.find((entry) => entry.recordType === 'parsed')?.data;
if (!parsed) {
  throw new Error('Parsed Quo payload was not found.');
}

const config = payload.find((entry) => entry.recordType === 'config')?.config || {};
const excludedNames = new Set((config.excludedExactNames || []).map((value) => normalizeText(value)).filter(Boolean));
const excludedPhones = new Set((config.excludedExactPhones || []).map((value) => normalizePhoneKey(value)).filter(Boolean));

function isExcluded(participant) {
  const normalizedName = normalizeText(participant.name);
  const phoneKeys = Array.isArray(participant.phoneKeys) ? participant.phoneKeys : [];
  return excludedNames.has(normalizedName)
    || phoneKeys.some((key) => excludedPhones.has(normalizePhoneKey(key)));
}

const excludedParticipants = [];
const participants = [];

for (const participant of parsed.participants || []) {
  if (isExcluded(participant)) {
    excludedParticipants.push({
      name: participant.name || null,
      phoneRaw: participant.phoneRaw || null,
      reason: 'participant matched an exclusion rule',
    });
    continue;
  }

  participants.push(participant);
}

return [{
  json: {
    ...parsed,
    participants,
    excludedParticipants,
    exclusionConfig: config,
  },
}];`;

const tagFilteredCallCode = String.raw`return [{
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

const tagConversationCode = String.raw`return $input.all().map((item) => ({
  json: {
    recordType: 'conversation',
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

function buildPhoneKeys(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return [];
  }
  const keys = new Set([digits]);
  if (digits.length === 11 && digits.startsWith('1')) {
    keys.add(digits.slice(1));
  }
  if (digits.length === 10) {
    keys.add('1' + digits);
  }
  return Array.from(keys);
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

function addUniqueRecord(list, record) {
  if (!record || !record.id) {
    return list;
  }
  if (!list.some((entry) => entry.id === record.id)) {
    list.push(record);
  }
  return list;
}

function getUniqueRecordsFromKeys(map, keys) {
  const output = [];
  for (const key of keys || []) {
    for (const record of map.get(key) || []) {
      addUniqueRecord(output, record);
    }
  }
  return output;
}

function formatDisplay(person) {
  if (!person) {
    return null;
  }
  if (person.name && person.phoneRaw) {
    return person.name + ' (' + person.phoneRaw + ')';
  }
  return person.name || person.phoneRaw || null;
}

function formatList(values) {
  const unique = Array.from(new Set((values || []).filter(Boolean)));
  return unique.length ? unique.join('; ') : 'None';
}

const parsed = payload.find((entry) => entry.recordType === 'parsed')?.data;
if (!parsed) {
  throw new Error('Parsed Quo payload was not found.');
}

const clients = payload.filter((entry) => entry.recordType === 'client').map((entry) => entry.record);
const companies = payload.filter((entry) => entry.recordType === 'company').map((entry) => entry.record);
const employees = payload.filter((entry) => entry.recordType === 'employee').map((entry) => entry.record);
const conversations = payload.filter((entry) => entry.recordType === 'conversation').map((entry) => entry.record);

const clientsByName = new Map();
const clientsByPhone = new Map();
const companiesByName = new Map();
const employeesByName = new Map();
const conversationsByQuoCallId = new Map();

for (const client of clients) {
  pushToMap(clientsByName, normalizeText(client['Client Name']), client);
  for (const phoneField of ['Phone Number', '2nd Phone Number']) {
    for (const phoneKey of buildPhoneKeys(client[phoneField])) {
      pushToMap(clientsByPhone, phoneKey, client);
    }
  }
}

for (const company of companies) {
  pushToMap(companiesByName, normalizeText(company['Company Name']), company);
}

for (const employee of employees) {
  pushToMap(employeesByName, normalizeText(employee['Employee Name']), employee);
}

for (const conversation of conversations) {
  pushToMap(conversationsByQuoCallId, String(conversation['Quo Call ID'] || '').trim(), conversation);
}

const clientIds = new Set();
const employeeIds = new Set();
const matchedClientIds = [];
const matchedEmployeeIds = [];
const matchedClientParticipants = [];
const internalParticipants = [];
const unmatchedExternal = [];
const clientsToCreate = [];
const queuedCreateKeys = new Set();

const conversationMatches = conversationsByQuoCallId.get(String(parsed.quoCallId || '').trim()) || [];
const existingConversationId = conversationMatches[0]?.id || null;
const duplicateConversationIds = conversationMatches.slice(1).map((record) => record.id).filter(Boolean);

function addClientMatch(record, participant, reason) {
  if (!record?.id) {
    return;
  }
  if (!clientIds.has(record.id)) {
    clientIds.add(record.id);
    matchedClientIds.push(record.id);
  }
  matchedClientParticipants.push({
    name: participant.name || record['Client Name'] || null,
    phoneRaw: participant.phoneRaw || null,
    reason,
  });
}

function addEmployeeMatch(record, participant, reason) {
  if (record?.id && !employeeIds.has(record.id)) {
    employeeIds.add(record.id);
    matchedEmployeeIds.push(record.id);
  }
  internalParticipants.push({
    name: participant.name || record?.['Employee Name'] || null,
    phoneRaw: participant.phoneRaw || null,
    reason,
  });
}

for (const participant of parsed.participants || []) {
  const participantName = participant.name || null;
  const participantNameKey = normalizeText(participantName);
  const participantPhoneKeys = Array.isArray(participant.phoneKeys) ? participant.phoneKeys : buildPhoneKeys(participant.phoneRaw);
  const participantEmail = normalizeEmail(participant.email);
  const employeeMatches = participantNameKey ? (employeesByName.get(participantNameKey) || []) : [];

  const explicitInternal = Boolean(participant.isInternal)
    || (participantEmail ? participantEmail.endsWith('@atwell.com') || participantEmail === 'placek.jared.crm@gmail.com' : false);

  if (explicitInternal) {
    if (employeeMatches.length === 1) {
      addEmployeeMatch(employeeMatches[0], participant, 'explicit internal marker');
    } else {
      internalParticipants.push({
        name: participant.name || null,
        phoneRaw: participant.phoneRaw || null,
        reason: 'explicit internal marker without employee link',
      });
    }
    continue;
  }

  if (participantPhoneKeys.length) {
    const phoneMatches = getUniqueRecordsFromKeys(clientsByPhone, participantPhoneKeys);

    if (phoneMatches.length === 1) {
      addClientMatch(phoneMatches[0], participant, 'matched by phone');
      continue;
    }

    if (phoneMatches.length > 1) {
      const tiebreakMatches = participantNameKey
        ? phoneMatches.filter((record) => normalizeText(record['Client Name']) === participantNameKey)
        : [];

      if (tiebreakMatches.length === 1) {
        addClientMatch(tiebreakMatches[0], participant, 'matched by phone plus name tiebreak');
        continue;
      }

      unmatchedExternal.push({
        name: participant.name || null,
        phoneRaw: participant.phoneRaw || null,
        reason: tiebreakMatches.length > 1
          ? 'multiple CRM clients share this phone number and exact name'
          : 'multiple CRM clients share this phone number',
      });
      continue;
    }

    if (employeeMatches.length === 1) {
      addEmployeeMatch(employeeMatches[0], participant, 'matched internal employee by exact name after no client phone match');
      continue;
    }

    const createKey = participantPhoneKeys[0] || participantNameKey;
    if (!createKey || queuedCreateKeys.has(createKey)) {
      continue;
    }
    queuedCreateKeys.add(createKey);

    const companyMatches = participant.companyName
      ? (companiesByName.get(normalizeText(participant.companyName)) || [])
      : [];

    clientsToCreate.push({
      clientName: participant.name || participant.phoneRaw || 'Unknown Quo Participant',
      phoneNumber: participant.phoneRaw || null,
      email: participant.email || null,
      companyId: companyMatches.length === 1 ? companyMatches[0].id : null,
      companyName: companyMatches.length === 1 ? companyMatches[0]['Company Name'] : (participant.companyName || null),
      sourceParticipant: {
        name: participant.name || null,
        phoneRaw: participant.phoneRaw || null,
      },
    });
    matchedClientParticipants.push({
      name: participant.name || participant.phoneRaw || null,
      phoneRaw: participant.phoneRaw || null,
      reason: 'client will be created from Quo phone match miss',
    });
    continue;
  }

  const nameMatches = participantNameKey ? (clientsByName.get(participantNameKey) || []) : [];
  if (nameMatches.length === 1) {
    addClientMatch(nameMatches[0], participant, 'matched by exact name fallback');
    continue;
  }

  if (employeeMatches.length === 1) {
    addEmployeeMatch(employeeMatches[0], participant, 'matched internal employee by exact name fallback');
    continue;
  }

  if (nameMatches.length > 1) {
    unmatchedExternal.push({
      name: participant.name || null,
      phoneRaw: participant.phoneRaw || null,
      reason: 'multiple CRM clients share this exact name',
    });
    continue;
  }

  unmatchedExternal.push({
    name: participant.name || null,
    phoneRaw: participant.phoneRaw || null,
    reason: 'participant had no phone and no exact CRM name match',
  });
}

const conversationSummaryLines = [
  'Call title: ' + (parsed.title || 'Untitled Quo Call'),
  'Source: Quo',
  'Quo Call ID: ' + (parsed.quoCallId || 'Unknown'),
  'Date: ' + (parsed.occurredAt || 'Unknown'),
  parsed.durationSeconds != null ? 'Duration (seconds): ' + parsed.durationSeconds : null,
  'Matched clients: ' + formatList(matchedClientParticipants.map(formatDisplay)),
  'Internal attendance: ' + formatList(internalParticipants.map(formatDisplay)),
  'Excluded participants: ' + formatList((parsed.excludedParticipants || []).map(formatDisplay)),
  'Unmatched external participants: ' + formatList(unmatchedExternal.map(formatDisplay)),
  '',
  'Summary:',
  parsed.summary || '(none provided)',
  '',
  'Transcript:',
  parsed.transcript || '(none provided)',
].filter((line) => line !== null);

return [{
  json: {
    ...parsed,
    matchedClientIds,
    matchedEmployeeIds,
    matchedClientParticipants,
    internalParticipants,
    clientsToCreate,
    unmatchedExternal,
    existingConversationId,
    duplicateConversationIds,
    conversationSummary: conversationSummaryLines.join('\n'),
  },
}];`;

const emitClientsToCreateCode = String.raw`const plan = $input.first().json;

return (plan.clientsToCreate || []).map((client) => ({
  json: {
    plan,
    clientName: client.clientName,
    phoneNumber: client.phoneNumber || null,
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

const skipInvalidPayloadCode = String.raw`const item = $input.first().json;

return [{
  json: {
    status: 'skipped',
    reason: 'Incoming Quo payload was missing required fields.',
    quoCallId: item.quoCallId || null,
    missingRequiredFields: item.missingRequiredFields || [],
  },
}];`;

const skipAllExcludedCode = String.raw`const item = $input.first().json;

return [{
  json: {
    status: 'skipped',
    reason: 'All participants were excluded before CRM matching.',
    quoCallId: item.quoCallId || null,
    excludedParticipants: item.excludedParticipants || [],
  },
}];`;

const skipNoLinkedClientsCode = String.raw`const item = $input.first().json;

return [{
  json: {
    status: 'skipped',
    reason: 'No CRM clients could be matched or created from the Quo call.',
    quoCallId: item.quoCallId || null,
    unmatchedExternal: item.unmatchedExternal || [],
    excludedParticipants: item.excludedParticipants || [],
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

function codeNode(id, name, jsCode, position) {
  return {
    parameters: {
      jsCode,
    },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function ifNode(id, name, leftValue, operation, rightValue, position) {
  return {
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
            id: id + '-condition',
            leftValue,
            rightValue,
            operator: {
              type: 'string',
              operation,
              ...(operation === 'notEmpty' || operation === 'exists' ? { singleValue: true } : {}),
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
  };
}

function mergeNode(id, name, position) {
  return {
    parameters: {
      mode: 'append',
    },
    id,
    name,
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position,
  };
}

function airtableSearchNode(id, name, tableId, tableName, tableUrl, position) {
  return {
    parameters: {
      authentication: 'airtableOAuth2Api',
      operation: 'search',
      base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
      table: airtableRef(tableId, tableName, tableUrl),
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position,
  };
}

function airtableCreateNode(id, name, tableId, tableName, tableUrl, columnsValue, schema, position) {
  return {
    parameters: {
      authentication: 'airtableOAuth2Api',
      operation: 'create',
      base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
      table: airtableRef(tableId, tableName, tableUrl),
      columns: {
        mappingMode: 'defineBelow',
        value: columnsValue,
        matchingColumns: [],
        schema,
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {
        typecast: true,
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position,
  };
}

function airtableUpdateNode(id, name, tableId, tableName, tableUrl, recordId, columnsValue, schema, position) {
  return {
    parameters: {
      authentication: 'airtableOAuth2Api',
      operation: 'update',
      base: airtableRef('appxCuCg2znbMJx2v', "Jared's CRM", 'https://airtable.com/appxCuCg2znbMJx2v'),
      table: airtableRef(tableId, tableName, tableUrl),
      id: recordId,
      columns: {
        mappingMode: 'defineBelow',
        value: columnsValue,
        matchingColumns: [],
        schema,
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {
        typecast: true,
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position,
  };
}

const clientCreateSchema = [
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
    id: 'Phone Number',
    displayName: 'Phone Number',
    required: false,
    defaultMatch: false,
    canBeUsedToMatch: true,
    display: true,
    type: 'string',
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
];

const conversationSchema = [
  {
    id: 'Quo Call ID',
    displayName: 'Quo Call ID',
    required: false,
    defaultMatch: false,
    canBeUsedToMatch: true,
    display: true,
    type: 'string',
    readOnly: false,
    removed: false,
  },
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
];

const workflow = {
  name: 'Quo Call to Airtable Conversations',
  nodes: [
    {
      parameters: {},
      id: 'manual-trigger',
      name: 'When clicking Execute workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [160, 220],
    },
    codeNode('load-sample', 'Load Sample Quo Payload', loadSampleCode, [400, 220]),
    {
      parameters: {
        httpMethod: 'POST',
        path: 'quo-call-to-airtable',
        responseMode: 'lastNode',
        options: {},
      },
      id: 'quo-webhook',
      name: 'Quo Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [160, 420],
      webhookId: 'quo-call-to-airtable',
    },
    codeNode('capture-raw', 'Capture Raw Quo Payload', captureRawPayloadCode, [640, 320]),
    codeNode('normalize-payload', 'Normalize Quo Payload', normalizeQuoPayloadCode, [880, 320]),
    ifNode('if-valid-call', 'If Is Valid Quo Call', '={{ String($json.shouldProcessCall) }}', 'equals', 'true', [1120, 320]),
    codeNode('skip-invalid', 'Skip Invalid Quo Payload', skipInvalidPayloadCode, [1360, 500]),
    codeNode('tag-normalized', 'Tag Normalized Call', tagParsedCode, [1360, 160]),
    codeNode('load-exclusion-config', 'Load Exclusion Config', loadExclusionConfigCode, [1360, 280]),
    mergeNode('merge-normalized-and-config', 'Merge Normalized and Config', [1600, 220]),
    codeNode('filter-excluded', 'Filter Excluded Participants', filterExcludedParticipantsCode, [1840, 220]),
    ifNode('if-has-active-participants', 'If Has Active Participants', '={{ $json.participants[0]?.name || $json.participants[0]?.phoneRaw || $json.participants[0]?.email || "" }}', 'notEmpty', '', [2080, 220]),
    codeNode('skip-all-excluded', 'Skip All Participants Excluded', skipAllExcludedCode, [2320, 400]),
    codeNode('tag-filtered', 'Tag Filtered Call', tagFilteredCallCode, [2320, 60]),
    airtableSearchNode('get-clients', 'Get Client Records', 'tblpwZCI6iGrESUDI', 'Clients', 'https://airtable.com/appxCuCg2znbMJx2v/tblpwZCI6iGrESUDI', [2320, 160]),
    codeNode('tag-clients', 'Tag Client Records', tagClientCode, [2560, 160]),
    airtableSearchNode('get-companies', 'Get Company Records', 'tblHPdSrAS7VV8utO', 'Companies', 'https://airtable.com/appxCuCg2znbMJx2v/tblHPdSrAS7VV8utO', [2320, 260]),
    codeNode('tag-companies', 'Tag Company Records', tagCompanyCode, [2560, 260]),
    airtableSearchNode('get-employees', 'Get Employee Records', 'tblAFg2j2lRJXv0V8', 'Manhard Employees', 'https://airtable.com/appxCuCg2znbMJx2v/tblAFg2j2lRJXv0V8', [2320, 360]),
    codeNode('tag-employees', 'Tag Employee Records', tagEmployeeCode, [2560, 360]),
    airtableSearchNode('get-conversations', 'Get Existing Conversation Records', 'tblhj8ZhO5XRFABom', 'Conversations', 'https://airtable.com/appxCuCg2znbMJx2v/tblhj8ZhO5XRFABom', [2320, 460]),
    codeNode('tag-conversations', 'Tag Conversation Records', tagConversationCode, [2560, 460]),
    mergeNode('merge-filtered-and-clients', 'Merge Filtered and Clients', [2800, 140]),
    mergeNode('merge-companies', 'Merge Companies', [3040, 200]),
    mergeNode('merge-employees', 'Merge Employees', [3280, 260]),
    mergeNode('merge-conversations', 'Merge Conversations', [3520, 320]),
    codeNode('match-crm', 'Match CRM Records', matchRecordsCode, [3760, 320]),
    ifNode('if-needs-new-clients', 'If Needs New Clients', '={{ $json.clientsToCreate[0]?.clientName || "" }}', 'notEmpty', '', [4000, 320]),
    codeNode('emit-clients-to-create', 'Emit Clients To Create', emitClientsToCreateCode, [4240, 220]),
    airtableCreateNode('create-missing-clients', 'Create Missing Clients', 'tblpwZCI6iGrESUDI', 'Clients', 'https://airtable.com/appxCuCg2znbMJx2v/tblpwZCI6iGrESUDI', {
      'Client Name': '={{ $json.clientName }}',
      Company: '={{ $json.companyIds }}',
      'Phone Number': '={{ $json.phoneNumber }}',
      Email: '={{ $json.email }}',
    }, clientCreateSchema, [4480, 220]),
    codeNode('finalize-with-new-clients', 'Finalize With New Clients', finalizeWithNewClientsCode, [4720, 220]),
    codeNode('finalize-existing-clients', 'Finalize Existing Clients', finalizeExistingClientsCode, [4240, 420]),
    ifNode('if-has-linked-clients', 'If Has Linked Clients', '={{ $json.allClientIds[0] || "" }}', 'notEmpty', '', [4960, 320]),
    codeNode('skip-no-linked-clients', 'Skip When No Clients Could Link', skipNoLinkedClientsCode, [5200, 500]),
    ifNode('if-existing-conversation', 'If Existing Conversation', '={{ $json.existingConversationId || "" }}', 'notEmpty', '', [5200, 220]),
    airtableUpdateNode('update-conversation', 'Update Conversation Record', 'tblhj8ZhO5XRFABom', 'Conversations', 'https://airtable.com/appxCuCg2znbMJx2v/tblhj8ZhO5XRFABom', '={{ $json.existingConversationId }}', {
      'Quo Call ID': '={{ $json.quoCallId }}',
      Date: '={{ $json.occurredAt }}',
      'Duration (minutes)': '={{ $json.durationSeconds }}',
      Client: '={{ $json.allClientIds }}',
      'Conversation Summary': '={{ $json.conversationSummary }}',
      'Activity Type': '={{ $json.activityType }}',
      'Internal Attendance': '={{ $json.matchedEmployeeIds }}',
    }, conversationSchema, [5440, 140]),
    airtableCreateNode('create-conversation', 'Create Conversation Record', 'tblhj8ZhO5XRFABom', 'Conversations', 'https://airtable.com/appxCuCg2znbMJx2v/tblhj8ZhO5XRFABom', {
      'Quo Call ID': '={{ $json.quoCallId }}',
      Date: '={{ $json.occurredAt }}',
      'Duration (minutes)': '={{ $json.durationSeconds }}',
      Client: '={{ $json.allClientIds }}',
      'Conversation Summary': '={{ $json.conversationSummary }}',
      'Activity Type': '={{ $json.activityType }}',
      'Internal Attendance': '={{ $json.matchedEmployeeIds }}',
    }, conversationSchema, [5440, 300]),
  ],
  connections: {
    'When clicking Execute workflow': { main: [[{ node: 'Load Sample Quo Payload', type: 'main', index: 0 }]] },
    'Load Sample Quo Payload': { main: [[{ node: 'Capture Raw Quo Payload', type: 'main', index: 0 }]] },
    'Quo Webhook': { main: [[{ node: 'Capture Raw Quo Payload', type: 'main', index: 0 }]] },
    'Capture Raw Quo Payload': { main: [[{ node: 'Normalize Quo Payload', type: 'main', index: 0 }]] },
    'Normalize Quo Payload': { main: [[{ node: 'If Is Valid Quo Call', type: 'main', index: 0 }]] },
    'If Is Valid Quo Call': {
      main: [
        [
          { node: 'Tag Normalized Call', type: 'main', index: 0 },
          { node: 'Load Exclusion Config', type: 'main', index: 0 },
        ],
        [{ node: 'Skip Invalid Quo Payload', type: 'main', index: 0 }],
      ],
    },
    'Tag Normalized Call': { main: [[{ node: 'Merge Normalized and Config', type: 'main', index: 0 }]] },
    'Load Exclusion Config': { main: [[{ node: 'Merge Normalized and Config', type: 'main', index: 1 }]] },
    'Merge Normalized and Config': { main: [[{ node: 'Filter Excluded Participants', type: 'main', index: 0 }]] },
    'Filter Excluded Participants': { main: [[{ node: 'If Has Active Participants', type: 'main', index: 0 }]] },
    'If Has Active Participants': {
      main: [
        [
          { node: 'Tag Filtered Call', type: 'main', index: 0 },
          { node: 'Get Client Records', type: 'main', index: 0 },
          { node: 'Get Company Records', type: 'main', index: 0 },
          { node: 'Get Employee Records', type: 'main', index: 0 },
          { node: 'Get Existing Conversation Records', type: 'main', index: 0 },
        ],
        [{ node: 'Skip All Participants Excluded', type: 'main', index: 0 }],
      ],
    },
    'Tag Filtered Call': { main: [[{ node: 'Merge Filtered and Clients', type: 'main', index: 0 }]] },
    'Get Client Records': { main: [[{ node: 'Tag Client Records', type: 'main', index: 0 }]] },
    'Tag Client Records': { main: [[{ node: 'Merge Filtered and Clients', type: 'main', index: 1 }]] },
    'Merge Filtered and Clients': { main: [[{ node: 'Merge Companies', type: 'main', index: 0 }]] },
    'Get Company Records': { main: [[{ node: 'Tag Company Records', type: 'main', index: 0 }]] },
    'Tag Company Records': { main: [[{ node: 'Merge Companies', type: 'main', index: 1 }]] },
    'Merge Companies': { main: [[{ node: 'Merge Employees', type: 'main', index: 0 }]] },
    'Get Employee Records': { main: [[{ node: 'Tag Employee Records', type: 'main', index: 0 }]] },
    'Tag Employee Records': { main: [[{ node: 'Merge Employees', type: 'main', index: 1 }]] },
    'Merge Employees': { main: [[{ node: 'Merge Conversations', type: 'main', index: 0 }]] },
    'Get Existing Conversation Records': { main: [[{ node: 'Tag Conversation Records', type: 'main', index: 0 }]] },
    'Tag Conversation Records': { main: [[{ node: 'Merge Conversations', type: 'main', index: 1 }]] },
    'Merge Conversations': { main: [[{ node: 'Match CRM Records', type: 'main', index: 0 }]] },
    'Match CRM Records': { main: [[{ node: 'If Needs New Clients', type: 'main', index: 0 }]] },
    'If Needs New Clients': {
      main: [
        [{ node: 'Emit Clients To Create', type: 'main', index: 0 }],
        [{ node: 'Finalize Existing Clients', type: 'main', index: 0 }],
      ],
    },
    'Emit Clients To Create': { main: [[{ node: 'Create Missing Clients', type: 'main', index: 0 }]] },
    'Create Missing Clients': { main: [[{ node: 'Finalize With New Clients', type: 'main', index: 0 }]] },
    'Finalize With New Clients': { main: [[{ node: 'If Has Linked Clients', type: 'main', index: 0 }]] },
    'Finalize Existing Clients': { main: [[{ node: 'If Has Linked Clients', type: 'main', index: 0 }]] },
    'If Has Linked Clients': {
      main: [
        [{ node: 'If Existing Conversation', type: 'main', index: 0 }],
        [{ node: 'Skip When No Clients Could Link', type: 'main', index: 0 }],
      ],
    },
    'If Existing Conversation': {
      main: [
        [{ node: 'Update Conversation Record', type: 'main', index: 0 }],
        [{ node: 'Create Conversation Record', type: 'main', index: 0 }],
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

const outlineMarkdown = `# Quo Call to Airtable Conversations

## Purpose
This workflow receives Quo call data by webhook, normalizes the payload into one stable call object, filters excluded contacts, matches participants to Airtable CRM clients primarily by phone number, creates missing clients when a phone match does not exist, and then creates or updates one Airtable conversation record keyed by \`Quo Call ID\`.

It is designed to:
- accept either a real Quo webhook payload or the built-in manual sample payload
- preserve the raw payload for the first production payload-inspection run
- exclude configured contacts before any CRM matching
- match against both \`Phone Number\` and \`2nd Phone Number\`
- normalize \`+1XXXXXXXXXX\` and \`XXXXXXXXXX\` into compatible comparison keys
- use exact normalized client name only as a phone-match tiebreaker or no-phone fallback
- create missing clients when a phone number is present but no CRM phone match exists
- upsert the Airtable \`Conversations\` record using \`Quo Call ID\`

## Airtable Tables Used
- \`Clients\` (\`tblpwZCI6iGrESUDI\`)
- \`Companies\` (\`tblHPdSrAS7VV8utO\`)
- \`Conversations\` (\`tblhj8ZhO5XRFABom\`)
- \`Manhard Employees\` (\`tblAFg2j2lRJXv0V8\`)

## Airtable Fields Written
### Clients
- \`Client Name\`
- \`Company\` when there is one confident exact company match
- \`Phone Number\`
- \`Email\` when Quo provides it

### Conversations
- \`Quo Call ID\`
- \`Date\`
- \`Duration (minutes)\`
- \`Client\`
- \`Conversation Summary\`
- \`Activity Type\`
- \`Internal Attendance\`

## Entry Points
### 1. \`Quo Webhook\`
Production entry point.

Quo should POST the call payload to this webhook.

### 2. \`When clicking Execute workflow\`
Manual test entry point.

This runs the workflow with the built-in sample Quo payload.

## Step-by-Step Flow
### 1. Capture and preserve the raw Quo payload
Node: \`Capture Raw Quo Payload\`

This stores the incoming payload under \`rawPayload\` so the first real production webhook can be inspected later in n8n execution history.

### 2. Normalize the Quo payload
Node: \`Normalize Quo Payload\`

This node extracts a flexible set of likely Quo fields into one canonical object:
- \`quoCallId\`
- \`title\`
- \`occurredAt\`
- \`durationSeconds\`
- \`summary\`
- \`transcript\`
- \`participants\`

Each participant is normalized to:
- \`name\`
- \`phoneRaw\`
- \`phoneKeys\`
- \`email\`
- \`companyName\`
- \`isInternal\`

### 3. Validate the normalized call
Nodes:
- \`If Is Valid Quo Call\`
- \`Skip Invalid Quo Payload\`

The workflow requires:
- a stable \`quoCallId\`
- an \`occurredAt\` timestamp
- at least one of \`summary\` or \`transcript\`
- at least one participant

If any of these are missing, the workflow skips Airtable writes and returns a structured status payload.

### 4. Load and apply exclusions
Nodes:
- \`Load Exclusion Config\`
- \`Filter Excluded Participants\`

Current default exclusions are:
- \`Mom\`
- \`Dad\`

The filter checks:
- exact normalized name
- exact normalized phone key

Excluded contacts are recorded in \`excludedParticipants\`.

### 5. Skip fully excluded calls
Nodes:
- \`If Has Active Participants\`
- \`Skip All Participants Excluded\`

If every participant was excluded, the workflow stops before Airtable matching.

### 6. Load Airtable records for matching and upsert detection
Nodes:
- \`Get Client Records\`
- \`Get Company Records\`
- \`Get Employee Records\`
- \`Get Existing Conversation Records\`

These are tagged and merged into one stream for the matching step.

### 7. Match CRM records
Node: \`Match CRM Records\`

Matching rules:

For external client matching:
- match by normalized phone keys against both \`Phone Number\` and \`2nd Phone Number\`
- if multiple clients share the phone number, use exact normalized \`Client Name\` as a tiebreaker
- if no phone match exists and the participant has a phone number, queue a new client for creation
- if the participant has no phone, fall back to exact normalized name match
- if no-phone exact name matching is ambiguous or missing, do not auto-create the client

For internal attendance:
- explicit internal markers are honored immediately
- if no client phone match exists and the exact participant name matches one \`Manhard Employees\` record, the participant is treated as internal

The node outputs:
- \`matchedClientIds\`
- \`matchedEmployeeIds\`
- \`clientsToCreate\`
- \`unmatchedExternal\`
- \`existingConversationId\`
- \`conversationSummary\`

### 8. Create missing clients
Nodes:
- \`If Needs New Clients\`
- \`Emit Clients To Create\`
- \`Create Missing Clients\`
- \`Finalize With New Clients\`
- \`Finalize Existing Clients\`

Any participant with a phone number and no Airtable phone match is turned into a new \`Clients\` record.

### 9. Guard against empty client links
Nodes:
- \`If Has Linked Clients\`
- \`Skip When No Clients Could Link\`

If there are no matched or created client IDs after the matching phase, the workflow returns a skip status instead of creating a CRM conversation.

### 10. Upsert the conversation record
Nodes:
- \`If Existing Conversation\`
- \`Update Conversation Record\`
- \`Create Conversation Record\`

The workflow looks up existing \`Conversations\` rows by \`Quo Call ID\`.

If a match exists:
- update the existing conversation

If no match exists:
- create a new conversation

## Conversation Summary Format
The \`Conversation Summary\` field stores:
- call title
- source
- Quo call ID
- date
- duration
- matched clients
- internal attendance
- excluded participants
- unmatched external participants
- summary
- transcript

## Current Limitations
- The exact production Quo field paths are still assumption-based until the first real webhook payload is reviewed in n8n execution data.
- Company linking is only used when Quo provides a company name and Airtable has one exact match.
- No fuzzy name matching is used.
- Duplicate Airtable \`Quo Call ID\` values are not resolved automatically beyond updating the first matching conversation record.

## Files
- Workflow export: [quo-call-to-airtable.workflow.json](c:\\Users\\gcaruso\\Misc Workspace\\output\\quo-call-to-airtable.workflow.json)
- Generator script: [generate-quo-call-workflow.js](c:\\Users\\gcaruso\\Misc Workspace\\scripts\\generate-quo-call-workflow.js)
`;

function runCodeNode(jsCode, inputItems, extraContext = {}) {
  const $input = {
    first: () => inputItems[0],
    all: () => inputItems,
  };
  const $items = extraContext.$items || (() => []);
  const fn = new Function('$input', '$items', jsCode);
  return fn($input, $items);
}

const normalizeResult = runCodeNode(normalizeQuoPayloadCode, [{ json: { rawPayload: sampleQuoPayload } }]);
assert.equal(normalizeResult[0].json.shouldProcessCall, true, 'Sample Quo payload should pass normalization validation');
assert.equal(normalizeResult[0].json.quoCallId, 'quo-call-123', 'Sample Quo payload should extract the stable call ID');
assert.deepEqual(
  normalizeResult[0].json.participants.find((participant) => participant.name === 'Jane Smith').phoneKeys.sort(),
  ['13125551212', '3125551212'].sort(),
  'Sample Quo payload should normalize phone numbers into both with-country and without-country keys'
);

const invalidNormalizeResult = runCodeNode(normalizeQuoPayloadCode, [{ json: { rawPayload: invalidSampleQuoPayload } }]);
assert.equal(invalidNormalizeResult[0].json.shouldProcessCall, false, 'Invalid Quo sample should fail normalization validation');
assert.ok(
  invalidNormalizeResult[0].json.missingRequiredFields.includes('quoCallId'),
  'Invalid Quo sample should report missing quoCallId'
);

const filteredResult = runCodeNode(filterExcludedParticipantsCode, [
  { json: { recordType: 'parsed', data: normalizeResult[0].json } },
  { json: { recordType: 'config', config: { excludedExactNames: ['Mom', 'Dad'], excludedExactPhones: [] } } },
]);
assert.equal(filteredResult[0].json.excludedParticipants.length, 1, 'Exclusion config should remove Mom from the participant list');
assert.equal(filteredResult[0].json.participants.length, 3, 'Exclusion config should leave three active participants in the sample call');

const matchedResult = runCodeNode(matchRecordsCode, [
  {
    json: {
      recordType: 'parsed',
      data: filteredResult[0].json,
    },
  },
  {
    json: {
      recordType: 'client',
      record: {
        id: 'recJaneClient',
        'Client Name': 'Jane Smith',
        'Phone Number': null,
        '2nd Phone Number': '312-555-1212',
      },
    },
  },
  {
    json: {
      recordType: 'employee',
      record: {
        id: 'recEmployee1',
        'Employee Name': 'Gianluca Caruso',
      },
    },
  },
  {
    json: {
      recordType: 'conversation',
      record: {
        id: 'recConversation1',
        'Quo Call ID': 'quo-call-123',
      },
    },
  },
]);
assert.deepEqual(
  matchedResult[0].json.matchedClientIds,
  ['recJaneClient'],
  'Match logic should find the existing client by secondary phone number'
);
assert.deepEqual(
  matchedResult[0].json.matchedEmployeeIds,
  ['recEmployee1'],
  'Match logic should link the explicit internal participant to Manhard Employees'
);
assert.equal(
  matchedResult[0].json.clientsToCreate.length,
  1,
  'Match logic should queue one new client when a participant phone number is not found in Airtable'
);
assert.equal(
  matchedResult[0].json.existingConversationId,
  'recConversation1',
  'Match logic should detect an existing conversation by Quo Call ID'
);

const duplicatePhoneTiebreakResult = runCodeNode(matchRecordsCode, [
  {
    json: {
      recordType: 'parsed',
      data: {
        quoCallId: 'quo-call-tiebreak',
        title: 'Tiebreak Test',
        occurredAt: '2026-03-26T15:00:00.000Z',
        durationSeconds: 300,
        summary: 'Tiebreak summary',
        transcript: 'Tiebreak transcript',
        excludedParticipants: [],
        activityType: 'Phone Call',
        participants: [
          {
            name: 'Alex One',
            phoneRaw: '+1 (312) 555-9999',
            phoneKeys: ['13125559999', '3125559999'],
            email: null,
            companyName: null,
            isInternal: false,
            role: null,
          },
        ],
      },
    },
  },
  {
    json: {
      recordType: 'client',
      record: {
        id: 'recAlex1',
        'Client Name': 'Alex One',
        'Phone Number': '3125559999',
        '2nd Phone Number': null,
      },
    },
  },
  {
    json: {
      recordType: 'client',
      record: {
        id: 'recAlex2',
        'Client Name': 'Alex Two',
        'Phone Number': '13125559999',
        '2nd Phone Number': null,
      },
    },
  },
]);
assert.deepEqual(
  duplicatePhoneTiebreakResult[0].json.matchedClientIds,
  ['recAlex1'],
  'Phone duplicates should resolve via exact normalized client name tiebreak'
);

const finalizeResult = runCodeNode(
  finalizeWithNewClientsCode,
  [
    {
      json: {
        id: 'recCreatedClient1',
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
  ['recExistingClient1', 'recCreatedClient1'],
  'Finalize With New Clients should merge existing and newly created client IDs'
);

const workflowOutputPath = path.join(__dirname, '..', '..', 'output', 'quo-call-to-airtable.workflow.json');
fs.writeFileSync(workflowOutputPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');

const outlineOutputPath = path.join(__dirname, '..', '..', 'output', 'quo-call-to-airtable-outline.md');
fs.writeFileSync(outlineOutputPath, outlineMarkdown, 'utf8');

console.log(workflowOutputPath);
console.log(outlineOutputPath);

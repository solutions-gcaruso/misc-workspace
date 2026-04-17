const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require('docx');

const { AirtableClient } = require('../lib/airtable-client');

const DEFAULT_MODEL = 'gpt-5.4-nano';
const DEFAULT_SAMPLE_OUTPUT_PATH = path.resolve(process.cwd(), 'output', 'icsc-golf-fundraiser-personalization-sample.md');
const DEFAULT_BATCH_JSON_PATH = path.resolve(process.cwd(), 'output', 'icsc-golf-fundraiser-personalizations.json');
const DEFAULT_BATCH_DOCX_PATH = path.resolve(process.cwd(), 'output', 'icsc-golf-fundraiser-personalizations.docx');
const DEFAULT_BATCH_MARKDOWN_PATH = path.resolve(process.cwd(), 'output', 'icsc-golf-fundraiser-personalizations.md');
const CLIENT_TABLE = process.env.AIRTABLE_TABLE_NAME || 'Clients';
const EVENT_LOCATION = 'Glen Ellyn';
const MATCH_FIELDS = [
  'Client Name',
  'Email',
  'Phone Number',
  '2nd Phone Number',
  'Events',
  'Associations',
  'Job Title',
  'Company Name Text',
  'Personal Summary (AI Generated)',
  'Medium Summary (AI Generated)',
  'Long-Form Summary (AI Generated)',
  'Personal Notes (Handwritten)',
  'Professional/Business Notes (Handwritten)'
];
const SENSITIVE_SUMMARY_PATTERNS = [
  /\bspouse\b/i,
  /\bwife\b/i,
  /\bhusband\b/i,
  /\bmarried\b/i,
  /\bwedding\b/i,
  /\bhoneymoon\b/i,
  /\bchildren?\b/i,
  /\bkids?\b/i,
  /\bfamily\b/i,
  /\bethnic/i,
  /\brace\b/i,
  /\btrying for children\b/i,
  /\bfiance/i,
  /\bhindu\b/i,
  /\bindian\b/i,
  /\bvietnamese\b/i,
  /\bnigerian\b/i
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    mode: 'sample',
    model: DEFAULT_MODEL,
    outputPath: DEFAULT_SAMPLE_OUTPUT_PATH,
    markdownPath: DEFAULT_BATCH_MARKDOWN_PATH,
    jsonPath: DEFAULT_BATCH_JSON_PATH,
    targetName: '',
    sampleIndex: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--all') {
      options.mode = 'all';
      options.outputPath = DEFAULT_BATCH_DOCX_PATH;
      continue;
    }

    if (arg === '--name') {
      options.targetName = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }

    if (arg === '--output') {
      options.outputPath = path.resolve(process.cwd(), String(argv[index + 1] || ''));
      index += 1;
      continue;
    }

    if (arg === '--markdown') {
      options.markdownPath = path.resolve(process.cwd(), String(argv[index + 1] || ''));
      index += 1;
      continue;
    }

    if (arg === '--json') {
      options.jsonPath = path.resolve(process.cwd(), String(argv[index + 1] || ''));
      index += 1;
      continue;
    }

    if (arg === '--model') {
      options.model = String(argv[index + 1] || '').trim() || DEFAULT_MODEL;
      index += 1;
      continue;
    }

    if (arg === '--sample-index') {
      options.sampleIndex = Number.parseInt(argv[index + 1], 10) || 0;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log('Usage: node scripts/generate-icsc-golf-personalizations.js [--all] [--name <client-name>] [--output <path>] [--markdown <path>] [--json <path>] [--model <model>] [--sample-index <n>]');
  console.log('Defaults:');
  console.log(`  sample output: ${DEFAULT_SAMPLE_OUTPUT_PATH}`);
  console.log(`  all output docx: ${DEFAULT_BATCH_DOCX_PATH}`);
  console.log(`  all output markdown: ${DEFAULT_BATCH_MARKDOWN_PATH}`);
  console.log(`  all output json: ${DEFAULT_BATCH_JSON_PATH}`);
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractFieldValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeWhitespace(value.value || '');
  }

  return normalizeWhitespace(value);
}

function listToText(values) {
  const items = Array.isArray(values)
    ? values.map(item => normalizeWhitespace(item)).filter(Boolean)
    : [];

  return items.join('; ');
}

function sanitizeSummary(summary) {
  const clean = normalizeWhitespace(summary);
  if (!clean) {
    return '';
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map(sentence => normalizeWhitespace(sentence))
    .filter(Boolean)
    .filter(sentence => !SENSITIVE_SUMMARY_PATTERNS.some(pattern => pattern.test(sentence)));

  return sentences.join(' ');
}

function mapClientRecord(record) {
  return {
    id: record.id,
    name: normalizeWhitespace(record.fields['Client Name']),
    email: normalizeWhitespace(record.fields.Email),
    phone: normalizeWhitespace(record.fields['Phone Number']) || normalizeWhitespace(record.fields['2nd Phone Number']),
    events: Array.isArray(record.fields.Events) ? record.fields.Events.map(value => normalizeWhitespace(value)).filter(Boolean) : [],
    associations: Array.isArray(record.fields.Associations) ? record.fields.Associations.map(value => normalizeWhitespace(value)).filter(Boolean) : [],
    jobTitle: normalizeWhitespace(record.fields['Job Title']),
    company: listToText(record.fields['Company Name Text']),
    personalSummary: sanitizeSummary(extractFieldValue(record.fields['Personal Summary (AI Generated)'])),
    mediumSummary: sanitizeSummary(extractFieldValue(record.fields['Medium Summary (AI Generated)'])),
    longSummary: sanitizeSummary(extractFieldValue(record.fields['Long-Form Summary (AI Generated)'])),
    personalNotes: normalizeWhitespace(record.fields['Personal Notes (Handwritten)']),
    professionalNotes: normalizeWhitespace(record.fields['Professional/Business Notes (Handwritten)'])
  };
}

function matchesGolfCriteria(client) {
  const haystack = [...client.events, ...client.associations].join(' ').toLowerCase();

  return haystack.includes('icsc - golf 2025')
    || haystack.includes('potential icsc golf sponsor')
    || haystack.includes('previous icsc golf sponsor');
}

function scoreClient(client) {
  return [
    client.personalSummary.length,
    client.mediumSummary.length,
    client.longSummary.length,
    client.personalNotes.length,
    client.professionalNotes.length,
    client.email ? 25 : 0,
    client.phone ? 10 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function sortClients(clients) {
  return [...clients]
    .sort((left, right) => {
      const scoreDelta = scoreClient(right) - scoreClient(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.name.localeCompare(right.name);
    });
}

function selectClient(clients, { targetName, sampleIndex }) {
  const filtered = sortClients(clients);

  if (targetName) {
    const target = targetName.toLowerCase();
    const exact = filtered.find(client => client.name.toLowerCase() === target);
    if (exact) {
      return exact;
    }

    const partial = filtered.find(client => client.name.toLowerCase().includes(target));
    if (partial) {
      return partial;
    }

    throw new Error(`No matching client found for --name "${targetName}"`);
  }

  return filtered[sampleIndex] || filtered[0] || null;
}

function buildPrompt({ styleExamples, client }) {
  const examplesBlock = normalizeWhitespace(styleExamples)
    .replace(/# 2025 Sponsorship Emails/i, '')
    .trim();

  return [
    'You are writing one short personalization line for a golf fundraiser invite email.',
    '',
    'Primary goal:',
    'Write a single P.S.-style line inspired by the rhythm, warmth, and specificity of the example notes below.',
    '',
    'Event context:',
    `- The fundraiser golf event is in ${EVENT_LOCATION}, Illinois.`,
    '- If you mention location, use Glen Ellyn or Chicagoland.',
    '- The examples below reference Vegas, but that is style inspiration only and not a factual location for this event.',
    '- Do not mention Vegas or Las Vegas anywhere in the final line.',
    '- Do not mention unrelated event names such as Eisonopoly in the final line.',
    '',
    'Style rules:',
    '- Start with "P.S."',
    '- Write 1 to 2 sentences.',
    '- Sound like a real relationship-based note, not a polished marketing line.',
    '- Follow the cadence of the examples: conversational, warm, lightly informal, often referencing a catch-up, upcoming event, or something specific about the person.',
    '- It is good to use turns of phrase like "As an aside," "hopefully will see you," or "looking forward to connecting again soon" when they fit naturally.',
    '- Use the Personal Summary plus both work-summary AI fields to make it more personal and professionally specific.',
    '- Prefer pulling at least one concrete work detail from the work-summary fields when they contain a real project, responsibility, market, or event.',
    '- Use no more than one specific work-detail thread in the final line so it stays breezy and natural.',
    '- Prefer safe personal details like golf interest, alumni, city/region, or harmless travel/event context.',
    '- Do not use sensitive personal details such as spouse, children, wedding, ethnicity, religion, or medical/private matters.',
    '- Do not invent any meeting, conversation, or shared history that is not in the CRM.',
    '- Do not say "I remember," "as we discussed," or anything else that implies a specific prior conversation unless the CRM clearly says it happened.',
    '- Do not turn the line into the actual ask for money or sponsorship.',
    '- Avoid em dashes.',
    '',
    'Example style notes:',
    examplesBlock,
    '',
    'Client CRM details:',
    `Name: ${client.name || 'Unknown'}`,
    `Job Title: ${client.jobTitle || 'Unknown'}`,
    `Company: ${client.company || 'Unknown'}`,
    `Events: ${client.events.join('; ') || 'None listed'}`,
    `Associations: ${client.associations.join('; ') || 'None listed'}`,
    `Personal Summary (AI Generated): ${client.personalSummary || 'None listed'}`,
    `Work Summary 1 - Medium Summary (AI Generated): ${client.mediumSummary || 'None listed'}`,
    `Work Summary 2 - Long-Form Summary (AI Generated): ${client.longSummary || 'None listed'}`,
    `Personal Notes: ${client.personalNotes || 'None listed'}`,
    `Professional Notes: ${client.professionalNotes || 'None listed'}`,
    '',
    'Important: if the work summaries contain a specific project, responsibility, market, or industry event, weave that in naturally the way a human relationship note would.',
    '',
    'Return only the personalization line.'
  ].join('\n');
}

async function generatePersonalization({ apiKey, model, prompt }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 180
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${JSON.stringify(payload)}`);
  }

  const text = payload.output
    ?.flatMap(item => item.content || [])
    .find(item => item.type === 'output_text')
    ?.text;

  return {
    model: payload.model,
    text: normalizeWhitespace(text)
  };
}

async function generatePersonalizationWithRetry({ apiKey, model, prompt, retries = 3 }) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await generatePersonalization({ apiKey, model, prompt });
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(attempt * 1000);
      }
    }
  }

  throw lastError;
}

function ensureOutputDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function formatTagList(client) {
  const tags = [...client.events, ...client.associations];
  return tags.length ? tags : [];
}

function renderMarkdown({ client, personalization, model, generatedAt, styleSourcePath }) {
  const tags = formatTagList(client);

  return [
    '# ICSC Golf Fundraiser Personalization Sample',
    '',
    `- Name: ${client.name || 'Unknown'}`,
    `- Event / Association Tags: ${tags.length ? tags.map(tag => `\`${tag}\``).join('; ') : 'None listed'}`,
    `- Email: ${client.email ? `\`${client.email}\`` : 'Not listed'}`,
    `- Phone: ${client.phone ? `\`${client.phone}\`` : 'Not listed'}`,
    `- Personal Summary Used: ${client.personalSummary || 'None listed'}`,
    `- Work Summary Used (Medium): ${client.mediumSummary || 'None listed'}`,
    `- Work Summary Used (Long-Form): ${client.longSummary || 'None listed'}`,
    `- Personalization: ${personalization}`,
    '',
    `Drafted with OpenAI \`${model}\` on ${generatedAt} using Airtable CRM details and tone guidance from \`${styleSourcePath}\`.`
  ].join('\n');
}

function renderBatchMarkdown({ records, model, generatedAt }) {
  const lines = [
    '# ICSC Golf Fundraiser Personalizations',
    '',
    `Generated on ${generatedAt} with OpenAI \`${model}\`.`,
    `Event location reference used in prompts: ${EVENT_LOCATION}, Illinois.`,
    '',
    `Total contacts: ${records.length}`,
    ''
  ];

  for (const record of records) {
    const tags = record.tags.length ? record.tags.map(tag => `\`${tag}\``).join('; ') : 'None listed';

    lines.push(`## ${record.name}`);
    lines.push('');
    lines.push(`- Event / Association Tags: ${tags}`);
    lines.push(`- Email: ${record.email ? `\`${record.email}\`` : 'Not listed'}`);
    lines.push(`- Phone: ${record.phone ? `\`${record.phone}\`` : 'Not listed'}`);
    lines.push(`- Personalization: ${record.personalization}`);
    lines.push('');
  }

  return lines.join('\n');
}

function createCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun(normalizeWhitespace(text) || 'Not listed')]
      })
    ]
  });
}

async function writeDocx(records, outputPath, generatedAt, model) {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        createCell('Name', 16),
        createCell('Tags', 22),
        createCell('Email', 18),
        createCell('Phone', 12),
        createCell('Personalization', 32)
      ]
    }),
    ...records.map(record => new TableRow({
      children: [
        createCell(record.name, 16),
        createCell(record.tags.join('; '), 22),
        createCell(record.email, 18),
        createCell(record.phone, 12),
        createCell(record.personalization, 32)
      ]
    }))
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE
            }
          }
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            text: 'ICSC Golf Fundraiser Personalizations'
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun(`Generated ${generatedAt} with ${model}. `),
              new TextRun(`Event location referenced: ${EVENT_LOCATION}, Illinois. `),
              new TextRun(`Total contacts: ${records.length}.`)
            ]
          }),
          table
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  ensureOutputDirectory(outputPath);
  fs.writeFileSync(outputPath, buffer);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadClients() {
  const airtableApiKey = requireEnv('AIRTABLE_API_KEY');
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const airtableClient = new AirtableClient({ apiKey: airtableApiKey, baseId });
  const records = await airtableClient.fetchAllRecords({
    tableName: CLIENT_TABLE,
    fields: MATCH_FIELDS
  });

  return records
    .map(mapClientRecord)
    .filter(client => client.name)
    .filter(matchesGolfCriteria);
}

async function runSample({ options, apiKey, styleExamples, styleSourcePath, clients }) {
  const selectedClient = selectClient(clients, options);

  if (!selectedClient) {
    throw new Error('No matching golf fundraiser clients were found in Airtable.');
  }

  const prompt = buildPrompt({
    styleExamples,
    client: selectedClient
  });

  const result = await generatePersonalizationWithRetry({
    apiKey,
    model: options.model,
    prompt
  });

  const generatedAt = new Date().toISOString().slice(0, 10);
  const markdown = renderMarkdown({
    client: selectedClient,
    personalization: result.text,
    model: result.model,
    generatedAt,
    styleSourcePath: path.relative(process.cwd(), styleSourcePath).replace(/\\/g, '/')
  });

  ensureOutputDirectory(options.outputPath);
  fs.writeFileSync(options.outputPath, markdown);

  console.log(JSON.stringify({
    mode: 'sample',
    outputPath: options.outputPath,
    client: selectedClient.name,
    model: result.model,
    personalization: result.text
  }, null, 2));
}

async function runBatch({ options, apiKey, styleExamples, clients }) {
  const sortedClients = sortClients(clients);
  const results = [];
  let resolvedModel = options.model;

  for (let index = 0; index < sortedClients.length; index += 1) {
    const client = sortedClients[index];
    const prompt = buildPrompt({ styleExamples, client });
    const result = await generatePersonalizationWithRetry({
      apiKey,
      model: options.model,
      prompt
    });

    resolvedModel = result.model;

    results.push({
      name: client.name,
      tags: formatTagList(client),
      email: client.email,
      phone: client.phone,
      personalization: result.text
    });

    console.log(`[${index + 1}/${sortedClients.length}] ${client.name}`);
    await sleep(250);
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const markdown = renderBatchMarkdown({
    records: results,
    model: resolvedModel,
    generatedAt
  });

  ensureOutputDirectory(options.markdownPath);
  fs.writeFileSync(options.markdownPath, markdown);

  ensureOutputDirectory(options.jsonPath);
  fs.writeFileSync(options.jsonPath, JSON.stringify({
    generatedAt,
    model: resolvedModel,
    eventLocation: `${EVENT_LOCATION}, Illinois`,
    count: results.length,
    records: results
  }, null, 2));

  await writeDocx(results, options.outputPath, generatedAt, resolvedModel);

  console.log(JSON.stringify({
    mode: 'all',
    count: results.length,
    docxPath: options.outputPath,
    markdownPath: options.markdownPath,
    jsonPath: options.jsonPath,
    model: resolvedModel
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const apiKey = requireEnv('OPENAI_API_KEY');
  const styleSourcePath = path.resolve(process.cwd(), 'output', 'psexamples.md');
  const styleExamples = fs.readFileSync(styleSourcePath, 'utf8');
  const clients = await loadClients();

  if (!clients.length) {
    throw new Error('No matching golf fundraiser clients were found in Airtable.');
  }

  if (options.mode === 'all') {
    await runBatch({ options, apiKey, styleExamples, clients });
    return;
  }

  await runSample({ options, apiKey, styleExamples, styleSourcePath, clients });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

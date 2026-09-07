'use strict';

const SECTIONS = [
  'GREETING',
  'ROUTES',
  'BOOKINGS',
  'PRICING',
  'POLICIES',
  'LOST_LUGGAGE',
  'ESCALATION'
];

const KEYWORDS = {
  GREETING: ['greeting', 'hello', 'welcome', 'introduce', 'opening', 'answer the phone', 'say hi'],
  ROUTES: ['route', 'trichardt', 'destination', 'trip', 'timetable', 'evening run', 'schedule', 'stop'],
  BOOKINGS: ['booking', 'charter', 'reserve', 'coach quantity', 'availability', 'confirm booking'],
  PRICING: ['price', 'pricing', 'cost', 'rate', 'quote', 'fee', 'rand', 'r '],
  POLICIES: ['policy', 'policies', 'cancellation', 'cancel', 'hours notice', 'refund', 'terms'],
  LOST_LUGGAGE: ['luggage', 'suitcase', 'bag', 'lost property', 'left behind'],
  ESCALATION: ['escalat', 'supervisor', 'human agent', 'manager', 'handoff', 'transfer the call']
};

function detectSection(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (!text.trim()) {
    const err = new Error('Type an instruction first.');
    err.status = 400;
    throw err;
  }
  const scores = {};
  for (const section of SECTIONS) {
    scores[section] = 0;
    for (const word of KEYWORDS[section]) {
      if (text.includes(word)) scores[section] += word.length > 8 ? 2 : 1;
    }
  }
  if (/in the greeting|opening line|when you answer/.test(text)) return 'GREETING';
  if (/cancellation|cancel policy|hours notice/.test(text)) return 'POLICIES';
  if (/lost luggage|lost bag/.test(text)) return 'LOST_LUGGAGE';
  if (/new (evening )?route|add (a )?route/.test(text)) scores.ROUTES += 5;

  let best = 'GREETING';
  let top = -1;
  for (const section of SECTIONS) {
    if (scores[section] > top) {
      top = scores[section];
      best = section;
    }
  }
  if (top <= 0) {
    const err = new Error('Could not tell which section to update. Mention greeting, routes, bookings, pricing, policies, lost luggage, or escalation.');
    err.status = 400;
    throw err;
  }
  return best;
}

function replaceFromTo(content, instruction) {
  const match = instruction.match(/from\s+(.+?)\s+to\s+(.+?)(?:[.!]|$)/i);
  if (!match) return null;
  const from = match[1].trim().replace(/["']/g, '');
  const to = match[2].trim().replace(/["'.]/g, '');
  if (!from || !content.toLowerCase().includes(from.toLowerCase())) {
    return `${content.trim()}\nUpdated rule: ${from} is now ${to}.`;
  }
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return content.replace(re, to);
}

function rewriteSection(section, currentContent, instruction) {
  const text = String(instruction).trim();
  const fromTo = replaceFromTo(currentContent, text);
  if (fromTo) return fromTo;

  if (section === 'GREETING' && /mention|add|include|announce/.test(text.toLowerCase())) {
    const mention = text.replace(/^.*?(mention|include|announce|add)\s+/i, '').replace(/in the greeting\.?$/i, '').trim();
    const sentence = mention.endsWith('.') ? mention : `${mention}.`;
    const cleaned = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (currentContent.includes(cleaned)) return currentContent;
    return `${currentContent.trim()}\nAlso mention: ${cleaned}`;
  }

  if (section === 'ROUTES' && /route|trichardt|evening/.test(text.toLowerCase())) {
    return `${currentContent.trim()}\nNew service note from operations: ${text}`;
  }

  return `${currentContent.trim()}\nOperations update: ${text}`;
}

function proposeUpdate(sectionsMap, instruction) {
  const forbidden = /replace (all|entire|whole) (prompt|instructions)|overwrite everything/i;
  if (forbidden.test(instruction)) {
    const err = new Error('That instruction would replace the whole agent prompt. Update one topic only.');
    err.status = 400;
    throw err;
  }
  const section = detectSection(instruction);
  const current = sectionsMap[section];
  if (typeof current !== 'string') {
    const err = new Error(`Section ${section} is missing.`);
    err.status = 500;
    throw err;
  }
  const updated_content = rewriteSection(section, current, instruction);
  if (updated_content === current) {
    const err = new Error('No change was produced. Try a more specific instruction.');
    err.status = 400;
    throw err;
  }
  for (const name of SECTIONS) {
    if (name === section) continue;
    if (updated_content === sectionsMap[name]) {
      const err = new Error('Safety check blocked a change that copied another section.');
      err.status = 400;
      throw err;
    }
  }
  return { section, updated_content };
}

const DEFAULT_SECTIONS = {
  GREETING:
    'You are the Meridian Coach voice agent. Greet the caller warmly, give your name as Meridian Coach, and ask how you can help with a whole-coach charter. Do not sell individual seats.',
  ROUTES:
    'Known charter corridors include Cape Town Waterfront, CPT airport transfers, Garden Route, Stellenbosch Winelands, and Johannesburg OR Tambo runs. Confirm pickup and destination before quoting.',
  BOOKINGS:
    'Meridian charters complete 65-seat coaches. Staff or the caller choose the number of coaches. Total capacity equals coaches times 65. One booking reference can hold many coaches. Check date availability before confirming.',
  PRICING:
    'Default charter rate is R 8,500 per coach per day unless operations give another figure. Quote the number of coaches times the daily rate times the number of days. Do not invent discounts.',
  POLICIES:
    'Cancellations must be received at least 2 hours before departure. Same-day no-shows may be charged. Whole-coach charters are never converted into individual seat sales.',
  LOST_LUGGAGE:
    'Take a description, last coach or booking reference if known, and a return phone number. Log the item for operations. Do not promise that the bag has been found.',
  ESCALATION:
    'If the caller is upset, asks for a supervisor, or the request is outside these instructions, offer to transfer to a Meridian operations agent. Never guess safety or legal advice.'
};

module.exports = {
  SECTIONS,
  DEFAULT_SECTIONS,
  detectSection,
  rewriteSection,
  proposeUpdate
};

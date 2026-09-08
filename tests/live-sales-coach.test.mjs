import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoResearch } from '../src/lib/demo-data.ts';
import { buildSalesOpportunity } from '../src/lib/sales-copy.ts';
import {
  answerLeaksUnverifiedPain,
  collectSalesEvidence,
  formatCompanyBrief,
  formatNamedLookupBrief,
  formatNeutralCallAdvice,
  groundedCallOpener,
  hasCompanySpecificTrigger,
  isGenericIndustryCopy,
  looksLikeCompanyBrief,
  openingMove,
  nextSalesMove,
  promisesUnverifiedPriceWin,
  inventsUnverifiedNetwork,
  refersToCurrentCompany,
  recommendsInPersonSelling,
  salesCoachNotes,
} from '../src/lib/live/sales-coach.ts';
import { parseLiveBrief } from '../src/lib/live/intent.ts';
import { prepareOutreach } from '../src/lib/live/prospecting.ts';

const prospect = generateDemoResearch().prospects[0];

test('brief-me language is detected without treating ordinary questions as research', () => {
  assert.equal(looksLikeCompanyBrief('Brief me on this company'), true);
  assert.equal(looksLikeCompanyBrief('Brief me on this company again'), true);
  assert.equal(looksLikeCompanyBrief('Prep me for this company'), true);
  assert.equal(looksLikeCompanyBrief('What should I know before I call them?'), true);
  assert.equal(looksLikeCompanyBrief('Tell me about this one'), true);
  assert.equal(looksLikeCompanyBrief('What do we know about them?'), true);
  assert.equal(looksLikeCompanyBrief('Tell me about The Innovations Group'), true);
  assert.equal(looksLikeCompanyBrief('How do I sound more natural on calls?'), false);
  assert.equal(looksLikeCompanyBrief('Next one'), false);
  assert.equal(parseLiveBrief('Brief me on this company').wantsResearch, true);
});

test('research briefs summarize facts instead of dumping search snippets', () => {
  const brief = formatNamedLookupBrief('Oak Street Coffee', 'Rivertown, SC', [{
    title: 'Oak Street Coffee — Rivertown, SC',
    snippet: 'Oak Street Coffee serves Rivertown from a Main Street cafe.',
    url: 'https://oakstreetcoffee.example',
  }, {
    title: 'Oak Street Coffee - Yelp',
    snippet: 'Reviews for Oak Street Coffee.',
    url: 'https://www.yelp.com/biz/oak-street-coffee',
  }]);
  assert.doesNotMatch(brief, /Public coverage/i);
  assert.doesNotMatch(brief, /Public source/i);
  assert.doesNotMatch(brief, /yelp\.com/i);
  assert.doesNotMatch(brief, /What matters|Best opening move|Reality Check|Why this works/i);
  assert.match(brief, /What I verified/);
  assert.match(brief, /\*\*Best move\*\*/);
  assert.match(brief, /\*\*(?:Location|Website):\*\*/);
  assert.match(brief, /oakstreetcoffee\.example/);
  assert.match(brief, /^>/m);
  assert.match(openingMove(collectSalesEvidence(prospect)), /^>/m);
});

test('fit score and generic topOpportunity are not treated as customer pain', () => {
  const loaded = {
    ...prospect,
    score: 84,
    topOpportunity: buildSalesOpportunity(prospect.category),
    hypothesizedNeeds: ['Tenant communications', 'Maintenance scheduling'],
  };
  const evidence = collectSalesEvidence(loaded);
  assert.equal(hasCompanySpecificTrigger(evidence), false);
  assert.equal(isGenericIndustryCopy(loaded.topOpportunity), true);
  const brief = formatCompanyBrief(loaded, evidence);
  assert.match(brief, /didn’t find a strong company-specific trigger/i);
  assert.doesNotMatch(brief, /connectivity pain|tenant communications|often face/i);
  assert.doesNotMatch(brief, /fit 84/);
  assert.ok(!evidence.verified.some((item) => /pain|tenant communications/i.test(item.value)));
});

test('verified public coverage can influence the opener, generic industry copy cannot', () => {
  const evidence = collectSalesEvidence(prospect, {
    findings: [{
      title: 'Northline Logistics opens second warehouse in Charlotte',
      snippet: 'The company opened a second warehouse this spring to handle more freight.',
      url: 'https://example.com/northline-expansion',
    }],
  });
  assert.equal(hasCompanySpecificTrigger(evidence), true);
  assert.match(openingMove(evidence), /second warehouse/i);
  assert.doesNotMatch(openingMove(evidence), /connectivity pain/i);
  const generic = collectSalesEvidence(prospect);
  assert.match(openingMove(generic), /cold discovery|didn’t find a strong company-specific trigger/i);
});

test('industry assumptions leaked as company facts are rejected', () => {
  const evidence = collectSalesEvidence(prospect);
  assert.equal(
    answerLeaksUnverifiedPain(
      'Property management teams often face connectivity pain points with tenant communications.',
      evidence,
    ),
    true,
  );
  assert.equal(
    answerLeaksUnverifiedPain(formatCompanyBrief(prospect, evidence), evidence),
    false,
  );
});

test('nextSalesMove diagnoses objections instead of forcing a close', () => {
  const evidence = collectSalesEvidence(prospect);
  assert.match(nextSalesMove(evidence, 'It is too expensive'), /Diagnose before rebutting/i);
  assert.match(nextSalesMove(evidence, 'We already have a provider'), /all-in|paying/i);
  assert.doesNotMatch(nextSalesMove(evidence, 'We already have a provider'), /no reason to switch/i);
  assert.match(nextSalesMove(evidence, 'Not interested'), /Back off/i);
  assert.match(nextSalesMove(evidence), /didn’t find a strong company-specific trigger/i);
});

test('this/them follow-ups point at the active company, not a newly named one', () => {
  assert.equal(refersToCurrentCompany('Brief me on this company again'), true);
  assert.equal(refersToCurrentCompany('What should I ask them?'), true);
  assert.equal(refersToCurrentCompany('Tell me more about them'), true);
  assert.equal(refersToCurrentCompany('What do we know about them?'), true);
  assert.equal(refersToCurrentCompany('Tell me about Oak Street Coffee'), false);
  assert.equal(refersToCurrentCompany('How do I sound more natural on calls?'), false);
});

test('discovery questions stay neutral and do not assume cafe pain', () => {
  const cafe = { ...prospect, category: 'Cafe', name: 'Example Cafe' };
  const evidence = collectSalesEvidence(cafe);
  assert.match(evidence.discoveryQuestions[1], /day-to-day operation/i);
  assert.doesNotMatch(evidence.discoveryQuestions.join(' '), /headache|lunch rush|if the connection drops|struggle with/i);
  assert.match(openingMove(evidence), /currently using/i);
  assert.equal(
    answerLeaksUnverifiedPain("What's your biggest headache with internet reliability during the lunch rush?", evidence),
    true,
  );
  assert.equal(
    answerLeaksUnverifiedPain("Many cafes struggle with POS outages; is that something you've experienced?", evidence),
    true,
  );
  assert.equal(
    answerLeaksUnverifiedPain('How does internet and phone fit into the day-to-day operation here?', evidence),
    false,
  );
});

const IN_PERSON_SELLING = /\b(?:stop by|visit them|site walk|meet in person|drop by|swing by|come by|in-person appointment|on-site visit)\b/i;

function assertPhoneSalesCopy(label, text) {
  assert.equal(recommendsInPersonSelling(text), false, label);
  assert.doesNotMatch(text, IN_PERSON_SELLING, label);
}

test('soft objections keep discovery moving and hard rejections stop', () => {
  const evidence = collectSalesEvidence(prospect);
  const happy = nextSalesMove(evidence, "We're happy with AT&T.");
  assert.match(happy, /all-in|paying/i);
  assert.doesNotMatch(happy, /thanks for your time|close the lead|no reason to switch/i);
  assert.equal(promisesUnverifiedPriceWin(happy), false);

  const goodToUs = nextSalesMove(evidence, "They've been very good to us.");
  assert.match(goodToUs, /all-in|paying/i);
  assert.doesNotMatch(goodToUs, /no reason to switch|they see no reason/i);

  const noReason = nextSalesMove(evidence, "I don't really see a reason to change.");
  assert.match(noReason, /all-in|paying/i);
  assert.doesNotMatch(noReason, /no reason to switch/i);

  const price = nextSalesMove(evidence, 'We pay $150.');
  assert.match(price, /if i could/i);
  assert.doesNotMatch(price, /i can beat|we can beat|spectrum can beat/i);
  assert.equal(promisesUnverifiedPriceWin(price), false);
  assert.equal(promisesUnverifiedPriceWin('I can beat that.'), true);

  const listen = nextSalesMove(evidence, "If you could beat it I'd listen.");
  assert.match(listen, /interest|quote|address|look/i);
  assert.doesNotMatch(listen, /i can beat that|we can beat/i);
  assert.equal(inventsUnverifiedNetwork(listen), false);

  const stop = nextSalesMove(evidence, "We're absolutely not changing anything, please stop calling.");
  assert.match(stop, /hard no|back off|off the list/i);
  assert.doesNotMatch(stop, /all-in|if i could put together/i);
});

test('Live sales coaching never recommends in-person selling', () => {
  const evidence = collectSalesEvidence(prospect);
  const triggered = collectSalesEvidence(prospect, {
    findings: [{
      title: 'Northline Logistics opens second warehouse in Charlotte',
      snippet: 'The company opened a second warehouse this spring.',
      url: 'https://example.com/northline-expansion',
    }],
  });
  const outreach = prepareOutreach(prospect, evidence);
  const moves = [
    salesCoachNotes(),
    openingMove(evidence),
    openingMove(triggered),
    formatCompanyBrief(prospect, evidence),
    formatNeutralCallAdvice(prospect.name, evidence),
    groundedCallOpener(prospect, evidence),
    `${outreach.callOpener}\n${outreach.followUpEmail.body}\n${outreach.qualification.questions.join('\n')}\n${outreach.qualification.beforeQuoting.join('\n')}`,
    nextSalesMove(evidence),
    nextSalesMove(evidence, 'Not interested'),
    nextSalesMove(evidence, 'It is too expensive'),
    nextSalesMove(evidence, 'We already have a provider'),
    nextSalesMove(evidence, "They're busy, call back tomorrow"),
    nextSalesMove(evidence, 'Can you email me the details?'),
    nextSalesMove(evidence, 'Ask the owner, I am not the person'),
    nextSalesMove(triggered, "We're interested, check the address"),
    nextSalesMove(evidence, "We're happy with AT&T."),
    nextSalesMove(evidence, "They've been very good to us."),
    nextSalesMove(evidence, 'We pay $150.'),
    nextSalesMove(evidence, "If you could beat it I'd listen."),
    nextSalesMove(evidence, "We're absolutely not changing anything, please stop calling."),
  ];
  for (const [index, text] of moves.entries()) assertPhoneSalesCopy(`copy ${index}`, text);

  assert.equal(recommendsInPersonSelling('Can I stop by for 5 minutes this week?'), true);
  assert.equal(recommendsInPersonSelling('Ask for a site walk next.'), true);
  assert.equal(recommendsInPersonSelling('Visit them at the shop tomorrow.'), true);
  assert.equal(recommendsInPersonSelling('Meet them in person to inspect the equipment.'), true);
  assert.equal(recommendsInPersonSelling('Send the details and stay on this call.'), false);

  const busy = nextSalesMove(evidence, "They're busy, call back tomorrow");
  const info = nextSalesMove(evidence, 'Can you email me the details?');
  const order = nextSalesMove(triggered, "We're interested, check the address");
  assert.notEqual(busy, info);
  assert.notEqual(info, order);
  assert.notEqual(busy, order);
  assert.match(busy, /callback/i);
  assert.match(info, /send the information/i);
  assert.match(order, /serviceability|remote order|callback/i);
});


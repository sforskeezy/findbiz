import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLiveBugLog,
  hasBugLogContent,
  liveBugFilename,
  snapshotFromPublicState,
  snapshotFromSession,
} from '../src/lib/live/chat-output.ts';
import { parseLiveBrief } from '../src/lib/live/intent.ts';

const exportedAt = '2026-09-07T21:24:00.000Z';

const session = {
  id: 'live_abc123def456',
  title: 'Find lawn care in Lugoff',
  createdAt: '2026-09-07T21:00:00.000Z',
  updatedAt: '2026-09-07T21:20:00.000Z',
  awaitingLocation: false,
  brief: parseLiveBrief('Find 3 home-based businesses in Lugoff, SC and research them'),
  queue: {
    locationLabel: 'Lugoff, SC',
    radiusMiles: 2,
    category: null,
    currentIndex: 1,
    prospects: [
      {
        id: 'p1',
        name: 'Macon Lawn',
        address: '100 Main St, Lugoff, SC',
        coordinates: { lat: 34.22, lng: -80.69 },
        distanceMiles: 0.4,
        category: 'Lawn care',
        phone: '(803) 555-0100',
        website: 'https://example.com/macon',
        directoryUrl: null,
        hours: null,
        rating: 4.8,
        reviewCount: 12,
        locationCount: 1,
        businessSize: null,
        operatingStatus: 'Open',
        publicNotes: null,
        source: 'Google Maps',
        sourceDate: exportedAt,
        retrievedAt: exportedAt,
        confidence: 'Verified',
        score: 82,
        scoreBreakdown: { proximity: 20, industryFit: 20, operationalDependence: 10, organizationScale: 10, broadbandOpportunity: 12, dataConfidence: 10 },
        scoreRationale: 'Independent lawn care close to the pin.',
        topOpportunity: '',
        summary: '',
        hypothesizedNeeds: [],
        discoveryQuestions: [],
        callOpener: '',
        followUpEmail: { subject: '', body: '' },
        signals: [{ kind: 'home', label: 'Home-based', detail: 'Residential street' }],
      },
      {
        id: 'p2',
        name: 'Just Sew',
        address: '200 Woods Crossing Rd, Lugoff, SC',
        coordinates: { lat: 34.23, lng: -80.68 },
        distanceMiles: 0.9,
        category: 'Sewing',
        phone: null,
        website: null,
        directoryUrl: null,
        hours: null,
        rating: null,
        reviewCount: null,
        locationCount: 1,
        businessSize: null,
        operatingStatus: 'Open',
        publicNotes: null,
        source: 'Google Maps',
        sourceDate: exportedAt,
        retrievedAt: exportedAt,
        confidence: 'Estimated',
        score: 61,
        scoreBreakdown: { proximity: 10, industryFit: 15, operationalDependence: 8, organizationScale: 8, broadbandOpportunity: 10, dataConfidence: 10 },
        scoreRationale: 'Quiet independent shop.',
        topOpportunity: '',
        summary: '',
        hypothesizedNeeds: [],
        discoveryQuestions: [],
        callOpener: '',
        followUpEmail: { subject: '', body: '' },
      },
    ],
  },
  messages: [
    {
      id: 'msg_user',
      role: 'user',
      content: 'Find 3 home-based businesses in Lugoff, SC',
      createdAt: '2026-09-07T21:01:00.000Z',
    },
    {
      id: 'msg_live',
      role: 'assistant',
      content: '1. **Macon Lawn** — 0.4 mi\n2. **Just Sew** — 0.9 mi',
      createdAt: '2026-09-07T21:01:08.000Z',
      thinking: [{ id: 'step_1', label: 'Searching Google Maps near Lugoff, SC', detail: 'Google Maps scraper', thought: 'Need independent shops, not chains.' }],
      sources: [{ id: 'src_1', title: 'Macon Lawn', url: 'https://example.com/macon', domain: 'example.com', snippet: 'Lawn care in Lugoff' }],
    },
  ],
};

test('snapshot keeps list, brief, and traces for a bug report', () => {
  const snapshot = snapshotFromSession(session, [{ id: 'mem_1', kind: 'territory', text: 'Working territory: Lugoff, SC (2 mi)', createdAt: exportedAt }], exportedAt);
  assert.equal(snapshot.session.id, 'live_abc123def456');
  assert.equal(snapshot.session.brief.targetName, null);
  assert.equal(snapshot.session.brief.locationHint, 'Lugoff, SC');
  assert.equal(snapshot.queue.currentName, 'Just Sew');
  assert.equal(snapshot.queue.cards[0].coordinates.lat, 34.22);
  assert.equal(hasBugLogContent(snapshot), true);
  assert.equal(liveBugFilename(snapshot), 'live-bug-log-live_abc123def456-20260907-212400.md');
});

test('bug log is a readable transcript with replay steps and machine JSON', () => {
  const snapshot = snapshotFromSession(session, [], exportedAt);
  snapshot.inProgress = { status: 'Thinking', answer: 'Partial reply', error: 'Timed out' };
  snapshot.app = { url: 'http://localhost:3000/live', userAgent: 'TestAgent/1.0' };
  const log = formatLiveBugLog(snapshot);
  assert.match(log, /ProspectIQ Live — bug log/);
  assert.match(log, /1\. Find 3 home-based businesses in Lugoff, SC/);
  assert.match(log, /### 1\. User/);
  assert.match(log, /### 2\. Live/);
  assert.match(log, /Searching Google Maps near Lugoff, SC/);
  assert.match(log, /Need independent shops, not chains/);
  assert.match(log, /Current: \*\*#2 Just Sew\*\*/);
  assert.match(log, /34\.22000, -80\.69000/);
  assert.match(log, /Partial reply/);
  assert.match(log, /Timed out/);
  assert.match(log, /```json/);
  assert.match(log, /"id": "live_abc123def456"/);
  assert.doesNotMatch(log, /\/output/);
});

test('public-state fallback still exports when the API is unavailable', () => {
  const snapshot = snapshotFromPublicState({
    sessionId: 'live_abc123def456',
    title: 'Find lawn care in Lugoff',
    updatedAt: exportedAt,
    messages: session.messages,
    queue: {
      locationLabel: 'Lugoff, SC',
      radiusMiles: 2,
      category: null,
      currentIndex: 1,
      total: 2,
      current: { id: 'p2', name: 'Just Sew', category: 'Sewing', address: '200 Woods Crossing Rd, Lugoff, SC', distanceMiles: 0.9, phone: null, website: null, score: 61, why: 'Quiet independent shop.' },
      cards: [
        { id: 'p1', name: 'Macon Lawn', category: 'Lawn care', address: '100 Main St, Lugoff, SC', distanceMiles: 0.4, phone: '(803) 555-0100', website: 'https://example.com/macon', score: 82, why: 'Independent lawn care close to the pin.' },
        { id: 'p2', name: 'Just Sew', category: 'Sewing', address: '200 Woods Crossing Rd, Lugoff, SC', distanceMiles: 0.9, phone: null, website: null, score: 61, why: 'Quiet independent shop.' },
      ],
    },
    memory: [],
    exportedAt,
  });
  assert.equal(snapshot.queue.currentName, 'Just Sew');
  assert.equal(hasBugLogContent(snapshotFromPublicState({ sessionId: null, messages: [], queue: null, memory: [] })), false);
  assert.equal(
    hasBugLogContent(snapshotFromPublicState({
      sessionId: null,
      messages: [],
      queue: null,
      memory: [{ id: 'mem_1', kind: 'territory', text: 'Working territory: Lugoff, SC (2 mi)', createdAt: exportedAt }],
    })),
    false,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyRepUtterance,
  coachCopyForScan,
  coachNeedsBusinessMessage,
  formatCoachSummary,
  resetCallCoach,
  resolveCoachBusiness,
  startCallCoach,
} from '../src/lib/live/call-coach.ts';
import {
  inventsUnverifiedNetwork,
  promisesUnverifiedPriceWin,
  recommendsInPersonSelling,
} from '../src/lib/live/sales-coach.ts';

const business = {
  name: 'Midlands Notary & Wedding Services',
  location: 'Columbia, SC',
  website: null,
  publicTrigger: null,
};

function repoRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function readMicSource() {
  return readFileSync(path.join(repoRoot(), 'src/components/live/use-live-coach-mic.ts'), 'utf8');
}

function readModalSource() {
  return readFileSync(path.join(repoRoot(), 'src/components/live/live-coach-modal.tsx'), 'utf8');
}

function assertPhoneSales(label, text) {
  assert.equal(recommendsInPersonSelling(text), false, label);
  assert.doesNotMatch(text, /\b(?:stop by|site walk|visit them|in[- ]person|on[- ]site visit)\b/i, label);
}

function play(utterances, from = startCallCoach(business)) {
  return utterances.reduce((view, line) => applyRepUtterance(view.state, line), from);
}

test('empty or introductory calls do not append boilerplate to chat', () => {
  assert.equal(formatCoachSummary(startCallCoach(business).state), '');
  assert.equal(formatCoachSummary(play(['Hi, this is Skylar with Spectrum Business.']).state), '');
  assert.equal(resolveCoachBusiness({activeCompany:{name:'one for landscape'}}), null);
});

test('provider recaps support ordinary phrasing and ASR variants', () => {
  for (const text of ['Oh, you use AT&T.', 'Okay, you have AT and T.', 'So you are with AT&T.', "You're using AT&T.", 'They use AT&T.']) {
    const view = play([text]);
    assert.equal(view.state.facts.find(item => item.key === 'provider')?.value, 'AT&T', text);
    assert.match(view.suggestion.line, /how have they been treating you/i, text);
    assert.doesNotMatch(coachCopyForScan(view), /cannot hear|couldn.t hear|customer audio/i);
  }
  const combined = play(['Hi, this is Skylar from Spectrum. Oh, you use AT&T.']);
  assert.equal(combined.state.facts.find(item => item.key === 'provider')?.value, 'AT&T');
  const split = play(['Oh, you use.', 'AT and T?']);
  assert.equal(split.state.facts.find(item => item.key === 'provider')?.value, 'AT&T');
});

test('questions and our offers are not treated as customer answers', () => {
  for (const text of ['Do you use AT&T?', 'If you use AT&T, we can look at the options.', 'I can offer internet for about $150 a month.']) {
    const view = play([text]);
    assert.equal(view.state.facts.some(item => item.key === 'provider' || item.key === 'price'), false, text);
  }
});

test('the latest recap moves the coach beyond a previous callback or provider question', () => {
  const view = play(['Sounds like you’re busy, I can call you back.', 'Oh, you use AT&T.', 'So you are paying $150 a month for internet.']);
  assert.match(view.suggestion.line, /if i could/i);
  assert.doesNotMatch(view.suggestion.line, /call back|treating you/i);
  const problem = applyRepUtterance(view.state, 'Oh, so the connection keeps dropping.');
  assert.match(problem.suggestion.line, /what part of the work gets interrupted/i);
  assert.doesNotMatch(problem.suggestion.line, /all-in|treating you/i);
});

test('/livemode opens using the current business', () => {
  const resolved = resolveCoachBusiness({
    activeCompany: {
      name: 'Midlands Notary & Wedding Services',
      location: 'Columbia, SC',
      website: null,
      publicTrigger: null,
    },
    queueCurrent: { name: 'Other Shop', address: 'Charlotte, NC' },
  });
  assert.equal(resolved?.name, 'Midlands Notary & Wedding Services');
  assert.equal(resolved?.location, 'Columbia, SC');
  const fromList = resolveCoachBusiness({
    queueCurrent: { name: 'Oak Street Coffee', address: 'Rivertown, SC' },
  });
  assert.equal(fromList?.name, 'Oak Street Coffee');
});

test('no business gives a useful error', () => {
  assert.equal(resolveCoachBusiness({}), null);
  assert.equal(resolveCoachBusiness({ activeCompany: null, queueCurrent: null }), null);
  assert.match(coachNeedsBusinessMessage(), /select or research a business first/i);
  assert.match(coachNeedsBusinessMessage(), /\/livemode/i);
});

test('rep-only transcripts update call state', () => {
  const opened = startCallCoach(business);
  assert.equal(opened.suggestion.heardCustomer, false);
  assert.equal(opened.state.utterances.length, 0);
  assert.match(opened.suggestion.line, /skylar with spectrum business on a recorded line/i);

  const spoken = applyRepUtterance(
    opened.state,
    'Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?',
  );
  assert.equal(spoken.state.utterances.length, 1);
  assert.equal(spoken.suggestion.heardCustomer, false);
  assert.match(spoken.suggestion.line, /who you currently use/i);
  assert.doesNotMatch(spoken.suggestion.line, /finished construction|fiber is available|high-powered services/i);
});

test('"Oh, you use AT&T?" infers AT&T without claiming customer audio was heard', () => {
  const view = play([
    'Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?',
    "Good, good — glad to hear it. I wanted to see who you currently use for internet and phone service.",
    'Oh, you use AT&T?',
  ]);
  const provider = view.state.facts.find((item) => item.key === 'provider');
  assert.equal(provider?.value, 'AT&T');
  assert.equal(provider?.source, 'inferred_from_rep');
  assert.equal(view.suggestion.heardCustomer, false);
  assert.match(view.suggestion.customerInference ?? '', /AT&T/);
  assert.match(view.suggestion.customerInference ?? '', /likely customer detail/i);
  const copy = coachCopyForScan(view);
  assert.doesNotMatch(copy, /heard the customer|customer audio|i heard them|transcribed the customer/i);
  assert.match(view.suggestion.line, /how have they been treating you/i);
});

test('"Glad they\'ve been treating you well" does not kill the lead', () => {
  const view = play([
    'Oh okay, you guys use AT&T?',
    "Yeah, absolutely. I'm glad they've been taking care of you.",
    "Glad they've been treating you well.",
  ]);
  assert.equal(view.state.hardRejected, false);
  assert.notEqual(view.state.stage, 'true_rejection');
  assert.match(view.suggestion.line, /all-in|paying/i);
  assert.doesNotMatch(view.suggestion.line, /dead lead|no reason to switch|thanks for your time/i);
  assert.doesNotMatch(coachCopyForScan(view), /give up|walk away|close the lead/i);
});

test('suggestions change as discovery progresses', () => {
  const intro = startCallCoach(business);
  const opening = applyRepUtterance(intro.state, 'Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?');
  const provider = applyRepUtterance(opening.state, 'Oh okay, you guys use AT&T?');
  const happy = applyRepUtterance(provider.state, "Yeah, absolutely. I'm glad they've been taking care of you.");
  const price = applyRepUtterance(happy.state, 'Oh wow, around $150 for internet and two mobile lines?');

  assert.notEqual(intro.suggestion.line, opening.suggestion.line);
  assert.notEqual(opening.suggestion.line, provider.suggestion.line);
  assert.notEqual(provider.suggestion.line, happy.suggestion.line);
  assert.notEqual(happy.suggestion.line, price.suggestion.line);
  assert.match(provider.suggestion.line, /treating you/i);
  assert.match(happy.suggestion.line, /all-in/i);
  assert.match(price.suggestion.line, /if i could/i);
  assert.match(price.suggestion.line, /open to taking a look/i);

  const spend = price.state.facts.find((item) => item.key === 'price');
  const services = price.state.facts.find((item) => item.key === 'services');
  assert.match(spend?.value ?? '', /\$150/);
  assert.match(services?.value ?? '', /internet/i);
  assert.match(services?.value ?? '', /mobile/i);
});

test('no invented pricing or availability, and no in-person selling', () => {
  let view = startCallCoach(business);
  const script = [
    'Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?',
    "The only reason for my call is I'm working with a few businesses in the area. Who do you currently use?",
    'Oh, you use AT&T?',
    "Glad they've been treating you well.",
    'Oh wow, around $150 for internet and two mobile lines?',
    "No, I completely understand not wanting to switch.",
  ];
  const lines = [view.suggestion.line];
  for (const spoken of script) {
    view = applyRepUtterance(view.state, spoken);
    lines.push(view.suggestion.line);
    const copy = coachCopyForScan(view);
    assert.equal(promisesUnverifiedPriceWin(copy), false, spoken);
    assert.equal(inventsUnverifiedNetwork(copy), false, spoken);
    assertPhoneSales(spoken, copy);
    assert.doesNotMatch(copy, /i can beat|we can beat|spectrum can beat/i);
    assert.doesNotMatch(copy, /fiber is available|you(?:'|’)re serviceable|construction (?:was |is )?completed/i);
    assert.equal(view.suggestion.heardCustomer, false);
  }
  assert.ok(lines.length >= 4);
  const unique = new Set(lines);
  assert.ok(unique.size >= 4);
});

test('construction language stays out unless the rep verified it', () => {
  const cold = startCallCoach(business);
  assert.doesNotMatch(cold.suggestion.line, /finished construction|high-powered services/i);
  const afterIntro = applyRepUtterance(
    cold.state,
    'Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?',
  );
  assert.doesNotMatch(afterIntro.suggestion.line, /finished construction|fiber is available/i);

  const verified = applyRepUtterance(afterIntro.state, "They're green. Construction was completed.");
  assert.equal(verified.state.networkVerified, true);
  assert.match(verified.suggestion.line, /finished construction in the area/i);
  assert.equal(inventsUnverifiedNetwork(verified.suggestion.line), false);
});

test('explicit hard rejection ends further selling', () => {
  const view = play([
    'Oh, you use AT&T?',
    "Glad they've been treating you well.",
    'They said "Do not call again."',
  ]);
  assert.equal(view.state.hardRejected, true);
  assert.equal(view.state.stage, 'true_rejection');
  assert.match(view.suggestion.line, /off the list/i);
  assert.doesNotMatch(view.suggestion.line, /all-in|if i could put together|who do you currently use/i);

  const still = applyRepUtterance(view.state, 'Oh wow, around $150 for internet?');
  assert.equal(still.state.hardRejected, true);
  assert.equal(still.state.stage, 'true_rejection');
  assert.match(still.suggestion.line, /off the list/i);
  assert.doesNotMatch(still.suggestion.line, /if i could put together/i);
});

test('take us off the list is a hard stop', () => {
  const view = applyRepUtterance(startCallCoach(business).state, 'They said take us off your list.');
  assert.equal(view.state.hardRejected, true);
  assert.match(view.suggestion.line, /off the list|sorry to bother you/i);
});

test('coach summary keeps useful context and not the full transcript', () => {
  const view = play([
    'Oh, you use AT&T?',
    'Oh wow, around $150 for internet and two mobile lines?',
  ]);
  const summary = formatCoachSummary(view.state);
  assert.match(summary, /Midlands Notary/);
  assert.match(summary, /AT&T/);
  assert.doesNotMatch(summary, /customer audio|hear the customer|permanent memory|Live Coach/i);
  assert.doesNotMatch(summary, /Oh, you use AT&T\?/);
  const cleared = resetCallCoach(view.state);
  assert.equal(cleared.state.facts.length, 0);
  assert.equal(cleared.state.business.name, business.name);
});

test('Live Coach capture code is rep-mic only', () => {
  const mic = readMicSource();
  assert.match(mic, /getUserMedia/);
  assert.doesNotMatch(mic, /getDisplayMedia|captureStream|system audio|tabCapture/i);
  const modal = readModalSource();
  assert.doesNotMatch(modal, /cannot hear the customer|customer audio was not captured/i);
  assert.doesNotMatch(modal, /getDisplayMedia/);
});

test('a sentence split across two ASR segments is joined before inference', () => {
  const view = play(['Oh okay, you guys use', 'AT&T?']);
  assert.equal(view.state.utterances.length, 1);
  assert.equal(view.state.utterances[0], 'Oh okay, you guys use AT&T?');
  const provider = view.state.facts.find((item) => item.key === 'provider');
  assert.equal(provider?.value, 'AT&T');
  assert.equal(provider?.source, 'inferred_from_rep');
  assert.match(view.suggestion.line, /treating you/i);
  assert.equal(view.suggestion.heardCustomer, false);
  assert.doesNotMatch(coachCopyForScan(view), /heard the customer|customer audio|transcribed the customer/i);
});

test('a split price echo still lands as an all-in fact', () => {
  const view = play([
    'Oh okay, you guys use AT&T?',
    'Oh wow, around $150',
    'for internet and two mobile lines?',
  ]);
  assert.equal(view.state.utterances.length, 2);
  const price = view.state.facts.find((item) => item.key === 'price');
  const services = view.state.facts.find((item) => item.key === 'services');
  assert.match(price?.value ?? '', /\$150/);
  assert.match(services?.value ?? '', /internet/i);
  assert.match(services?.value ?? '', /mobile/i);
});

test('finished sentences stay separate utterances', () => {
  const view = play([
    'Oh, you use AT&T?',
    "Glad they've been treating you well.",
    "They're green. Construction was completed.",
  ]);
  assert.equal(view.state.utterances.length, 3);
});

test('a repeated ASR segment is not counted twice', () => {
  const once = applyRepUtterance(startCallCoach(business).state, 'They said take us off your list.');
  const twice = applyRepUtterance(once.state, 'They said take us off your list.');
  assert.equal(twice.state.utterances.length, 1);
  assert.equal(twice.state.explicitRejectionCount, 1);
  assert.equal(twice.state.hardRejected, true);
  assert.equal(twice.state.stage, once.state.stage);
  assert.equal(twice.suggestion.line, once.suggestion.line);

  const echoed = play(['Oh okay, you guys use AT&T?', 'Oh okay, you guys use AT&T!']);
  assert.equal(echoed.state.utterances.length, 1);
});

test('rep mic keeps capturing while a segment is transcribing', () => {
  const mic = readMicSource();
  // The next recorder opens before the previous one stops, so the boundary loses nothing.
  assert.match(mic, /const started = startRecorder\(\);[\s\S]{0,240}previous\.stop\(\)/);
  assert.match(mic, /rotateSegment/);
  // Transcription runs off an ordered queue instead of gating the restart of capture.
  assert.match(mic, /queueRef/);
  assert.doesNotMatch(mic, /onstop\s*=\s*async/);
  assert.doesNotMatch(mic, /await transcribe\w*\([\s\S]{0,140}start(?:Recorder|Capture|Loop)\(/);
});

test('the mic hook never writes refs during render', () => {
  const mic = readMicSource();
  assert.doesNotMatch(mic, /^ {2}[A-Za-z_$][\w$]*Ref\.current\s*[+-]?=/m);
  assert.doesNotMatch(mic, /startLoopRef/);
});

test('mic status has stable states and one writer', () => {
  const mic = readMicSource();
  assert.match(mic, /STAGE_SETTLE_MS/);
  assert.match(mic, /const syncStage = useCallback/);
  // The stage is written in exactly one place, so the dwell rule always applies.
  assert.equal((mic.match(/stageRef\.current = /g) ?? []).length, 1);
  // Stage and level are published from an external store, never setState in an effect.
  assert.match(mic, /useSyncExternalStore/);
  assert.doesNotMatch(mic, /setStage|setLevel/);
});

test('mute and unmute are deterministic in either order', () => {
  const mic = readMicSource();
  const muteEffect = mic.match(/\/\/ Mute is applied here and only here[\s\S]*?\n {2}\}, \[applyStage, muted/);
  assert.ok(muteEffect, 'a single effect owns mute');
  assert.match(muteEffect[0], /track\.enabled = false/);
  assert.match(muteEffect[0], /stopCapture\(true\)/);
  assert.match(muteEffect[0], /startCapture\(\)/);
  // Muting stops the monitor and the recorder, not just the track.
  const stopCapture = mic.match(/const stopCapture = useCallback\(\s*\(flushTail[\s\S]*?\n {4}\},\n {4}\[/);
  assert.ok(stopCapture, 'stopCapture exists');
  assert.match(stopCapture[0], /stopMonitor\(\)/);
  assert.match(stopCapture[0], /recorder\.stop\(\)/);
  // open() re-reads the mute flag after the permission prompt resolves.
  assert.match(mic, /if \(mutedRef\.current\) \{\s*\n\s*stream\.getAudioTracks/);
});

test('a long or silent stretch cannot pile up in the recorder', () => {
  const mic = readMicSource();
  assert.match(mic, /SEGMENT_IDLE_MS/);
  assert.match(mic, /SEGMENT_MAX_MS/);
  assert.match(mic, /rotateSegment\(false\)/);
  assert.match(mic, /MAX_PENDING_SEGMENTS/);
});

test('ending a coach session releases every mic resource', () => {
  const mic = readMicSource();
  const teardown = mic.match(/const teardown = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[/);
  assert.ok(teardown, 'teardown exists');
  const body = teardown[1];
  assert.match(body, /sessionRef\.current \+= 1/);
  assert.match(body, /stopMonitor\(\)/);
  assert.match(body, /inflightRef\.current\?\.abort\(\)/);
  assert.match(body, /queueRef\.current = \[\]/);
  assert.match(body, /recorder\.stop\(\)/);
  assert.match(body, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(body, /analyserRef\.current\?\.disconnect\(\)/);
  assert.match(mic, /audioContextRef\.current\?\.close\(\)/);
  // Teardown runs on unmount, on end, and on the business changing.
  assert.match(mic, /return \(\) => \{\s*\n\s*cancelled = true;\s*\n\s*teardown\(\);/);
});

test('a no-speech transcription is silent and a real error does not end the session', () => {
  const mic = readMicSource();
  const noSpeech = mic.match(/if \(response\.status === 422\) \{([\s\S]*?)\n {6}\}/);
  assert.ok(noSpeech, '422 is handled on its own');
  assert.doesNotMatch(noSpeech[1], /onError/);
  const failure = mic.match(/\} catch \(error\) \{([\s\S]*?)\n {4}\} finally \{/);
  assert.ok(failure, 'transcription failures are caught');
  // One notice per rough patch, and listening keeps going.
  assert.match(failure[1], /if \(errorLatchRef\.current\) return;/);
  assert.doesNotMatch(failure[1], /teardown|stopCapture|activeRef\.current = false/);
});

test('a mic that disappears mid-call reopens before it gives up', () => {
  const mic = readMicSource();
  assert.match(mic, /MIC_RECOVERY_ATTEMPTS/);
  const recovery = mic.slice(mic.indexOf('const tick = useCallback')).match(/if \(!isLiveAudioStream\(streamRef\.current\)\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(recovery, 'a dead device is detected on the monitor tick');
  assert.match(recovery[1], /stopMonitor\(\)/);
  assert.match(recovery[1], /setReopen/);
  assert.match(recovery[1], /errorLatchRef\.current = true/);
  // The reopen is what re-runs the open effect.
  assert.match(mic, /\}, \[active, applyStage, reopen, resetKey, startCapture, teardown\]\)/);
});

test('Live Coach never plays anything into the call', () => {
  for (const source of [readMicSource(), readModalSource()]) {
    assert.doesNotMatch(
      source,
      /createOscillator|createGain|speechSynthesis|new Audio\(|playLiveVoiceCue|\.destination\b/i,
    );
  }
});

test('the coach panel shows a rolling rep transcript', () => {
  const modal = readModalSource();
  assert.doesNotMatch(modal, /utterances\.at\(-1\)/);
  assert.match(modal, /utterances\.slice\(-TRANSCRIPT_WINDOW\)/);
  assert.match(modal, /is-latest/);
  assert.match(modal, /is-recent/);
  assert.match(modal, /scrollTop = feed\.scrollHeight/);
  const css = readFileSync(path.join(repoRoot(), 'src/app/globals.css'), 'utf8');
  assert.match(css, /\.live-coach-feed \{[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.live-coach-said\.is-latest \{/);
});

test('Escape minimizes the coach and never ends the call', () => {
  const modal = readModalSource();
  const handler = modal.match(/if \(event\.key !== "Escape"[\s\S]*?\n {4}\};/);
  assert.ok(handler, 'the Escape handler exists');
  assert.match(handler[0], /onMinimize\(\)/);
  assert.doesNotMatch(handler[0], /endCoach|onEnded/);
  // Ending stays an explicit click on the End control.
  assert.match(modal, /onClick=\{\(\) => void endCoach\(\)\}/);
  // The overlay does not trap the rep.
  assert.doesNotMatch(modal, /aria-modal/);
});

test('coach controls read the live call state, not a stale render', () => {
  const modal = readModalSource();
  assert.match(modal, /resetCallCoach\(viewRef\.current\.state\)/);
  assert.doesNotMatch(modal, /resetCallCoach\(view\.state\)/);
  assert.match(modal, /applyRepUtterance\(viewRef\.current\.state, text\)/);
  assert.match(modal, /await mic\.finish\(\)/);
  assert.match(modal, /formatCoachSummary\(viewRef\.current\.state\)/);
  assert.doesNotMatch(modal, /formatCoachSummary\(view\.state\)/);
});

test('minimizing keeps listening and the next move stays announced', () => {
  const modal = readModalSource();
  assert.match(modal, /useLiveCoachMic\(\{\s*\n\s*active: true/);
  assert.match(modal, /const listening = !muted && mic\.stage !== "paused"/);
  assert.match(modal, /live-coach-line" aria-live="assertive"/);
  const pill = modal.match(/className="live-coach-pill"[\s\S]*?<\/button>/);
  assert.ok(pill, 'the minimized pill exists');
  assert.match(pill[0], /business\.name/);
  assert.match(pill[0], /view\.suggestion\.line/);
});

test('the status line stays honest about who is being heard', () => {
  const modal = readModalSource();
  const block = modal.match(/const status = muted([\s\S]*?);\n/);
  assert.ok(block, 'the status line exists');
  const stageNames = new Set(['connecting', 'listening', 'speaking', 'transcribing', 'paused']);
  const states = [...block[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !stageNames.has(value));
  assert.ok(states.length >= 3);
  for (const state of states) {
    assert.doesNotMatch(state, /\b(?:customer|caller|them|their side|both)\b/i, state);
    assert.doesNotMatch(state, /couldn.t hear|was not captured/i);
  }
});

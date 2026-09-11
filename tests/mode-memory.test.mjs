import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.window = {
  location: { pathname: '/', search: '' },
  sessionStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
  },
};

const {
  MODE_HOME,
  currentModeHref,
  forgetModeLocation,
  modeForPath,
  modeMemorySnapshot,
  modeReturnHref,
  normalizeModeHref,
  rememberModeLocation,
  resetModeMemoryCache,
  subscribeModeMemory,
} = await import('../src/lib/mode-memory.ts');

function reset(seed) {
  store.clear();
  if (seed) store.set('pai.mode-return.v1', JSON.stringify(seed));
  resetModeMemoryCache();
}

test('each mode keeps its own last location and returns to it', () => {
  reset();
  rememberModeLocation('/search?address=120%20Main%20St&radius=0.5');
  rememberModeLocation('/live?session=live_abc');
  const memory = modeMemorySnapshot();
  assert.equal(modeReturnHref(memory, 'normal'), '/search?address=120%20Main%20St&radius=0.5');
  assert.equal(modeReturnHref(memory, 'live'), '/live?session=live_abc');
});

test('a mode with nothing remembered falls back to its home screen', () => {
  reset();
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'normal'), MODE_HOME.normal);
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'live'), MODE_HOME.live);
  rememberModeLocation('/live?session=live_abc');
  // Remembering one side must not disturb the other.
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'normal'), '/');
});

test('the deepest normal-mode page is what you come back to', () => {
  reset();
  rememberModeLocation('/search?address=120%20Main%20St&radius=1');
  rememberModeLocation('/business/osm_123?address=120%20Main%20St&radius=1');
  assert.equal(
    modeReturnHref(modeMemorySnapshot(), 'normal'),
    '/business/osm_123?address=120%20Main%20St&radius=1',
  );
});

test('routes map to the mode that owns them', () => {
  assert.equal(modeForPath('/'), 'normal');
  assert.equal(modeForPath('/search'), 'normal');
  assert.equal(modeForPath('/business/osm_123'), 'normal');
  assert.equal(modeForPath('/live'), 'live');
  assert.equal(modeForPath('/live?session=live_abc'), 'live');
  assert.equal(modeForPath('/radar'), 'live');
});

test('only same-origin paths are ever stored or replayed', () => {
  reset();
  for (const href of ['https://evil.test/live', '//evil.test/live', '/\\evil.test', 'javascript:alert(1)']) {
    assert.equal(normalizeModeHref(href), null);
    rememberModeLocation(href);
  }
  assert.deepEqual(modeMemorySnapshot(), {});
});

test('a stored entry filed under the wrong mode is discarded on read', () => {
  reset({ normal: '/live?session=live_abc', live: '/search?address=x', extra: '/live' });
  assert.deepEqual(modeMemorySnapshot(), {});
});

test('unreadable storage leaves the switch on its home screens', () => {
  reset();
  store.set('pai.mode-return.v1', '{not json');
  resetModeMemoryCache();
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'live'), '/live');
});

test('a pointer that no longer resolves can be dropped', () => {
  reset();
  rememberModeLocation('/live?session=live_gone');
  rememberModeLocation('/search?address=x&radius=1');
  forgetModeLocation('live');
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'live'), '/live');
  assert.equal(modeReturnHref(modeMemorySnapshot(), 'normal'), '/search?address=x&radius=1');
});

test('the snapshot is stable between writes and changes on every write', () => {
  reset();
  const first = modeMemorySnapshot();
  assert.equal(modeMemorySnapshot(), first, 'repeat reads must not re-render the switch');
  rememberModeLocation('/live?session=live_abc');
  assert.notEqual(modeMemorySnapshot(), first);
  const second = modeMemorySnapshot();
  rememberModeLocation('/live?session=live_abc');
  assert.equal(modeMemorySnapshot(), second, 'storing the same path again is not a change');
});

test('subscribers hear about a new location', () => {
  reset();
  let calls = 0;
  const unsubscribe = subscribeModeMemory(() => { calls += 1; });
  rememberModeLocation('/live?session=live_abc');
  assert.equal(calls, 1);
  unsubscribe();
  rememberModeLocation('/search?address=x&radius=1');
  assert.equal(calls, 1);
});

test('the switch records the path the browser is actually showing', () => {
  // LIVE rewrites its own query with replaceState, which the router never sees.
  window.location = { pathname: '/live', search: '?session=live_abc' };
  assert.equal(currentModeHref(), '/live?session=live_abc');
  window.location = { pathname: '/', search: '' };
  assert.equal(currentModeHref(), '/');
});

test('LIVE tells the switch about the chat it swapped in behind the router', () => {
  const source = readFileSync(new URL('../src/components/live-page.tsx', import.meta.url), 'utf8');
  assert.match(source, /window\.history\.replaceState\(null, "", href\);\s*\n\s*rememberModeLocation\(href\);/);
  assert.match(source, /forgetModeLocation\("live"\)/);
});

test('reasoning stays collapsed until the caret is opened', () => {
  const source = readFileSync(new URL('../src/components/live/live-thinking.tsx', import.meta.url), 'utf8');
  assert.match(source, /const \[open, setOpen\] = useState\(false\);/);
  // The panel is the only thing behind the toggle, so `open` must gate it.
  assert.match(source, /\{open && \(/);
  assert.doesNotMatch(source, /useState\(live\)/);
});

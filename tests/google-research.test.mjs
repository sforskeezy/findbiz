import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {searchPublicWeb, publicQueryRelevance} from '../src/lib/google-research-engine.ts';

const realFetch = globalThis.fetch;
const originalEnv = {...process.env};
beforeEach(() => {
  process.env.GOOGLE_SEARCH_API_KEY = '';
  process.env.GOOGLE_MAPS_API_KEY = '';
  process.env.GOOGLE_SEARCH_ENGINE_ID = '';
  process.env.ENABLE_GOOGLE_SEARCH_SCRAPER = 'true';
  process.env.ENABLE_BING_SEARCH_FALLBACK = 'true';
  process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK = 'true';
});
afterEach(() => { globalThis.fetch = realFetch; process.env = {...originalEnv}; });
const bing = (title, url, snippet) => `<li class="b_algo"><h2><a href="${url}">${title}</a></h2><cite>https://example.com</cite><div class="b_caption"><p>${snippet}</p></div></li>`;
const duck = (title, url, snippet) => `<a class="result__a" href="${url}">${title}</a><a class="result__snippet">${snippet}</a>`;

test('blocked Google and unrelated Bing continue to the next index', async () => {
  const hosts = [];
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname; hosts.push(host);
    if (host === 'www.google.com') return new Response('rate limited', {status:429});
    if (host === 'www.bing.com') return new Response(bing('L3Harris Technologies', 'https://example.com/harris', 'Installer services in Lugoff SC'));
    assert.equal(host, 'html.duckduckgo.com');
    return new Response(duck('L3 Installer Services', 'https://example.com/l3', 'Lugoff SC decks and patios'));
  };
  const found = await searchPublicWeb(['L3 Installer Lugoff SC'], {businessName:'L3 Installer', fresh:true});
  assert.deepEqual(hosts, ['www.google.com', 'www.bing.com', 'html.duckduckgo.com']);
  assert.deepEqual(found.results.map(item => item.title), ['L3 Installer Services']);
  assert.equal(found.results[0].provider, 'Keyless web index fallback');
  assert.ok(found.diagnostics.failures.some(message => message.includes('429')));
});

test('each query can fall back independently after another query succeeds', async () => {
  process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK = 'false';
  const hits = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url); hits.push(parsed.hostname + ':' + parsed.searchParams.get('q'));
    if (parsed.hostname === 'www.google.com' && parsed.searchParams.get('q') === 'Acme contact') return new Response('<a href="/url?q=https%3A%2F%2Fexample.com%2Facme%3Fid%3D7"><h3>Acme contact</h3></a><div>Acme contact information and address.</div>');
    if (parsed.hostname === 'www.google.com') return new Response('blocked', {status:429});
    return new Response(bing('Acme owner', 'https://example.com/acme/owner', 'Acme owner details'));
  };
  const found = await searchPublicWeb(['Acme contact', 'Acme owner'], {fresh:true});
  assert.equal(found.results.length, 2);
  assert.ok(found.results.some(item => item.url === 'https://example.com/acme?id=7'), 'Unwrap Google redirect');
  assert.ok(found.results.some(item => item.url === 'https://example.com/acme/owner'), 'Keep actual Bing href, not truncated cite');
  assert.ok(hits.includes('www.bing.com:Acme owner'));
});

test('empty and failed searches are not cached as business nonexistence', async () => {
  process.env.ENABLE_BING_SEARCH_FALLBACK = 'false';
  process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK = 'false';
  let hits = 0;
  globalThis.fetch = async () => { hits++; return new Response('blocked', {status:429}); };
  for (let index = 0; index < 2; index++) {
    const result = await searchPublicWeb(['Uncached test business']);
    assert.equal(result.results.length, 0);
    assert.equal(result.diagnostics.queriesCompleted, 0);
    assert.equal(result.diagnostics.cacheHit, false);
  }
  assert.equal(hits, 2);
});

test('cancelling a lookup aborts its fetch without starting another provider', async () => {
  const controller = new AbortController();
  let hits = 0;
  globalThis.fetch = async (_url, init) => {
    hits++;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true});
      controller.abort();
    });
  };
  await assert.rejects(searchPublicWeb(['Cancel lookup'], {signal:controller.signal}), {name:'AbortError'});
  assert.equal(hits, 1);
});

test('relevance rewards query evidence rather than unrelated publisher authority', () => {
  const unrelated = {query:'L3 Installer Lugoff South Carolina',title:'L3Harris',snippet:'Aerospace technologies',url:'https://example.com'};
  const local = {...unrelated,title:'L3 Installer Services',snippet:'Lugoff deck builder'};
  assert.ok(publicQueryRelevance(local) > publicQueryRelevance(unrelated));
  assert.equal(publicQueryRelevance({...local, query:'site:example.com L3 Installer'}), 1);
});

test('apostrophes in a query still match apostrophe-free titles', () => {
  const result = {
    query: "Anna\u2019s Bakery Greenville, SC",
    title: 'Annas Bakery - Greenville, SC',
    snippet: 'Bakery in Greenville',
    url: 'https://annasbakery.example',
  };
  assert.ok(publicQueryRelevance(result) >= 0.5);
});

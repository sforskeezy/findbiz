import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLES, PROMOTIONS, promotionFit } from '../src/lib/swarm/promotions.ts';

test('the full verified promotion list is present', () => {
  assert.equal(BUNDLES.length, 6);
  assert.equal(PROMOTIONS.length, 8);
  assert.deepEqual(BUNDLES.map((bundle) => bundle.price), [50, 70, 100, 100, 120, 150]);
});

test('offers are marked for the business’s specific needs, not for Internet alone', () => {
  const crew = promotionFit(['internet', 'mobile', 'voice']);
  assert.equal(crew.topBundle.name, '500 Mbps Internet + Mobile');
  assert.deepEqual(crew.bundles.filter((bundle) => bundle.fit).map((bundle) => bundle.name), ['500 Mbps Internet + Mobile', 'Gig Internet + Mobile']);
  assert.ok(crew.promotions.find((promotion) => promotion.title.startsWith('Mobile phone-balance buyout')).fit);
  assert.equal(crew.promotions.find((promotion) => promotion.title.startsWith('Business contract buyout')).fit, false);

  const internetOnly = promotionFit(['internet']);
  assert.equal(internetOnly.topBundle.price, 50);
  assert.ok(internetOnly.bundles.every((bundle) => !bundle.fit));

  assert.equal(promotionFit([]).topBundle, null);
});

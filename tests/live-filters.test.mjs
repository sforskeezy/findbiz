import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProspectsForBrief, searchRelevance } from '../src/lib/live/filters.ts';

test('plumber search includes plumbing and rejects unrelated nearby businesses', () => {
  assert.ok(searchRelevance({name:'Example Plumbing', publicNotes:'Plumbing service'}, ['plumber']) > 0);
  assert.equal(searchRelevance({name:'Example Law', publicNotes:'Legal services'}, ['plumber']), 0);
});

test('broad medical category alone does not make a clinic a dentist', () => {
  assert.equal(searchRelevance({name:'Example Urgent Care', category:'Medical & dental', publicNotes:'Walk-in clinic'}, ['dentist']), 0);
  assert.ok(searchRelevance({name:'Example Dental', publicNotes:null}, ['dentist']) > 0);
});

test('landscaping and lawncare variants match public listing evidence', () => {
  assert.ok(searchRelevance({name:'Example Landscaping', publicNotes:null}, ['landscaper']) > 0);
  assert.ok(searchRelevance({name:'Example Lawncare', publicNotes:null}, ['lawn care service']) > 0);
});


test('an empty trade match stays empty instead of falling back to unrelated leads', () => {
  const result = filterProspectsForBrief([{name:'Example Law', publicNotes:'Legal services', category:'Legal & accounting', score:99}], {profile:'any', excludeNational:true, searchTerms:['plumber']});
  assert.deepEqual(result.kept, []);
});

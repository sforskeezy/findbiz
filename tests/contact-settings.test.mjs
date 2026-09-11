import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPhone, phoneCopyValue, normalizePhonesForCopy } from '../src/lib/phone.ts';
import { parseVoiceKey, matchesVoiceShortcut } from '../src/lib/voice-shortcut.ts';
import { sameLiveBusiness, clampRadius } from '../src/lib/live/tools.ts';

test('phone display stays readable and copies only digits', () => {
  assert.equal(displayPhone('(888) 555-0199'), '888-555-0199');
  assert.equal(phoneCopyValue('(888) 555-0199'), '8885550199');
  assert.equal(phoneCopyValue('+1 (888) 555-0199'), '18885550199');
  assert.equal(normalizePhonesForCopy('Call (888) 555-0199 or 888-555-0123. At 123 Main St.'), 'Call 8885550199 or 8885550123. At 123 Main St.');
});
test('voice defaults to Tab and never captures copy/paste modifier combinations', () => {
  assert.equal(parseVoiceKey(null), 'Tab');
  assert.equal(parseVoiceKey('Control'), 'Tab');
  const key = {key:'Tab',code:'Tab',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false};
  assert.equal(matchesVoiceShortcut(key, 'Tab'), true);
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey','isComposing']) assert.equal(matchesVoiceShortcut({...key,[modifier]:true},'Tab'),false);
  for (const name of ['Control','c','v']) assert.equal(matchesVoiceShortcut({...key,key:name,ctrlKey:true},'Tab'),false);
  assert.equal(matchesVoiceShortcut(key,'None'),false);
});
test('dedupe handles changed provider ids and formatted phones but keeps separate branches', () => {
  const a = {id:'a',name:'Example Plumbing',phone:'(888) 555-0199',address:'10 Main St'};
  assert.equal(sameLiveBusiness(a,{...a,id:'b',phone:'+1 8885550199'}),true);
  assert.equal(sameLiveBusiness(a,{...a,id:'b',address:'12 Main St',phone:'8885550100'}),false);
  assert.equal(clampRadius(3),3);
  assert.equal(clampRadius(5),5);
});

test('care and Carolina are not automotive category matches', async () => {
  const { normalizeCategory } = await import('../src/lib/place-candidate.ts');
  assert.equal(normalizeCategory('Just Like Family Lawn Care and Handyman Service'),'Construction');
  assert.equal(normalizeCategory('Carolina Landscaping Unlimited'),'Construction');
  assert.equal(normalizeCategory("God's Heritage Child Care"),'Education & childcare');
  assert.equal(normalizeCategory('Car repair'),'Automotive');
});

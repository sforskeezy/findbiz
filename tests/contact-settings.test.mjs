import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPhone, phoneCopyValue, normalizePhonesForCopy } from '../src/lib/phone.ts';
import { readFileSync } from 'node:fs';
import { parseVoiceKey, matchesVoiceShortcut, voiceKeyFromEvent, voiceKeyLabel } from '../src/lib/voice-shortcut.ts';
import { sameLiveBusiness, clampRadius } from '../src/lib/live/tools.ts';

test('phone display stays readable and copies only digits', () => {
  assert.equal(displayPhone('(888) 555-0199'), '888-555-0199');
  assert.equal(phoneCopyValue('(888) 555-0199'), '8885550199');
  assert.equal(phoneCopyValue('+1 (888) 555-0199'), '18885550199');
  assert.equal(normalizePhonesForCopy('Call (888) 555-0199 or 888-555-0123. At 123 Main St.'), 'Call 8885550199 or 8885550123. At 123 Main St.');
});
test('voice defaults to Tab and never captures copy/paste modifier combinations', () => {
  assert.equal(parseVoiceKey(null), 'Tab');
  assert.equal(parseVoiceKey('Shift'), 'Tab');
  assert.equal(parseVoiceKey('not a real key'), 'Tab');
  const key = {key:'Tab',code:'Tab',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false};
  assert.equal(matchesVoiceShortcut(key, 'Tab'), true);
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey','isComposing']) assert.equal(matchesVoiceShortcut({...key,[modifier]:true},'Tab'),false);
  for (const name of ['Control','c','v']) assert.equal(matchesVoiceShortcut({...key,key:name,ctrlKey:true},'Tab'),false);
  assert.equal(matchesVoiceShortcut(key,'None'),false);
});

test('a custom key can be captured and bound, Ctrl included', () => {
  assert.equal(voiceKeyFromEvent({key:'Control',code:'ControlLeft'}), 'Control');
  assert.equal(voiceKeyFromEvent({key:'Control',code:'ControlRight'}), 'Control');
  assert.equal(voiceKeyFromEvent({key:'j',code:'KeyJ'}), 'KeyJ');
  assert.equal(voiceKeyFromEvent({key:'F9',code:'F9'}), 'F9');
  assert.equal(parseVoiceKey('KeyJ'), 'KeyJ');
  assert.equal(parseVoiceKey('Control'), 'Control');
  for (const reserved of [{key:'Escape',code:'Escape'},{key:'Enter',code:'Enter'},{key:' ',code:'Space'},{key:'Shift',code:'ShiftLeft'}]) {
    assert.equal(voiceKeyFromEvent(reserved), null);
  }
});

test('a bound modifier opens the mic but still yields to real shortcuts', () => {
  const ctrl = {key:'Control',code:'ControlLeft',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,isComposing:false};
  assert.equal(matchesVoiceShortcut(ctrl,'Control'), true);
  // Ctrl+C, Ctrl+V and Ctrl+Shift+anything stay with the browser.
  for (const letter of ['c','v','a']) assert.equal(matchesVoiceShortcut({...ctrl,key:letter,code:`Key${letter.toUpperCase()}`},'Control'), false);
  assert.equal(matchesVoiceShortcut({...ctrl,shiftKey:true},'Control'), false);
  assert.equal(matchesVoiceShortcut({...ctrl,metaKey:true},'Control'), false);
});

test('a custom letter key matches by physical code and not as a modifier combo', () => {
  const j = {key:'j',code:'KeyJ',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false};
  assert.equal(matchesVoiceShortcut(j,'KeyJ'), true);
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) assert.equal(matchesVoiceShortcut({...j,[modifier]:true},'KeyJ'), false);
  assert.equal(matchesVoiceShortcut({...j,key:'k',code:'KeyK'},'KeyJ'), false);
});

test('every binding renders a readable label', () => {
  assert.equal(voiceKeyLabel('Control'), 'Ctrl');
  assert.equal(voiceKeyLabel('Backquote'), '`');
  assert.equal(voiceKeyLabel('None'), 'Off');
  assert.equal(voiceKeyLabel('KeyJ'), 'J');
  assert.equal(voiceKeyLabel('Digit5'), '5');
  assert.equal(voiceKeyLabel('F9'), 'F9');
  assert.equal(voiceKeyLabel('BracketLeft'), 'Bracket Left');
});

test('holding the voice key releases it the moment another key joins', () => {
  const source = readFileSync(new URL('../src/components/live/use-live-voice.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(holdLiveRef\.current\) controlIsShortcutRef\.current = true;/);
  assert.match(source, /if \(!isModifierVoiceKey\(voiceKey\)\) event\.preventDefault\(\);/);
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

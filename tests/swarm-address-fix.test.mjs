import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixAddresses, sortAddresses } from '../src/lib/swarm/address-fix.ts';
import { parseAddressBatch } from '../src/lib/swarm/logic.ts';
import { gisServiceabilityUrl } from '../src/lib/swarm/lookup-links.ts';

const prism = readFileSync(new URL('./fixtures/prism-export.txt', import.meta.url), 'utf8');

test('address fix pulls one address per PRISM row out of the plant columns', () => {
  assert.deepEqual(fixAddresses(prism), [
    '3099 Carters Road, Lockport, KY 40036',
    '1415 Carters Road, Lockport, KY 40036',
    '4476 Harpers Ferry Road, Lockport, KY 40036',
    '2189 Harpers Ferry Road Rear 1, Lockport, KY 40036',
    '2189 Harpers Ferry Road, Lockport, KY 40036',
    '1743 Albert Moore Road, Lockport, KY 40036',
    '1478 Harpers Ferry Road, Lockport, KY 40036',
  ]);
});

test('PRISM rows still parse when the copy turned tabs into spaces', () => {
  assert.deepEqual(fixAddresses(prism.replaceAll('\t', '  ')).length, 7);
});

test('address order groups each street and sorts house numbers low to high', () => {
  assert.deepEqual(sortAddresses(fixAddresses(prism)), [
    '1743 Albert Moore Road, Lockport, KY 40036',
    '1415 Carters Road, Lockport, KY 40036',
    '3099 Carters Road, Lockport, KY 40036',
    '1478 Harpers Ferry Road, Lockport, KY 40036',
    '2189 Harpers Ferry Road, Lockport, KY 40036',
    '2189 Harpers Ferry Road Rear 1, Lockport, KY 40036',
    '4476 Harpers Ferry Road, Lockport, KY 40036',
  ]);
});

test('PROD link routes the full address and ZIP the way the tool does', () => {
  assert.equal(gisServiceabilityUrl('616 Columbia Rd, Winnsboro, SC 29180, USA'), 'https://gis.corp.chartercom.com/chartercommserv/pages/serviceability.jsp?address=616+Columbia+Rd%2C+Winnsboro%2C+SC+29180&city=&state=&zip=29180');
});

test('address fix pulls addresses out of scattered PRISM-style junk', () => {
  const copied = [
    '123 MAIN STREET',
    '@#*$',
    'Albertville Alabama',
    '$*@($ S:WKF',
    'ACCT 99812 | OPEN',
    '',
    '46 carina lane lugoff sc 29078',
    '!!',
    '2001 BARDSTOWN RD APT 4 ##',
    '*&^ 88 ::',
    'LOUISVILLE, KY 40205',
    'STATUS: LOGGED',
  ].join('\n');
  assert.deepEqual(fixAddresses(copied), [
    '123 Main Street, Albertville, AL',
    '46 Carina Lane, Lugoff, SC 29078',
    '2001 Bardstown Rd Apt 4, Louisville, KY 40205',
  ]);
});

test('address fix finds a city on its own line and a ZIP on the next', () => {
  assert.deepEqual(fixAddresses('500 N Harden St\n%%\nColumbia\nSC\n29201\nxx'), ['500 N Harden St, Columbia, SC 29201']);
});

test('address fix skips numbers that are not addresses and removes duplicates', () => {
  const copied = '30 DAYS PAST DUE\nno location here\n803-555-1234\n12 Oak Ct\nCamden SC 29020\n12 OAK CT\nCAMDEN, SC 29020';
  assert.deepEqual(fixAddresses(copied), ['12 Oak Ct, Camden, SC 29020']);
});

test('fixed addresses pass Swarm validation', () => {
  const lines = fixAddresses('77 KING ST\n&&&\nCHARLESTON SOUTH CAROLINA 29401\n9 Elm Dr\n**\nAiken, SC');
  const parsed = parseAddressBatch(lines.join('\n'));
  assert.equal(parsed.addresses.length, 2);
  assert.equal(parsed.invalid.length, 0);
});

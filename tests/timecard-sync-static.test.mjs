import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../timecard-store.js', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../timecard-sync.js', import.meta.url), 'utf8');

test('the application and sync scripts parse', () => {
  const inlineScripts = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inlineScripts.length, 1);
  assert.doesNotThrow(() => new Function(inlineScripts[0][1]));
  assert.doesNotThrow(() => new Function(store));
  assert.doesNotThrow(() => new Function(sync));
});

test('the page loads one strict store, one public client, and one Timecard adapter client', () => {
  assert.equal((index.match(/timecard-store\.js\?v=1/g) || []).length, 1);
  assert.equal((index.match(/ryan-app-sync\.js/g) || []).length, 1);
  assert.equal((index.match(/timecard-sync\.js\?v=1/g) || []).length, 1);
  assert.match(
    index,
    /https:\/\/ryan-app-sync\.ryan-666-mp3\.chatgpt\.site\/ryan-app-sync\.js/
  );
  assert.equal(index.includes('durable-storage'), false);
  assert.equal(index.includes('shared-state'), false);
});

test('only the two audited fixed Timecard records are registered', () => {
  assert.equal((sync.match(/client\.register\(/g) || []).length, 2);
  assert.match(sync, /collection: 'timecards',\s+recordId: 'current',\s+schemaVersion: 1/);
  assert.match(sync, /collection: 'preferences',\s+recordId: 'view',\s+schemaVersion: 1/);
  assert.equal((sync.match(/scope: APP_ID/g) || []).length, 2);
  assert.equal((sync.match(/appId: APP_ID/g) || []).length, 4);
  assert.equal(sync.includes('registerGlobalTheme'), false);
  assert.equal(sync.includes("scope: 'global'"), false);
  assert.equal(sync.includes('theme'), false);
});

test('local writes are locked, source-tagged, and never patch native Storage', () => {
  assert.match(store, /LOCK_NAME = 'timecard-validator:local-state-v1'/);
  assert.match(store, /navigator\.locks\.request\(LOCK_NAME, \{ mode: 'exclusive' \}/);
  assert.match(index, /timecardStore\.write\(collectState\(\), \{ source: 'local' \}\)/);
  assert.match(sync, /detail\.source !== 'local'/);
  assert.equal(`${index}\n${store}\n${sync}`.includes('Storage.prototype'), false);
  assert.equal(`${index}\n${store}\n${sync}`.includes('localStorage.clear'), false);
  assert.equal(`${index}\n${store}\n${sync}`.includes('localStorage.removeItem'), false);
});

test('corrupt startup is fail-closed and the exact raw-value backup remains available', () => {
  assert.match(index, /const inspected = timecardStore\.inspect\(\);/);
  assert.match(index, /if \(inspected\.status !== 'valid'\) return false;/);
  assert.match(store, /const previousRaw = root\.localStorage\.getItem\(STORAGE_KEY\);/);
  assert.match(store, /const previous = parseRaw\(previousRaw\);/);
  assert.match(store, /raw_value: raw/);
  assert.match(sync, /store\.rawBackup\(\)/);
  assert.match(sync, /Raw local backup remains available/);
});

test('migration requires a downloaded backup, a zero-write preview, and explicit choices', () => {
  assert.match(sync, /downloadRawBackup\(\);\s+await ready;\s+const result = await client\.previewMigration/);
  assert.match(sync, /sourceKey: 'timecard-validator-browser-v1'/);
  assert.match(sync, /previewResult\.preview\.writesPerformed !== 0/);
  assert.match(sync, /select\[data-record-key\]/);
  assert.match(sync, /client\.applyMigration\(previewResult\.plan, resolutions\)/);
  assert.match(sync, /Preview confirmed: 0 writes performed\./);
  assert.match(sync, /previewResult\.preview\.remoteCount > 0/);
  assert.match(sync, /First-device migration is blocked because synchronized Timecard data already exists/);
});

test('remote changes defer while a date or time editor has focus', () => {
  assert.match(index, /function hasActiveTimecardEditor\(\)/);
  assert.match(index, /active === document\.getElementById\('weekStart'\)/);
  assert.match(index, /active\.matches\('input\[type="time"\]'\)/);
  assert.match(index, /pendingExternalState = state/);
  assert.match(index, /if \(detail\.source === 'local'\) \{\s+pendingExternalState = null;/);
  assert.match(index, /setTimeout\(flushPendingExternalState, 0\)/);
});

test('disconnect, conflict handling, and device reset remain explicit', () => {
  assert.match(sync, /client\.disconnect\(\)/);
  assert.match(sync, /client\.listConflicts\(\)/);
  assert.match(sync, /client\.resolveConflict\(item\.recordKey/);
  assert.match(sync, /client\.resetDevice\(\)/);
  assert.match(sync, /Local Timecard data was preserved/);
});

test('existing Timecard limits and rules remain intact', () => {
  assert.match(index, /const maxPeriods = 3;/);
  assert.match(index, /const maxWeeks = 4;/);
  assert.match(index, /const days = \['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'\];/);
  assert.match(index, /weeklyTotal > 40/);
  assert.match(index, /dailyTotal > 8/);
  assert.match(index, /workedDays === 7/);
  assert.match(index, /dailyMinutes > 360/);
  assert.match(index, /dailyMinutes >= 330/);
});

test('documentation says local-first and describes the opt-in upload gate', () => {
  assert.match(readme, /saved automatically in this browser/);
  assert.match(readme, /optionally connect App Sync/);
  assert.match(readme, /uploaded only after Ryan connects App Sync/);
  assert.match(readme, /zero-write migration preview/);
  assert.equal(readme.includes('No entered schedule data is uploaded or stored.'), false);
});

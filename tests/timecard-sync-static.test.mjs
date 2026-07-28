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

test('current mode registers two records and legacy mode registers only its recovery record', () => {
  assert.equal((sync.match(/client\.register\(/g) || []).length, 3);
  assert.match(sync, /collection: 'timecards',\s+recordId: 'current',\s+schemaVersion: 1/);
  assert.match(sync, /collection: 'preferences',\s+recordId: 'view',\s+schemaVersion: 1/);
  assert.match(sync, /collection: 'recovery',\s+recordId: 'manual-break-v1',\s+schemaVersion: 1/);
  assert.match(
    sync,
    /if \(recoveryMode\) {\s+await client\.register\(recoveryAdapter\);\s+} else {\s+workspaceHandle = await client\.register\(workspaceAdapter\);\s+viewHandle = await client\.register\(viewAdapter\);/
  );
  assert.equal((sync.match(/scope: APP_ID/g) || []).length, 3);
  assert.equal((sync.match(/appId: APP_ID/g) || []).length, 5);
  assert.equal(sync.includes('registerGlobalTheme'), false);
  assert.equal(sync.includes("scope: 'global'"), false);
  assert.equal(sync.includes('theme'), false);
});

test('legacy recovery is read-only toward browser storage and rejects remote application', () => {
  const recoveryBlock = sync.slice(
    sync.indexOf('const recoveryAdapter ='),
    sync.indexOf('const invalidatePreview =')
  );
  assert.match(recoveryBlock, /validate: value => store\.isLegacyState\(value\)/);
  assert.match(recoveryBlock, /readLocal: \(\) => store\.readLegacy\(\) \|\| undefined/);
  assert.match(recoveryBlock, /JSON\.stringify\(local\) !== JSON\.stringify\(value\)/);
  assert.match(recoveryBlock, /Synchronized manual-break recovery data cannot be applied/);
  assert.equal(recoveryBlock.includes('localStorage'), false);
  assert.equal(recoveryBlock.includes('store.write'), false);
  assert.equal(recoveryBlock.includes('store.apply'), false);
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
  assert.match(index, /if \(!inspected \|\| inspected\.status !== 'legacy'\) {\s+document\.getElementById\('todayBtn'\)\.click\(\);/);
});

test('migration requires a downloaded backup, a zero-write preview, and explicit choices', () => {
  assert.match(sync, /downloadRawBackup\(\);\s+await ready;\s+const result = await client\.previewMigration/);
  assert.match(sync, /'timecard-validator-manual-break-recovery-v1'/);
  assert.match(sync, /'timecard-validator-browser-v1'/);
  assert.match(sync, /sourceKey: SOURCE_KEY/);
  assert.match(sync, /previewResult\.preview\.writesPerformed !== 0/);
  assert.match(sync, /select\[data-record-key\]/);
  assert.match(sync, /client\.applyMigration\(previewResult\.plan, resolutions\)/);
  assert.match(sync, /Preview confirmed: 0 writes performed\./);
  assert.match(sync, /previewResult\.preview\.remoteCount > 0/);
  assert.match(sync, /First-device migration is blocked because synchronized Timecard data already exists/);
});

test('legacy recovery fails closed on all existing remote data', () => {
  assert.match(sync, /if \(recoveryMode && item\.remoteRevision > 0\)/);
  assert.match(sync, /Synchronized recovery data cannot be applied over this local legacy record/);
  assert.match(sync, /if \(!recoveryMode && item\.current && !item\.current\.deleted\)/);
  assert.match(sync, /Recovery upload is blocked because synchronized recovery data already exists/);
  assert.match(sync, /previewResult\.preview\.remoteCount > 0/);
  assert.match(sync, /previewResult\.preview\.orphanedCount > 0/);
  assert.match(sync, /Recovery is blocked by preserved metadata from another Timecard adapter/);
});

test('legacy UI labels recovery clearly and keeps current sync unavailable', () => {
  assert.match(sync, /Legacy manual-break data is preserved unchanged for recovery/);
  assert.match(sync, /Current Timecard sync remains unavailable until it is resolved separately/);
  assert.match(sync, /openButton\.textContent = recoveryMode \? 'Recovery & backup'/);
  assert.match(sync, /mode: recoveryMode \? 'manual-break-recovery' : 'current'/);
  assert.match(sync, /const MANIFEST_VERSION = recoveryMode \? 2 : 1/);
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

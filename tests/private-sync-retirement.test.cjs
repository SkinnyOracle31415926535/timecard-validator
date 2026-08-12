const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { test } = require('node:test');

const index = readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const runtime = readFileSync(new URL('../automatic-app-sync.js', `file://${__filename}`), 'utf8');
const store = readFileSync(new URL('../timecard-store.js', `file://${__filename}`), 'utf8');
const storage = readFileSync(new URL('../timecard-automatic-storage.js', `file://${__filename}`), 'utf8');

test('Timecard Validator uses automatic sync without a transfer or private-sync control', () => {
  assert.match(index, /timecard-automatic-storage\.js/);
  assert.match(index, /automatic-app-sync\.js/);
  assert.match(index, /AutomaticAppSync\.install/);
  assert.doesNotMatch(index, /timecard-semantic-storage\.js|semantic-app-sync\.js|SemanticAppSync|\/api\/app-sync|temporary-data-transfer\.js|TemporaryDataTransfer|transfer-theme\.js|ryan-semantic-sync/);
  assert.match(index, /timecardStore\.changeEvent/);
  assert.doesNotMatch(runtime, /createElement|showModal|<dialog|ryan-semantic-sync|private sync/i);
  assert.match(store, /workspaceValue|viewValue|applyWorkspace|applyView/);
  assert.match(storage, /makeAdapters|attachHandles/);
  assert.equal(existsSync(new URL('../timecard-semantic-storage.js', `file://${__filename}`)), false);
  assert.equal(existsSync(new URL('../semantic-app-sync.js', `file://${__filename}`)), false);
  assert.equal(existsSync(new URL('../temporary-data-transfer.js', `file://${__filename}`)), false);
  assert.equal(existsSync(new URL('../transfer-theme.js', `file://${__filename}`)), false);
});

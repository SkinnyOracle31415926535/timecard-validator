const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { test } = require('node:test');

const index = readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const store = readFileSync(new URL('../timecard-store.js', `file://${__filename}`), 'utf8');
const transferTheme = readFileSync(new URL('../transfer-theme.js', `file://${__filename}`), 'utf8');
const temporaryTransfer = readFileSync(new URL('../temporary-data-transfer.js', `file://${__filename}`), 'utf8');

test('Timecard Validator no longer ships the retired private-sync client', () => {
  assert.doesNotMatch(index, /timecard-semantic-storage\.js|semantic-app-sync\.js|SemanticAppSync|\/api\/app-sync/);
  assert.match(index, /timecardStore\.changeEvent/);
  assert.doesNotMatch(store, /workspaceValue|viewValue|applyWorkspace|applyView|makeAdapters|attachHandles|semantic/i);
  assert.doesNotMatch(transferTheme, /ryan-semantic-sync|ryan-transfer-sync|ryan-transfer-conflict/);
  assert.doesNotMatch(temporaryTransfer, /\/api\/app-sync|private device sync|private sync/i);
  assert.equal(existsSync(new URL('../timecard-semantic-storage.js', `file://${__filename}`)), false);
  assert.equal(existsSync(new URL('../semantic-app-sync.js', `file://${__filename}`)), false);
});

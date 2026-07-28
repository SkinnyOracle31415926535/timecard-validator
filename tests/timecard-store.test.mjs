import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../timecard-store.js', import.meta.url), 'utf8');

class FakeStorage {
  constructor(raw) {
    this.values = new Map();
    this.getCalls = [];
    this.setCalls = [];
    if (raw !== undefined) this.values.set('timecard-validator-v1', raw);
  }

  getItem(key) {
    this.getCalls.push(key);
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.setCalls.push([key, String(value)]);
    this.values.set(key, String(value));
  }
}

class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}

function loadStore(raw) {
  const listeners = new Map();
  const storage = new FakeStorage(raw);
  const lockCalls = [];
  const window = {
    localStorage: storage,
    navigator: {
      locks: {
        async request(name, options, callback) {
          lockCalls.push([name, options]);
          return callback();
        },
      },
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
  };
  const context = vm.createContext({
    CustomEvent: FakeCustomEvent,
    window,
  });
  vm.runInContext(source, context, { filename: 'timecard-store.js' });
  return {
    dispatch: event => window.dispatchEvent(event),
    listen: (type, callback) => window.addEventListener(type, callback),
    lockCalls,
    storage,
    store: window.TimecardStore,
  };
}

const jsonClone = value => JSON.parse(JSON.stringify(value));

test('default state and both fixed adapter values use the strict version-1 schema', () => {
  const { store } = loadStore();
  const state = store.defaultState('2026-07-25');

  assert.equal(store.isState(state), true);
  assert.equal(state.version, 1);
  assert.equal(state.weekStart, '2026-07-25');
  assert.equal(state.visibleWeekCount, 1);
  assert.equal(state.weeks.length, 4);
  assert.equal(state.weeks.every(week => week.days.length === 7), true);
  assert.equal(
    state.weeks.every(week => week.days.every(day => day.periods.length === 1)),
    true
  );
  assert.deepEqual(Object.keys(store.workspaceValue(state)).sort(), ['weekStart', 'weeks']);
  assert.deepEqual(jsonClone(store.viewValue(state)), { visibleWeekCount: 1 });
});

test('strict validation rejects malformed, expanded, and semantically invalid states', () => {
  const { store } = loadStore();
  const cases = [];

  const wrongVersion = store.defaultState('2026-07-25');
  wrongVersion.version = 2;
  cases.push(wrongVersion);

  const extraRootKey = store.defaultState('2026-07-25');
  extraRootKey.theme = 'green';
  cases.push(extraRootKey);

  const nonSaturday = store.defaultState('2026-07-25');
  nonSaturday.weekStart = '2026-07-26';
  cases.push(nonSaturday);

  const impossibleDate = store.defaultState('2026-07-25');
  impossibleDate.weekStart = '2026-02-31';
  cases.push(impossibleDate);

  const wrongWeekCount = store.defaultState('2026-07-25');
  wrongWeekCount.weeks.pop();
  cases.push(wrongWeekCount);

  const wrongDayCount = store.defaultState('2026-07-25');
  wrongDayCount.weeks[0].days.pop();
  cases.push(wrongDayCount);

  const noPeriods = store.defaultState('2026-07-25');
  noPeriods.weeks[0].days[0].periods = [];
  cases.push(noPeriods);

  const tooManyPeriods = store.defaultState('2026-07-25');
  tooManyPeriods.weeks[0].days[0].periods = Array.from(
    { length: 4 },
    () => ({ start: '', end: '' })
  );
  cases.push(tooManyPeriods);

  const invalidTime = store.defaultState('2026-07-25');
  invalidTime.weeks[0].days[0].periods[0].start = '24:00';
  cases.push(invalidTime);

  const extraPeriodKey = store.defaultState('2026-07-25');
  extraPeriodKey.weeks[0].days[0].periods[0].note = 'no';
  cases.push(extraPeriodKey);

  const invalidVisibleCount = store.defaultState('2026-07-25');
  invalidVisibleCount.visibleWeekCount = 0;
  cases.push(invalidVisibleCount);

  for (const candidate of cases) assert.equal(store.isState(candidate), false);
  assert.equal(store.isWorkspaceValue({ weekStart: '2026-07-25', weeks: [] }), false);
  assert.equal(store.isViewValue({ visibleWeekCount: 1, extra: true }), false);
});

test('invalid-state diagnostics identify only structure, type, or range failures', () => {
  const makeState = () => loadStore().store.defaultState('2026-07-25');
  const diagnosticFor = candidate => {
    const raw = JSON.stringify(candidate);
    const { storage, store } = loadStore(raw);
    const inspected = store.inspect();
    assert.equal(inspected.status, 'invalid');
    assert.equal(storage.values.get(store.storageKey), raw);
    assert.equal(storage.setCalls.length, 0);
    return inspected.error.message;
  };

  const wrongVersion = makeState();
  wrongVersion.version = 999;
  const versionMessage = diagnosticFor(wrongVersion);
  assert.match(versionMessage, /Reason: version must be 1\./);
  assert.equal(versionMessage.includes('999'), false);

  const wrongWeekCount = makeState();
  wrongWeekCount.weeks.pop();
  assert.match(
    diagnosticFor(wrongWeekCount),
    /Reason: weeks must be an array with exactly 4 entries\./
  );

  const privateExtraField = makeState();
  privateExtraField.private_saved_note = 'do not reveal this';
  const fieldsMessage = diagnosticFor(privateExtraField);
  assert.match(fieldsMessage, /Reason: the root fields must be exactly/);
  assert.equal(fieldsMessage.includes('private_saved_note'), false);
  assert.equal(fieldsMessage.includes('do not reveal this'), false);

  const invalidSavedTime = makeState();
  invalidSavedTime.weeks[0].days[0].periods[0].start = 'PRIVATE-TIME-VALUE';
  const timeMessage = diagnosticFor(invalidSavedTime);
  assert.match(
    timeMessage,
    /Reason: week 1, day 1, period 1 times must be empty or use 24-hour HH:MM format\./
  );
  assert.equal(timeMessage.includes('PRIVATE-TIME-VALUE'), false);
});

test('invalid JSON is preserved byte-for-byte and cannot be overwritten', async () => {
  const corruptRaw = '{"version":1';
  const { storage, store } = loadStore(corruptRaw);

  const inspected = store.inspect();
  assert.equal(inspected.status, 'invalid');
  assert.equal(inspected.raw, corruptRaw);
  await assert.rejects(
    store.write(store.defaultState('2026-07-25'), { source: 'local' }),
    /not valid JSON/
  );
  assert.equal(storage.values.get(store.storageKey), corruptRaw);
  assert.equal(storage.setCalls.length, 0);
});

test('wrong-shape JSON is preserved byte-for-byte and cannot be overwritten', async () => {
  const wrongShapeRaw = '{"version":1,"weekStart":"2026-07-25","weeks":[]}';
  const { storage, store } = loadStore(wrongShapeRaw);

  await assert.rejects(
    store.write(store.defaultState('2026-07-25'), { source: 'local' }),
    /invalid format/
  );
  assert.equal(storage.values.get(store.storageKey), wrongShapeRaw);
  assert.equal(storage.setCalls.length, 0);
});

test('a first local write changes only the owned key and publishes source-tagged facets', async () => {
  const { listen, lockCalls, storage, store } = loadStore();
  const changes = [];
  listen(store.changeEvent, event => changes.push(event.detail));

  const state = store.defaultState('2026-07-25');
  await store.write(state, { source: 'local' });

  assert.deepEqual(storage.setCalls, [[store.storageKey, JSON.stringify(state)]]);
  assert.deepEqual([...storage.values.keys()], [store.storageKey]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].source, 'local');
  assert.deepEqual(jsonClone(changes[0].changed), ['workspace', 'view']);
  assert.equal(store.isState(changes[0].state), true);
  assert.deepEqual(jsonClone(lockCalls), [[store.lockName, { mode: 'exclusive' }]]);
});

test('the local save stays committed if downstream sync staging fails', async () => {
  const { listen, storage, store } = loadStore();
  listen(store.changeEvent, event => {
    event.detail.waitUntil(Promise.reject(new Error('sync unavailable')));
  });
  const state = store.defaultState('2026-07-25');

  await assert.rejects(
    store.write(state, { source: 'local' }),
    error => error.message === 'sync unavailable' && error.localSaved === true
  );
  assert.equal(storage.values.get(store.storageKey), JSON.stringify(state));
});

test('workspace and view adapters preserve the other half of the aggregate state', async () => {
  const { store } = loadStore();
  const original = store.defaultState('2026-07-25');
  original.visibleWeekCount = 3;
  original.weeks[0].days[0].periods[0].start = '09:00';
  original.weeks[0].days[0].periods[0].end = '12:00';
  await store.write(original);

  const remoteWorkspace = store.workspaceValue(original);
  remoteWorkspace.weekStart = '2026-08-01';
  remoteWorkspace.weeks[0].days[0].periods[0].start = '10:00';
  remoteWorkspace.weeks[0].days[0].periods[0].end = '13:00';
  await store.applyWorkspace(remoteWorkspace, { source: 'sync' });

  let saved = store.read();
  assert.equal(saved.visibleWeekCount, 3);
  assert.equal(saved.weekStart, '2026-08-01');
  assert.deepEqual(
    jsonClone(saved.weeks[0].days[0].periods[0]),
    { start: '10:00', end: '13:00' }
  );

  const workspaceBeforeView = store.workspaceValue(saved);
  const remoteView = store.viewValue(saved);
  remoteView.visibleWeekCount = 2;
  await store.applyView(remoteView, { source: 'sync' });
  saved = store.read();
  assert.equal(saved.visibleWeekCount, 2);
  assert.deepEqual(jsonClone(store.workspaceValue(saved)), jsonClone(workspaceBeforeView));
});

test('fixed records reject synchronized deletion without changing local bytes', async () => {
  const { storage, store } = loadStore();
  const state = store.defaultState('2026-07-25');
  await store.write(state);
  const rawBefore = storage.values.get(store.storageKey);

  assert.throws(
    () => store.applyWorkspace(store.workspaceValue(state), { source: 'sync', deleted: true }),
    /cannot be deleted/
  );
  assert.throws(
    () => store.applyView(store.viewValue(state), { source: 'sync', deleted: true }),
    /cannot be deleted/
  );
  assert.equal(storage.values.get(store.storageKey), rawBefore);
});

test('raw backup contains the exact owned browser value and no storage scan', () => {
  const raw = '{"not":"validated on export","spacing": true}';
  const { storage, store } = loadStore(raw);
  const backup = store.rawBackup();

  assert.equal(backup.kind, 'timecard_validator_browser_local_raw_backup');
  assert.equal(backup.app_id, 'timecard-validator');
  assert.deepEqual(jsonClone(backup.records), [{
    key: 'timecard-validator-v1',
    present: true,
    raw_value: raw,
  }]);
  assert.deepEqual(storage.getCalls, ['timecard-validator-v1']);
  assert.equal('length' in storage, false);
  assert.equal('key' in storage, false);
});

test('valid cross-tab state is source-tagged and invalid cross-tab state never renders', () => {
  const { dispatch, listen, store } = loadStore();
  const changes = [];
  const errors = [];
  listen(store.changeEvent, event => changes.push(event.detail));
  listen(store.errorEvent, event => errors.push(event.detail.message));
  const state = store.defaultState('2026-07-25');

  dispatch({
    type: 'storage',
    key: store.storageKey,
    oldValue: null,
    newValue: JSON.stringify(state),
  });
  dispatch({
    type: 'storage',
    key: store.storageKey,
    oldValue: JSON.stringify(state),
    newValue: '{',
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].source, 'storage');
  assert.deepEqual(jsonClone(changes[0].changed), ['workspace', 'view']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not valid JSON/);
});

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

const legacyState = (store, breakMinutes = '30') => {
  const state = store.defaultState('2026-07-25');
  state.version = 1;
  state.weeks.forEach(week => {
    week.days.forEach(day => {
      day.periods.forEach(period => {
        period.breakMinutes = breakMinutes;
      });
    });
  });
  return state;
};

test('default state uses rolling version 2 while its workspace value keeps the stable data shape', () => {
  const { store } = loadStore();
  const state = store.defaultState('2026-07-25');

  assert.equal(store.isState(state), true);
  assert.equal(state.version, 2);
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

test('legacy forward weeks migrate by their saved dates into the current-plus-past-three window', () => {
  const { store } = loadStore();
  const legacy = store.defaultState('2026-07-11');
  legacy.version = 1;
  legacy.weeks.forEach((week, index) => {
    week.days[0].periods[0].start = `${String(8 + index).padStart(2, '0')}:00`;
    week.days[0].periods[0].end = `${String(10 + index).padStart(2, '0')}:00`;
  });

  const rolling = store.toRollingState(legacy, '2026-08-01');

  assert.equal(rolling.version, 2);
  assert.equal(rolling.weekStart, '2026-08-01');
  assert.deepEqual(
    jsonClone(rolling.weeks.map(week => jsonClone(week.days[0].periods[0]))),
    [
      { start: '11:00', end: '13:00' },
      { start: '10:00', end: '12:00' },
      { start: '09:00', end: '11:00' },
      { start: '08:00', end: '10:00' },
    ]
  );
  assert.equal(store.isWorkspaceValue(store.workspaceValue(legacy)), true);
  assert.equal(store.isWorkspaceValue(store.workspaceValue(rolling)), true);
});

test('an unanchored state stays byte-for-byte in its original slot order until refresh', () => {
  const { store } = loadStore();
  const legacy = store.defaultState('');
  legacy.version = 1;
  legacy.weeks[0].days[0].periods[0].start = '08:00';
  legacy.weeks[0].days[0].periods[0].end = '10:00';
  legacy.weeks[1].days[0].periods[0].start = '09:00';
  legacy.weeks[1].days[0].periods[0].end = '11:00';

  assert.deepEqual(
    jsonClone(store.toRollingState(legacy, '2026-08-01')),
    jsonClone(legacy)
  );

  const rollingBlank = store.defaultState('');
  assert.deepEqual(
    jsonClone(store.toRollingState(rollingBlank, '2026-08-01')),
    jsonClone(rollingBlank)
  );
  assert.deepEqual(
    jsonClone(store.toRollingState(rollingBlank, '2026-08-01', { reanchorBlank: true })),
    jsonClone({ ...rollingBlank, weekStart: '2026-08-01' })
  );
});

test('rolling forward retains the current week and previous three without re-dating them', () => {
  const { store } = loadStore();
  const saved = store.defaultState('2026-08-01');
  saved.visibleWeekCount = 4;
  saved.weeks.forEach((week, index) => {
    week.days[0].periods[0].start = `${String(8 + index).padStart(2, '0')}:00`;
    week.days[0].periods[0].end = `${String(10 + index).padStart(2, '0')}:00`;
  });

  assert.deepEqual(jsonClone(store.toRollingState(saved, '2026-08-01')), jsonClone(saved));

  const nextWeek = store.toRollingState(saved, '2026-08-08');
  assert.deepEqual(
    jsonClone(nextWeek.weeks.map(week => jsonClone(week.days[0].periods[0]))),
    [
      { start: '', end: '' },
      { start: '08:00', end: '10:00' },
      { start: '09:00', end: '11:00' },
      { start: '10:00', end: '12:00' },
    ]
  );

  const twoWeeksLater = store.toRollingState(nextWeek, '2026-08-15');
  assert.deepEqual(
    jsonClone(twoWeeksLater.weeks.map(week => jsonClone(week.days[0].periods[0]))),
    [
      { start: '', end: '' },
      { start: '', end: '' },
      { start: '08:00', end: '10:00' },
      { start: '09:00', end: '11:00' },
    ]
  );
});

test('the exact historical manual-break schema is detected without rewriting raw bytes', async () => {
  const template = loadStore().store;
  const legacy = legacyState(template, '35');
  legacy.weeks[0].days[0].periods[0].breakMinutes = 20;
  const raw = JSON.stringify(legacy, null, 2);
  const { storage, store } = loadStore(raw);

  const inspected = store.inspect();
  assert.equal(inspected.status, 'legacy');
  assert.equal(inspected.raw, raw);
  assert.equal(inspected.state, null);
  assert.equal(store.isLegacyState(inspected.legacyState), true);
  assert.equal(store.isState(inspected.legacyState), false);
  assert.deepEqual(jsonClone(store.readLegacy()), jsonClone(legacy));
  assert.throws(() => store.read(), /must contain only the start and end fields/);
  assert.equal(storage.values.get(store.storageKey), raw);
  assert.equal(storage.setCalls.length, 0);

  await assert.rejects(
    store.write(store.defaultState('2026-07-25'), { source: 'local' }),
    /must contain only the start and end fields/
  );
  assert.equal(storage.values.get(store.storageKey), raw);
  assert.equal(storage.setCalls.length, 0);
});

test('legacy manual-break detection rejects exact-schema near misses', () => {
  const { store } = loadStore();
  for (const validBreak of ['', '0', '30', '30.5', '.5', '1e2', 0, 30.5, 240]) {
    assert.equal(store.isLegacyState(legacyState(store, validBreak)), true);
  }
  const invalidBreaks = [
    -1, -0, 241, Number.NaN, Number.POSITIVE_INFINITY,
    '-1', '241', ' 30', '30 ', '0x10', '30 minutes', '0'.repeat(33),
    true, null, {}, [],
  ];

  for (const invalidBreak of invalidBreaks) {
    const candidate = legacyState(store);
    candidate.weeks[0].days[0].periods[0].breakMinutes = invalidBreak;
    assert.equal(store.isLegacyState(candidate), false);
  }

  const missingBreak = legacyState(store);
  delete missingBreak.weeks[0].days[0].periods[0].breakMinutes;
  assert.equal(store.isLegacyState(missingBreak), false);

  const extraPeriodField = legacyState(store);
  extraPeriodField.weeks[0].days[0].periods[0].privateNote = 'private';
  assert.equal(store.isLegacyState(extraPeriodField), false);

  const current = store.defaultState('2026-07-25');
  assert.equal(store.isLegacyState(current), false);
});

test('legacy diagnostics never reveal saved times or break values', () => {
  const template = loadStore().store;
  const legacy = legacyState(template);
  legacy.weeks[0].days[0].periods[0].breakMinutes = 'PRIVATE-BREAK-VALUE';
  const raw = JSON.stringify(legacy);
  const { storage, store } = loadStore(raw);

  const inspected = store.inspect();
  assert.equal(inspected.status, 'invalid');
  assert.equal(inspected.raw, raw);
  assert.equal(inspected.error.message.includes('PRIVATE-BREAK-VALUE'), false);
  assert.throws(
    () => store.readLegacy(),
    error => /breakMinutes must be/.test(error.message) &&
      !error.message.includes('PRIVATE-BREAK-VALUE')
  );
  assert.equal(storage.values.get(store.storageKey), raw);
  assert.equal(storage.setCalls.length, 0);

  const invalidTime = legacyState(template);
  invalidTime.weeks[0].days[0].periods[0].start = 'PRIVATE-TIME-VALUE';
  const timeStore = loadStore(JSON.stringify(invalidTime)).store;
  assert.throws(
    () => timeStore.readLegacy(),
    error => /times must be/.test(error.message) &&
      !error.message.includes('PRIVATE-TIME-VALUE')
  );
});

test('strict validation rejects malformed, expanded, and semantically invalid states', () => {
  const { store } = loadStore();
  const cases = [];

  const wrongVersion = store.defaultState('2026-07-25');
  wrongVersion.version = 3;
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
  assert.match(versionMessage, /Reason: version must be 1 or 2\./);
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

test('rolling migration keeps the exact version-1 bytes in a one-time backup', async () => {
  const template = loadStore().store;
  const legacy = template.defaultState('2026-07-11');
  legacy.version = 1;
  legacy.weeks[0].days[0].periods[0].start = '08:00';
  legacy.weeks[0].days[0].periods[0].end = '10:00';
  const raw = JSON.stringify(legacy, null, 2);
  const { storage, store } = loadStore(raw);
  const rolling = store.toRollingState(store.inspect().state, '2026-08-01');

  await store.write(rolling);

  assert.equal(storage.values.get(store.migrationBackupKey), raw);
  assert.equal(storage.values.get(store.storageKey), JSON.stringify(rolling));
  assert.deepEqual(storage.setCalls, [
    [store.migrationBackupKey, raw],
    [store.storageKey, JSON.stringify(rolling)],
  ]);
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
  await store.applyWorkspace(remoteWorkspace, { source: 'sync', schemaVersion: 2 });

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

test('raw backup contains the exact owned browser values and no storage scan', () => {
  const raw = '{"not":"validated on export","spacing": true}';
  const { storage, store } = loadStore(raw);
  const backup = store.rawBackup();

  assert.equal(backup.kind, 'timecard_validator_browser_local_raw_backup');
  assert.equal(backup.app_id, 'timecard-validator');
  assert.deepEqual(jsonClone(backup.records), [{
    key: 'timecard-validator-v1',
    present: true,
    raw_value: raw,
  }, {
    key: 'timecard-validator-v1-before-rolling-window',
    present: false,
    raw_value: null,
  }]);
  assert.deepEqual(storage.getCalls, [
    'timecard-validator-v1',
    'timecard-validator-v1-before-rolling-window',
  ]);
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

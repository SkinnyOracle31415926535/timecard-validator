import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../timecard-store.js', import.meta.url), 'utf8');
const jsonClone = value => JSON.parse(JSON.stringify(value));

class FakeStorage {
  constructor(raw) {
    this.values = new Map();
    this.setCalls = [];
    if (raw !== undefined) this.values.set('timecard-validator-v1', raw);
  }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.setCalls.push([key, String(value)]);
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}

function loadStore(raw, { locks = true } = {}) {
  const listeners = new Map();
  const storage = new FakeStorage(raw);
  const window = {
    localStorage: storage,
    navigator: {},
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
  };
  if (locks) {
    window.navigator.locks = {
      request(_name, _options, callback) { return Promise.resolve().then(callback); },
    };
  }
  const context = vm.createContext({ CustomEvent: FakeCustomEvent, window });
  vm.runInContext(source, context, { filename: 'timecard-store.js' });
  return {
    dispatch: event => window.dispatchEvent(event),
    listen: (type, callback) => window.addEventListener(type, callback),
    storage,
    store: window.TimecardStore,
  };
}

const periodValues = state => jsonClone(
  state.weeks.map(week => week.days[0].periods[0])
);

test('Timecard Validator persists local state with and without navigator locks', async () => {
  for (const locks of [true, false]) {
    const { storage, store } = loadStore(undefined, { locks });
    const state = store.defaultState('2026-07-25');
    state.visibleWeekCount = 2;
    state.weeks[0].days[0].periods[0].start = '09:00';
    state.weeks[0].days[0].periods[0].end = '12:00';

    await store.write(state);
    assert.deepEqual(JSON.parse(storage.getItem(store.storageKey)), jsonClone(state));
    assert.equal(store.read().visibleWeekCount, 2);
  }
});

test('rolling forward retains the current week and previous three', () => {
  const { store } = loadStore();
  const saved = store.defaultState('2026-08-01');
  saved.visibleWeekCount = 4;
  saved.weeks.forEach((week, index) => {
    week.days[0].periods[0].start = `${String(8 + index).padStart(2, '0')}:00`;
    week.days[0].periods[0].end = `${String(10 + index).padStart(2, '0')}:00`;
  });

  assert.equal(saved.version, store.stateVersion);
  assert.deepEqual(jsonClone(store.toRollingState(saved, '2026-08-01')), jsonClone(saved));
  assert.deepEqual(periodValues(store.toRollingState(saved, '2026-08-08')), [
    { start: '', end: '' },
    { start: '08:00', end: '10:00' },
    { start: '09:00', end: '11:00' },
    { start: '10:00', end: '12:00' },
  ]);
});

test('legacy forward weeks migrate into the rolling window and retain their exact raw backup', async () => {
  const original = loadStore().store.defaultState('2026-07-11');
  original.version = 1;
  original.weeks.forEach((week, index) => {
    week.days[0].periods[0].start = `${String(8 + index).padStart(2, '0')}:00`;
    week.days[0].periods[0].end = `${String(10 + index).padStart(2, '0')}:00`;
  });
  const raw = JSON.stringify(original, null, 2);
  const { storage, store } = loadStore(raw);

  const rolling = store.toRollingState(store.read(), '2026-08-01');
  assert.equal(rolling.version, store.stateVersion);
  assert.deepEqual(periodValues(rolling), [
    { start: '11:00', end: '13:00' },
    { start: '10:00', end: '12:00' },
    { start: '09:00', end: '11:00' },
    { start: '08:00', end: '10:00' },
  ]);

  await store.write(rolling);
  assert.equal(storage.getItem(store.migrationBackupKey), raw);
  assert.equal(storage.getItem(store.storageKey), JSON.stringify(rolling));
});

test('an unanchored state does not move until Refresh current week anchors it', () => {
  const { store } = loadStore();
  const blank = store.defaultState('');
  blank.weeks[0].days[0].periods[0].start = '08:00';
  blank.weeks[0].days[0].periods[0].end = '10:00';

  assert.deepEqual(jsonClone(store.toRollingState(blank, '2026-08-01')), jsonClone(blank));
  const anchored = store.toRollingState(blank, '2026-08-01', { reanchorBlank: true });
  assert.equal(anchored.weekStart, '2026-08-01');
  assert.deepEqual(periodValues(anchored)[0], { start: '08:00', end: '10:00' });
});

test('temporary transfer still recognizes historical manual-break timecards', () => {
  const { store } = loadStore();
  const legacy = store.defaultState('2026-07-25');
  legacy.version = 1;
  legacy.weeks.forEach(week => week.days.forEach(day => {
    day.periods.forEach(period => { period.breakMinutes = '30'; });
  }));

  assert.equal(store.isLegacyState(legacy), true);
  assert.equal(store.isState(legacy), false);
  assert.equal(loadStore(JSON.stringify(legacy)).store.inspect().status, 'legacy');
});

test('Timecard Validator preserves invalid local bytes instead of overwriting them', async () => {
  const raw = '{"version":1';
  const { storage, store } = loadStore(raw);

  assert.equal(store.inspect().status, 'invalid');
  await assert.rejects(store.write(store.defaultState('2026-07-25')), /not valid JSON/);
  assert.equal(storage.getItem(store.storageKey), raw);
});

test('Timecard Validator retains same-browser storage event updates', () => {
  const { dispatch, listen, store } = loadStore();
  const updates = [];
  listen(store.changeEvent, event => updates.push(event.detail));

  const previous = store.defaultState('2026-07-25');
  const next = store.defaultState('2026-08-01');
  next.visibleWeekCount = 3;
  dispatch({
    type: 'storage',
    key: store.storageKey,
    oldValue: JSON.stringify(previous),
    newValue: JSON.stringify(next),
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].source, 'storage');
  assert.equal(updates[0].state.visibleWeekCount, 3);
});

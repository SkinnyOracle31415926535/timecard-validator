import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../timecard-store.js', import.meta.url), 'utf8');

class FakeStorage {
  constructor(raw) {
    this.values = new Map();
    if (raw !== undefined) this.values.set('timecard-validator-v1', raw);
  }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
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

test('Timecard Validator persists local state with and without navigator locks', async () => {
  for (const locks of [true, false]) {
    const { storage, store } = loadStore(undefined, { locks });
    const state = store.defaultState('2026-07-25');
    state.visibleWeekCount = 2;
    state.weeks[0].days[0].periods[0].start = '09:00';
    state.weeks[0].days[0].periods[0].end = '12:00';

    await store.write(state);
    assert.deepEqual(JSON.parse(storage.getItem(store.storageKey)), JSON.parse(JSON.stringify(state)));
    assert.equal(store.read().visibleWeekCount, 2);
  }
});

test('Timecard Validator preserves invalid local bytes instead of overwriting them', async () => {
  const raw = '{"version":1';
  const { storage, store } = loadStore(raw);
  const next = store.defaultState('2026-07-25');

  assert.equal(store.inspect().status, 'invalid');
  await assert.rejects(store.write(next), /not valid JSON/);
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

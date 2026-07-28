import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../timecard-sync.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.children = [];
    this.listeners = new Map();
    this.queries = new Map();
    this.textContent = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  insertAdjacentElement(_position, element) {
    this.children.push(element);
  }

  append(...elements) {
    this.children.push(...elements);
  }

  appendChild(element) {
    this.children.push(element);
    return element;
  }

  prepend(...elements) {
    this.children.unshift(...elements);
  }

  replaceChildren(...elements) {
    this.children = elements;
  }

  remove() {}

  click() {}

  focus() {}

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  querySelector(selector) {
    if (!this.queries.has(selector)) this.queries.set(selector, new FakeElement());
    return this.queries.get(selector);
  }

  querySelectorAll(selector) {
    if (selector === '[data-sync-action]') {
      return [
        '[data-timecard-sync-connect]',
        '[data-timecard-sync-now]',
        '[data-timecard-sync-backup]',
        '[data-timecard-sync-preview]',
        '[data-timecard-sync-disconnect]',
        '[data-timecard-sync-reset]',
        '[data-timecard-sync-apply]',
      ].map(item => this.querySelector(item));
    }
    return [];
  }
}

async function loadSync(mode) {
  const legacyValue = {
    version: 1,
    marker: 'legacy',
    breakMinutes: 'PRIVATE-BREAK',
  };
  const currentValue = { version: 1, marker: 'current' };
  const registered = [];
  const clientOptions = [];
  const link = new FakeElement('a');
  const body = new FakeElement('body');
  const created = [];
  const document = {
    activeElement: null,
    body,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
    querySelector(selector) {
      return selector === '.timecard-link' ? link : null;
    },
  };
  const store = {
    changeEvent: 'timecard-change',
    errorEvent: 'timecard-error',
    inspect: () => ({
      status: mode,
      state: mode === 'valid' ? currentValue : null,
      legacyState: mode === 'legacy' ? legacyValue : undefined,
      error: null,
    }),
    read: () => mode === 'valid' ? currentValue : null,
    readLegacy: () => mode === 'legacy'
      ? JSON.parse(JSON.stringify(legacyValue))
      : null,
    isLegacyState: value => Boolean(value && value.marker === 'legacy'),
    isState: value => Boolean(value && value.marker === 'current'),
    workspaceValue: () => ({ weekStart: 'current', weeks: [] }),
    viewValue: () => ({ visibleWeekCount: 1 }),
    isWorkspaceValue: value => Boolean(value && value.weekStart === 'current'),
    isViewValue: value => Boolean(value && value.visibleWeekCount === 1),
    applyWorkspace() {
      throw new Error('not used');
    },
    applyView() {
      throw new Error('not used');
    },
    rawBackup: () => ({ records: [] }),
    getLastError: () => null,
  };
  const state = {
    mode: 'disconnected',
    message: 'Not connected',
  };
  const fakeClient = {
    onStateChange(listener) {
      listener(state);
    },
    async register(adapter) {
      const local = adapter.readLocal();
      if (local !== undefined && adapter.validate(local) !== true) {
        throw new Error('adapter rejected local value');
      }
      registered.push(adapter);
      return { save() {} };
    },
    async finalizeRegistration() {},
    getState: () => state,
    async listConflicts() {
      return [];
    },
  };
  const windowListeners = new Map();
  const window = {
    TimecardStore: store,
    RyanAppSync: {
      create(options) {
        clientOptions.push(options);
        return fakeClient;
      },
    },
    addEventListener(type, callback) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(callback);
    },
    confirm: () => false,
    setTimeout,
  };
  const context = vm.createContext({
    document,
    navigator: { platform: 'test' },
    setTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: 'timecard-sync.js' });
  await window.TimecardSync.ready;
  return {
    clientOptions,
    dialog: created.find(element => element.tagName === 'dialog'),
    link,
    registered,
    sync: window.TimecardSync,
  };
}

test('legacy mode registers only the fixed recovery adapter', async () => {
  const result = await loadSync('legacy');

  assert.equal(result.sync.mode, 'manual-break-recovery');
  assert.equal(result.sync.manifestVersion, 2);
  assert.equal(result.clientOptions[0].appId, 'timecard-validator');
  assert.equal(result.registered.length, 1);
  assert.deepEqual(
    {
      scope: result.registered[0].scope,
      appId: result.registered[0].appId,
      collection: result.registered[0].collection,
      recordId: result.registered[0].recordId,
      schemaVersion: result.registered[0].schemaVersion,
    },
    {
      scope: 'timecard-validator',
      appId: 'timecard-validator',
      collection: 'recovery',
      recordId: 'manual-break-v1',
      schemaVersion: 1,
    }
  );
  assert.match(result.dialog.innerHTML, /preserved unchanged for recovery/);
  assert.equal(result.link.children[0].textContent, 'Recovery & backup');
});

test('current mode registers only the two current fixed adapters', async () => {
  const result = await loadSync('valid');

  assert.equal(result.sync.mode, 'current');
  assert.equal(result.sync.manifestVersion, 1);
  assert.deepEqual(
    result.registered.map(adapter => [adapter.collection, adapter.recordId]),
    [['timecards', 'current'], ['preferences', 'view']]
  );
  assert.equal(result.link.children[0].textContent, 'Sync & backup');
});

test('recovery adapter never writes or accepts remote recovery data', async () => {
  const result = await loadSync('legacy');
  const adapter = result.registered[0];
  const local = adapter.readLocal();

  assert.doesNotThrow(() => adapter.writeLocal(local, {
    source: 'local',
    deleted: false,
  }));
  const changed = JSON.parse(JSON.stringify(local));
  changed.breakMinutes = 'DIFFERENT-PRIVATE-BREAK';
  assert.throws(
    () => adapter.writeLocal(changed, { source: 'local', deleted: false }),
    error => /changed/.test(error.message) &&
      !error.message.includes('DIFFERENT-PRIVATE-BREAK')
  );
  assert.throws(
    () => adapter.writeLocal(local, { source: 'local', deleted: true }),
    /cannot be deleted/
  );
  assert.throws(
    () => adapter.applyRemote(local, { source: 'remote', deleted: false }),
    /cannot be applied/
  );
});

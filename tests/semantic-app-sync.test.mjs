import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../semantic-app-sync.js', import.meta.url), 'utf8');
const timecardStorageSource = fs.readFileSync(
  new URL('../timecard-semantic-storage.js', import.meta.url),
  'utf8'
);
const jsonClone = value => JSON.parse(JSON.stringify(value));

class FakeElement {
  constructor() {
    this.children = [];
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = '';
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...items) {
    this.children.push(...items);
  }

  remove() {}

  replaceChildren(...items) {
    this.children = items;
  }

  setAttribute() {}

  showModal() {}

  close() {}
}

const makeDocument = () => {
  const dialogs = [];
  const document = {
    dialogs,
    head: new FakeElement(),
    body: new FakeElement(),
    createElement(tag) {
      const element = new FakeElement();
      if (tag === 'dialog') {
        const nodes = new Map([
          ['[data-status]', new FakeElement()],
          ['[data-sync]', new FakeElement()],
          ['[data-conflicts]', new FakeElement()],
          ['[data-conflict-list]', new FakeElement()],
          ['[data-close]', new FakeElement()],
        ]);
        element.querySelector = selector => nodes.get(selector) || new FakeElement();
        dialogs.push(nodes);
      }
      return element;
    },
  };
  return document;
};

const makeLocalStorage = () => {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
};

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

const loadSync = fetch => {
  const document = makeDocument();
  const localStorage = makeLocalStorage();
  const window = {
    addEventListener() {},
    setInterval() {},
  };
  const context = vm.createContext({
    Blob,
    TextEncoder,
    URL,
    document,
    fetch,
    localStorage,
    location: { protocol: 'https:', hostname: 'timecard.chatgpt.site' },
    setTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: 'semantic-app-sync.js' });
  return { document, install: window.SemanticAppSync.install, localStorage };
};

const installWorkspaceSync = (install, adapter) => install({
  appId: 'timecard-validator',
  appName: 'Timecard Validator',
  storage: {
    makeAdapters: () => ({ workspace: adapter }),
    attachHandles() {},
  },
});

const workspaceAdapter = overrides => ({
  collection: 'workspace',
  recordId: 'current',
  schemaVersion: 2,
  acceptedSchemaVersions: [1, 2],
  validate: value => value && typeof value.kind === 'string',
  readLocal: () => undefined,
  applyRemote: () => {},
  ...overrides,
});

test('an unanchored legacy workspace has an explicit sync gate until refresh', () => {
  let state = { version: 1, weekStart: '' };
  const window = {
    TimecardStore: {
      changeEvent: 'timecard-change',
      inspect: () => ({ status: 'valid', state }),
      workspaceValue: value => ({ weekStart: value.weekStart, weeks: [] }),
      viewValue: () => ({ visibleWeekCount: 1 }),
      isWorkspaceValue: () => true,
      isViewValue: () => true,
      applyWorkspace: () => {},
      applyView: () => {},
    },
    addEventListener() {},
  };
  const context = vm.createContext({ window });
  vm.runInContext(timecardStorageSource, context, { filename: 'timecard-semantic-storage.js' });
  const workspace = window.TimecardSemanticStorage.makeAdapters().workspace;

  assert.equal(workspace.shouldSync(), false);
  state = { version: 1, weekStart: '2026-08-01' };
  assert.equal(workspace.shouldSync(), true);
  assert.deepEqual(jsonClone(workspace.readLocal()), { weekStart: '2026-08-01', weeks: [] });
  state = { version: 2, weekStart: '' };
  assert.equal(workspace.shouldSync(), false);
});

test('new workspace sync accepts legacy schema 1 and passes its schema to the adapter', async () => {
  const applied = [];
  const { install } = loadSync(async () => jsonResponse({
    records: [{
      collection: 'workspace',
      recordId: 'current',
      revision: 1,
      value: { schemaVersion: 1, deleted: false, data: { kind: 'legacy' } },
    }],
  }));
  const controller = installWorkspaceSync(install, workspaceAdapter({
    applyRemote: (value, metadata) => applied.push({ value, metadata }),
  }));

  await controller.sync();

  assert.deepEqual(jsonClone(applied), [{
    value: { kind: 'legacy' },
    metadata: { source: 'remote', deleted: false, schemaVersion: 1 },
  }]);
});

test('new workspace sync writes schema 2 for local rolling data', async () => {
  const requests = [];
  const { install } = loadSync(async (url, options) => {
    requests.push({ url, options });
    if (!options || options.method !== 'PUT') return jsonResponse({ records: [] });
    return jsonResponse({ record: { revision: 1 } });
  });
  const controller = installWorkspaceSync(install, workspaceAdapter({
    readLocal: () => ({ kind: 'rolling' }),
  }));

  await controller.sync();

  const upload = requests.find(request => request.options?.method === 'PUT');
  assert.ok(upload);
  const body = JSON.parse(upload.options.body);
  assert.deepEqual(body.value, {
    schemaVersion: 2,
    deleted: false,
    data: { kind: 'rolling' },
  });
});

test('an old schema-1 client rejects a schema-2 record without applying or overwriting it', async () => {
  let writes = 0;
  let applies = 0;
  const { install } = loadSync(async (url, options) => {
    if (options?.method === 'PUT') writes += 1;
    return jsonResponse({
      records: [{
        collection: 'workspace',
        recordId: 'current',
        revision: 1,
        value: { schemaVersion: 2, deleted: false, data: { kind: 'rolling' } },
      }],
    });
  });
  const controller = installWorkspaceSync(install, {
    collection: 'workspace',
    recordId: 'current',
    schemaVersion: 1,
    validate: value => value && typeof value.kind === 'string',
    readLocal: () => undefined,
    applyRemote: () => { applies += 1; },
  });

  await controller.sync();

  assert.equal(applies, 0);
  assert.equal(writes, 0);
});

test('a withheld workspace neither applies a remote record nor uploads a deletion', async () => {
  for (const known of [false, true]) {
    let writes = 0;
    let applies = 0;
    const { document, install, localStorage } = loadSync(async (url, options) => {
      if (options?.method === 'PUT') writes += 1;
      return jsonResponse({
        records: [{
          collection: 'workspace',
          recordId: 'current',
          revision: 1,
          value: { schemaVersion: 99, deleted: false, data: { kind: 'unsupported' } },
        }],
      });
    });
    if (known) {
      localStorage.setItem('__ryan_semantic_sync_timecard-validator_v1', JSON.stringify({
        version: 1,
        enabled: false,
        records: {
          'workspace\u001fcurrent': {
            collection: 'workspace',
            recordId: 'current',
            revision: 1,
            fingerprint: 'legacy-fingerprint',
          },
        },
      }));
    }
    const controller = installWorkspaceSync(install, workspaceAdapter({
      shouldSync: () => false,
      readLocal: () => {
        throw new Error('A withheld workspace must not be read as a deletion.');
      },
      applyRemote: () => { applies += 1; },
    }));

    await controller.sync();

    assert.equal(applies, 0);
    assert.equal(writes, 0);
    assert.equal(
      document.dialogs[0].get('[data-status]').textContent,
      'Synced. Every independent record is current.'
    );
  }
});

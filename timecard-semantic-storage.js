/* Semantic sync adapters for the Timecard Validator's durable workspace. */
(() => {
  'use strict';

  const APP_ID = 'timecard-validator';
  const LEGACY_WORKSPACE_SCHEMA_VERSION = 1;
  const WORKSPACE_SCHEMA_VERSION = 2;
  const VIEW_SCHEMA_VERSION = 1;
  const store = window.TimecardStore;
  let handles = null;

  if (!store) throw new Error('Timecard semantic storage needs the validated timecard store.');

  const currentState = () => {
    const inspected = store.inspect();
    return inspected.status === 'valid' ? inspected.state : undefined;
  };

  const readWorkspace = () => {
    const state = currentState();
    return state ? store.workspaceValue(state) : undefined;
  };

  const shouldSyncWorkspace = () => {
    const state = currentState();
    return Boolean(state && state.weekStart);
  };

  const readView = () => {
    const state = currentState();
    return state ? store.viewValue(state) : undefined;
  };

  const validateWorkspace = (value) => store.isWorkspaceValue(value);
  const validateView = (value) => store.isViewValue(value);

  const makeAdapters = () => ({
    workspace: {
      appId: APP_ID,
      collection: 'workspace',
      recordId: 'current',
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      acceptedSchemaVersions: [LEGACY_WORKSPACE_SCHEMA_VERSION, WORKSPACE_SCHEMA_VERSION],
      validate: validateWorkspace,
      shouldSync: shouldSyncWorkspace,
      readLocal: readWorkspace,
      applyRemote: (value, metadata) => store.applyWorkspace(value, {
        source: 'remote',
        deleted: Boolean(metadata?.deleted),
        schemaVersion: metadata?.schemaVersion,
      }),
    },
    view: {
      appId: APP_ID,
      collection: 'preferences',
      recordId: 'view',
      schemaVersion: VIEW_SCHEMA_VERSION,
      validate: validateView,
      readLocal: readView,
      applyRemote: (value, metadata) => store.applyView(value, {
        source: 'remote',
        deleted: Boolean(metadata?.deleted),
      }),
    },
  });

  const attachHandles = (next) => {
    if (!next || !next.workspace || typeof next.workspace.save !== 'function'
      || !next.view || typeof next.view.save !== 'function') {
      throw new Error('Timecard semantic sync handles are incomplete.');
    }
    handles = Object.freeze({ workspace: next.workspace, view: next.view });
  };

  window.addEventListener(store.changeEvent, (event) => {
    const detail = event.detail;
    if (!handles || detail?.source !== 'local' || !Array.isArray(detail.changed)) return;
    const pending = [];
    if (detail.changed.includes('workspace')) pending.push(handles.workspace.save(readWorkspace()));
    if (detail.changed.includes('view')) pending.push(handles.view.save(readView()));
    if (typeof detail.waitUntil === 'function') detail.waitUntil(Promise.all(pending));
  });

  window.TimecardSemanticStorage = Object.freeze({
    appId: APP_ID,
    makeAdapters,
    attachHandles,
  });
})();

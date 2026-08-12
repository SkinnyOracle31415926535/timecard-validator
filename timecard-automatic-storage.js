/* UI-free adapters for Timecard Validator's validated rolling workspace. */
(() => {
  'use strict';

  const APP_ID = 'timecard-validator';
  const CURRENT_SCHEMA_VERSION = 2;
  const LEGACY_SCHEMA_VERSION = 1;
  const store = window.TimecardStore;
  let handles = null;

  if (!store) throw new Error('Automatic Timecard storage needs the validated timecard store.');

  const currentState = () => {
    const inspected = store.inspect();
    return inspected.status === 'valid' ? inspected.state : undefined;
  };

  const readWorkspace = () => {
    const state = currentState();
    return state ? store.workspaceValue(state) : undefined;
  };

  const readView = () => {
    const state = currentState();
    return state ? store.viewValue(state) : undefined;
  };

  const validateWorkspacePayload = (payload) => (
    payload.schemaVersion === CURRENT_SCHEMA_VERSION
      ? store.isWorkspaceValue(payload.data)
      : payload.schemaVersion === LEGACY_SCHEMA_VERSION
        && store.isLegacyWorkspaceValue(payload.data)
  );

  const validateViewPayload = (payload) => (
    payload.schemaVersion === CURRENT_SCHEMA_VERSION
      ? store.isViewValue(payload.data)
      : payload.schemaVersion === LEGACY_SCHEMA_VERSION
        && store.isLegacyViewValue(payload.data)
  );

  const makeAdapters = () => ({
    workspace: {
      appId: APP_ID,
      collection: 'workspace',
      recordId: 'current',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      acceptedSchemaVersions: [LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION],
      validate: store.isWorkspaceValue,
      validatePayload: validateWorkspacePayload,
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
      schemaVersion: CURRENT_SCHEMA_VERSION,
      acceptedSchemaVersions: [LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION],
      validate: store.isViewValue,
      validatePayload: validateViewPayload,
      readLocal: readView,
      applyRemote: (value, metadata) => store.applyView(value, {
        source: 'remote',
        deleted: Boolean(metadata?.deleted),
        schemaVersion: metadata?.schemaVersion,
      }),
    },
  });

  const attachHandles = (next) => {
    if (!next || !next.workspace || typeof next.workspace.save !== 'function'
      || !next.view || typeof next.view.save !== 'function') {
      throw new Error('Timecard automatic sync handles are incomplete.');
    }
    handles = Object.freeze({ workspace: next.workspace, view: next.view });
  };

  window.addEventListener(store.changeEvent, (event) => {
    const detail = event.detail;
    if (!handles || detail?.source !== 'local' || !Array.isArray(detail.changed)) return;
    if (detail.changed.includes('workspace')) void handles.workspace.save(readWorkspace());
    if (detail.changed.includes('view')) void handles.view.save(readView());
  });

  window.TimecardAutomaticStorage = Object.freeze({
    appId: APP_ID,
    makeAdapters,
    attachHandles,
  });
})();

(() => {
  'use strict';

  const APP_ID = 'timecard-validator';
  const MANIFEST_VERSION = 1;
  const store = window.TimecardStore;
  const timecardLink = document.querySelector('.timecard-link');

  if (!document.body || !timecardLink) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'timecard-sync-open';
  openButton.dataset.state = 'disconnected';
  openButton.textContent = 'Sync & backup';
  timecardLink.insertAdjacentElement('afterend', openButton);

  const dialog = document.createElement('dialog');
  dialog.className = 'timecard-sync-dialog';
  dialog.setAttribute('aria-labelledby', 'timecard-sync-title');
  dialog.innerHTML = `
    <div class="timecard-sync-window">
      <div class="timecard-sync-heading">
        <div>
          <p class="timecard-sync-kicker">RYAN-ONLY APP SYNC</p>
          <h2 id="timecard-sync-title">Sync & backup</h2>
        </div>
        <button type="button" class="timecard-sync-close" data-timecard-sync-close
          aria-label="Close sync and backup window">×</button>
      </div>
      <p class="timecard-sync-copy">
        Your current four-week timecard and its visible-week preference can sync between
        Ryan’s browsers. Entries still save in this browser first.
      </p>
      <p class="timecard-sync-safety">
        Only <code>timecard-validator-v1</code> is read. Other browser storage is never
        scanned, replaced, or cleared.
      </p>
      <div class="timecard-sync-state" data-timecard-sync-state data-state="disconnected">
        <strong data-timecard-sync-state-label>Disconnected</strong>
        <span data-timecard-sync-state-message>Local timecard data stays on this device.</span>
      </div>
      <p class="timecard-sync-alert" data-timecard-sync-alert role="alert" hidden></p>
      <div class="timecard-sync-actions">
        <button type="button" class="is-primary" data-timecard-sync-connect data-sync-action>
          Connect as Ryan
        </button>
        <button type="button" data-timecard-sync-now data-sync-action>Sync now</button>
        <button type="button" data-timecard-sync-backup data-sync-action>Download local backup</button>
        <button type="button" data-timecard-sync-preview data-sync-action>
          Create backup & preview
        </button>
        <button type="button" data-timecard-sync-disconnect data-sync-action>Disconnect</button>
        <button type="button" data-timecard-sync-reset data-sync-action>
          Reset device connection
        </button>
      </div>
      <section class="timecard-sync-review" data-timecard-sync-review hidden
        aria-labelledby="timecard-sync-review-title">
        <h3 id="timecard-sync-review-title">Migration preview</h3>
        <p data-timecard-sync-counts></p>
        <p class="timecard-sync-zero-write" data-timecard-sync-zero-write></p>
        <div class="timecard-sync-records" data-timecard-sync-records></div>
        <button type="button" class="is-primary" data-timecard-sync-apply data-sync-action disabled>
          Apply reviewed migration
        </button>
      </section>
      <section class="timecard-sync-conflicts" data-timecard-sync-conflicts hidden
        aria-labelledby="timecard-sync-conflicts-title">
        <h3 id="timecard-sync-conflicts-title">Sync conflicts</h3>
        <p>Choose each result deliberately. No choice is made automatically.</p>
        <div class="timecard-sync-conflict-list" data-timecard-sync-conflict-list></div>
      </section>
      <p class="timecard-sync-footnote">
        Authentication lasts only in this open page. Queued local changes remain preserved
        after the session expires.
      </p>
      <p class="timecard-sync-footnote">
        Resetting the device connection does not remove the local timecard. It requires fresh
        owner approval and a new zero-write migration preview.
      </p>
    </div>
  `;
  document.body.append(dialog);

  const closeButton = dialog.querySelector('[data-timecard-sync-close]');
  const connectButton = dialog.querySelector('[data-timecard-sync-connect]');
  const syncButton = dialog.querySelector('[data-timecard-sync-now]');
  const backupButton = dialog.querySelector('[data-timecard-sync-backup]');
  const previewButton = dialog.querySelector('[data-timecard-sync-preview]');
  const disconnectButton = dialog.querySelector('[data-timecard-sync-disconnect]');
  const resetButton = dialog.querySelector('[data-timecard-sync-reset]');
  const applyButton = dialog.querySelector('[data-timecard-sync-apply]');
  const stateBox = dialog.querySelector('[data-timecard-sync-state]');
  const stateLabel = dialog.querySelector('[data-timecard-sync-state-label]');
  const stateMessage = dialog.querySelector('[data-timecard-sync-state-message]');
  const alert = dialog.querySelector('[data-timecard-sync-alert]');
  const review = dialog.querySelector('[data-timecard-sync-review]');
  const counts = dialog.querySelector('[data-timecard-sync-counts]');
  const zeroWrite = dialog.querySelector('[data-timecard-sync-zero-write]');
  const records = dialog.querySelector('[data-timecard-sync-records]');
  const conflicts = dialog.querySelector('[data-timecard-sync-conflicts]');
  const conflictList = dialog.querySelector('[data-timecard-sync-conflict-list]');
  const actionButtons = Array.from(dialog.querySelectorAll('[data-sync-action]'));

  let client = null;
  let workspaceHandle = null;
  let viewHandle = null;
  let previewResult = null;
  let busy = false;
  let initialized = false;
  let conflictRender = 0;
  let restoreFocus = null;

  const stateLabels = {
    disconnected: 'Disconnected',
    review: 'Migration review required',
    syncing: 'Syncing',
    synced: 'Synced',
    offline: 'Offline',
    conflict: 'Conflict needs review',
  };

  const showAlert = (message = '') => {
    alert.hidden = !message;
    alert.textContent = message;
  };

  const setBusy = next => {
    busy = next;
    dialog.setAttribute('aria-busy', String(next));
    actionButtons.forEach(button => {
      if (button === applyButton && !next) return;
      button.disabled = next;
    });
    if (!next) updateApplyAvailability();
  };

  const downloadJson = (payload, filename) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadRawBackup = () => {
    if (!store) throw new Error('The Timecard local data store did not load.');
    const today = new Date().toISOString().slice(0, 10);
    downloadJson(
      store.rawBackup(),
      `timecard-validator-browser-local-raw-backup-${today}.json`
    );
  };

  const requireWriteSource = metadata => {
    if (!metadata || !['local', 'remote-migration'].includes(metadata.source)) {
      throw new Error('The sync client requested an invalid local write source.');
    }
  };

  const requireRemoteSource = metadata => {
    if (!metadata || !['remote', 'migration'].includes(metadata.source)) {
      throw new Error('The sync client requested an invalid remote write source.');
    }
  };

  const workspaceAdapter = {
    scope: APP_ID,
    appId: APP_ID,
    collection: 'timecards',
    recordId: 'current',
    schemaVersion: 1,
    validate: value => store.isWorkspaceValue(value),
    readLocal: () => {
      const state = store.read();
      return state ? store.workspaceValue(state) : undefined;
    },
    writeLocal: (value, metadata) => {
      requireWriteSource(metadata);
      return store.applyWorkspace(value, {
        source: 'sync',
        deleted: Boolean(metadata.deleted),
      });
    },
    applyRemote: (value, metadata) => {
      requireRemoteSource(metadata);
      return store.applyWorkspace(value, {
        source: 'sync',
        deleted: Boolean(metadata.deleted),
      });
    },
  };

  const viewAdapter = {
    scope: APP_ID,
    appId: APP_ID,
    collection: 'preferences',
    recordId: 'view',
    schemaVersion: 1,
    validate: value => store.isViewValue(value),
    readLocal: () => {
      const state = store.read();
      return state ? store.viewValue(state) : undefined;
    },
    writeLocal: (value, metadata) => {
      requireWriteSource(metadata);
      return store.applyView(value, {
        source: 'sync',
        deleted: Boolean(metadata.deleted),
      });
    },
    applyRemote: (value, metadata) => {
      requireRemoteSource(metadata);
      return store.applyView(value, {
        source: 'sync',
        deleted: Boolean(metadata.deleted),
      });
    },
  };

  const invalidatePreview = () => {
    previewResult = null;
    review.hidden = true;
    records.replaceChildren();
    applyButton.disabled = true;
  };

  const stageLocalChanges = async detail => {
    await ready;
    if (detail.changed.includes('workspace')) {
      await workspaceHandle.save(store.workspaceValue(detail.state));
    }
    if (detail.changed.includes('view')) {
      await viewHandle.save(store.viewValue(detail.state));
    }
  };

  if (store) {
    window.addEventListener(store.changeEvent, event => {
      const detail = event.detail;
      if (!detail || detail.source !== 'local' || !store.isState(detail.state)) return;
      invalidatePreview();
      const pending = stageLocalChanges(detail);
      if (typeof detail.waitUntil === 'function') detail.waitUntil(pending);
    });
    window.addEventListener(store.errorEvent, event => {
      const message = event.detail && event.detail.message;
      if (message) showAlert(message);
    });
  }

  const updateApplyAvailability = () => {
    if (busy || !previewResult || previewResult.preview.writesPerformed !== 0) {
      applyButton.disabled = true;
      return;
    }
    const required = Array.from(records.querySelectorAll('select[data-record-key]'));
    const blocked = records.querySelector('[data-migration-blocked]');
    applyButton.disabled = Boolean(blocked)
      || previewResult.preview.remoteCount > 0
      || required.some(select => !select.value);
  };

  const makeReviewRow = item => {
    const row = document.createElement('div');
    row.className = 'timecard-sync-record';
    const identity = document.createElement('strong');
    identity.textContent = `${item.collection} · ${item.recordId}`;
    const status = document.createElement('span');
    status.className = 'timecard-sync-record-status';
    status.textContent = item.status.replaceAll('-', ' ');
    row.append(identity, status);

    if (item.status === 'content-conflict') {
      const label = document.createElement('label');
      label.textContent = item.remoteDeleted
        ? 'The synchronized record is deleted; preserve this device'
        : 'Choose result';
      const select = document.createElement('select');
      select.dataset.recordKey = item.recordKey;
      select.innerHTML = item.remoteDeleted
        ? '<option value="">Choose…</option><option value="keep-local">Keep this device</option>'
        : `
          <option value="">Choose…</option>
          <option value="keep-local">Keep this device</option>
          <option value="accept-remote">Accept synchronized record</option>
        `;
      select.addEventListener('change', updateApplyAvailability);
      label.append(select);
      row.append(label);
    } else if (item.status === 'schema-conflict' && item.localPresent) {
      const label = document.createElement('label');
      label.textContent = 'This app cannot import a different remote schema';
      const select = document.createElement('select');
      select.dataset.recordKey = item.recordKey;
      select.innerHTML = `
        <option value="">Choose…</option>
        <option value="keep-local">Keep this device</option>
      `;
      select.addEventListener('change', updateApplyAvailability);
      label.append(select);
      row.append(label);
    } else if (item.status === 'schema-conflict' ||
        (item.status === 'remote-only' && item.remoteDeleted)) {
      const blocked = document.createElement('p');
      blocked.dataset.migrationBlocked = '';
      blocked.textContent =
        'This synchronized record cannot be applied safely. Local data has not changed.';
      row.append(blocked);
    }
    return row;
  };

  const renderPreview = result => {
    previewResult = result;
    review.hidden = false;
    counts.textContent =
      `${result.preview.localCount} local · ${result.preview.remoteCount} synchronized · ` +
      `${result.preview.conflictCount} conflict${result.preview.conflictCount === 1 ? '' : 's'}`;
    zeroWrite.textContent = result.preview.writesPerformed === 0
      ? 'Preview confirmed: 0 writes performed.'
      : 'Preview could not confirm zero writes.';
    zeroWrite.dataset.safe = String(result.preview.writesPerformed === 0);
    records.replaceChildren(...result.preview.review.map(makeReviewRow));
    if (result.preview.remoteCount > 0) {
      const blocked = document.createElement('p');
      blocked.dataset.migrationBlocked = '';
      blocked.textContent =
        'First-device migration is blocked because synchronized Timecard data already exists. ' +
        'Local timecard data was not changed.';
      records.prepend(blocked);
    }
    if (!result.preview.review.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No registered local or synchronized records were found.';
      records.append(empty);
    }
    updateApplyAvailability();
  };

  const renderConflicts = async () => {
    if (!client) return;
    const renderId = ++conflictRender;
    const items = await client.listConflicts();
    if (renderId !== conflictRender) return;
    conflicts.hidden = items.length === 0;
    conflictList.replaceChildren();
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'timecard-sync-conflict';
      const title = document.createElement('strong');
      title.textContent = String(item.recordKey || '').split('\u001f').slice(-2).join(' · ');
      const reason = document.createElement('span');
      reason.textContent = `Reason: ${item.reason || 'conflict'}`;
      const actions = document.createElement('div');
      actions.className = 'timecard-sync-conflict-actions';
      const revision = Number.isInteger(item.current && item.current.revision)
        ? item.current.revision
        : 0;
      const choices = [['Keep this device', 'keep-local']];
      if (item.current && !item.current.deleted) {
        choices.push(['Accept synchronized record', 'accept-remote']);
      }
      for (const [label, strategy] of choices) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = label;
        choice.addEventListener('click', () => {
          void runAction(async () => {
            await client.resolveConflict(item.recordKey, {
              strategy,
              expectedRemoteRevision: revision,
            });
            await renderConflicts();
          });
        });
        actions.append(choice);
      }
      card.append(title, reason, actions);
      conflictList.append(card);
    }
  };

  const showState = state => {
    const mode = state && state.mode || 'disconnected';
    openButton.dataset.state = mode;
    openButton.title = state && state.message || 'Open sync and backup';
    stateBox.dataset.state = mode;
    stateLabel.textContent = stateLabels[mode] || mode;
    stateMessage.textContent = state && state.message || 'Local timecard data remains on this device.';
    connectButton.hidden = mode !== 'disconnected';
    syncButton.hidden = !['synced', 'offline', 'conflict'].includes(mode);
    previewButton.hidden = mode !== 'review';
    disconnectButton.hidden = mode === 'disconnected';
    resetButton.hidden = mode !== 'disconnected';
    if (mode === 'conflict') void renderConflicts();
    else {
      conflictRender += 1;
      conflicts.hidden = true;
      conflictList.replaceChildren();
    }
  };

  const runAction = async action => {
    if (busy) return;
    showAlert('');
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'The action could not be completed safely.');
    } finally {
      setBusy(false);
    }
  };

  const initialize = async () => {
    if (!store) throw new Error('The Timecard local data store did not load.');
    const inspected = store.inspect();
    if (inspected.status === 'invalid') throw inspected.error;
    if (!window.RyanAppSync || typeof window.RyanAppSync.create !== 'function') {
      throw new Error('Ryan App Sync is unavailable. Raw local backup still works.');
    }
    client = window.RyanAppSync.create({
      appId: APP_ID,
      manifestVersion: MANIFEST_VERSION,
      deviceLabel: `Timecard Validator · ${navigator.platform || 'browser'}`,
      showStatus: false,
    });
    client.onStateChange(showState);
    workspaceHandle = await client.register(workspaceAdapter);
    viewHandle = await client.register(viewAdapter);
    await client.finalizeRegistration();
    initialized = true;
    showState(client.getState());
    return true;
  };

  const ready = initialize().catch(error => {
    showAlert(error instanceof Error ? error.message : 'Ryan App Sync could not initialize.');
    stateMessage.textContent = 'Raw local backup remains available; synchronization is unavailable.';
    connectButton.hidden = true;
    syncButton.hidden = true;
    previewButton.hidden = true;
    disconnectButton.hidden = true;
    resetButton.hidden = true;
    throw error;
  });
  ready.catch(() => {});

  openButton.addEventListener('click', () => {
    restoreFocus = document.activeElement;
    const storedError = store && store.getLastError();
    showAlert(storedError ? storedError.message : '');
    if (!dialog.open) dialog.showModal();
    closeButton.focus();
  });

  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (restoreFocus && typeof restoreFocus.focus === 'function') restoreFocus.focus();
    restoreFocus = null;
  });

  connectButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.connect();
    });
  });

  syncButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.sync();
      await renderConflicts();
    });
  });

  backupButton.addEventListener('click', () => {
    void runAction(async () => {
      downloadRawBackup();
      if (!initialized) {
        showAlert('Raw local backup downloaded. Safe sync is unavailable on this page.');
        return;
      }
      await client.exportBackup(true);
    });
  });

  previewButton.addEventListener('click', () => {
    void runAction(async () => {
      downloadRawBackup();
      await ready;
      const result = await client.previewMigration({
        sourceKey: 'timecard-validator-browser-v1',
        downloadBackup: true,
      });
      renderPreview(result);
    });
  });

  applyButton.addEventListener('click', () => {
    void runAction(async () => {
      if (!previewResult || previewResult.preview.writesPerformed !== 0) {
        throw new Error('Create and review a fresh zero-write migration preview.');
      }
      if (previewResult.preview.remoteCount > 0) {
        throw new Error(
          'First-device migration is blocked because synchronized Timecard records already exist.'
        );
      }
      const resolutions = {};
      records.querySelectorAll('select[data-record-key]').forEach(select => {
        if (select.value) resolutions[select.dataset.recordKey] = select.value;
      });
      await client.applyMigration(previewResult.plan, resolutions);
      invalidatePreview();
      await renderConflicts();
    });
  });

  disconnectButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.disconnect();
      invalidatePreview();
    });
  });

  resetButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.resetDevice();
      invalidatePreview();
      showAlert(
        'Device connection reset. Local Timecard data was preserved; connect again and review a fresh preview.'
      );
    });
  });

  window.TimecardSync = Object.freeze({
    appId: APP_ID,
    manifestVersion: MANIFEST_VERSION,
    ready,
    open: () => openButton.click(),
    rawBackup: () => store.rawBackup(),
  });
})();

(() => {
  'use strict';

  const STORAGE_KEY = 'timecard-validator-v1';
  const CHANGE_EVENT = 'timecard-validator-state-changed';
  const ERROR_EVENT = 'timecard-validator-storage-error';
  const LOCK_NAME = 'timecard-validator:local-state-v1';
  const DAYS_PER_WEEK = 7;
  const MAX_WEEKS = 4;
  const MAX_PERIODS = 3;
  const root = window;
  let fallbackQueue = Promise.resolve();
  let lastError = null;

  const plainObject = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };

  const exactKeys = (value, keys) => (
    plainObject(value) &&
    Object.keys(value).sort().join('\u001f') === keys.slice().sort().join('\u001f')
  );

  const clone = value => JSON.parse(JSON.stringify(value));

  const validTime = value => (
    value === '' ||
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  );

  const validSaturday = value => {
    if (value === '') return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return false;
    const normalized = [
      String(date.getFullYear()).padStart(4, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    return normalized === value && date.getDay() === 6;
  };

  const isPeriod = value => (
    exactKeys(value, ['start', 'end']) &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    validTime(value.start) &&
    validTime(value.end)
  );

  const isDay = value => (
    exactKeys(value, ['periods']) &&
    Array.isArray(value.periods) &&
    value.periods.length >= 1 &&
    value.periods.length <= MAX_PERIODS &&
    value.periods.every(isPeriod)
  );

  const isWeek = value => (
    exactKeys(value, ['days']) &&
    Array.isArray(value.days) &&
    value.days.length === DAYS_PER_WEEK &&
    value.days.every(isDay)
  );

  const isWorkspaceValue = value => (
    exactKeys(value, ['weekStart', 'weeks']) &&
    typeof value.weekStart === 'string' &&
    validSaturday(value.weekStart) &&
    Array.isArray(value.weeks) &&
    value.weeks.length === MAX_WEEKS &&
    value.weeks.every(isWeek)
  );

  const isViewValue = value => (
    exactKeys(value, ['visibleWeekCount']) &&
    Number.isSafeInteger(value.visibleWeekCount) &&
    value.visibleWeekCount >= 1 &&
    value.visibleWeekCount <= MAX_WEEKS
  );

  const isState = value => (
    exactKeys(value, ['version', 'weekStart', 'visibleWeekCount', 'weeks']) &&
    value.version === 1 &&
    isWorkspaceValue({
      weekStart: value.weekStart,
      weeks: value.weeks,
    }) &&
    isViewValue({ visibleWeekCount: value.visibleWeekCount })
  );

  const assertState = value => {
    if (!isState(value)) {
      throw new Error('The saved timecard has an invalid format. Download its raw backup before making changes.');
    }
    return value;
  };

  const emptyPeriod = () => ({ start: '', end: '' });
  const emptyDay = () => ({ periods: [emptyPeriod()] });
  const emptyWeek = () => ({
    days: Array.from({ length: DAYS_PER_WEEK }, emptyDay),
  });

  const currentSaturday = () => {
    const date = new Date();
    date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
    return [
      String(date.getFullYear()).padStart(4, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  const defaultState = (weekStart = currentSaturday()) => ({
    version: 1,
    weekStart,
    visibleWeekCount: 1,
    weeks: Array.from({ length: MAX_WEEKS }, emptyWeek),
  });

  const parseRaw = raw => {
    if (raw === null) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('The saved timecard is not valid JSON. Download its raw backup before making changes.');
    }
    return clone(assertState(parsed));
  };

  const readUnlocked = () => parseRaw(root.localStorage.getItem(STORAGE_KEY));

  const workspaceValue = state => {
    assertState(state);
    return clone({
      weekStart: state.weekStart,
      weeks: state.weeks,
    });
  };

  const viewValue = state => {
    assertState(state);
    return { visibleWeekCount: state.visibleWeekCount };
  };

  const changedFacets = (before, after) => {
    if (!before) return ['workspace', 'view'];
    const changed = [];
    if (JSON.stringify(workspaceValue(before)) !== JSON.stringify(workspaceValue(after))) {
      changed.push('workspace');
    }
    if (before.visibleWeekCount !== after.visibleWeekCount) changed.push('view');
    return changed;
  };

  const publishError = error => {
    lastError = error instanceof Error ? error : new Error('Browser storage is unavailable.');
    root.dispatchEvent(new CustomEvent(ERROR_EVENT, {
      detail: { message: lastError.message },
    }));
  };

  const writeUnlocked = (candidate, source) => {
    const next = clone(assertState(candidate));
    const previousRaw = root.localStorage.getItem(STORAGE_KEY);
    const previous = parseRaw(previousRaw);
    const nextRaw = JSON.stringify(next);
    const changed = changedFacets(previous, next);
    if (previousRaw === nextRaw) {
      return { state: next, changed: [], settled: Promise.resolve([]) };
    }

    root.localStorage.setItem(STORAGE_KEY, nextRaw);
    lastError = null;
    const pending = [];
    root.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        source,
        state: clone(next),
        changed: changed.slice(),
        waitUntil(promise) {
          pending.push(Promise.resolve(promise));
        },
      },
    }));
    return { state: next, changed, settled: Promise.all(pending) };
  };

  const withAggregateLock = callback => {
    if (root.navigator && root.navigator.locks &&
        typeof root.navigator.locks.request === 'function') {
      return root.navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, callback);
    }
    const result = fallbackQueue.then(callback, callback);
    fallbackQueue = result.catch(() => {});
    return result;
  };

  const write = async (candidate, { source = 'local' } = {}) => {
    let committed;
    try {
      committed = await withAggregateLock(() => writeUnlocked(candidate, source));
    } catch (error) {
      publishError(error);
      throw error;
    }
    try {
      await committed.settled;
    } catch (error) {
      if (error && typeof error === 'object') error.localSaved = true;
      publishError(error);
      throw error;
    }
    return committed;
  };

  const update = async (mutator, source) => {
    let committed;
    try {
      committed = await withAggregateLock(() => {
        const existing = readUnlocked();
        const base = existing || defaultState();
        const next = mutator(clone(base));
        return writeUnlocked(next, source);
      });
    } catch (error) {
      publishError(error);
      throw error;
    }
    try {
      await committed.settled;
    } catch (error) {
      if (error && typeof error === 'object') error.localSaved = true;
      publishError(error);
      throw error;
    }
    return committed;
  };

  const applyWorkspace = (value, { source = 'sync', deleted = false } = {}) => {
    if (deleted) throw new Error('The current timecard workspace cannot be deleted by synchronization.');
    if (!isWorkspaceValue(value)) throw new Error('The synchronized timecard workspace is invalid.');
    return update(state => ({
      version: 1,
      weekStart: value.weekStart,
      visibleWeekCount: state.visibleWeekCount,
      weeks: clone(value.weeks),
    }), source);
  };

  const applyView = (value, { source = 'sync', deleted = false } = {}) => {
    if (deleted) throw new Error('The Timecard view preference cannot be deleted by synchronization.');
    if (!isViewValue(value)) throw new Error('The synchronized Timecard view preference is invalid.');
    return update(state => ({
      version: 1,
      weekStart: state.weekStart,
      visibleWeekCount: value.visibleWeekCount,
      weeks: clone(state.weeks),
    }), source);
  };

  const inspect = () => {
    let raw = null;
    try {
      raw = root.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return { status: 'missing', raw: null, state: null, error: null };
      const state = parseRaw(raw);
      lastError = null;
      return { status: 'valid', raw, state, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Browser storage is unavailable.');
      return { status: 'invalid', raw, state: null, error: lastError };
    }
  };

  const rawBackup = () => {
    const raw = root.localStorage.getItem(STORAGE_KEY);
    return {
      version: 1,
      kind: 'timecard_validator_browser_local_raw_backup',
      app_id: 'timecard-validator',
      exported_at: new Date().toISOString(),
      records: [{
        key: STORAGE_KEY,
        present: raw !== null,
        raw_value: raw,
      }],
    };
  };

  root.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    try {
      const next = parseRaw(event.newValue);
      if (!next) return;
      const previous = parseRaw(event.oldValue);
      lastError = null;
      root.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
        detail: {
          source: 'storage',
          state: clone(next),
          changed: changedFacets(previous, next),
          waitUntil() {},
        },
      }));
    } catch (error) {
      publishError(error);
    }
  });

  root.TimecardStore = Object.freeze({
    storageKey: STORAGE_KEY,
    changeEvent: CHANGE_EVENT,
    errorEvent: ERROR_EVENT,
    lockName: LOCK_NAME,
    inspect,
    read: readUnlocked,
    write,
    rawBackup,
    defaultState,
    workspaceValue,
    viewValue,
    isState,
    isWorkspaceValue,
    isViewValue,
    applyWorkspace,
    applyView,
    getLastError: () => lastError,
  });
})();

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

  const validLegacyBreakMinutes = value => {
    if (typeof value === 'number') {
      return Number.isFinite(value) && !Object.is(value, -0) &&
        value >= 0 && value <= 240;
    }
    if (typeof value !== 'string') return false;
    if (value === '') return true;
    if (value.length > 32) return false;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false;
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 0 && minutes <= 240;
  };

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

  const stateValidationReason = (value, { manualBreaks = false } = {}) => {
    if (!plainObject(value)) return 'the root must be a JSON object.';
    if (!exactKeys(value, ['version', 'weekStart', 'visibleWeekCount', 'weeks'])) {
      return 'the root fields must be exactly version, weekStart, visibleWeekCount, and weeks.';
    }
    if (value.version !== 1) return 'version must be 1.';
    if (typeof value.weekStart !== 'string') return 'weekStart must be a string.';
    if (!validSaturday(value.weekStart)) {
      return 'weekStart must be empty or a real Saturday in YYYY-MM-DD format.';
    }
    if (!Number.isSafeInteger(value.visibleWeekCount) ||
        value.visibleWeekCount < 1 || value.visibleWeekCount > MAX_WEEKS) {
      return 'visibleWeekCount must be an integer from 1 through 4.';
    }
    if (!Array.isArray(value.weeks) || value.weeks.length !== MAX_WEEKS) {
      return 'weeks must be an array with exactly 4 entries.';
    }

    for (let weekIndex = 0; weekIndex < value.weeks.length; weekIndex += 1) {
      const week = value.weeks[weekIndex];
      if (!plainObject(week) || !exactKeys(week, ['days'])) {
        return `week ${weekIndex + 1} must contain only the days field.`;
      }
      if (!Array.isArray(week.days) || week.days.length !== DAYS_PER_WEEK) {
        return `week ${weekIndex + 1} days must be an array with exactly 7 entries.`;
      }

      for (let dayIndex = 0; dayIndex < week.days.length; dayIndex += 1) {
        const day = week.days[dayIndex];
        if (!plainObject(day) || !exactKeys(day, ['periods'])) {
          return `week ${weekIndex + 1}, day ${dayIndex + 1} must contain only the periods field.`;
        }
        if (!Array.isArray(day.periods) ||
            day.periods.length < 1 || day.periods.length > MAX_PERIODS) {
          return `week ${weekIndex + 1}, day ${dayIndex + 1} periods must be an array with 1 through 3 entries.`;
        }

        for (let periodIndex = 0; periodIndex < day.periods.length; periodIndex += 1) {
          const period = day.periods[periodIndex];
          const location =
            `week ${weekIndex + 1}, day ${dayIndex + 1}, period ${periodIndex + 1}`;
          const periodFields = manualBreaks
            ? ['start', 'end', 'breakMinutes']
            : ['start', 'end'];
          if (!plainObject(period) || !exactKeys(period, periodFields)) {
            return manualBreaks
              ? `${location} must contain only the start, end, and breakMinutes fields.`
              : `${location} must contain only the start and end fields.`;
          }
          if (typeof period.start !== 'string' || typeof period.end !== 'string') {
            return `${location} start and end must be strings.`;
          }
          if (!validTime(period.start) || !validTime(period.end)) {
            return `${location} times must be empty or use 24-hour HH:MM format.`;
          }
          if (manualBreaks && !validLegacyBreakMinutes(period.breakMinutes)) {
            return `${location} breakMinutes must be an empty or numeric string up to 32 characters, or a number, from 0 through 240.`;
          }
        }
      }
    }
    return '';
  };

  const isState = value => stateValidationReason(value) === '';
  const isLegacyState = value => (
    stateValidationReason(value, { manualBreaks: true }) === ''
  );

  const assertState = value => {
    const reason = stateValidationReason(value);
    if (reason) {
      throw new Error(
        `The saved timecard has an invalid format. Reason: ${reason} ` +
        'Download its raw backup before making changes.'
      );
    }
    return value;
  };

  const assertLegacyState = value => {
    const reason = stateValidationReason(value, { manualBreaks: true });
    if (reason) {
      throw new Error(
        `The legacy manual-break timecard has an invalid format. Reason: ${reason} ` +
        'Download its raw backup before making changes.'
      );
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

  const parseJsonRaw = raw => {
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('The saved timecard is not valid JSON. Download its raw backup before making changes.');
    }
  };

  const parseRaw = raw => {
    const parsed = parseJsonRaw(raw);
    return parsed === null ? null : clone(assertState(parsed));
  };

  const readUnlocked = () => parseRaw(root.localStorage.getItem(STORAGE_KEY));

  const readLegacy = () => {
    const parsed = parseJsonRaw(root.localStorage.getItem(STORAGE_KEY));
    return parsed === null ? null : clone(assertLegacyState(parsed));
  };

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
      const parsed = parseJsonRaw(raw);
      if (isLegacyState(parsed)) {
        lastError = null;
        return {
          status: 'legacy',
          raw,
          state: null,
          legacyState: clone(parsed),
          error: null,
        };
      }
      const state = clone(assertState(parsed));
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
    isLegacyState,
    isWorkspaceValue,
    isViewValue,
    readLegacy,
    applyWorkspace,
    applyView,
    getLastError: () => lastError,
  });
})();

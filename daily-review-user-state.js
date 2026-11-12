import { normalizeDailyReview } from './daily-review.js';

export class DailyReviewUserStateError extends Error {
  constructor() {
    super('validation_error');
    this.name = 'DailyReviewUserStateError';
    this.errorType = 'validation_error';
  }
}

const fail = () => { throw new DailyReviewUserStateError(); };

const isPlain = (val) => {
  if (!val || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
};

const hasKeys = (obj, keys) => {
  const objKeys = Object.keys(obj);
  return objKeys.length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
};

const isInt = (val) => typeof val === 'number' && Number.isInteger(val) && !Number.isNaN(val);

const isValidIso = (str) => {
  if (typeof str !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(str) && !isNaN(Date.parse(str));
};

const isValidDateStr = (str) => {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

const cleanStr = (val) => {
  if (typeof val !== 'string') fail();
  if (val.trim() === '') fail();
  return val;
};

const parseSource = (s) => {
  if (!isPlain(s) || !hasKeys(s, ['recordId', 'revision', 'checksum'])) fail();
  const recordId = cleanStr(s.recordId);
  if (!isInt(s.revision) || s.revision < 1) fail();
  const checksum = cleanStr(s.checksum);
  return { recordId, revision: s.revision, checksum };
};

export function createDailyReviewUserState(rawReview, nowIso) {
  let normalized;
  try {
    normalized = normalizeDailyReview(rawReview);
  } catch {
    fail();
  }

  if (!isValidIso(nowIso)) fail();

  const sources = (normalized.sources || []).map(parseSource);
  if (normalized.sourceCount !== sources.length) fail();

  const confirmations = (normalized.confirmations || []).map(c => {
    if (!isPlain(c) || !hasKeys(c, ['recordId', 'text', 'userStatus'])) fail();
    return {
      recordId: cleanStr(c.recordId),
      text: typeof c.text === 'string' ? cleanStr(c.text) : fail(),
      decision: 'pending',
      correction: ''
    };
  });

  return {
    schemaVersion: 1,
    reviewDate: normalized.reviewDate,
    sourceReview: {
      sourceCount: normalized.sourceCount,
      sources
    },
    confirmations,
    reflection: '',
    todayPriority: '',
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function normalizeDailyReviewUserState(value) {
  if (!isPlain(value)) fail();

  const topKeys = ['schemaVersion', 'reviewDate', 'sourceReview', 'confirmations', 'reflection', 'todayPriority', 'createdAt', 'updatedAt'];
  if (!hasKeys(value, topKeys)) fail();

  if (value.schemaVersion !== 1 || !isInt(value.schemaVersion)) fail();
  if (!isValidDateStr(value.reviewDate)) fail();

  const sr = value.sourceReview;
  if (!isPlain(sr) || !hasKeys(sr, ['sourceCount', 'sources'])) fail();
  if (!isInt(sr.sourceCount) || sr.sourceCount < 0) fail();
  if (!Array.isArray(sr.sources) || sr.sources.length !== sr.sourceCount) fail();

  const sources = sr.sources.map(parseSource);

  if (!Array.isArray(value.confirmations)) fail();
  const confirmations = value.confirmations.map(c => {
    if (!isPlain(c) || !hasKeys(c, ['recordId', 'text', 'decision', 'correction'])) fail();
    const recordId = cleanStr(c.recordId);
    const text = cleanStr(c.text);
    if (!['pending', 'confirmed', 'corrected', 'rejected'].includes(c.decision)) fail();
    if (typeof c.correction !== 'string') fail();

    if (c.decision === 'corrected') {
      if (c.correction.trim() === '') fail();
    } else if (c.correction !== '') {
      fail();
    }
    return { recordId, text, decision: c.decision, correction: c.correction };
  });

  if (typeof value.reflection !== 'string' || typeof value.todayPriority !== 'string') fail();
  if (!isValidIso(value.createdAt) || !isValidIso(value.updatedAt)) fail();
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) fail();

  return {
    schemaVersion: 1,
    reviewDate: value.reviewDate,
    sourceReview: {
      sourceCount: sources.length,
      sources
    },
    confirmations,
    reflection: value.reflection,
    todayPriority: value.todayPriority,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

export function updateDailyReviewUserState(rawCurrent, rawChanges, nowIso) {
  const current = normalizeDailyReviewUserState(rawCurrent);
  if (!isPlain(rawChanges) || !hasKeys(rawChanges, ['confirmations', 'reflection', 'todayPriority'])) fail();
  if (!Array.isArray(rawChanges.confirmations) || typeof rawChanges.reflection !== 'string' || typeof rawChanges.todayPriority !== 'string') fail();
  if (!isValidIso(nowIso)) fail();

  const nowTime = Date.parse(nowIso);
  if (nowTime < Date.parse(current.createdAt) || nowTime < Date.parse(current.updatedAt)) fail();

  const currentMap = new Map();
  for (const confirmation of current.confirmations) {
    if (currentMap.has(confirmation.recordId)) fail();
    currentMap.set(confirmation.recordId, confirmation);
  }
  if (rawChanges.confirmations.length !== current.confirmations.length) fail();

  const changedByRecordId = new Map();
  const validDecisions = new Set(['pending', 'confirmed', 'corrected', 'rejected']);
  for (const item of rawChanges.confirmations) {
    if (!isPlain(item) || !hasKeys(item, ['recordId', 'decision', 'correction'])) fail();
    if (typeof item.recordId !== 'string' || changedByRecordId.has(item.recordId) || !currentMap.has(item.recordId)) fail();
    if (typeof item.decision !== 'string' || !validDecisions.has(item.decision)) fail();
    if (typeof item.correction !== 'string') fail();
    if (item.decision === 'corrected') {
      if (item.correction.trim() === '') fail();
    } else if (item.correction !== '') {
      fail();
    }
    changedByRecordId.set(item.recordId, item);
  }

  const confirmations = current.confirmations.map(confirmation => {
    const change = changedByRecordId.get(confirmation.recordId);
    if (!change) fail();
    return {
      recordId: confirmation.recordId,
      text: confirmation.text,
      decision: change.decision,
      correction: change.correction
    };
  });

  return normalizeDailyReviewUserState({
    schemaVersion: current.schemaVersion,
    reviewDate: current.reviewDate,
    sourceReview: current.sourceReview,
    confirmations,
    reflection: rawChanges.reflection,
    todayPriority: rawChanges.todayPriority,
    createdAt: current.createdAt,
    updatedAt: nowIso
  });
}

export class DailyReviewViewError extends Error {
  constructor() {
    super('validation_error');
    this.name = 'DailyReviewViewError';
    this.errorType = 'validation_error';
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v) && !Number.isNaN(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const hasExactKeys = (obj, keys) => {
  const ks = Object.keys(obj);
  return ks.length === keys.length && keys.every(k => ks.includes(k));
};

function isValidDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const isStatus = (v) => ['pending', 'confirmed', 'corrected', 'rejected'].includes(v);

function validateArray(arr, keys, itemValidator) {
  if (!Array.isArray(arr)) throw new DailyReviewViewError();
  return arr.map(item => {
    if (!isObj(item) || !hasExactKeys(item, keys)) throw new DailyReviewViewError();
    return itemValidator(item);
  });
}

export function normalizeDailyReview(value) {
  const allowedTop = ['schemaVersion', 'reviewDate', 'timezone', 'sourceCount', 'sources', 'facts', 'confirmations', 'tags', 'recordTypes'];
  if (!isObj(value) || !Object.keys(value).every(k => allowedTop.includes(k))) throw new DailyReviewViewError();

  const { schemaVersion, reviewDate, timezone, sourceCount, sources, facts, confirmations, tags, recordTypes } = value;

  if (typeof schemaVersion === 'boolean' || !isInt(schemaVersion) || schemaVersion !== 1) throw new DailyReviewViewError();
  if (!isValidDate(reviewDate)) throw new DailyReviewViewError();
  if (typeof timezone !== 'string' || !isStr(timezone)) throw new DailyReviewViewError();
  if (typeof sourceCount === 'boolean' || !isInt(sourceCount) || sourceCount < 0) throw new DailyReviewViewError();

  const vSources = validateArray(sources, ['recordId', 'checksum', 'revision'], (i) => {
    if (!isStr(i.recordId) || !isStr(i.checksum) || typeof i.revision === 'boolean' || !isInt(i.revision) || i.revision < 1) throw new DailyReviewViewError();
    return { recordId: i.recordId, checksum: i.checksum, revision: i.revision };
  });

  if (sourceCount !== vSources.length) throw new DailyReviewViewError();

  const vFacts = validateArray(facts, ['recordId', 'summary', 'userStatus', 'confidence'], (i) => {
    if (!isStr(i.recordId) || !isStr(i.summary) || !isStatus(i.userStatus) || typeof i.confidence === 'boolean' || typeof i.confidence !== 'number' || !Number.isFinite(i.confidence) || i.confidence < 0 || i.confidence > 1) throw new DailyReviewViewError();
    return { recordId: i.recordId, summary: i.summary, userStatus: i.userStatus, confidence: i.confidence };
  });

  const vConf = validateArray(confirmations, ['recordId', 'text', 'userStatus'], (i) => {
    if (!isStr(i.recordId) || !isStr(i.text) || !isStatus(i.userStatus)) throw new DailyReviewViewError();
    return { recordId: i.recordId, text: i.text, userStatus: i.userStatus };
  });

  const vTags = validateArray(tags, ['tag', 'count'], (i) => {
    if (!isStr(i.tag) || typeof i.count === 'boolean' || !isInt(i.count) || i.count < 1) throw new DailyReviewViewError();
    return { tag: i.tag, count: i.count };
  });

  const vTypes = validateArray(recordTypes, ['recordType', 'count'], (i) => {
    if (!isStr(i.recordType) || typeof i.count === 'boolean' || !isInt(i.count) || i.count < 1) throw new DailyReviewViewError();
    return { recordType: i.recordType, count: i.count };
  });

  return {
    schemaVersion,
    reviewDate,
    timezone,
    sourceCount,
    sources: vSources,
    facts: vFacts,
    confirmations: vConf,
    tags: vTags,
    recordTypes: vTypes
  };
}

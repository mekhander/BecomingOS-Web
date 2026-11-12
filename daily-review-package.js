import { normalizeDailyReview } from './daily-review.js';

export const DAILY_REVIEW_PACKAGE_KIND = 'becoming_os_daily_review';

export class DailyReviewPackageError extends Error {
  constructor() {
    super('validation_error');
    this.name = 'DailyReviewPackageError';
    this.errorType = 'validation_error';
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isValidISOTimestamp(str) {
  if (typeof str !== 'string') return false;
  const isoRegex = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|[+-]([0-9]{2}):([0-9]{2}))$/;
  const match = str.match(isoRegex);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const timezone = match[8];

  if (timezone !== 'Z') {
    const offsetHour = parseInt(match[9], 10);
    const offsetMinute = parseInt(match[10], 10);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;

  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  if (isLeap) daysInMonth[2] = 29;
  return day <= daysInMonth[month];
}

export function createDailyReviewPackage(rawReview, generatedAt) {
  let normalizedReview;
  try {
    normalizedReview = normalizeDailyReview(rawReview);
  } catch {
    throw new DailyReviewPackageError();
  }
  if (!isValidISOTimestamp(generatedAt)) throw new DailyReviewPackageError();
  return {
    schemaVersion: 1,
    kind: DAILY_REVIEW_PACKAGE_KIND,
    reviewDate: normalizedReview.reviewDate,
    generatedAt,
    review: normalizedReview
  };
}

export function normalizeDailyReviewPackage(value) {
  if (!isPlainObject(value)) throw new DailyReviewPackageError();
  const keys = Object.keys(value);
  const expectedKeys = ['schemaVersion', 'kind', 'reviewDate', 'generatedAt', 'review'];
  if (keys.length !== expectedKeys.length) throw new DailyReviewPackageError();
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (keys[index] !== expectedKeys[index] || !Object.prototype.hasOwnProperty.call(value, expectedKeys[index])) {
      throw new DailyReviewPackageError();
    }
  }
  if (typeof value.schemaVersion !== 'number' || !Number.isInteger(value.schemaVersion) || value.schemaVersion !== 1) {
    throw new DailyReviewPackageError();
  }
  if (value.kind !== DAILY_REVIEW_PACKAGE_KIND || !isValidISOTimestamp(value.generatedAt)) {
    throw new DailyReviewPackageError();
  }

  let normalizedReview;
  try {
    normalizedReview = normalizeDailyReview(value.review);
  } catch {
    throw new DailyReviewPackageError();
  }
  if (typeof value.reviewDate !== 'string' || value.reviewDate !== normalizedReview.reviewDate) {
    throw new DailyReviewPackageError();
  }
  return {
    schemaVersion: 1,
    kind: DAILY_REVIEW_PACKAGE_KIND,
    reviewDate: normalizedReview.reviewDate,
    generatedAt: value.generatedAt,
    review: normalizedReview
  };
}

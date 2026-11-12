import { getSetting, saveSetting } from './db.js?v=4';
import { normalizeDailyReview } from './daily-review.js';

const PREFIX = 'dailyReview:v1:';

function validateDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new TypeError('daily_review_date_required');
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    throw new TypeError('daily_review_date_required');
  }
  return dateStr;
}

function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export function dailyReviewKey(reviewDate) {
  validateDate(reviewDate);
  return PREFIX + reviewDate;
}

export async function saveDailyReview(rawReview) {
  const normalized = normalizeDailyReview(rawReview);
  if (!normalized || typeof normalized !== 'object' || !normalized.reviewDate) {
    throw new TypeError('daily_review_date_required');
  }
  validateDate(normalized.reviewDate);
  const key = PREFIX + normalized.reviewDate;
  const clonedForStorage = deepClone(normalized);
  await saveSetting(key, clonedForStorage);
  return deepClone(normalized);
}

export async function getDailyReview(reviewDate) {
  validateDate(reviewDate);
  const key = PREFIX + reviewDate;
  const stored = await getSetting(key, null);
  if (stored === null || stored === undefined) {
    return null;
  }
  const normalized = normalizeDailyReview(stored);
  if (normalized.reviewDate !== reviewDate) {
    throw new Error('daily_review_date_mismatch');
  }
  return deepClone(normalized);
}

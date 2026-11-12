import { getSetting, saveSetting } from './db.js?v=4';
import { normalizeDailyReviewUserState } from './daily-review-user-state.js';

const PREFIX = 'dailyReviewUserState:v1:';

function validateReviewDate(reviewDate) {
  if (typeof reviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
    throw new TypeError('daily_review_user_state_date_required');
  }
  const parts = reviewDate.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const date = new Date(0);
  date.setUTCFullYear(year);
  date.setUTCMonth(month - 1);
  date.setUTCDate(day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError('daily_review_user_state_date_required');
  }
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function dailyReviewUserStateKey(reviewDate) {
  validateReviewDate(reviewDate);
  return PREFIX + reviewDate;
}

export async function saveDailyReviewUserState(rawState) {
  const normalized = normalizeDailyReviewUserState(rawState);
  const key = dailyReviewUserStateKey(normalized.reviewDate);
  const cloneToSave = deepClone(normalized);
  await saveSetting(key, cloneToSave);
  return deepClone(cloneToSave);
}

export async function getDailyReviewUserState(reviewDate) {
  validateReviewDate(reviewDate);
  const key = dailyReviewUserStateKey(reviewDate);
  const saved = await getSetting(key, null);
  if (saved === null || saved === undefined) {
    return null;
  }
  const normalized = normalizeDailyReviewUserState(saved);
  if (normalized.reviewDate !== reviewDate) {
    throw new Error('daily_review_user_state_date_mismatch');
  }
  return deepClone(normalized);
}

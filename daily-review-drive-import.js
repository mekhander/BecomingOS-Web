import { normalizeDailyReviewPackage, DailyReviewPackageError } from './daily-review-package.js';
import { saveDailyReview } from './daily-review-store.js';

export class DailyReviewDriveImportError extends Error {
  constructor(errorType) {
    super(errorType);
    this.name = 'DailyReviewDriveImportError';
    this.errorType = errorType;
  }
}

const DATE_REGEX = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function isLeapYear(year) {
  if (year % 4 !== 0) return false;
  if (year % 100 !== 0) return true;
  return year % 400 === 0;
}

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const match = DATE_REGEX.exec(dateStr);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  let maxDays = 31;
  if (month === 2) maxDays = isLeapYear(year) ? 29 : 28;
  else if (month === 4 || month === 6 || month === 9 || month === 11) maxDays = 30;
  return day <= maxDays;
}

function hasTokenUnsafeChars(str) {
  return typeof str !== 'string' || str.includes('\r') || str.includes('\n');
}

function hasIdUnsafeChars(str) {
  return typeof str !== 'string' || str.includes('\r') || str.includes('\n') || str.includes('/') || str.includes('\\');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function mapHttpError(status) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict_error';
  if (status === 429 || (status >= 500 && status <= 599)) return 'retryable_error';
  return 'api_error';
}

export async function importDailyReviewFromDrive(reviewDate, options = {}) {
  if (!isValidDateString(reviewDate) || !isPlainObject(options)) {
    throw new DailyReviewDriveImportError('validation_error');
  }

  const allowedKeys = new Set(['accessToken', 'folderId', 'fetchImpl', 'saveReview', 'dryRun']);
  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) throw new DailyReviewDriveImportError('validation_error');
  }

  const {
    accessToken,
    folderId,
    fetchImpl = globalThis.fetch,
    saveReview = saveDailyReview,
    dryRun = false
  } = options;

  if (typeof accessToken !== 'string' || accessToken.trim() === '' || hasTokenUnsafeChars(accessToken)) {
    throw new DailyReviewDriveImportError('validation_error');
  }
  if (typeof folderId !== 'string' || folderId.trim() === '' || hasIdUnsafeChars(folderId)) {
    throw new DailyReviewDriveImportError('validation_error');
  }
  if (typeof fetchImpl !== 'function' || typeof saveReview !== 'function' || typeof dryRun !== 'boolean') {
    throw new DailyReviewDriveImportError('validation_error');
  }

  const q = `trashed=false and '${folderId.replace(/'/g, "\\'")}' in parents and appProperties has { key='app' and value='BecomingOS' } and appProperties has { key='kind' and value='daily_review' } and appProperties has { key='reviewDate' and value='${reviewDate}' }`;
  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    pageSize: '2',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,modifiedTime,appProperties)'
  });

  let listResponse;
  try {
    listResponse = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
  } catch {
    throw new DailyReviewDriveImportError('network_error');
  }
  if (!listResponse.ok) throw new DailyReviewDriveImportError(mapHttpError(listResponse.status));

  let listText;
  try {
    listText = await listResponse.text();
  } catch {
    throw new DailyReviewDriveImportError('response_error');
  }
  if (new TextEncoder().encode(listText).length > 1048576) {
    throw new DailyReviewDriveImportError('response_error');
  }

  let listData;
  try {
    listData = JSON.parse(listText);
  } catch {
    throw new DailyReviewDriveImportError('response_error');
  }
  if (!isPlainObject(listData) || !Array.isArray(listData.files)) {
    throw new DailyReviewDriveImportError('response_error');
  }
  if (listData.files.length === 0) return { status: 'not_found', reviewDate };
  if (listData.files.length > 1) throw new DailyReviewDriveImportError('response_error');

  const fileItem = listData.files[0];
  if (!isPlainObject(fileItem)) throw new DailyReviewDriveImportError('response_error');
  const fileId = fileItem.id;
  if (typeof fileId !== 'string' || fileId.trim() === '' || hasIdUnsafeChars(fileId)) {
    throw new DailyReviewDriveImportError('response_error');
  }

  let downloadResponse;
  try {
    downloadResponse = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
  } catch {
    throw new DailyReviewDriveImportError('network_error');
  }
  if (!downloadResponse.ok) throw new DailyReviewDriveImportError(mapHttpError(downloadResponse.status));

  let arrayBuffer;
  try {
    arrayBuffer = await downloadResponse.arrayBuffer();
  } catch {
    throw new DailyReviewDriveImportError('response_error');
  }
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength > 1048576) {
    throw new DailyReviewDriveImportError('response_error');
  }

  let parsedPackage;
  try {
    const fileContentText = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
    parsedPackage = JSON.parse(fileContentText);
  } catch {
    throw new DailyReviewDriveImportError('validation_error');
  }

  let normalizedPkg;
  try {
    normalizedPkg = normalizeDailyReviewPackage(parsedPackage);
  } catch (error) {
    if (error instanceof DailyReviewPackageError) {
      throw new DailyReviewDriveImportError('validation_error');
    }
    throw new DailyReviewDriveImportError('validation_error');
  }
  if (!isPlainObject(normalizedPkg) || normalizedPkg.reviewDate !== reviewDate) {
    throw new DailyReviewDriveImportError('validation_error');
  }

  const generatedAt = normalizedPkg.generatedAt;
  const sourceCount = normalizedPkg.review.sourceCount;
  if (dryRun) return { status: 'would_import', reviewDate, fileId, generatedAt, sourceCount };

  let savedResult;
  try {
    savedResult = await saveReview(normalizedPkg.review);
  } catch {
    throw new DailyReviewDriveImportError('storage_error');
  }
  if (!isPlainObject(savedResult) || savedResult.reviewDate !== reviewDate) {
    throw new DailyReviewDriveImportError('storage_error');
  }
  return { status: 'imported', reviewDate, fileId, generatedAt, sourceCount };
}

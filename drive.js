import { getSetting, listEntries, saveEntry } from './db.js?v=4';
import { GOOGLE_CLIENT_ID } from './config.js?v=2';
import { importDailyReviewFromDrive } from './daily-review-drive-import.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let accessToken = '';

function waitForGoogle(timeout = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (globalThis.google?.accounts?.oauth2) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error('Google 로그인 모듈을 불러오지 못했습니다.')); }
    }, 100);
  });
}

export async function connectDrive() {
  await waitForGoogle();
  accessToken = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => response.error ? reject(new Error(response.error)) : resolve(response.access_token),
      error_callback: () => reject(new Error('Google 로그인이 취소되었습니다.'))
    });
    client.requestAccessToken({ prompt: '' });
  });
  return true;
}

async function driveFetch(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
      if (response.ok) return response.status === 204 ? null : response.json();
      if (response.status < 500 && response.status !== 429) throw new Error(`Drive 요청 실패 (${response.status})`);
      lastError = new Error(`Drive 일시 오류 (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError;
}

async function getExistingFolderId() {
  const saved = await getSetting('driveFolderId');
  if (saved) return saved;
  const { saveSetting } = await import('./db.js');
  const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='app' and value='BecomingOS' }";
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,createdTime)')}&orderBy=${encodeURIComponent('createdTime')}&pageSize=1`;
  const existing = await driveFetch(listUrl);
  if (existing?.files?.length) {
    await saveSetting('driveFolderId', existing.files[0].id);
    return existing.files[0].id;
  }
  return null;
}

async function getFolderId() {
  const existingFolderId = await getExistingFolderId();
  if (existingFolderId) return existingFolderId;
  const { saveSetting } = await import('./db.js');
  const metadata = { name: 'BecomingOS', mimeType: 'application/vnd.google-apps.folder', appProperties: { app: 'BecomingOS' } };
  const folder = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(metadata) });
  await saveSetting('driveFolderId', folder.id);
  return folder.id;
}

export async function syncDailyReview(reviewDate, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('daily_review_sync_options_invalid');
  }
  const proto = Object.getPrototypeOf(options);
  if (proto !== null && proto !== Object.prototype) {
    throw new TypeError('daily_review_sync_options_invalid');
  }
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const allowedKeys = ['interactive', 'fetchImpl', 'saveReview', 'dryRun'];
  for (const key of Object.keys(options)) {
    if (!allowedKeys.includes(key)) {
      throw new TypeError('daily_review_sync_options_invalid');
    }
  }
  let interactive = true;
  if (hasOwn(options, 'interactive')) {
    if (typeof options.interactive !== 'boolean') {
      throw new TypeError('daily_review_sync_options_invalid');
    }
    interactive = options.interactive;
  }
  let dryRun = false;
  if (hasOwn(options, 'dryRun')) {
    if (typeof options.dryRun !== 'boolean') {
      throw new TypeError('daily_review_sync_options_invalid');
    }
    dryRun = options.dryRun;
  }
  if (hasOwn(options, 'fetchImpl') && typeof options.fetchImpl !== 'function') {
    throw new TypeError('daily_review_sync_options_invalid');
  }
  if (hasOwn(options, 'saveReview') && typeof options.saveReview !== 'function') {
    throw new TypeError('daily_review_sync_options_invalid');
  }
  if (!accessToken) {
    if (!interactive) {
      return { status: 'skipped', reason: 'not-connected', reviewDate };
    }
    await connectDrive();
  }
  const folderId = await getExistingFolderId();
  if (!folderId) return { status: 'not_found', reviewDate };
  const importerOptions = { accessToken, folderId, dryRun };
  if (hasOwn(options, 'fetchImpl')) {
    importerOptions.fetchImpl = options.fetchImpl;
  }
  if (hasOwn(options, 'saveReview')) {
    importerOptions.saveReview = options.saveReview;
  }
  return importDailyReviewFromDrive(reviewDate, importerOptions);
}

async function findExistingFileId(entryId, kind) {
  const q = `trashed = false and appProperties has { key='app' and value='BecomingOS' } and appProperties has { key='entryId' and value='${entryId}' } and appProperties has { key='kind' and value='${kind}' }`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,createdTime)')}&orderBy=${encodeURIComponent('createdTime')}&pageSize=1`;
  const existing = await driveFetch(listUrl);
  return existing?.files?.[0]?.id || null;
}

async function getOrCreateDriveFile({ existingId, entryId, kind, name, mimeType, data, folderId, checksum, checksumAlgorithm }) {
  if (existingId) return existingId;
  const foundId = await findExistingFileId(entryId, kind);
  if (foundId) return foundId;
  const appProperties = { app: 'BecomingOS', entryId: String(entryId), kind: String(kind) };
  if (kind === 'attachment' && checksum) {
    appProperties.checksumAlgorithm = String(checksumAlgorithm || 'SHA-256');
    appProperties.checksum = String(checksum);
  }
  const uploaded = await uploadMultipart(name, mimeType, data, folderId, { appProperties });
  return uploaded.id;
}

async function uploadMultipart(name, mimeType, data, folderId, extraMetadata = {}) {
  const boundary = `becoming_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  const meta = JSON.stringify({ name, parents: [folderId], ...extraMetadata, appProperties: { app: 'BecomingOS', ...(extraMetadata.appProperties || {}) } });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, data, `\r\n--${boundary}--`]);
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method:'POST', headers:{'Content-Type':`multipart/related; boundary=${boundary}`}, body });
}

export async function syncPending(options = {}) {
  const interactive = options.interactive !== false;
  if (!accessToken) {
    if (!interactive) return { uploaded: 0, total: 0, cloudDeleted: 0, skipped: 'not-connected' };
    await connectDrive();
  }
  const folderId = await getFolderId();
  const pending = (await listEntries()).filter(entry => ['pending','error'].includes(entry.syncState) && !entry.localContentRemoved);
  let uploaded = 0;
  for (const entry of pending) {
    try {
      const metadata = { ...entry, blob: undefined };
      if (!entry.driveMetadataFileId) {
        entry.driveMetadataFileId = await getOrCreateDriveFile({ existingId: entry.driveMetadataFileId, entryId: entry.id, kind: 'metadata', name: `${entry.id}.json`, mimeType: 'application/json', data: JSON.stringify(metadata), folderId });
        await saveEntry(entry);
      }
      if (entry.blob && !entry.driveAttachmentFileId) {
        entry.driveAttachmentFileId = await getOrCreateDriveFile({ existingId: entry.driveAttachmentFileId, entryId: entry.id, kind: 'attachment', name: `${entry.id}-${entry.fileName || 'attachment'}`, mimeType: entry.mimeType || 'application/octet-stream', data: entry.blob, folderId, checksum: entry.checksum, checksumAlgorithm: entry.checksumAlgorithm });
        await saveEntry(entry);
      }
      entry.syncState = 'synced';
      entry.syncedAt = new Date().toISOString();
      await saveEntry(entry);
      uploaded += 1;
    } catch (error) {
      entry.syncState = 'error';
      entry.syncError = error.message;
      await saveEntry(entry);
    }
  }
  return { uploaded, total: pending.length, cloudDeleted: 0 };
}

async function deleteDriveFile(fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok && response.status !== 404) throw new Error(`Drive 삭제 실패 (${response.status})`);
}

export async function cleanupRemoteExpired(days = 365) {
  const cutoff = Date.now() - days * 86400000;
  const entries = await listEntries();
  let deleted = 0;
  for (const entry of entries) {
    if (entry.syncState !== 'synced' || entry.driveContentRemoved || Date.parse(entry.createdAt) >= cutoff) continue;
    try {
      for (const fileId of [entry.driveAttachmentFileId, entry.driveMetadataFileId].filter(Boolean)) await deleteDriveFile(fileId);
      entry.driveContentRemoved = true;
      entry.driveCleanedAt = new Date().toISOString();
      entry.syncState = 'expired';
      await saveEntry(entry);
      deleted += 1;
    } catch (error) {
      entry.syncError = error.message;
      await saveEntry(entry);
    }
  }
  return deleted;
}

import { getSetting, listEntries, saveEntry } from './db.js?v=4';
import { GOOGLE_CLIENT_ID } from './config.js?v=2';

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

async function getFolderId() {
  const saved = await getSetting('driveFolderId');
  if (saved) return saved;
  const metadata = { name: 'BecomingOS', mimeType: 'application/vnd.google-apps.folder', appProperties: { app: 'BecomingOS' } };
  const folder = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(metadata) });
  const { saveSetting } = await import('./db.js');
  await saveSetting('driveFolderId', folder.id);
  return folder.id;
}

async function uploadMultipart(name, mimeType, data, folderId) {
  const boundary = `becoming_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  const meta = JSON.stringify({ name, parents: [folderId], appProperties: { app: 'BecomingOS' } });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, data, `\r\n--${boundary}--`]);
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method:'POST', headers:{'Content-Type':`multipart/related; boundary=${boundary}`}, body });
}

export async function syncPending() {
  if (!accessToken) await connectDrive();
  const folderId = await getFolderId();
  const pending = (await listEntries()).filter(entry => ['pending','error'].includes(entry.syncState) && !entry.localContentRemoved);
  let uploaded = 0;
  for (const entry of pending) {
    try {
      const metadata = { ...entry, blob: undefined };
      if (!entry.driveMetadataFileId) {
        const uploadedMetadata = await uploadMultipart(`${entry.id}.json`, 'application/json', JSON.stringify(metadata), folderId);
        entry.driveMetadataFileId = uploadedMetadata.id;
        await saveEntry(entry);
      }
      if (entry.blob && !entry.driveAttachmentFileId) {
        const uploadedAttachment = await uploadMultipart(`${entry.id}-${entry.fileName || 'attachment'}`, entry.mimeType || 'application/octet-stream', entry.blob, folderId);
        entry.driveAttachmentFileId = uploadedAttachment.id;
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
  const cloudDeleted = await cleanupRemoteExpired(365);
  return { uploaded, total: pending.length, cloudDeleted };
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

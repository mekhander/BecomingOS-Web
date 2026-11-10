const DB_NAME = 'becoming-os';
const DB_VERSION = 1;

function request(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openDatabase() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('createdAt', 'createdAt');
      entries.createIndex('type', 'type');
      entries.createIndex('syncState', 'syncState');
      const plans = db.createObjectStore('plans', { keyPath: 'id' });
      plans.createIndex('createdAt', 'createdAt');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export async function saveEntry(entry) { return request((await store('entries', 'readwrite')).put(entry)); }
export async function getEntry(id) { return request((await store('entries')).get(id)); }
export async function listEntries() { return (await request((await store('entries')).getAll())).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
export async function savePlan(plan) { return request((await store('plans', 'readwrite')).put(plan)); }
export async function listPlans() { return (await request((await store('plans')).getAll())).sort((a,b) => a.done-b.done || a.createdAt.localeCompare(b.createdAt)); }
export async function saveSetting(key, value) { return request((await store('settings','readwrite')).put({key,value})); }
export async function getSetting(key, fallback = '') { const row = await request((await store('settings')).get(key)); return row?.value ?? fallback; }

export async function cleanupSyncedEntries(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const entries = await listEntries();
  let cleaned = 0;
  for (const entry of entries) {
    if (entry.syncState === 'synced' && !entry.localContentRemoved && Date.parse(entry.createdAt) < cutoff) {
      try {
        entry.text = '';
        entry.blob = null;
        entry.localContentRemoved = true;
        entry.cleanedAt = new Date().toISOString();
        await saveEntry(entry);
        cleaned += 1;
      } catch (error) {
        console.error('기기 원본 정리 실패', entry.id, error);
      }
    }
  }
  return cleaned;
}

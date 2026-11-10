const DB_NAME = 'becoming-os';

function request(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openDatabase() {
  return new Promise((resolve, reject) => {
    // Open the installed schema as-is. Entry fields do not need an index, so
    // adding processingState must not force an upgrade that can be blocked by
    // another open BecomingOS tab (for example, while it is recording).
    const opening = indexedDB.open(DB_NAME);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      let entries;
      if (!db.objectStoreNames.contains('entries')) {
        entries = db.createObjectStore('entries', { keyPath: 'id' });
      } else {
        entries = opening.transaction.objectStore('entries');
      }
      if (!entries.indexNames.contains('createdAt')) entries.createIndex('createdAt', 'createdAt');
      if (!entries.indexNames.contains('type')) entries.createIndex('type', 'type');
      if (!entries.indexNames.contains('syncState')) entries.createIndex('syncState', 'syncState');
      if (!db.objectStoreNames.contains('plans')) {
        const plans = db.createObjectStore('plans', { keyPath: 'id' });
        plans.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

function normalizeEntry(entry) {
  if (entry === null || entry === undefined) return entry;
  return { syncState: 'pending', processingState: 'unprocessed', ...entry };
}

export async function saveEntry(entry) { return request((await store('entries', 'readwrite')).put(normalizeEntry(entry))); }
export async function getEntry(id) { return normalizeEntry(await request((await store('entries')).get(id))); }
export async function listEntries() { return (await request((await store('entries')).getAll())).map(normalizeEntry).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
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

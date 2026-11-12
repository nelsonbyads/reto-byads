import type { EvidenceRecord } from '../types/exercise';

const DB_NAME = 'dadofit-evidence';
const STORE_NAME = 'items';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('rollId', 'rollId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listEvidenceForRoll(rollId: string): Promise<EvidenceRecord[]> {
  if (!rollId || !('indexedDB' in globalThis)) return [];
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const index = transaction.objectStore(STORE_NAME).index('rollId');
    const request = index.getAll(rollId);
    request.onsuccess = () => resolve((request.result as EvidenceRecord[]).sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error ?? new Error('No se pudieron leer las evidencias.'));
    transaction.oncomplete = () => db.close();
  });
}

export async function saveEvidence(record: EvidenceRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { const error = transaction.error; db.close(); reject(error ?? new Error('No se pudo guardar la evidencia.')); };
  });
}

export async function deleteEvidence(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { const error = transaction.error; db.close(); reject(error ?? new Error('No se pudo eliminar la evidencia.')); };
  });
}

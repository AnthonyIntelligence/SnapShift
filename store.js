// Screenshots are passed from the service worker to the preview tab via IndexedDB,
// because full-page images can be far larger than message/storage size limits.
const DB_NAME = 'quick-screenshot';
const STORE = 'shots';
const KEEP = 5;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function putShot(shot) {
  const db = await openDb();
  const id = crypto.randomUUID();
  let tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ ...shot, id });
  await done(tx);

  // Keep only the newest few screenshots.
  tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const all = [];
  store.openCursor().onsuccess = (e) => {
    const cur = e.target.result;
    if (cur) { all.push({ id: cur.value.id, created: cur.value.created }); cur.continue(); }
    else {
      all.sort((a, b) => b.created - a.created).slice(KEEP).forEach((s) => store.delete(s.id));
    }
  };
  await done(tx);
  db.close();
  return id;
}

export async function getShot(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get(id);
  await done(tx);
  db.close();
  return req.result;
}

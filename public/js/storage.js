// public/js/storage.js
function storageSet(remember, data) {
  const key = 'eposAuth';
  const raw = JSON.stringify({ ...data, savedAt: new Date().toISOString() });
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);

  if (remember) localStorage.setItem(key, raw);
  else sessionStorage.setItem(key, raw);
}

function storageGet() {
  const key = 'eposAuth';
  const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function storageClear() {
  const key = 'eposAuth';
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

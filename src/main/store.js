// Small JSON settings store in the user's app data folder.
// Secrets (Pinterest app secret and tokens) are encrypted with Windows DPAPI via safeStorage.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'settings.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

function get(key) { return readAll()[key]; }

function set(key, value) {
  const data = readAll();
  if (value === undefined) delete data[key]; else data[key] = value;
  writeAll(data);
}

function setSecret(key, value) {
  if (value == null) return set(key, undefined);
  const enc = safeStorage.isEncryptionAvailable()
    ? { enc: true, v: safeStorage.encryptString(String(value)).toString('base64') }
    : { enc: false, v: Buffer.from(String(value)).toString('base64') };
  set(key, enc);
}

function getSecret(key) {
  const rec = get(key);
  if (!rec) return null;
  try {
    const buf = Buffer.from(rec.v, 'base64');
    return rec.enc ? safeStorage.decryptString(buf) : buf.toString();
  } catch { return null; }
}

module.exports = { get, set, getSecret, setSecret };

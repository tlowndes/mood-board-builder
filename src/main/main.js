const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const pinterest = require('./pinterest');
const { setupUpdater } = require('./updater');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1b1b1d',
    title: 'Mood Board Builder',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // keep links out of the app window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function listImages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()) && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort(collator.compare)
    .map(name => path.join(dir, name));
}

// Only files the user picked (or Pinterest downloads) can be read by the renderer.
const allowed = new Set();
const allow = files => { files.forEach(f => allowed.add(path.resolve(f))); return files; };

ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder of reference images', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  return { folder: dir, name: path.basename(dir), files: allow(listImages(dir)) };
});

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Add images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXT].map(e => e.slice(1)) }],
  });
  return r.canceled ? [] : allow(r.filePaths);
});

// Drag and drop: the renderer passes paths of dropped files or folders.
ipcMain.handle('paths:expand', async (_e, paths) => {
  const out = [];
  for (const p of paths || []) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) out.push(...listImages(p));
      else if (IMAGE_EXT.has(path.extname(p).toLowerCase())) out.push(p);
    } catch { /* ignore */ }
  }
  return allow(out);
});

ipcMain.handle('file:read', async (_e, file) => {
  const full = path.resolve(file);
  if (!allowed.has(full)) throw new Error('File not allowed');
  return fs.promises.readFile(full);
});

// Save one or more exported files. data: [{ bytes: Uint8Array }]
ipcMain.handle('export:save', async (_e, { defaultName, ext, files }) => {
  const filters = ext === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'JPEG image', extensions: ['jpg'] }];
  const r = await dialog.showSaveDialog(win, { title: 'Export mood board', defaultPath: `${defaultName}.${ext}`, filters });
  if (r.canceled || !r.filePath) return null;
  const base = r.filePath.replace(/\.(pdf|jpe?g)$/i, '');
  const written = [];
  files.forEach((f, i) => {
    const target = files.length > 1 ? `${base}-${String(i + 1).padStart(2, '0')}.${ext}` : `${base}.${ext}`;
    fs.writeFileSync(target, Buffer.from(f.bytes));
    written.push(target);
  });
  return written;
});

ipcMain.handle('export:reveal', (_e, file) => shell.showItemInFolder(file));

ipcMain.handle('pinterest:status', () => pinterest.status());
ipcMain.handle('pinterest:saveConfig', (_e, cfg) => pinterest.saveConfig(cfg));
ipcMain.handle('pinterest:signIn', () => pinterest.signIn());
ipcMain.handle('pinterest:signOut', () => pinterest.signOut());
ipcMain.handle('pinterest:boards', () => pinterest.boards());
ipcMain.handle('pinterest:download', async (e, boardId) => {
  const files = await pinterest.downloadBoard(boardId, p => e.sender.send('pinterest:progress', p));
  return allow(files);
});
ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  setupUpdater(win);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());

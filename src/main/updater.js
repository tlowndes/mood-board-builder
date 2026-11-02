// Auto-updates from GitHub Releases (installed copies only, not dev runs or the portable zip).
const { app, ipcMain } = require('electron');

function setupUpdater(win) {
  const send = (state, extra = {}) => { if (!win.isDestroyed()) win.webContents.send('update:state', { state, ...extra }); };
  ipcMain.handle('app:version', () => app.getVersion());

  // The portable zip has no installer to update, and dev runs have no release to compare against.
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR || !app.isPackaged || process.platform !== 'win32';
  let autoUpdater = null;
  if (!portable) {
    try { ({ autoUpdater } = require('electron-updater')); } catch { autoUpdater = null; }
  }

  ipcMain.handle('update:check', async () => {
    if (!autoUpdater) return send('unsupported');
    try { await autoUpdater.checkForUpdates(); } catch (e) { send('error', { message: e.message }); }
  });
  ipcMain.handle('update:install', () => autoUpdater && autoUpdater.quitAndInstall(false, true));

  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', info => send('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => send('latest'));
  autoUpdater.on('download-progress', p => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => send('ready', { version: info.version }));
  autoUpdater.on('error', e => send('error', { message: e && e.message }));

  // check shortly after launch, then every 6 hours while the app is open
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

module.exports = { setupUpdater };

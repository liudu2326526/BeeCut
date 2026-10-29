import { app, BrowserWindow, dialog, Menu, shell, session, nativeTheme, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { initializeLibrary, importLegacyLibrary } from './library.mjs';
import { createAudioHost } from './audio-host.mjs';
import { createDraftImportAccess } from './draft-import-access.mjs';
import { fileURLToPath } from 'node:url';

app.setName('BeeCut');
app.setAppUserModelId('com.weijian.studio');
// Match the editor's fixed dark workspace, including native frames and dialogs.
nativeTheme.themeSource = 'dark';
// Preserve the existing library and single-instance identity across the BeeCut rename.
app.setPath('userData', path.join(app.getPath('appData'), '微剪'));

let mainWindow, server, queue, origin, runtimeFile, audioHost;
let draftImports;
const draftImportAccess = createDraftImportAccess();
let shutdownComplete = false, shuttingDown = false;
const instanceId = randomUUID();
const previews = new Set();
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

const trustedUrl = url => {
  try { return new URL(url).origin === origin; } catch { return false; }
};
const exportUrl = url => {
  try { return trustedUrl(url) && /^\/exports\/[a-f0-9-]+\.mp4$/.test(new URL(url).pathname); } catch { return false; }
};
const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false };

function protectWindow(window, acceptsNavigation) {
  window.webContents.on('will-navigate', (event, url) => { if (!acceptsNavigation(url)) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', event => { if (!acceptsNavigation(event.url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function showPreview(url) {
  if (previews.size >= 2) { const previous = previews.values().next().value; previous.close(); }
  const window = new BrowserWindow({ width: 1100, height: 720, title: 'BeeCut · 成片预览', backgroundColor: '#111111', webPreferences: preferences });
  previews.add(window);
  window.on('closed', () => previews.delete(window));
  protectWindow(window, candidate => candidate === url);
  window.loadURL(url);
}

async function saveCurrentProject() {
  return mainWindow.webContents.executeJavaScript(`new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = ok => { clearTimeout(timer); window.removeEventListener('weijian:save-complete', completed); resolve(ok); };
    const completed = event => { if (event.detail?.requestId === requestId) finish(event.detail.ok === true); };
    const timer = setTimeout(() => finish(false), 15000);
    window.addEventListener('weijian:save-complete', completed);
    window.dispatchEvent(new CustomEvent('weijian:save-request', { detail: { requestId } }));
  })`);
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({ width: 1480, height: 940, minWidth: 1060, minHeight: 700, title: 'BeeCut · 视频工作台', backgroundColor: '#171717', show: false, webPreferences: { ...preferences, preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)) } });
  protectWindow(mainWindow, url => trustedUrl(url) && new URL(url).pathname === '/');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (exportUrl(url)) showPreview(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: '工程尚未保存完成', message: '还有修改尚未保存完成。',
      detail: '可以取消关闭，等待保存成功后再退出；放弃后尚未保存的修改可能丢失。',
      buttons: ['取消关闭', '放弃修改并关闭'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response === 1) event.preventDefault();
  });
  mainWindow.on('closed', () => { audioHost?.close(); audioHost = null; mainWindow = null; for (const window of previews) window.destroy(); });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(origin);
}

function installMenu(dataDir, exportDir) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BeeCut', submenu: [{ role: 'about', label: '关于 BeeCut' }, { type: 'separator' }, { role: 'hide', label: '隐藏 BeeCut' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' }, { type: 'separator' }, { role: 'quit', label: '退出 BeeCut' }] },
    { label: '文件', submenu: [
      { label: '导入剪映草稿…', click: () => mainWindow?.webContents.send('weijian:import-jianying') },
      { type: 'separator' },
      { label: '显示本机资料库', click: () => shell.openPath(dataDir) },
      { label: '显示视频导出文件夹', click: () => shell.openPath(exportDir) },
      { role: 'close', label: '关闭窗口' },
      { type: 'separator' },
      { label: '导入旧网页版资料库…', click: async () => {
        const selected = await dialog.showOpenDialog(mainWindow, { title: '选择旧版本的 data 资料库文件夹', properties: ['openDirectory'], message: '导入素材与工程副本，原文件夹保持不变。完成后 BeeCut 会重新启动。' });
        if (selected.canceled) return;
        const answer = await dialog.showMessageBox(mainWindow, { type: 'question', title: '导入旧版本资料库', message: '导入所选资料库并重新启动 BeeCut？', detail: '先保存当前工程。导入前会备份桌面资料库，不会改写旧版本文件夹。', buttons: ['取消', '导入并重启'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return;
        let engineStopped = false;
        mainWindow.setEnabled(false);
        try {
          if (!await saveCurrentProject()) throw new Error('当前工程尚未保存成功，请返回编辑器完成保存后再导入。');
          await importLegacyLibrary({ source: selected.filePaths[0], destination: dataDir, beforeCommit: async () => { engineStopped = true; await queue.close(); await closeServer(); } });
          app.relaunch(); app.quit();
        } catch (error) { dialog.showErrorBox('导入未完成', error.message); if (engineStopped) { app.relaunch(); app.quit(); } }
        finally { if (!mainWindow?.isDestroyed()) mainWindow?.setEnabled(true); }
      } },
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'front', label: '前置全部窗口' }] },
  ]));
}

async function closeServer() {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections?.(); });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    audioHost?.close(); audioHost = null;
    draftImportAccess.clear();
    await queue?.close();
    await closeServer();
    if (runtimeFile) {
      const current = JSON.parse(await fs.readFile(runtimeFile, 'utf8').catch(() => '{}'));
      if (current.instanceId === instanceId) await fs.rm(runtimeFile, { force: true });
    }
    shutdownComplete = true; app.quit();
  } catch (error) {
    // Keep the process and service owner alive so a later quit can retry its
    // failed cleanup; do not report completion while it still owns resources.
    shuttingDown = false;
    console.error('BeeCut 关闭清理失败', error);
    dialog.showErrorBox('退出尚未完成', `${error.message}\n请再次选择“退出 BeeCut”重试清理。资料库和恢复记录已保留。`);
  }
}

if (hasLock) {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.show(); mainWindow?.focus(); });
  app.on('activate', () => { if (origin) createWindow().catch(console.error); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.close(); return; }
    void shutdown();
  });
  app.whenReady().then(async () => {
    const dataDir = path.join(app.getPath('userData'), 'Library');
    const resources = app.isPackaged ? process.resourcesPath : path.resolve('.desktop-build/resources');
    await initializeLibrary(dataDir, path.join(resources, 'demo-library'));
    const runtime = await createApp({ dataDir, staticDir: path.join(resources, 'ui'), audioHelperPath: path.join(resources, 'audio-helper/weijian-audio-helper'), draftImportAccess });
    queue = runtime.queue;
    draftImports = runtime.draftImports;
    server = await new Promise((resolve, reject) => { const listening = runtime.app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject); });
    origin = `http://127.0.0.1:${server.address().port}`;
    const trustedChooser = event => {
      if (shuttingDown || event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !trustedUrl(event.senderFrame.url)) throw new Error('本地选择窗口请求来源无效');
    };
    ipcMain.handle('weijian:choose-jianying-draft', async event => {
      trustedChooser(event);
      const selected = await dialog.showOpenDialog(mainWindow, { title: '选择剪映草稿文件夹', message: '只读预检草稿。确认导入后会复制成独立 BeeCut 工程，不改写原草稿。', properties: ['openDirectory'] });
      if (selected.canceled || !selected.filePaths.length) return { canceled: true };
      trustedChooser(event);
      const directory = selected.filePaths[0];
      return { grantId: draftImportAccess.issueDirectory(directory), directory };
    });
    ipcMain.handle('weijian:choose-jianying-media', async (event, request) => {
      trustedChooser(event);
      if (!request || typeof request.sessionId !== 'string' || typeof request.sourceId !== 'string' || request.sessionId.length > 100 || request.sourceId.length > 512) throw new Error('重新定位素材请求无效');
      const report = await draftImports.get(request.sessionId);
      const material = report.materials?.find(m => m.sourceId === request.sourceId);
      if (!material || ['scanning', 'importing', 'completed', 'cancelled'].includes(report.status)) throw new Error('请先完成预检并选择需要重新定位的素材');
      const selected = await dialog.showOpenDialog(mainWindow, { title: '重新定位剪映素材', message: `请选择“${String(material.name || request.sourceId).slice(0, 160)}”的原始素材文件。不会按同名文件自动替换。`, properties: ['openFile'] });
      if (selected.canceled || !selected.filePaths.length) return { canceled: true };
      trustedChooser(event);
      const current = await draftImports.get(request.sessionId);
      if (current.revision !== report.revision || ['scanning', 'importing', 'completed', 'cancelled'].includes(current.status)) throw new Error('草稿预检已经变化，请重新选择需要定位的素材');
      const filename = selected.filePaths[0];
      return { grantId: draftImportAccess.issueMedia(filename, request.sessionId, request.sourceId, report.revision), path: filename };
    });
    runtimeFile = path.join(app.getPath('userData'), 'runtime.json');
    await fs.writeFile(runtimeFile, JSON.stringify({ instanceId, pid: process.pid, origin, dataDir, appVersion: app.getVersion(), startedAt: new Date().toISOString() }, null, 2));
    const exportDir = path.join(app.getPath('videos'), 'BeeCut导出');
    await fs.mkdir(exportDir, { recursive: true });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (event, item, contents) => {
      if (!contents || (!trustedUrl(contents.getURL()) && !previews.has(BrowserWindow.fromWebContents(contents)))) { event.preventDefault(); return; }
      const filename = path.basename(item.getFilename()).replace(/[\u0000-\u001f]/g, '_');
      item.setSaveDialogOptions({ title: '保存到本机', defaultPath: path.join(exportDir, filename), buttonLabel: '保存', properties: ['createDirectory', 'showOverwriteConfirmation'] });
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"] } });
    });
    audioHost = createAudioHost({ getWindow: () => mainWindow, origin, exportDir });
    installMenu(dataDir, exportDir);
    await createWindow();
    console.log(`BeeCut 桌面版 ready ${origin}`);
  }).catch(async error => { dialog.showErrorBox('BeeCut 启动失败', error.message); await shutdown(); });
}

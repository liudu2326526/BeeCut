import { BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseAudioCommand, AUDIO_CAPTURE_FRAMES, floatWav } from './audio-protocol.mjs';

export function createAudioHost({ getWindow, origin, exportDir, startupMs = 8000, heartbeatMs = 4000 }) {
  let host, ready = false, stopped = false, lastBeat = 0, born = 0, pending = [], failure, capture, lastPlan, lastInstall, proof;
  const revisions = new Map(); let revisionBytes = 0;
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const send = status => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('weijian:audio-status', { ...status, ...(proof ? { process: proof } : {}) }); };
  const trustedMain = event => { const window = getWindow(); return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === `${origin}/`; };
  const trustedHost = event => host && !host.isDestroyed() && event.sender === host.webContents && event.senderFrame === host.webContents.mainFrame && new URL(event.senderFrame.url).pathname === '/audio-host.html';
  function stop(reason) {
    const old = host; host = null; ready = false; pending = []; if (!capture?.completed) capture = null;
    if (old && !old.isDestroyed()) old.destroy();
    if (reason) { failure = reason; send({ phase: 'error', code: 'AUDIO_HOST_UNAVAILABLE', message: reason }); }
  }
  function start() {
    if (host || stopped) return;
    failure = null; born = lastBeat = Date.now(); ready = false;
    const window = new BrowserWindow({ show: false, width: 320, height: 160, title: 'BeeCut 实时音频', webPreferences: { preload: path.join(directory, 'audio-host-preload.cjs'), partition: `weijian-audio-${randomUUID()}`, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
    host = window;
    window.webContents.session.setPermissionRequestHandler((_c, _p, done) => done(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const url = `${origin}/audio-host.html`;
    window.webContents.on('will-navigate', (event, candidate) => { if (candidate !== url) event.preventDefault(); });
    window.webContents.on('will-frame-navigate', event => { if (event.url !== url) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => { if (host === window) stop('音频进程已退出；画面可继续，请重试音频。'); });
    window.on('closed', () => { if (host === window) stop('音频进程已关闭；画面可继续。'); });
    window.loadURL(url).catch(error => { if (host === window) stop(error.message); });
    send({ phase: 'initializing', message: '正在启动独立实时音频进程' });
  }
  const timer = setInterval(() => {
    if (!host) return;
    if ((!ready && Date.now() - born > startupMs) || Date.now() - lastBeat > heartbeatMs) stop('音频设备初始化或响应超时；画面可继续。请检查输出设备后重试音频。');
  }, 250);
  timer.unref?.();
  ipcMain.handle('weijian:audio-command', (event, raw) => {
    if (!trustedMain(event)) throw new Error('不可信的音频调用来源');
    const command = parseAudioCommand(raw);
    if (command.type === 'close') { stop(); return { accepted: true }; }
    if (command.type === 'retry') { stop(); start(); return { accepted: true }; }
    if (command.type === 'install') lastInstall = command;
    if (command.type === 'install' || command.type === 'plan') {
      lastPlan = command; const bytes = JSON.stringify(command.plan).length;
      revisionBytes -= revisions.get(command.revision)?.bytes || 0;
      revisions.set(command.revision, { plan: command.plan, bytes }); revisionBytes += bytes;
      while (revisionBytes > 4 * 1024 * 1024 || revisions.size > 128) { const key = revisions.keys().next().value; revisionBytes -= revisions.get(key).bytes; revisions.delete(key); }
    }
    if (command.type === 'capture-start') { command.captureId = randomUUID(); capture = { id: command.captureId, eventBytes: 0, chunks: [], frames: 0, sequence: 0, first: null, completed: false,
      provenance: { version: 1, startedAt: new Date().toISOString(), sampleRate: 48000, channels: 2, tap: 'actual AudioWorklet shared DSP final mix before device/master-monitor mute', process: proof, epoch: lastPlan?.epoch, revision: lastPlan?.revision,
        initialPlan: lastPlan?.plan, lease: lastInstall?.lease, assets: lastInstall?.assets?.map(a => ({ clipId: a.clipId, key: a.key, frames: a.frames })), events: [], underruns: 0, overruns: 0 } }; }
    if (!host && !failure) start();
    if (failure) return { accepted: false, error: failure };
    if (ready) host.webContents.send('weijian:audio-host-command', command);
    else {
      const superseded = command.type === 'halt' ? ['halt', 'install', 'plan', 'transport', 'capture-start'] : command.type === 'install' ? ['install', 'plan', 'transport'] : [command.type];
      pending = pending.filter(c => !superseded.includes(c.type)); pending.push(command);
    }
    return { accepted: true };
  });
  ipcMain.on('weijian:audio-host-status', (event, status) => {
    if (!trustedHost(event) || !status || typeof status !== 'object' || JSON.stringify(status).length > 16384) return;
    lastBeat = Date.now();
    if (status.phase === 'heartbeat') return;
    if (status.phase === 'host-ready') {
      const hostPid = host.webContents.getOSProcessId(), mainPid = getWindow()?.webContents.getOSProcessId();
      if (!hostPid || !mainPid || hostPid === mainPid) { stop('无法隔离音频设备进程；已停用音频，画面仍可继续。'); return; }
      ready = true;
      proof = { hostPid, mainPid, isolated: true };
      send({ phase: 'host-ready', ...proof });
      for (const command of pending) host.webContents.send('weijian:audio-host-command', command);
      pending = []; return;
    }
    if (['capturing', 'capture-completed', 'capture-error'].includes(status.phase) && status.captureId !== capture?.id) return;
    if (capture && ['capturing', 'ready', 'applied', 'playing', 'paused', 'buffering', 'capture-completed', 'capture-error', 'error'].includes(status.phase)) {
      if (status.phase === 'buffering') capture.provenance.underruns++;
      if (status.phase === 'capturing') { capture.provenance.epoch = status.epoch; capture.provenance.revision = status.revision; capture.provenance.initialPlan = revisions.get(status.revision)?.plan; }
      if (status.phase === 'capture-completed') {
        if (status.frames !== capture.frames || status.first !== capture.first || !capture.frames) { capture = null; send({ phase: 'capture-error', message: '实时录制样本或结束时钟不完整；未保存无效录音。' }); return; }
        capture.completed = true;
      }
      const event = { at: new Date().toISOString(), ...status,
        ...(status.phase === 'applied' || status.phase === 'ready' ? { plan: revisions.get(status.revision)?.plan } : {}) };
      const bytes = JSON.stringify(event).length;
      if (capture.eventBytes + bytes < 8 * 1024 * 1024) { capture.provenance.events.push(event); capture.eventBytes += bytes; }
      else capture.provenance.overruns++;
    }
    send(status);
  });
  ipcMain.on('weijian:audio-host-capture', (event, packet) => {
    if (!trustedHost(event) || !capture || packet?.captureId !== capture.id) return;
    if (!packet || packet.sequence !== capture.sequence || !(packet.samples instanceof Float32Array) || packet.samples.length > 16384 || packet.samples.length % 2 || !Number.isSafeInteger(packet.first) || packet.first < 0 || packet.first > 48000 * 901) { capture = null; send({ phase: 'capture-error', message: '实时录制的数据序列无效。' }); return; }
    const frames = packet.samples.length / 2;
    if (capture.frames + frames > AUDIO_CAPTURE_FRAMES || (capture.first !== null && packet.first !== capture.first + capture.frames)) { capture = null; send({ phase: 'capture-error', message: '录制时钟不连续，未保存无效录音。' }); return; }
    capture.first ??= packet.first; capture.frames += frames; capture.sequence++;
    capture.chunks.push(packet.samples.buffer.slice(packet.samples.byteOffset, packet.samples.byteOffset + packet.samples.byteLength));
  });
  ipcMain.handle('weijian:audio-save-capture', async event => {
    if (!trustedMain(event)) throw new Error('不可信的录音调用来源');
    const completed = capture;
    if (!completed?.frames || !completed.completed) throw new Error('请先停止实时录制后再保存');
    const result = await dialog.showSaveDialog(getWindow(), { title: '保存实时混音录制', defaultPath: path.join(exportDir, `BeeCut-实时混音-${Date.now()}.wav`), filters: [{ name: 'Float32 WAV', extensions: ['wav'] }] });
    if (result.canceled) return { cancelled: true };
    const wav = floatWav(completed.chunks, completed.frames);
    await fs.writeFile(result.filePath, wav);
    const receipt = { ...completed.provenance, first: completed.first, frames: completed.frames, duration: completed.frames / 48000, completedAt: new Date().toISOString(), wavSha256: createHash('sha256').update(wav).digest('hex'), format: 'IEEE Float32 WAV' };
    await fs.writeFile(`${result.filePath}.json`, JSON.stringify(receipt, null, 2));
    return { path: result.filePath, frames: completed.frames, first: completed.first, sampleRate: 48000, channels: 2, format: 'float32-wav' };
  });
  return { close() { stopped = true; clearInterval(timer); stop(); ipcMain.removeHandler('weijian:audio-command'); ipcMain.removeHandler('weijian:audio-save-capture'); ipcMain.removeAllListeners('weijian:audio-host-status'); ipcMain.removeAllListeners('weijian:audio-host-capture'); } };
}

import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore, publicMedia, HttpError } from './store.mjs';
import { validateProject, validateSettings, safeId, durationOf } from './validate.mjs';
import { probe, run, ffmpegPath, getAvailability, inputSafetyArgs } from './process.mjs';
import { createExportQueue } from './render.mjs';
import { createWaveformService } from './waveform.mjs';
import { createJianyingImportService } from './jianying-import.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensions = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.aif', '.aiff', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const limits = { maxFileBytes: 512 * 1024 * 1024, maxImportFiles: 12, maxMedia: 200, maxClips: 64, maxSubtitles: 120, maxDuration: 900, maxExportQueue: 3 };

export async function createApp({ dataDir = process.env.DATA_DIR || path.join(projectRoot, 'data'), staticDir, audioHelperPath, draftImportAccess } = {}) {
  const store = await createStore(path.resolve(dataDir));
  const exports = createExportQueue(store, { audioHelperPath }), waveforms = createWaveformService(store);
  const draftImports = createJianyingImportService(store);
  await draftImports.ready();
  let closing;
  const queue = {
    enqueue: (...args) => exports.enqueue(...args), get: (...args) => exports.get(...args), cancel: (...args) => exports.cancel(...args),
    prepareAudio: (...args) => exports.prepareAudio(...args), audioRange: (...args) => exports.audioRange(...args),
    // Existing desktop callers await this one lifecycle owner before stopping
    // the HTTP server or replacing its Library. Both services finish cleanup.
    close: () => {
      if (closing) return closing;
      closing = Promise.allSettled([
        Promise.resolve().then(() => exports.close()), Promise.resolve().then(() => waveforms.close()),
        Promise.resolve().then(() => draftImports.close()).then(() => store.waitForWrites()),
      ]).then(results => {
        const failure = results.find(result => result.status === 'rejected');
        // A rejected close still owns unfinished cleanup. Keep successful
        // completion idempotent, but permit the retained owner to retry.
        if (failure) { closing = null; throw failure.reason; }
      });
      return closing;
    },
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Local binding plus Host/Origin checks prevent browser-origin drive-by imports.
    const host = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host)) return res.status(403).json({ error: '此服务只接受本机请求' });
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) return res.status(403).json({ error: '禁止来自外部网站的请求' });
      } catch { return res.status(403).json({ error: '请求来源无效' }); }
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/exports', (req, res, next) => {
    // Match the same single URL decode that express.static applies. An encoded
    // dot must not expose a still-growing WAV/MP4 through a second spelling.
    let pathname;
    try { pathname = decodeURIComponent(req.path); }
    catch { return res.status(400).json({ error: '文件地址编码无效' }); }
    if (pathname.includes('.partial.')) return res.status(404).json({ error: '导出尚未完成' });
    next();
  });
  for (const name of ['media', 'thumbnails', 'exports']) {
    app.use(`/${name}`, express.static(store.dirs[name], { dotfiles: 'deny', index: false, fallthrough: false, setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    } }));
  }
  app.get('/api/health', asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...await getAvailability(), limits });
  }));
  const requestBody = (value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new HttpError(400, '草稿导入请求字段无效');
    return value;
  };
  app.post('/api/jianying/imports', asyncRoute(async (req, res) => {
    const { grantId } = requestBody(req.body, ['grantId']);
    if (!draftImportAccess) throw new HttpError(403, '请使用桌面版的本机文件夹选择窗口导入剪映草稿');
    const directory = draftImportAccess.consumeDirectory(safeId(grantId, '本地选择凭据'));
    res.status(202).json(await draftImports.scan({ directory }));
  }));
  app.get('/api/jianying/imports/:id', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.json(await draftImports.get(safeId(req.params.id)));
  }));
  app.post('/api/jianying/imports/:id/timeline', asyncRoute(async (req, res) => {
    const { timelineId } = requestBody(req.body, ['timelineId']);
    res.status(202).json(await draftImports.update(safeId(req.params.id), { timelineId: safeId(timelineId, '时间线 ID') }));
  }));
  app.post('/api/jianying/imports/:id/relink', asyncRoute(async (req, res) => {
    const { sourceId, grantId } = requestBody(req.body, ['sourceId', 'grantId']);
    const id = safeId(req.params.id);
    if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 200 || sourceId.includes('\0')) throw new HttpError(400, '来源素材标识无效');
    if (!draftImportAccess) throw new HttpError(403, '请通过本机文件选择窗口重新定位素材');
    const current = await draftImports.get(id);
    const filename = draftImportAccess.consumeMedia(safeId(grantId, '本地选择凭据'), id, sourceId, current.revision);
    res.status(202).json(await draftImports.update(id, { relinks: [{ sourceId, path: filename }] }));
  }));
  app.post('/api/jianying/imports/:id/commit', asyncRoute(async (req, res) => {
    const { acknowledgeWarnings = false } = requestBody(req.body, ['acknowledgeWarnings']);
    if (typeof acknowledgeWarnings !== 'boolean') throw new HttpError(400, '请明确确认导入报告中的差异');
    res.json(await draftImports.commit(safeId(req.params.id), { acknowledgeWarnings }));
  }));
  app.delete('/api/jianying/imports/:id', asyncRoute(async (req, res) => {
    res.json(await draftImports.cancel(safeId(req.params.id)));
  }));
  app.get('/api/jianying/reports/:id', asyncRoute(async (req, res) => {
    await store.waitForWrites();
    let report;
    try { report = JSON.parse(await fs.readFile(path.join(store.dirs.imports, `${safeId(req.params.id)}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, '未找到此工程的草稿导入报告'); throw error; }
    res.setHeader('Cache-Control', 'no-store'); res.json(report);
  }));
  app.get('/api/media/:id/waveform', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await waveforms.get(safeId(req.params.id, '素材 ID')));
  }));
  app.post('/api/media/:id/waveform/retry', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await waveforms.get(safeId(req.params.id, '素材 ID'), { retry: true }));
  }));

  const upload = multer({
    dest: store.dirs.uploads,
    limits: { fileSize: limits.maxFileBytes, files: limits.maxImportFiles, fields: 0 },
    fileFilter(_req, file, callback) {
      if (!extensions.has(path.extname(file.originalname).toLowerCase())) return callback(new HttpError(415, `不支持的素材格式：${file.originalname}。请导入常见视频、音频或图片文件`));
      callback(null, true);
    },
  });
  app.post('/api/media', upload.array('files', limits.maxImportFiles), asyncRoute(async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw new HttpError(400, '请选择需要导入的素材');
    if (store.media.size + files.length > 1000) {
      await Promise.all(files.map(file => fs.rm(file.path, { force: true })));
      throw new HttpError(413, '本机素材索引最多保存 1000 个文件');
    }
    const imported = [];
    const created = [];
    try {
      for (const file of files) {
        const id = randomUUID();
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `${id}${extension}`;
        const destination = path.join(store.dirs.media, filename);
        await fs.rename(file.path, destination);
        created.push(destination);
        const info = await probe(destination).catch(error => { throw new HttpError(415, `无法读取素材“${file.originalname}”：${error.message}`); });
        const streams = Array.isArray(info.streams) ? info.streams : [];
        const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const audio = streams.find(stream => stream.codec_type === 'audio');
        const image = imageExtensions.has(extension) && video;
        if (!video && !audio) throw new HttpError(415, `素材“${file.originalname}”没有可读取的视频或音频`);
        const type = image ? 'image' : video ? 'video' : 'audio';
        const duration = image ? 5 : Number(info.format?.duration || video?.duration || audio?.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 3600) throw new HttpError(415, `无法确定素材“${file.originalname}”的有效时长`);
        if (video && (Number(video.width) > 16384 || Number(video.height) > 16384 || Number(video.width) * Number(video.height) > 50_000_000)) throw new HttpError(413, '素材画面尺寸过大（上限 5000 万像素）');
        let thumbnailUrl = '';
        if (video) {
          const thumbnail = path.join(store.dirs.thumbnails, `${id}.jpg`);
          created.push(thumbnail);
          const seek = image ? 0 : Math.min(.25, duration / 3);
          await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2', ...inputSafetyArgs, '-ss', String(seek), '-i', destination, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', '-q:v', '3', thumbnail]);
          thumbnailUrl = `/thumbnails/${id}.jpg`;
        }
        // Multer uses the multipart latin-1 header convention; browsers send UTF-8.
        const utf8Name = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const name = utf8Name.includes('\ufffd') ? file.originalname : utf8Name;
        imported.push({ id, name: name.slice(0, 240), type, url: `/media/${filename}`, thumbnailUrl, duration, width: Number(video?.width || 0), height: Number(video?.height || 0), hasAudio: Boolean(audio), size: file.size, filename });
      }
      await store.addMedia(imported);
      res.status(201).json({ media: imported.map(publicMedia) });
    } catch (error) {
      await Promise.all([...created, ...files.map(file => file.path)].map(file => fs.rm(file, { force: true }).catch(() => {})));
      throw error;
    }
  }));
  app.get('/api/projects', asyncRoute(async (_req, res) => {
    await store.waitForWrites();
    const names = await fs.readdir(store.dirs.projects);
    const projects = [];
    for (const name of names.filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
      try {
        const project = JSON.parse(await fs.readFile(path.join(store.dirs.projects, name), 'utf8'));
        const media = project.media?.find(item => item.thumbnailUrl);
        projects.push({ id: project.id, name: project.name, updatedAt: project.updatedAt, duration: durationOf(project), thumbnailUrl: media?.thumbnailUrl || '' });
      } catch (error) { console.error(`工程索引跳过无法读取的文件 ${name}: ${error.message}`); }
    }
    res.json({ projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  }));
  app.post('/api/projects', asyncRoute(async (req, res) => {
    const project = validateProject(req.body, store);
    await store.saveProject(project);
    res.json({ project });
  }));
  app.get('/api/projects/:id', asyncRoute(async (req, res) => {
    await store.waitForWrites();
    const id = safeId(req.params.id, '工程 ID');
    let project;
    try { project = JSON.parse(await fs.readFile(path.join(store.dirs.projects, `${id}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, '找不到此工程'); throw error; }
    res.json({ project: validateProject(project, store, { touch: false }) });
  }));
  app.get('/api/demo', asyncRoute(async (_req, res) => {
    let project;
    try { project = JSON.parse(await fs.readFile(path.join(store.root, 'demo.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, '演示工程尚未生成，请先导入自己的素材'); throw error; }
    res.json({ project: validateProject(project, store, { touch: false }) });
  }));
  app.post('/api/audio-previews', asyncRoute(async (req, res) => {
    const project = validateProject(req.body?.project, store);
    if (!(await getAvailability()).ffmpegAvailable) throw new HttpError(503, '本地 FFmpeg 不可用');
    res.status(202).json(queue.enqueue(project, { width: project.width, height: project.height, fps: project.fps, quality: 'standard', audioOnly: true }));
  }));
  app.post('/api/audio-clock-prepares', asyncRoute(async (req, res) => {
    const project = validateProject(req.body?.project, store), ids = req.body?.clipIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 64 || new Set(ids).size !== ids.length)) throw new HttpError(400, '音频准备片段列表无效');
    const clipIds = ids?.map(id => safeId(id, '音频片段 ID'));
    if (clipIds?.some(id => !project.clips.some(c => c.id === id && store.media.get(c.mediaId)?.hasAudio))) throw new HttpError(400, '音频准备片段无效或没有音轨');
    res.status(202).json(queue.prepareAudio(project, clipIds));
  }));
  app.get('/api/audio-clock-prepares/:id', (req, res, next) => { try { res.setHeader('Cache-Control', 'no-store'); res.json(queue.get(safeId(req.params.id))); } catch (error) { next(error); } });
  app.delete('/api/audio-clock-prepares/:id', (req, res, next) => { try { res.json(queue.cancel(safeId(req.params.id))); } catch (error) { next(error); } });
  app.get('/api/audio-clock-assets/:key', asyncRoute(async (req, res) => {
    const data = await queue.audioRange(req.params.key, Number(req.query.first), Number(req.query.frames), safeId(req.query.lease, '音频会话'));
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-PCM-Frames', String(data.frames)); res.setHeader('X-PCM-Channels', String(data.channels));
    res.setHeader('X-PCM-Sample-Rate', String(data.sampleRate)); res.end(data.buffer);
  }));
  app.post('/api/exports', asyncRoute(async (req, res) => {
    const project = validateProject(req.body?.project, store);
    const settings = validateSettings(req.body?.settings, project);
    if (!(await getAvailability()).ffmpegAvailable) throw new HttpError(503, '本地 FFmpeg 不可用');
    res.status(202).json(queue.enqueue(project, settings));
  }));
  app.get('/api/exports/:id', (req, res, next) => { try { res.json(queue.get(safeId(req.params.id))); } catch (error) { next(error); } });
  app.delete('/api/exports/:id', (req, res, next) => { try { res.json(queue.cancel(safeId(req.params.id))); } catch (error) { next(error); } });
  // Desktop serves its bundled client and API on one private loopback origin.
  // A missing API or asset must remain a 404 rather than returning index.html.
  app.use('/api', (_req, res) => res.status(404).json({ error: '请求的本地接口不存在' }));
  if (staticDir) {
    const clientDir = path.resolve(staticDir);
    const entries = await fs.readdir(clientDir, { withFileTypes: true });
    const assetDirectories = new Set(entries.filter(entry => entry.isDirectory()).map(entry => entry.name));
    app.use(express.static(clientDir, { dotfiles: 'deny', index: 'index.html', setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    } }));
    app.use((req, res, next) => {
      const segments = req.path.split('/').filter(Boolean);
      const clientPage = req.method === 'GET' && req.accepts('html') && !path.extname(req.path)
        && !segments.some(segment => segment.startsWith('.')) && !assetDirectories.has(segments[0]);
      if (!clientPage) return next();
      res.sendFile(path.join(clientDir, 'index.html'), error => { if (error) next(error); });
    });
  }
  app.use((_req, res) => res.status(404).json({ error: '请求的本地资源不存在' }));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : error.status || (error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(error);
    const message = error instanceof multer.MulterError ? `素材上传失败：${error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 512 MB' : error.message}` : error.message || '本地服务处理失败';
    res.status(status).json({ error: message });
  });
  return { app, store, queue, draftImports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, queue } = await createApp();
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效的本地端口');
  const server = app.listen(port, '127.0.0.1', () => console.log(`Local editor API ready at http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    setTimeout(() => process.exit(0), 3500).unref();
    await queue.close();
    server.close(() => process.exit(0));
  });
}

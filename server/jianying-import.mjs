import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectJianyingDraft, convertJianyingDraft, JIANYING_DRAFT_LIMITS } from '../shared/jianying-draft.mjs';
import { HttpError, publicMedia } from './store.mjs';
import { validateProject } from './validate.mjs';
import { probe, run, ffmpegPath, inputSafetyArgs } from './process.mjs';

const MAX_JSON = JIANYING_DRAFT_LIMITS.bytes;
const MAX_FILE = 512 * 1024 * 1024;
const TTL = 10 * 60 * 1000;
const issue = (code, message, extra = {}) => ({ severity: 'error', code, message, ...extra });
const clone = value => structuredClone(value);
const signature = stat => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].map(key => String(stat[key])).join(':');
const inside = (root, filename) => filename === root || (!path.relative(root, filename).startsWith(`..${path.sep}`) && path.relative(root, filename) !== '..' && !path.isAbsolute(path.relative(root, filename)));
const safeTimeline = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const cancelled = () => new HttpError(409, '草稿导入已取消');
const stagingName = value => /^jianying-import-[A-Za-z0-9]{6}$/.test(value);
const stagedFilename = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(mp4|m4a|mkv|avi|mp3|wav|aiff|flac|ogg|aac|jpg|png|webp|bmp|gif)$/.test(value);
const mediaExtension = (format, type, codec) => {
  const first = String(format || '').split(',')[0];
  if (first === 'mov') return type === 'audio' ? '.m4a' : '.mp4';
  if (first === 'matroska') return '.mkv';
  if (first === 'image2') return ({ png: '.png', mjpeg: '.jpg', webp: '.webp', bmp: '.bmp' })[codec];
  return ({ avi: '.avi', mp3: '.mp3', wav: '.wav', aiff: '.aiff', flac: '.flac', ogg: '.ogg', aac: '.aac', jpeg_pipe: '.jpg', png_pipe: '.png', webp_pipe: '.webp', bmp_pipe: '.bmp', gif: '.gif' })[first];
};

/** Only the desktop grant owner calls this service with an authorized folder or
 * exact relink file. Source text never grants file access on its own. */
export function createJianyingImportService(store, options = {}) {
  const now = options.now || Date.now;
  const sessions = new Map();
  const maxSessions = options.maxSessions ?? 4;
  let closing = false, closePromise, recoveryPromise;
  const recoveryHandles = new Set();

  const check = session => { if (session.cancelled || closing) throw cancelled(); };
  const publicReport = session => clone(session.report);
  const setStatus = (session, status) => { session.report.status = status; if (status !== 'ready') session.report.canCommit = false; };

  async function recoverStaging() {
    for (const handle of recoveryHandles) { await handle.close(); recoveryHandles.delete(handle); }
    const work = await fs.realpath(store.dirs.work);
    for (const entry of await fs.readdir(work, { withFileTypes: true })) {
      if (!stagingName(entry.name)) continue;
      const folder = path.join(work, entry.name), directory = await fs.lstat(folder);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`导入暂存位置不能确认归属，已保留：${folder}`);
      const marker = path.join(folder, 'owner.json'), markerStat = await fs.lstat(marker).catch(() => null);
      if (!markerStat?.isFile() || markerStat.isSymbolicLink() || markerStat.size > 2048) throw new Error(`导入暂存缺少有效归属记录，已保留：${folder}`);
      const handle = await fs.open(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
      recoveryHandles.add(handle);
      let owner;
      try {
        const before = await handle.stat(), bytes = Buffer.alloc(2049);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
        if (bytesRead > 2048 || signature(before) !== signature(after) || signature(after) !== signature(markerStat)) throw new Error('导入暂存归属记录发生变化');
        owner = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
      } finally { await handle.close(); recoveryHandles.delete(handle); }
      if (owner?.version !== 1 || owner.owner !== 'weijian-jianying-import' || owner.directory !== entry.name || !safeTimeline(owner.id) || typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))) throw new Error(`导入暂存归属记录无效，已保留：${folder}`);
      const contents = await fs.readdir(folder);
      if (contents.length > 401) throw new Error(`导入暂存包含未知内容，已保留：${folder}`);
      for (const name of contents) {
        const stat = await fs.lstat(path.join(folder, name));
        if (!stat.isFile() || stat.isSymbolicLink() || (name !== 'owner.json' && !stagedFilename(name))) throw new Error(`导入暂存包含未知内容，已保留：${folder}`);
      }
      await (options.remove || fs.rm)(folder, { recursive: true, force: true });
    }
  }

  function ready() {
    if (!recoveryPromise) recoveryPromise = recoverStaging().catch(error => { recoveryPromise = null; throw error; });
    return recoveryPromise;
  }

  async function cleanup(session) {
    // Keep ownership until removal succeeds; cancel/close may retry a failed rm.
    const closed = await Promise.allSettled([...session.handles].map(async handle => { await handle.close(); session.handles.delete(handle); }));
    const closeFailure = closed.find(result => result.status === 'rejected');
    if (closeFailure) throw closeFailure.reason;
    if (session.staging) {
      await (options.remove || fs.rm)(session.staging, { recursive: true, force: true });
      session.staging = null;
    }
  }

  async function expire() {
    for (const [id, session] of sessions) {
      if (!session.operation && (session.expiresAt <= now() || (sessions.size >= maxSessions && ['completed', 'cancelled', 'failed'].includes(session.report.status)))) {
        await cleanup(session);
        sessions.delete(id);
      }
    }
  }

  function find(id) {
    if (typeof id !== 'string' || !sessions.has(id)) throw new HttpError(404, '草稿预检已失效，请重新选择草稿');
    const session = sessions.get(id);
    if (!session.operation && session.expiresAt <= now()) throw new HttpError(410, '草稿预检已过期，请重新扫描');
    return session;
  }

  async function canonicalDirectory(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw new HttpError(400, '请选择本地草稿文件夹');
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new HttpError(400, '草稿位置必须为普通文件夹，不能是符号链接');
    return fs.realpath(directory);
  }

  async function regularPath(filename, root) {
    if (root) {
      const rootStat = await fs.lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new HttpError(409, '所选草稿文件夹已被替换，请重新选择');
      if (!inside(root, filename) || filename === root) throw new HttpError(400, '素材路径超出了所选草稿范围，请逐项重新定位');
      const parts = path.relative(root, filename).split(path.sep);
      let cursor = root;
      for (let index = 0; index < parts.length; index++) {
        cursor = path.join(cursor, parts[index]);
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) throw new HttpError(400, '不跟随草稿中的符号链接，请重新选择实际素材文件');
        if (index !== parts.length - 1 && !stat.isDirectory()) throw new HttpError(400, '素材父目录无效');
      }
    }
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new HttpError(400, '请选择普通本地素材文件，不能使用符号链接或设备文件');
    const real = await fs.realpath(filename);
    if (root && !inside(root, real)) throw new HttpError(400, '素材路径已离开所选草稿范围');
    return { real, stat };
  }

  async function snapshot(filename, { root, maxBytes = MAX_FILE, destination, session } = {}) {
    if (session) check(session);
    const checked = await regularPath(filename, root);
    if (checked.stat.size > maxBytes) throw new HttpError(413, maxBytes === MAX_JSON ? '草稿 JSON 超过 2 MiB，请拆分草稿后重试' : '单个素材不能超过 512 MB');
    const handle = await fs.open(checked.real, constants.O_RDONLY | constants.O_NOFOLLOW);
    session?.handles.add(handle);
    let output;
    try {
      const initial = await handle.stat();
      if (!initial.isFile() || signature(initial) !== signature(checked.stat)) throw new HttpError(409, '来源文件在读取前发生变化，请重新扫描');
      if (destination) { output = await fs.open(destination, 'wx'); session?.handles.add(output); }
      const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
      const chunks = maxBytes === MAX_JSON && !destination ? [] : null;
      let total = 0;
      for (;;) {
        if (session) check(session);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > maxBytes) throw new HttpError(413, '来源文件超过允许大小');
        const bytes = buffer.subarray(0, bytesRead);
        hash.update(bytes);
        if (chunks) chunks.push(Buffer.from(bytes));
        if (output) await output.writeFile(bytes);
      }
      const end = await handle.stat();
      const finalPath = await regularPath(filename, root);
      if (signature(initial) !== signature(end) || signature(initial) !== signature(finalPath.stat) || checked.real !== finalPath.real || total !== initial.size) throw new HttpError(409, '来源文件在读取期间发生变化，请重新扫描');
      return { path: checked.real, root, signature: signature(initial), size: total, sha256: hash.digest('hex'), ...(chunks ? { bytes: Buffer.concat(chunks) } : {}) };
    } finally {
      const results = await Promise.allSettled([handle, output].filter(Boolean).map(async owned => { await owned.close(); session?.handles.delete(owned); }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  }

  async function jsonFile(session, relative, { optional = false } = {}) {
    const filename = path.join(session.directory, relative);
    let entry;
    try { entry = await snapshot(filename, { root: session.directory, maxBytes: MAX_JSON, session }); }
    catch (error) {
      if (optional && error.code === 'ENOENT') { session.absentDocuments.add(relative); return null; }
      throw error;
    }
    session.documents.set(relative, { ...entry, bytes: undefined });
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes).replace(/^\uFEFF/, '')); }
    catch { throw new HttpError(415, `“${relative}”不是可读 JSON，当前版本不支持该草稿（可能为加密或私有格式）`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(415, `“${relative}”的草稿结构无法识别`);
    return value;
  }

  async function selectDocument(session) {
    const registry = await jsonFile(session, path.join('Timelines', 'project.json'), { optional: true });
    let prefix = '';
    if (registry) {
      if (!Array.isArray(registry.timelines) || registry.timelines.length > 64) throw new HttpError(415, '时间线索引无效或超过 64 条时间线');
      const ids = new Set();
      for (const item of registry.timelines) {
        if (!item || !safeTimeline(item.id) || ids.has(item.id) || typeof item.name !== 'string' || item.name.length > 240 || (item.is_marked_delete !== undefined && typeof item.is_marked_delete !== 'boolean')) throw new HttpError(415, '时间线索引包含无效、重复或越界标识');
        ids.add(item.id);
      }
      session.report.timelines = registry.timelines.filter(item => !item.is_marked_delete).map(item => ({ id: item.id, name: item.name }));
      if (!session.timelineId) {
        if (session.report.timelines.length !== 1) {
          session.report.issues.push(issue('SELECT_TIMELINE', '请选择一条时间线后继续预检；不会自动导入主时间线或合并时间线'));
          setStatus(session, 'needs-timeline');
          return null;
        }
        session.timelineId = session.report.timelines[0].id;
      }
      if (!session.report.timelines.some(item => item.id === session.timelineId)) throw new HttpError(400, '所选时间线不在当前草稿索引中');
      prefix = path.join('Timelines', session.timelineId);
      session.report.selectedTimelineId = session.timelineId;
    } else if (session.timelineId) throw new HttpError(400, '此草稿没有可选择的时间线索引');
    // A present but opaque authoritative document must not fall through to a
    // stale backup/alternate document and appear successfully compatible.
    for (const name of ['draft_info.json', 'draft_content.json']) {
      const relative = path.join(prefix, name);
      const value = await jsonFile(session, relative, { optional: true });
      if (value) { session.report.sourceDocument = relative; return value; }
    }
    throw new HttpError(415, '所选草稿或时间线没有 draft_info.json / draft_content.json');
  }

  async function processMedia(session, filename, info) {
    const probed = await (options.probeMedia || probe)(filename, { signal: session.controller.signal });
    check(session);
    const streams = Array.isArray(probed.streams) ? probed.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const audio = streams.find(stream => stream.codec_type === 'audio');
    const imageFormats = new Set(['image2', 'jpeg_pipe', 'png_pipe', 'webp_pipe', 'bmp_pipe', 'gif']);
    const image = Boolean(video && imageFormats.has(probed.format?.format_name));
    const type = image ? 'image' : video ? 'video' : audio ? 'audio' : null;
    if (!type || type !== info.kind && type !== info.type) throw new HttpError(415, '素材实际流类型与草稿记录不符，请选择对应的原始素材');
    const duration = image ? 5 : Number(probed.format?.duration || video?.duration || audio?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 3600) throw new HttpError(415, '无法确定素材有效时长');
    if (video && (!Number.isFinite(Number(video.width)) || !Number.isFinite(Number(video.height)) || Number(video.width) <= 0 || Number(video.height) <= 0 || Number(video.width) > 16384 || Number(video.height) > 16384 || Number(video.width) * Number(video.height) > 50_000_000)) throw new HttpError(413, '素材画面尺寸无效或超过 5000 万像素');
    const extension = mediaExtension(probed.format?.format_name, type, video?.codec_name);
    if (!extension) throw new HttpError(415, '素材容器格式尚未支持，不能按文件名猜测格式');
    return { type, duration, width: Number(video?.width || 0), height: Number(video?.height || 0), hasAudio: Boolean(audio), format: probed.format?.format_name, extension };
  }

  function sourceFilename(session, material) {
    const sourceId = material.id;
    const relink = session.relinks.get(sourceId);
    if (relink && relink.context === sourceContext(session, material)) return { filename: relink.path, root: undefined, relink: true };
    const raw = material.path;
    if (typeof raw !== 'string' || !raw || raw.includes('\0') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.includes('\\')) return null;
    const filename = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(session.directory, raw);
    if (!inside(session.directory, filename)) return null;
    return { filename, root: session.directory, relink: false };
  }

  function initialReport(session) {
    return { id: session.id, revision: session.revision, status: 'scanning', canCommit: false, profile: { format: null, version: null, applicationVersion: null, supported: false }, name: path.basename(session.directory), timelines: [], selectedTimelineId: null, summary: { materials: 0, clips: 0, subtitles: 0 }, mappings: [], issues: [], materials: [], progress: { phase: 'scan', completed: 0, total: 0 } };
  }

  function sourceContext(session, material) {
    return JSON.stringify([session.report.sourceDocument, material.id, material.sourcePath, material.path]);
  }

  async function scanSession(session) {
    check(session);
    session.revision++;
    session.documents = new Map(); session.absentDocuments = new Set(); session.sources = new Map(); session.report = initialReport(session);
    try {
      const document = await selectDocument(session);
      if (!document) return publicReport(session);
      session.inspected = inspectJianyingDraft(document, { name: session.report.name });
      const parsed = session.inspected;
      session.report.profile = { format: parsed.profile, version: parsed.sourceVersion?.draft ?? null, applicationVersion: parsed.sourceVersion?.app ?? null, supported: Boolean(parsed.canImport) };
      session.report.name = parsed.name || session.report.name;
      session.report.issues.push(...(parsed.issues || []));
      session.report.mappings = parsed.mapping || parsed.mappings || [];
      session.report.summary = { materials: parsed.materials?.length || 0, clips: parsed.clips?.length || 0, subtitles: parsed.subtitles?.length || 0 };
      if (!parsed.canImport) { setStatus(session, 'unsupported'); return publicReport(session); }
      if (!Array.isArray(parsed.materials) || parsed.materials.length > 200) throw new HttpError(413, '草稿素材不能超过 200 个');
      session.report.progress.total = parsed.materials.length;
      for (const material of parsed.materials) {
        check(session);
        const sourceId = material.id;
        const entry = { sourceId, name: String(material.name || sourceId).slice(0, 240), sourcePath: material.path, sourceField: material.sourcePath, status: 'needs-relink' };
        session.report.materials.push(entry);
        const chosen = sourceFilename(session, material);
        if (!chosen) session.report.issues.push(issue('MATERIAL_NEEDS_GRANT', '素材位于所选草稿范围之外、路径缺失或不是本地路径，请逐项重新定位', { sourceId }));
        else {
          try {
            const frozen = await snapshot(chosen.filename, { root: chosen.root, session });
            const metadata = await processMedia(session, frozen.path, material);
            const after = await snapshot(chosen.filename, { root: chosen.root, session });
            if (after.signature !== frozen.signature || after.sha256 !== frozen.sha256) throw new HttpError(409, '素材在探测期间发生变化，请重新扫描');
            entry.status = 'ready'; entry.sha256 = frozen.sha256; entry.size = frozen.size;
            entry.metadata = metadata; entry.relinked = chosen.relink;
            if (chosen.relink) {
              entry.selectedPath = frozen.path;
              entry.identityVerification = 'user-selected; original-content-digest-unavailable';
              session.report.issues.push({ severity: 'warning', code: 'RELINK_IDENTITY_UNVERIFIED', sourceId, message: '已使用你逐项选择的素材并记录内容摘要；此草稿没有可核对的原文件摘要，无法证明它与原素材字节相同，请确认所选内容' });
            }
            session.sources.set(sourceId, { ...frozen, metadata, material, relink: chosen.relink });
          } catch (error) {
            check(session);
            entry.reason = error.message;
            session.report.issues.push(issue('MATERIAL_UNAVAILABLE', error.message, { sourceId }));
          }
        }
        session.report.progress.completed++;
      }
      if (!session.report.issues.some(item => item.severity === 'error')) {
        // Validate actual source lengths/types before the confirmation step.
        const temporaryMedia = new Map([...session.sources].map(([sourceId, source]) => [sourceId, mediaRecord(source, randomUUID())]));
        try { makeProject(session, temporaryMedia); }
        catch (error) { session.report.issues.push(issue('PROJECT_NOT_REPRESENTABLE', error.message)); }
      }
      session.report.canCommit = !session.report.issues.some(item => item.severity === 'error');
      setStatus(session, session.report.canCommit ? 'ready' : 'blocked');
    } catch (error) {
      if (session.cancelled || closing) { setStatus(session, 'cancelled'); throw cancelled(); }
      session.report.issues.push(issue(error.status === 415 ? 'UNSUPPORTED_DOCUMENT' : 'SCAN_FAILED', error.message));
      setStatus(session, error.status === 415 ? 'unsupported' : 'blocked');
    }
    return publicReport(session);
  }

  function mediaRecord(source, id) {
    const { extension, format: _format, ...metadata } = source.metadata;
    const filename = `${id}${extension}`;
    return { id, name: String(source.material.name || path.basename(source.path)).slice(0, 240), ...metadata, size: source.size, filename, url: `/media/${filename}`, thumbnailUrl: source.metadata.type === 'audio' ? '' : `/thumbnails/${id}.jpg` };
  }

  function makeProject(session, bySourceId) {
    const project = convertJianyingDraft(session.inspected, { id: session.id, name: session.report.name, mediaBySourceId: new Map([...bySourceId].map(([key, media]) => [key, publicMedia(media)])), createdAt: session.createdAt });
    project.importReportId = session.id;
    const media = new Map(store.media);
    for (const item of bySourceId.values()) media.set(item.id, item);
    return validateProject(project, { ...store, media }, { touch: false });
  }

  async function verifyDocuments(session) {
    const directoryStat = await fs.lstat(session.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || `${directoryStat.dev}:${directoryStat.ino}` !== session.directoryIdentity) throw new HttpError(409, '所选草稿文件夹在预检之后被替换，请重新选择');
    for (const document of session.documents.values()) {
      const current = await snapshot(document.path, { root: session.directory, maxBytes: MAX_JSON, session });
      if (document.sha256 !== current.sha256 || document.signature !== current.signature) throw new HttpError(409, '草稿在预检之后发生变化，请重新扫描后确认导入');
    }
    for (const relative of session.absentDocuments) {
      try { await regularPath(path.join(session.directory, relative), session.directory); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new HttpError(409, '草稿的文件或时间线选择在预检之后发生变化，请重新扫描');
      }
      throw new HttpError(409, '草稿的文件或时间线选择在预检之后发生变化，请重新扫描');
    }
  }

  async function commitSession(session, acknowledgeWarnings) {
    if (!session.report.canCommit || session.report.status !== 'ready') throw new HttpError(409, '请先完成草稿预检并处理缺失素材');
    if (session.report.issues.some(item => item.severity === 'warning') && acknowledgeWarnings !== true) throw new HttpError(409, '请确认导入报告中的不兼容项目与转换损失');
    if (typeof store.publishImport !== 'function') throw new HttpError(503, '本地工程事务服务不可用');
    check(session);
    setStatus(session, 'importing');
    session.report.progress = { phase: 'copy', completed: 0, total: session.sources.size };
    try {
      await verifyDocuments(session);
      if (store.media.size + session.sources.size > 1000) throw new HttpError(413, '本机素材索引最多保存 1000 个文件');
      const requiredBytes = [...session.sources.values()].reduce((sum, source) => sum + BigInt(source.size), 0n);
      const space = await fs.statfs(store.dirs.work, { bigint: true });
      if (requiredBytes > space.bavail * space.bsize) throw new HttpError(507, '磁盘空间不足以复制所选素材，请释放空间后重新预检');
      session.staging = await fs.mkdtemp(path.join(await fs.realpath(store.dirs.work), 'jianying-import-'));
      await fs.writeFile(path.join(session.staging, 'owner.json'), JSON.stringify({ version: 1, owner: 'weijian-jianying-import', id: session.id, directory: path.basename(session.staging), createdAt: session.createdAt }), { flag: 'wx' });
      const files = [], bySourceId = new Map();
      for (const [sourceId, source] of session.sources) {
        check(session);
        const record = mediaRecord(source, randomUUID());
        const destination = path.join(session.staging, record.filename);
        const copied = await snapshot(source.path, { root: source.root, destination, session });
        if (copied.sha256 !== source.sha256 || copied.signature !== source.signature) throw new HttpError(409, `素材“${record.name}”在预检之后发生变化，请重新扫描`);
        files.push({ source: destination, directory: 'media', filename: record.filename });
        if (record.type !== 'audio') {
          const filename = `${record.id}.jpg`, output = path.join(session.staging, filename);
          if (options.makeThumbnail) await options.makeThumbnail(destination, output, record, { signal: session.controller.signal });
          else await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2', ...inputSafetyArgs, '-ss', String(record.type === 'image' ? 0 : Math.min(.25, record.duration / 3)), '-i', destination, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', '-q:v', '3', output], { signal: session.controller.signal });
          files.push({ source: output, directory: 'thumbnails', filename });
        }
        check(session);
        bySourceId.set(sourceId, record);
        session.report.progress.completed++;
      }
      await verifyDocuments(session);
      check(session);
      const project = makeProject(session, bySourceId);
      const persistedReport = { ...publicReport(session), status: 'completed', canCommit: false, importedAt: new Date(now()).toISOString(), projectId: project.id, sources: [...session.sources].map(([sourceId, source]) => ({ sourceId, originalPath: source.material.path, selectedPath: source.relink ? source.path : undefined, sha256: source.sha256, size: source.size, mediaId: bySourceId.get(sourceId).id })), documents: [...session.documents].map(([name, document]) => ({ name, sha256: document.sha256, size: document.size })), absentDocuments: [...session.absentDocuments] };
      session.publishing = true;
      session.report.progress.phase = 'publish';
      // Once publication starts the store owns all-or-nothing completion. A
      // concurrent cancel waits and reports the actual committed outcome.
      const published = await store.publishImport({ project, media: [...bySourceId.values()], files, report: persistedReport });
      session.report = { ...persistedReport, project: published?.project || project, reportUrl: `/api/jianying/reports/${project.id}`, progress: { phase: 'completed', completed: bySourceId.size, total: bySourceId.size } };
      if (published?.cleanupPending) {
        session.publicationCleanupPending = published.cleanupPending;
        session.report.cleanupPending = true;
        session.report.issues.push({ severity: 'warning', code: 'PUBLICATION_CLEANUP_PENDING', message: published.cleanupPending });
      }
      session.published = true;
      await cleanup(session);
      return publicReport(session);
    } catch (error) {
      if (session.published) {
        // Publication succeeded; failed staging cleanup cannot erase that fact.
        session.report.cleanupPending = true;
        session.report.issues.push({ severity: 'warning', code: 'CLEANUP_PENDING', message: `工程已导入，临时文件清理待重试：${error.message}` });
        return publicReport(session);
      }
      setStatus(session, session.cancelled || closing ? 'cancelled' : 'failed');
      session.report.canCommit = false;
      session.report.issues.push(issue(session.cancelled || closing ? 'CANCELLED' : 'IMPORT_FAILED', error.message));
      try { await cleanup(session); }
      catch (cleanupError) { session.report.cleanupPending = true; session.report.issues.push(issue('CLEANUP_PENDING', `临时文件清理失败，可重试取消：${cleanupError.message}`)); }
      throw error;
    } finally { session.publishing = false; }
  }

  function operation(session, fn) {
    const promise = Promise.resolve().then(fn);
    session.operation = promise;
    promise.finally(() => { if (session.operation === promise) session.operation = null; }).catch(() => {});
    return promise;
  }

  return {
    async scan({ directory, timelineId, relinks = [] } = {}) {
      if (closing) throw new HttpError(503, '草稿导入服务正在关闭');
      await ready();
      await expire();
      if (sessions.size >= maxSessions) throw new HttpError(429, `同时最多保留 ${maxSessions} 个草稿预检，请取消旧预检后重试`);
      const selectedDirectory = await canonicalDirectory(directory), directoryStat = await fs.lstat(selectedDirectory);
      const session = { id: randomUUID(), revision: 0, directory: selectedDirectory, directoryIdentity: `${directoryStat.dev}:${directoryStat.ino}`, timelineId, relinks: new Map(), expiresAt: now() + TTL, createdAt: new Date(now()).toISOString(), controller: new AbortController(), handles: new Set() };
      session.report = initialReport(session);
      validateRelinks(session, relinks);
      if (closing) throw new HttpError(503, '草稿导入服务正在关闭');
      if (sessions.size >= maxSessions) throw new HttpError(429, `同时最多保留 ${maxSessions} 个草稿预检，请取消旧预检后重试`);
      sessions.set(session.id, session);
      operation(session, () => scanSession(session)).catch(() => {});
      return publicReport(session);
    },
    get(id) { return publicReport(find(id)); },
    ready,
    update(id, { timelineId, relinks = [] } = {}) {
      const session = find(id);
      if (closing || session.operation || session.cancelled || session.published) throw new HttpError(409, '当前预检不能修改，请重新选择草稿');
      const timelineChanged = timelineId !== undefined && timelineId !== session.timelineId;
      if (timelineChanged && relinks.length) throw new HttpError(400, '请先选择时间线并重新预检，再逐项定位该时间线的素材');
      validateRelinks(session, relinks);
      if (timelineChanged) session.relinks.clear();
      if (timelineId !== undefined) session.timelineId = timelineId;
      session.expiresAt = now() + TTL;
      setStatus(session, 'scanning'); session.report.canCommit = false;
      operation(session, () => scanSession(session)).catch(() => {});
      return publicReport(session);
    },
    commit(id, { acknowledgeWarnings = false } = {}) {
      const session = find(id);
      if (session.operation) {
        if (session.report.status === 'importing') return session.operation;
        throw new HttpError(409, '草稿正在扫描，请稍后确认导入');
      }
      return operation(session, () => commitSession(session, acknowledgeWarnings));
    },
    async cancel(id) {
      const session = find(id);
      if (!session.publishing && !session.published) {
        session.cancelled = true;
        session.controller.abort();
      }
      await session.operation?.catch(() => {});
      await cleanup(session);
      session.report.cleanupPending = Boolean(session.publicationCleanupPending);
      if (!session.published) { setStatus(session, 'cancelled'); session.report.canCommit = false; }
      return publicReport(session);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await ready();
        for (const session of sessions.values()) {
          if (!session.publishing && !session.published) {
            session.cancelled = true; session.controller.abort();
          }
        }
        await Promise.allSettled([...sessions.values()].map(session => session.operation).filter(Boolean));
        const results = await Promise.allSettled([...sessions.values()].map(cleanup));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) { closePromise = null; throw failure.reason; }
        await Promise.all([...recoveryHandles].map(async handle => { await handle.close(); recoveryHandles.delete(handle); }));
        sessions.clear();
      })().catch(error => { closePromise = null; throw error; });
      return closePromise;
    },
  };

  function validateRelinks(session, relinks) {
    if (!Array.isArray(relinks) || relinks.length > 200) throw new HttpError(400, '重新定位素材列表无效');
    const selected = new Set();
    for (const entry of relinks) {
      if (!entry || typeof entry.sourceId !== 'string' || !entry.sourceId || entry.sourceId.length > 200 || selected.has(entry.sourceId) || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || entry.path.length > 4096 || entry.path.includes('\0')) throw new HttpError(400, '重新定位必须指定来源标识与用户选择的单个本地文件');
      if (!session.inspected?.materials.some(item => item.id === entry.sourceId)) throw new HttpError(400, '请先完成预检，重新定位来源必须属于此草稿');
      selected.add(entry.sourceId);
    }
    for (const entry of relinks) session.relinks.set(entry.sourceId, { path: entry.path, context: sourceContext(session, session.inspected.materials.find(item => item.id === entry.sourceId)) });
  }
}

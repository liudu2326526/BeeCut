import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
const read = filename => fs.readFile(filename).catch(absent);
const stat = filename => fs.lstat(filename).catch(absent);
async function writeNew(filename, bytes) { await fs.writeFile(filename, bytes, { flag: 'wx' }); }
async function replace(filename, bytes) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  try { await writeNew(temp, bytes); await fs.rename(temp, filename); }
  finally { await fs.rm(temp, { force: true }); }
}
const safe = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const safeFilename = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}\.[a-z0-9]{1,8}$/.test(value);
const bytesJson = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
async function regular(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('导入发布文件必须是普通文件');
  return stat;
}
async function identity(filename) {
  const before = await regular(filename), hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  const after = await regular(filename);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('导入文件读取期间发生变化');
  return { size: after.size, sha256: hash.digest('hex') };
}
function validateJournal(j, root) {
  if (j?.version !== 1 || !safe(j.id) || !safe(j.projectId) || !Array.isArray(j.files) || j.files.length > 402 || typeof j.registryBefore !== 'string' || j.registryBefore.length > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(j.registryAfterSha256)) throw new Error('导入恢复记录无效，已保留以供检查');
  for (const f of j.files) {
    if (!['media', 'thumbnails', 'projects', 'imports'].includes(f.directory) || !safeFilename(f.filename) || !Number.isSafeInteger(f.size) || f.size < 0 || !Number.isSafeInteger(f.dev) || !Number.isSafeInteger(f.ino) || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('导入恢复记录文件身份无效');
    if (['projects', 'imports'].includes(f.directory) && f.filename !== `${j.projectId}.json`) throw new Error('导入恢复记录工程身份无效');
  }
  return { registry: path.join(root, 'media.json'), files: j.files.map(f => ({ ...f, path: path.join(root, f.directory, f.filename) })) };
}
async function rollback(root, journal, folder) {
  const owned = validateJournal(journal, root), before = Buffer.from(journal.registryBefore, 'base64');
  const current = await read(owned.registry), beforeIdentity = journal.registryExisted ? digest(before) : null;
  if ((current ? digest(current) : null) !== beforeIdentity && (current ? digest(current) : null) !== journal.registryAfterSha256) throw new Error('素材索引与导入记录身份不符；保留恢复记录，不覆盖资料库');
  // Check every owned final before any rollback mutation. Content change means
  // ownership is unresolved; preserve it and its journal instead of deleting it.
  for (const f of owned.files) {
    if (!(await stat(f.path))) continue;
    const actualStat = await regular(f.path);
    if (actualStat.dev !== f.dev || actualStat.ino !== f.ino) throw new Error('导入发布路径不属于此事务，已保留文件及恢复记录');
    const actual = await identity(f.path);
    if (actual.sha256 !== f.sha256 || actual.size !== f.size) throw new Error('导入发布文件被改变，已保留文件及恢复记录');
  }
  if ((current ? digest(current) : null) !== beforeIdentity) {
    if (journal.registryExisted) await replace(owned.registry, before);
    else await fs.rm(owned.registry, { force: true });
  }
  for (const f of owned.files) await fs.rm(f.path, { force: true });
  await fs.rm(folder, { recursive: true });
}

// Called before createStore loads the registry. A completed journal retains the
// new project; an interrupted publication rolls back only identity-bound files.
export async function recoverImportPublications(root) {
  const pending = path.join(root, 'imports', '.pending');
  await fs.mkdir(pending, { recursive: true });
  for (const entry of await fs.readdir(pending, { withFileTypes: true })) {
    if (!entry.isDirectory() || !safe(entry.name)) throw new Error('导入恢复目录包含无法确认的项目，已保留');
    const folder = path.join(pending, entry.name);
    const preparing = await read(path.join(folder, 'preparing.json'));
    // This marker is removed before the first link. Even a partially written
    // journal while it exists therefore cannot own a published final.
    if (preparing) {
      const names = await fs.readdir(folder), allocation = JSON.parse(preparing.toString('utf8'));
      if (allocation.version !== 1 || allocation.id !== entry.name || !safe(allocation.projectId) || names.some(name => !['preparing.json', 'projects.stage', 'imports.stage', 'journal.json'].includes(name))) throw new Error('导入暂存所有权无法确认，已保留内容');
      for (const name of names) await regular(path.join(folder, name));
      await fs.rm(folder, { recursive: true });
      continue;
    }
    const raw = await read(path.join(folder, 'journal.json'));
    // An allocation that never published its journal cannot own any final file.
    if (!raw) {
      if ((await fs.readdir(folder)).length) throw new Error('导入恢复目录缺少身份记录，已保留内容');
      continue;
    }
    const journal = JSON.parse(raw.toString('utf8'));
    validateJournal(journal, root);
    const committed = await read(path.join(folder, 'committed'));
    if (committed && committed.toString('utf8') === journal.registryAfterSha256) {
      await fs.rm(folder, { recursive: true });
    } else await rollback(root, journal, folder);
  }
}

export async function publishImportFiles(root, { project, media, files, report, registry }, { checkpoint = async () => {} } = {}) {
  if (!safe(project?.id) || !Array.isArray(media) || media.length > 200 || !Array.isArray(files) || files.length > 400) throw new Error('草稿导入发布内容无效');
  const journalId = randomUUID(), folder = path.join(root, 'imports', '.pending', journalId);
  const finals = [], workRoot = await fs.realpath(path.join(root, 'work'));
  for (const f of files) {
    if (!['media', 'thumbnails'].includes(f.directory) || !safeFilename(f.filename)) throw new Error('草稿导入文件名无效');
    const source = await fs.realpath(f.source), stat = await regular(f.source);
    if (source !== path.resolve(f.source) || !source.startsWith(`${workRoot}${path.sep}`) || stat.size > 512 * 1024 * 1024) throw new Error('导入发布只能接收受控临时文件');
    finals.push({ source, directory: f.directory, filename: f.filename, dev: stat.dev, ino: stat.ino, ...await identity(source) });
  }
  const referenced = new Set();
  for (const item of media) {
    if (!safe(item.id) || !safeFilename(item.filename) || item.url !== `/media/${item.filename}`) throw new Error('导入素材与发布文件身份不一致');
    referenced.add(`media/${item.filename}`);
    if (item.thumbnailUrl) {
      if (item.thumbnailUrl !== `/thumbnails/${item.id}.jpg`) throw new Error('导入缩略图身份不一致');
      referenced.add(`thumbnails/${item.id}.jpg`);
    }
  }
  if (finals.length !== referenced.size || finals.some(f => !referenced.has(`${f.directory}/${f.filename}`))) throw new Error('导入素材与临时发布文件数量不一致');
  const projectBytes = bytesJson(project), reportBytes = bytesJson(report);
  finals.push({ directory: 'projects', filename: `${project.id}.json`, size: projectBytes.length, sha256: digest(projectBytes), bytes: projectBytes });
  finals.push({ directory: 'imports', filename: `${project.id}.json`, size: reportBytes.length, sha256: digest(reportBytes), bytes: reportBytes });
  if (new Set(finals.map(f => `${f.directory}/${f.filename}`)).size !== finals.length) throw new Error('导入发布路径重复');
  for (const f of finals) if (await stat(path.join(root, f.directory, f.filename))) throw new Error('导入只创建独立工程，不覆盖现有文件');
  const registryPath = path.join(root, 'media.json'), before = await read(registryPath), after = bytesJson(registry);
  await fs.mkdir(folder, { recursive: false });
  let committed = false;
  let journal;
  try {
    await writeNew(path.join(folder, 'preparing.json'), bytesJson({ version: 1, id: journalId, projectId: project.id }));
    // Every final is an exclusive link to an already owned inode. A planned
    // path plus matching bytes does not prove that a racing file is ours.
    for (const f of finals) {
      if (!f.bytes) continue;
      f.source = path.join(folder, `${f.directory}.stage`);
      await writeNew(f.source, f.bytes);
      const own = await regular(f.source); f.dev = own.dev; f.ino = own.ino;
    }
    journal = { version: 1, id: journalId, projectId: project.id, registryExisted: Boolean(before), registryBefore: (before || Buffer.alloc(0)).toString('base64'), registryAfterSha256: digest(after), files: finals.map(({ source, bytes, ...f }) => f) };
    validateJournal(journal, root);
    await writeNew(path.join(folder, 'journal.json'), bytesJson(journal));
    await fs.unlink(path.join(folder, 'preparing.json'));
    await checkpoint('journal');
    for (const f of finals) {
      const destination = path.join(root, f.directory, f.filename);
      await fs.link(f.source, destination);
      await checkpoint(`file:${f.directory}`);
    }
    for (const f of finals) {
      const filename = path.join(root, f.directory, f.filename), own = await regular(filename);
      if (own.dev !== f.dev || own.ino !== f.ino) throw new Error('导入发布期间文件所有权发生变化');
      const actual = await identity(filename);
      if (actual.size !== f.size || actual.sha256 !== f.sha256) throw new Error('导入发布期间文件身份发生变化');
    }
    await replace(registryPath, after);
    await checkpoint('registry');
    await writeNew(path.join(folder, 'committed'), Buffer.from(journal.registryAfterSha256));
    committed = true;
  } catch (error) {
    if (!committed) {
      try { if (journal) await rollback(root, journal, folder); else await fs.rm(folder, { recursive: true }); }
      catch (cleanup) { throw Object.assign(new AggregateError([error, cleanup], '导入失败且恢复未完成，已保留恢复记录；请重新打开资料库重试'), { importRecoveryRequired: true }); }
    }
    throw error;
  }
  // A durable commit is success even if removing its recovery record needs a
  // retry at next startup. Never roll back an already published project here.
  let cleanupPending;
  try { await checkpoint('committed'); await fs.rm(folder, { recursive: true }); }
  catch (error) { cleanupPending = error.message; }
  return { project, reportId: project.id, ...(cleanupPending ? { cleanupPending } : {}) };
}

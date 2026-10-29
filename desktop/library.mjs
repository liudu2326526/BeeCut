import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { validateProject } from '../server/validate.mjs';

const exists = filename => fs.access(filename).then(() => true, () => false);
const readJson = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const safeFilename = value => typeof value === 'string' && value !== '' && value === path.basename(value) && !['.', '..'].includes(value);

export async function initializeLibrary(destination, seed) {
  if (await exists(path.join(destination, 'media.json'))) return;
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length) throw new Error('资料库目录已有文件但缺少素材索引，请保留目录并恢复 media.json。');
  const temporary = `${destination}.seed-${randomUUID()}`;
  try {
    await fs.cp(seed, temporary, { recursive: true, errorOnExist: true, force: false });
    await fs.rmdir(destination);
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function copyFile(source, destination) {
  const stat = await fs.lstat(source);
  if (!stat.isFile()) throw new Error(`拒绝导入非普通素材文件：${path.basename(source)}`);
  if (await exists(destination)) {
    const hash = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
    if (await hash(source) !== await hash(destination)) throw new Error(`素材标识冲突：${path.basename(source)}。资料库保持不变。`);
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

export async function importLegacyLibrary({ source, destination, beforeCommit }) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error('所选目录已经是当前桌面资料库。');
  for (const directory of ['media', 'thumbnails', 'projects']) if (!(await fs.lstat(path.join(source, directory))).isDirectory()) throw new Error('旧版本资料库必须包含普通素材、缩略图与工程文件夹。');
  const registry = await readJson(path.join(source, 'media.json'));
  if (!Array.isArray(registry) || registry.length > 1000) throw new Error('所选文件夹的素材索引无效。请选择旧网页版的 data 文件夹。');
  const staging = `${destination}.import-${randomUUID()}`;
  const backup = `${destination}.backup-${Date.now()}`;
  let committed = false, moved = false;
  try {
    await fs.cp(destination, staging, { recursive: true, force: false });
    const current = await readJson(path.join(staging, 'media.json'));
    const merged = new Map(current.map(item => [item.id, item]));
    for (const item of registry) {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id) || !safeFilename(item.filename)) throw new Error('旧版本包含无效素材记录。');
      const previous = merged.get(item.id);
      if (previous && previous.filename !== item.filename) throw new Error('旧版本的素材标识与当前资料库冲突。');
      await copyFile(path.join(source, 'media', item.filename), path.join(staging, 'media', item.filename));
      if (item.thumbnailUrl) {
        const filename = path.basename(item.thumbnailUrl);
        if (item.thumbnailUrl !== `/thumbnails/${filename}` || !safeFilename(filename)) throw new Error('旧版本包含无效缩略图记录。');
        await copyFile(path.join(source, 'thumbnails', filename), path.join(staging, 'thumbnails', filename));
      }
      if (!previous) merged.set(item.id, item);
    }
    if (merged.size > 1000) throw new Error('导入后的素材总数超过本机资料库上限（1000）。');
    const projectNames = await fs.readdir(path.join(source, 'projects'));
    for (const filename of projectNames.filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
      const file = path.join(source, 'projects', filename);
      if (!(await fs.lstat(file)).isFile()) throw new Error('旧版本的工程必须为普通 JSON 文件。');
      const project = validateProject(await readJson(file), { media: merged }, { touch: false });
      if (!project || !/^[A-Za-z0-9_-]+$/.test(project.id)) throw new Error('旧版本包含无效工程记录。');
      let output = path.join(staging, 'projects', `${project.id}.json`);
      if (await exists(output)) {
        if (JSON.stringify(await readJson(output)) === JSON.stringify(project)) continue;
        project.id = randomUUID(); output = path.join(staging, 'projects', `${project.id}.json`);
      }
      await fs.writeFile(output, JSON.stringify(project, null, 2));
    }
    await fs.writeFile(path.join(staging, 'media.json'), JSON.stringify([...merged.values()], null, 2));
    await beforeCommit();
    await fs.rename(destination, backup); moved = true;
    await fs.rename(staging, destination); committed = true;
    return { backup, importedMedia: registry.length };
  } finally {
    if (moved && !committed) await fs.rename(backup, destination);
    await fs.rm(staging, { recursive: true, force: true });
  }
}

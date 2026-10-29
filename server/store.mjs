import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { recoverImportPublications, publishImportFiles } from './import-publication.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}

export const publicMedia = ({ filename, ...media }) => media;

export async function createStore(root, { importCheckpoint } = {}) {
  const dirs = Object.fromEntries(['media', 'thumbnails', 'projects', 'exports', 'work', 'uploads', 'waveforms', 'imports'].map(name => [name, path.join(root, name)]));
  await Promise.all(Object.values(dirs).map(dir => fs.mkdir(dir, { recursive: true })));
  await recoverImportPublications(root);
  let registry = [];
  try { registry = JSON.parse(await fs.readFile(path.join(root, 'media.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`素材索引读取失败：${error.message}`); }
  if (!Array.isArray(registry)) throw new Error('素材索引格式无效');
  const media = new Map(registry.map(item => [item.id, item]));
  let writeQueue = Promise.resolve(), recoveryRequired;
  const write = action => {
    const operation = writeQueue.then(() => { if (recoveryRequired) throw recoveryRequired; return action(); });
    writeQueue = operation.catch(() => {});
    return operation;
  };
  return {
    root, dirs, media,
    waitForWrites: async () => { await writeQueue; if (recoveryRequired) throw recoveryRequired; },
    saveProject(project) { return write(() => atomicJson(path.join(dirs.projects, `${project.id}.json`), project)); },
    publishImport(input) {
      return write(async () => {
        if (media.size + input.media.length > 1000) throw new HttpError(413, '本机素材索引最多保存1000个文件');
        const updated = new Map(media);
        for (const item of input.media) {
          if (updated.has(item.id)) throw new HttpError(409, '导入素材身份已存在');
          updated.set(item.id, item);
        }
        let result;
        try { result = await publishImportFiles(root, { ...input, registry: [...updated.values()] }, { checkpoint: importCheckpoint }); }
        catch (error) { if (error.importRecoveryRequired) recoveryRequired = error; throw error; }
        for (const item of input.media) media.set(item.id, item);
        return result;
      });
    },
    mediaPath(item) {
      if (!item || typeof item.filename !== 'string' || path.basename(item.filename) !== item.filename) throw new HttpError(400, '本地素材记录无效，请重新导入');
      return path.join(dirs.media, item.filename);
    },
    addMedia(items) {
      // Serialize registry writes so simultaneous imports cannot lose one another.
      return write(async () => {
        const updated = new Map(media);
        for (const item of items) updated.set(item.id, item);
        await atomicJson(path.join(root, 'media.json'), [...updated.values()]);
        for (const item of items) media.set(item.id, item);
      });
    },
  };
}

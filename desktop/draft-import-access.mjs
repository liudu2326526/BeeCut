import { randomUUID } from 'node:crypto';
import path from 'node:path';

// A request from the local web API cannot choose a filesystem path. Only a
// native chooser issues these single-use, short-lived exact-path capabilities.
export function createDraftImportAccess({ now = Date.now, lifetimeMs = 15 * 60 * 1000, capacity = 64 } = {}) {
  const grants = new Map();
  const error = message => Object.assign(new Error(message), { status: 403 });
  const expire = () => { for (const [id, g] of grants) if (now() - g.at >= lifetimeMs) grants.delete(id); };
  const issue = (kind, filename, binding = {}) => {
    expire();
    if (!path.isAbsolute(filename) || filename.includes('\0')) throw error('本地选择路径无效');
    if (grants.size >= capacity) throw error('本地选择请求过多，请关闭导入窗口后重试');
    const id = randomUUID(); grants.set(id, { kind, filename, binding, at: now() }); return id;
  };
  const consume = (id, kind, binding = {}) => {
    expire(); const g = grants.get(id);
    if (!g || g.kind !== kind || JSON.stringify(g.binding) !== JSON.stringify(binding)) throw error('请选择本机文件或文件夹；此前的选择已过期或不属于此素材');
    grants.delete(id); return g.filename;
  };
  return {
    issueDirectory: directory => issue('directory', directory),
    issueMedia: (filename, sessionId, sourceId, revision) => issue('media', filename, { sessionId, sourceId, revision }),
    consumeDirectory: id => consume(id, 'directory'),
    consumeMedia: (id, sessionId, sourceId, revision) => consume(id, 'media', { sessionId, sourceId, revision }),
    clear: () => grants.clear(),
  };
}

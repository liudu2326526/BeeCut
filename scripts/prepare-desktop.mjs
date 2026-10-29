import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.desktop-build');
const appDir = path.join(staging, 'app');
const resources = path.join(staging, 'resources');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This desktop build targets macOS Apple Silicon (darwin-arm64).');
await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(appDir, { recursive: true });
await fs.mkdir(resources, { recursive: true });
const audioHelperSource = path.join(root, 'desktop/audio-helper');
await fs.mkdir(path.join(resources, 'audio-helper'), { recursive: true });
await fs.copyFile(path.join(audioHelperSource, 'bin/darwin-arm64/weijian-audio-helper'), path.join(resources, 'audio-helper/weijian-audio-helper'));
await fs.chmod(path.join(resources, 'audio-helper/weijian-audio-helper'), 0o755);
const helperSignature = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', path.join(resources, 'audio-helper/weijian-audio-helper')], { encoding: 'utf8' });
if (helperSignature.status !== 0) throw new Error(`Audio helper signing failed: ${helperSignature.stderr}`);

const result = await build({ entryPoints: [path.join(root, 'desktop/main.mjs')], outfile: path.join(appDir, 'main.mjs'), bundle: true, platform: 'node', target: 'node22', format: 'esm', external: ['electron', '@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'], banner: { js: "import { createRequire as __desktopCreateRequire } from 'node:module'; const require = __desktopCreateRequire(import.meta.url);" }, metafile: true, legalComments: 'eof', absWorkingDir: root });
for (const name of ['preload.cjs', 'audio-host-preload.cjs']) await fs.copyFile(path.join(root, 'desktop', name), path.join(appDir, name));
const dependencies = {};
const nativePackages = ['@ffmpeg-installer/ffmpeg', '@ffmpeg-installer/darwin-arm64', '@ffprobe-installer/ffprobe', '@ffprobe-installer/darwin-arm64'];
for (const name of nativePackages) {
  const source = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  dependencies[name] = metadata.version;
  const allowed = new Set(['index.js', 'lib', 'package.json', 'README.md', 'ffmpeg', 'ffprobe']);
  await fs.cp(source, path.join(appDir, 'node_modules', name), {
    recursive: true, mode: constants.COPYFILE_FICLONE,
    filter: sourcePath => { const relative = path.relative(source, sourcePath); return relative === '' || (allowed.has(relative.split(path.sep)[0]) && !relative.split(path.sep).some(part => part.startsWith('.') || part.endsWith('~'))); },
  });
}
await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: packageJson.name, productName: 'BeeCut', version: packageJson.version, private: true, type: 'module', main: 'main.mjs', description: '本机视频编辑工作台', author: 'BeeCut', dependencies }, null, 2));
await fs.cp(path.join(root, 'dist/client'), path.join(resources, 'ui'), { recursive: true, mode: constants.COPYFILE_FICLONE });

// Use a strict allowlist from the demonstration project. No exports, work,
// arbitrary projects, imported user media or source paths enter the release.
const data = path.join(root, 'data');
const demo = JSON.parse(await fs.readFile(path.join(data, 'demo.json'), 'utf8'));
const registry = JSON.parse(await fs.readFile(path.join(data, 'media.json'), 'utf8'));
const seed = path.join(resources, 'demo-library');
await Promise.all(['media', 'thumbnails', 'projects'].map(name => fs.mkdir(path.join(seed, name), { recursive: true })));
const records = [];
for (const item of demo.media) {
  const record = registry.find(record => record.id === item.id);
  if (!record || typeof record.filename !== 'string' || path.basename(record.filename) !== record.filename || item.url !== `/media/${record.filename}`) throw new Error('Demo contains an invalid or missing media record.');
  records.push(record);
  await fs.copyFile(path.join(data, 'media', record.filename), path.join(seed, 'media', record.filename), constants.COPYFILE_FICLONE);
  if (item.thumbnailUrl) {
    const filename = path.basename(item.thumbnailUrl);
    if (item.thumbnailUrl !== `/thumbnails/${filename}`) throw new Error('Demo thumbnail must be a local thumbnail.');
    await fs.copyFile(path.join(data, 'thumbnails', filename), path.join(seed, 'thumbnails', filename), constants.COPYFILE_FICLONE);
  }
}
await fs.writeFile(path.join(seed, 'media.json'), JSON.stringify(records, null, 2));
await fs.writeFile(path.join(seed, 'demo.json'), JSON.stringify(demo, null, 2));
await fs.writeFile(path.join(seed, 'projects', `${demo.id}.json`), JSON.stringify(demo, null, 2));

const licenses = path.join(resources, 'licenses');
await fs.mkdir(licenses, { recursive: true });
const rubberBandNotices = path.join(licenses, 'rubberband');
await fs.mkdir(rubberBandNotices, { recursive: true });
for (const filename of ['LICENSE.rubberband', 'rubberband.lock.json', 'build-receipt.json', 'main.cpp']) {
  await fs.copyFile(path.join(audioHelperSource, filename), path.join(rubberBandNotices, filename));
}
const rubberBandLock = JSON.parse(await fs.readFile(path.join(audioHelperSource, 'rubberband.lock.json'), 'utf8'));
await fs.copyFile(path.join(audioHelperSource, rubberBandLock.sourceArchive), path.join(rubberBandNotices, path.basename(rubberBandLock.sourceArchive)));
await fs.cp(path.join(root, 'desktop/licenses'), licenses, { recursive: true });
await fs.mkdir(path.join(licenses, 'electron'), { recursive: true });
for (const filename of ['LICENSE', 'LICENSES.chromium.html']) await fs.copyFile(path.join(root, 'node_modules/electron/dist', filename), path.join(licenses, 'electron', filename));
const names = new Set([...nativePackages, '@phosphor-icons/react', 'react', 'react-dom', 'scheduler']);
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) names.add(match[1]);
}
const notices = [];
for (const name of [...names].sort()) {
  const source = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const destination = path.join(licenses, name.replaceAll('/', '__'));
  await fs.mkdir(destination, { recursive: true });
  const files = (await fs.readdir(source)).filter(filename => /^(license|licence|copying|notice|copyright)(\.|$|-)/i.test(filename));
  for (const filename of files) if ((await fs.stat(path.join(source, filename))).isFile()) await fs.copyFile(path.join(source, filename), path.join(destination, filename));
  notices.push({ name, version: metadata.version, license: metadata.license, repository: metadata.repository, licenseFiles: files });
}
await fs.writeFile(path.join(licenses, 'THIRD-PARTY-NOTICES.json'), JSON.stringify(notices, null, 2));
await fs.copyFile(path.join(root, 'public/demo/asset-prompts.md'), path.join(licenses, 'DEMO-ASSET-PROVENANCE.md'));
await fs.writeFile(path.join(licenses, 'FFMPEG-LOCAL-USE-NOTICE.txt'), 'This local-only prototype contains the unchanged FFmpeg binary from @ffmpeg-installer/darwin-arm64 4.1.5. Its actual build flags include --enable-gpl, --enable-version3 and --enable-nonfree (see ffmpeg-build-info.txt). The npm wrapper metadata does not establish redistributability of the bundled binary. This package is prepared for the requesting user\'s use on this Mac; do not redistribute this build. A distributable release requires a replacement media-engine build and its corresponding source and license obligations.\nFFmpeg project: https://ffmpeg.org/\nFFmpeg legal information: https://ffmpeg.org/legal.html\nBinary provider: https://www.osxexperts.net/\nInstaller source: https://github.com/kribblo/node-ffmpeg-installer\n');
const ffmpeg = path.join(root, 'node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg');
const ffprobe = path.join(root, 'node_modules/@ffprobe-installer/darwin-arm64/ffprobe');
for (const [name, filename] of [['ffmpeg', ffmpeg], ['ffprobe', ffprobe]]) {
  const result = spawnSync(filename, ['-version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} binary is not runnable: ${result.stderr}`);
  await fs.writeFile(path.join(licenses, `${name}-build-info.txt`), result.stdout + result.stderr);
}
console.log(`Desktop stage ready: ${appDir}; demo media: ${records.length}; bundled dependency notices: ${notices.length}.`);

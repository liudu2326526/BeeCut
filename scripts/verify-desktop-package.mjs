import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile, getRawHeader } from '@electron/asar';

// Independent read-only acceptance of the finalized app and an extracted ZIP.
// This does not launch the editor, replace the installed app or read userData.
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
const app = path.join(release, '微剪.app');
const zip = path.join(release, `微剪-${metadata.version}-mac-arm64.zip`);
const reportPath = path.join(release, `independent-package-verification-${metadata.version}.json`);
const report = { version: metadata.version, startedAt: new Date().toISOString(), app, zip, stages: [] };
const hash = async filename => {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(filename)) digest.update(bytes);
  return digest.digest('hex');
};
async function command(binary, args, options = {}) {
  const result = await exec(binary, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
  return result.stdout + result.stderr;
}
const plist = key => command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents/Info.plist')]).then(value => value.trim());

async function manifest(folder) {
  const entries = [];
  async function walk(current) {
    for (const name of (await fs.readdir(current)).sort()) {
      const filename = path.join(current, name);
      const relative = path.relative(folder, filename).split(path.sep).join('/');
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(filename);
        const resolved = await fs.realpath(filename);
        assert.ok(resolved.startsWith(`${await fs.realpath(folder)}${path.sep}`), `Link escapes app: ${relative}`);
        entries.push({ path: relative, type: 'symlink', target });
      } else if (stat.isDirectory()) await walk(filename);
      else {
        assert.ok(stat.isFile(), `Unexpected filesystem entry: ${relative}`);
        entries.push({ path: relative, type: 'file', bytes: stat.size, mode: stat.mode & 0o777, sha256: await hash(filename) });
      }
    }
  }
  await walk(folder);
  return entries;
}
async function assertTreeMatches(actual, expected, label) {
  assert.deepEqual(await manifest(actual), await manifest(expected), label);
}

// Ad-hoc re-signing can rewrite signature padding while preserving the same
// CodeDirectory and executable. Compare normalized copies, never modify either
// runtime executable; signed App/ZIP bytes are still checked exactly below.
async function unsignedExecutableHash(filename) {
  const temporary = await fs.mkdtemp(path.join(release, '.helper-identity-'));
  try {
    const copy = path.join(temporary, 'weijian-audio-helper');
    await fs.copyFile(filename, copy);
    await command('/usr/bin/codesign', ['--remove-signature', copy]);
    return await hash(copy);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function verify() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.equal(await plist('CFBundleIdentifier'), 'com.weijian.studio');
  assert.equal(await plist('CFBundleShortVersionString'), metadata.version);
  assert.equal(await plist('LSMinimumSystemVersion'), '13.0');
  const signature = await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const signatureDetails = await command('/usr/bin/codesign', ['-d', '--verbose=4', app]);
  assert.match(signatureDetails, /Signature=adhoc/);
  report.platform = 'darwin-arm64';
  report.minimumMacOS = '13.0';
  report.signing = 'ad-hoc';
  report.notarized = false;
  report.signature = signature.trim();
  report.stages.push('stable bundle identity, version, minimum macOS and strict deep ad-hoc signature');

  const resources = path.join(app, 'Contents/Resources');
  const archive = path.join(resources, 'app.asar');
  const resourceNames = ['app.asar', 'app.asar.unpacked', 'audio-helper', 'default_app.asar', 'demo-library', 'icon.icns', 'licenses', 'ui'];
  assert.deepEqual((await fs.readdir(resources)).sort(), resourceNames.sort(), 'Resources must contain only declared runtime, demo, license and icon entries');
  assert.equal(await hash(path.join(resources, 'default_app.asar')), await hash(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/Resources/default_app.asar')), 'Electron bootstrap archive differs from the pinned vendor runtime');
  assert.equal(await hash(path.join(resources, 'icon.icns')), await hash(path.join(root, 'desktop/assets/icon.icns')));
  const archiveEntries = listPackage(archive);
  const rawHeader = getRawHeader(archive);
  const expectedUnpacked = [];
  function findUnpacked(entries, prefix = '', inherited = false) {
    for (const [name, value] of Object.entries(entries)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const unpacked = inherited || value.unpacked === true;
      if (value.files) findUnpacked(value.files, relative, unpacked);
      else if (unpacked) expectedUnpacked.push(relative);
    }
  }
  findUnpacked(rawHeader.header.files);
  const unpackedEntries = await manifest(path.join(resources, 'app.asar.unpacked'));
  assert.deepEqual(unpackedEntries.map(entry => entry.path).sort(), expectedUnpacked.sort(), 'Physical unpacked files must match the ASAR unpacked declarations exactly');
  for (const entry of unpackedEntries) {
    assert.equal(entry.type, 'file', 'Unpacked runtime modules must be ordinary files');
    if (path.basename(entry.path) === 'package.json') {
      const expected = JSON.parse(await fs.readFile(path.join(root, '.desktop-build/app', entry.path), 'utf8'));
      // electron-builder strips npm lifecycle scripts and search keywords from
      // shipped module manifests. Compare the parsed, explicitly pruned facts.
      delete expected.scripts;
      delete expected.keywords;
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(resources, 'app.asar.unpacked', entry.path), 'utf8')), expected, `Unexpected packaged module metadata: ${entry.path}`);
    } else if (!['ffmpeg', 'ffprobe'].includes(path.basename(entry.path))) assert.equal(entry.sha256, await hash(path.join(root, '.desktop-build/app', entry.path)), `Unpacked module differs from stage: ${entry.path}`);
  }
  const nativePackages = ['@ffmpeg-installer/ffmpeg', '@ffmpeg-installer/darwin-arm64', '@ffprobe-installer/ffprobe', '@ffprobe-installer/darwin-arm64'];
  const runtimeFiles = ['main.mjs', 'preload.cjs', 'audio-host-preload.cjs'];
  const moduleRoots = new Set(['index.js', 'lib', 'package.json', 'README.md', 'ffmpeg', 'ffprobe']);
  for (const entry of archiveEntries) {
    const relative = entry.replace(/^\//, '');
    if ([...runtimeFiles, 'package.json', 'node_modules', 'node_modules/@ffmpeg-installer', 'node_modules/@ffprobe-installer'].includes(relative)) continue;
    const module = nativePackages.find(name => relative === `node_modules/${name}` || relative.startsWith(`node_modules/${name}/`));
    assert.ok(module, `ASAR path is outside runtime allowlist: ${relative}`);
    const inside = relative.slice(`node_modules/${module}`.length).replace(/^\//, '');
    if (!inside) continue;
    assert.ok(moduleRoots.has(inside.split('/')[0]), `Module file is outside runtime allowlist: ${relative}`);
    assert.ok(!inside.split('/').some(part => part.startsWith('.') || part.endsWith('~')), `Hidden/backup file in package: ${relative}`);
  }
  const packagedMetadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(packagedMetadata.version, metadata.version);
  assert.equal(packagedMetadata.main, 'main.mjs');
  assert.deepEqual(Object.keys(packagedMetadata.dependencies).sort(), nativePackages.sort());
  const runtimeHashes = {};
  for (const file of runtimeFiles) {
    runtimeHashes[file] = createHash('sha256').update(extractFile(archive, file)).digest('hex');
    assert.equal(runtimeHashes[file], await hash(path.join(root, '.desktop-build/app', file)), `Packaged runtime differs from stage: ${file}`);
    if (file.endsWith('.cjs')) assert.equal(runtimeHashes[file], await hash(path.join(root, 'desktop', file)), `Packaged preload differs from source: ${file}`);
  }
  const headerHash = createHash('sha256').update(rawHeader.headerString).digest('hex');
  assert.equal(await plist('ElectronAsarIntegrity:Resources/app.asar:hash'), headerHash);
  await assertTreeMatches(path.join(resources, 'ui'), path.join(root, 'dist/client'), 'Packaged client must be byte-identical to the just-built UI');
  const allEntries = await manifest(app);
  const prohibited = allEntries.filter(entry => /(?:^|\/)(\.env(?:\.[^/]*)?|\.git|\.cache|artifacts|uploads|key-store)(?:\/|$)|~$/.test(entry.path));
  assert.deepEqual(prohibited, [], 'No environment files, repository artifacts, temporary uploads or key stores may be shipped');
  report.allowlist = { archiveEntries: archiveEntries.length, physicalUnpackedFiles: unpackedEntries.length, resourceNames, nativePackages, runtimeHashes, mainSha256: runtimeHashes['main.mjs'], asarHeaderSha256: headerHash, appEntries: allEntries.length, prohibitedFiles: 0, ambientEnvironmentCopied: false };
  report.stages.push('ASAR runtime allowlist, no environment/artifact files, matching client and bundle-integrity hash');

  const sourceDemo = JSON.parse(await fs.readFile(path.join(root, 'data/demo.json'), 'utf8'));
  const sourceRegistry = JSON.parse(await fs.readFile(path.join(root, 'data/media.json'), 'utf8'));
  const seed = path.join(resources, 'demo-library');
  const seededDemo = JSON.parse(await fs.readFile(path.join(seed, 'demo.json'), 'utf8'));
  const records = sourceDemo.media.map(item => sourceRegistry.find(record => record.id === item.id));
  assert.ok(records.every(Boolean));
  assert.deepEqual(seededDemo, sourceDemo);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(seed, 'media.json'), 'utf8')), records);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(seed, 'projects', `${sourceDemo.id}.json`), 'utf8')), sourceDemo);
  const expectedSeed = new Map([
    ['demo.json', path.join(root, 'data/demo.json')],
    ['media.json', null],
    [`projects/${sourceDemo.id}.json`, null],
  ]);
  for (const item of sourceDemo.media) {
    const record = records.find(record => record.id === item.id);
    assert.equal(path.basename(record.filename), record.filename);
    expectedSeed.set(`media/${record.filename}`, path.join(root, 'data/media', record.filename));
    if (item.thumbnailUrl) expectedSeed.set(`thumbnails/${path.basename(item.thumbnailUrl)}`, path.join(root, 'data/thumbnails', path.basename(item.thumbnailUrl)));
  }
  const seedManifest = await manifest(seed);
  assert.deepEqual(seedManifest.map(entry => entry.path).sort(), [...expectedSeed.keys()].sort(), 'Only selected demo files may enter the shipped library');
  for (const entry of seedManifest) {
    assert.equal(entry.type, 'file');
    const original = expectedSeed.get(entry.path);
    if (original && entry.path !== 'demo.json') assert.equal(entry.sha256, await hash(original), `Demo media changed: ${entry.path}`);
  }
  report.demo = { projectId: sourceDemo.id, mediaCount: records.length, fileCount: seedManifest.length, mediaHashes: seedManifest.filter(entry => /^(media|thumbnails)\//.test(entry.path)) };
  report.stages.push('demo-only exact file manifest and matching demo source bytes; no user library or acceptance project');

  const licenseDir = path.join(resources, 'licenses');
  await assertTreeMatches(licenseDir, path.join(root, '.desktop-build/resources/licenses'), 'Shipped licenses must exactly match the selected component notices and build metadata');
  for (const filename of ['electron/LICENSE', 'electron/LICENSES.chromium.html', 'FFmpeg-COPYING.GPLv2', 'FFmpeg-COPYING.GPLv3', 'FFmpeg-COPYING.LGPLv2.1', 'FFmpeg-COPYING.LGPLv3', 'FFmpeg-LICENSE.md', 'DEMO-ASSET-PROVENANCE.md', 'FFMPEG-LOCAL-USE-NOTICE.txt', 'ffmpeg-build-info.txt', 'ffprobe-build-info.txt']) assert.ok((await fs.stat(path.join(licenseDir, filename))).size > 0, `Missing component license/build metadata: ${filename}`);
  const notices = JSON.parse(await fs.readFile(path.join(licenseDir, 'THIRD-PARTY-NOTICES.json'), 'utf8'));
  for (const name of ['react', 'react-dom', '@phosphor-icons/react', ...nativePackages]) assert.ok(notices.some(item => item.name === name), `Missing notice for ${name}`);
  for (const notice of notices) for (const filename of notice.licenseFiles) assert.ok((await fs.stat(path.join(licenseDir, notice.name.replaceAll('/', '__'), filename))).isFile());
  assert.match(await fs.readFile(path.join(licenseDir, 'FFMPEG-LOCAL-USE-NOTICE.txt'), 'utf8'), /do not redistribute this build/);
  const nativeRoot = path.join(resources, 'app.asar.unpacked/node_modules');
  const nativeTools = {};
  for (const [name, module] of [['ffmpeg', '@ffmpeg-installer/darwin-arm64'], ['ffprobe', '@ffprobe-installer/darwin-arm64']]) {
    const filename = path.join(nativeRoot, module, name);
    const info = await command('/usr/bin/file', [filename]);
    assert.match(info, /arm64/);
    assert.ok((await fs.stat(filename)).mode & 0o111, `${name} is not executable`);
    const version = await command(filename, ['-version']);
    assert.equal(version, await fs.readFile(path.join(licenseDir, `${name}-build-info.txt`), 'utf8'));
    nativeTools[name] = { path: filename, sha256: await hash(filename), version: version.split('\n')[0], architecture: info.trim(), nonfree: version.includes('--enable-nonfree') };
  }
  assert.equal(nativeTools.ffmpeg.nonfree, true, 'Local-use notice must match the actual FFmpeg build');
  const helper = path.join(resources, 'audio-helper/weijian-audio-helper');
  assert.deepEqual(await fs.readdir(path.dirname(helper)), ['weijian-audio-helper'], 'Only the owned audio executable is shipped');
  const helperCodeHash = await unsignedExecutableHash(helper);
  assert.equal(helperCodeHash, await unsignedExecutableHash(path.join(root, '.desktop-build/resources/audio-helper/weijian-audio-helper')), 'Audio helper executable code differs from the staged executable');
  const helperInfo = await command('/usr/bin/file', [helper]);
  assert.match(helperInfo, /arm64/);
  assert.ok((await fs.stat(helper)).mode & 0o111);
  await command('/usr/bin/codesign', ['--verify', '--strict', helper]);
  const helperVersion = (await command(helper, ['--version'])).trim();
  assert.match(helperVersion, /^weijian-audio-helper .*rubberband-4\.0\.0 R3 short offline$/);
  const helperDependencies = await command('/usr/bin/otool', ['-L', helper]);
  for (const line of helperDependencies.split('\n').slice(1).filter(line => line.trim())) {
    assert.match(line.trim(), /^(\/System\/Library\/|\/usr\/lib\/)/, 'Audio helper requires an unbundled external library');
  }
  const helperLock = JSON.parse(await fs.readFile(path.join(licenseDir, 'rubberband/rubberband.lock.json'), 'utf8'));
  assert.equal(await hash(path.join(licenseDir, 'rubberband', path.basename(helperLock.sourceArchive))), helperLock.sha256, 'Shipped upstream source identity differs from the lock');
  assert.match(await fs.readFile(path.join(licenseDir, 'rubberband/LICENSE.rubberband'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
  nativeTools.audioHelper = { path: helper, version: helperVersion, sha256: await hash(helper), unsignedExecutableSha256: helperCodeHash, architecture: helperInfo.trim(), dependencies: helperDependencies, upstreamVersion: helperLock.version, upstreamSourceSha256: helperLock.sha256 };
  const executable = path.join(app, 'Contents/MacOS/微剪');
  const runtime = JSON.parse(await command(executable, ['-e', 'process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron,chrome:process.versions.chrome,arch:process.arch}))'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }));
  assert.equal(runtime.arch, 'arm64');
  assert.equal(runtime.electron, JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version);
  report.runtime = runtime;
  report.licenses = { dependencyNotices: notices.length, nativeTools, use: 'local personal use; unchanged nonfree FFmpeg build is not a distributable release' };
  report.stages.push('bundled Electron/Node and physical FFmpeg/FFprobe execute; licenses and actual nonfree metadata match');

  const extraction = await fs.mkdtemp(path.join(release, '.independent-verify-'));
  try {
    await command('/usr/bin/ditto', ['-x', '-k', zip, extraction]);
    report.extractedSignature = (await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', path.join(extraction, '微剪.app')])).trim();
    assert.deepEqual(await manifest(path.join(extraction, '微剪.app')), allEntries, 'ZIP extraction differs from finalized signed app');
  } finally { await fs.rm(extraction, { recursive: true, force: true }); }
  const sha256 = await hash(zip);
  assert.equal(await fs.readFile(`${zip}.sha256`, 'utf8'), `${sha256}  ${path.basename(zip)}\n`);
  const receipt = JSON.parse(await fs.readFile(path.join(release, `package-verification-${metadata.version}.json`), 'utf8'));
  assert.equal(receipt.version, metadata.version);
  assert.equal(receipt.sha256, sha256);
  assert.equal(receipt.zipBytes, (await fs.stat(zip)).size);
  Object.assign(report, { sha256, zipBytes: receipt.zipBytes, passed: true, completedAt: new Date().toISOString() });
  report.stages.push('independent ZIP extraction, all file bytes/modes/symlinks, strict signature and SHA-256 receipt match');
}

try {
  await verify();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, version: report.version, zip: report.zip, zipBytes: report.zipBytes, sha256: report.sha256, appEntries: report.allowlist.appEntries, reportPath }, null, 2));
} catch (error) {
  Object.assign(report, { passed: false, failedAt: new Date().toISOString(), error: { message: error.message, stack: error.stack } });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
}

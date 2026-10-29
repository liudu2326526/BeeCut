import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listPackage, getRawHeader } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
const app = path.join(release, 'BeeCut.app');
const source = path.join(release, 'mac-arm64/BeeCut.app');
const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8' }); if (result.status !== 0) throw new Error(`${command} failed: ${result.stdout}\n${result.stderr}`); return result.stdout + result.stderr; };
const archiveFiles = listPackage(path.join(source, 'Contents/Resources/app.asar'));
const unexpectedFiles = archiveFiles.filter(file => /(?:^|\/)(data|artifacts|exports|work|src|\.cache|\.env)(?:\/|$)|~$/.test(file));
if (unexpectedFiles.length) throw new Error(`Unexpected files in release archive: ${unexpectedFiles.join(', ')}`);
await fs.rm(app, { recursive: true, force: true });
run('/bin/cp', ['-cR', source, app]);
await fs.cp(path.join(root, 'desktop/licenses'), path.join(app, 'Contents/Resources/licenses'), { recursive: true });
await fs.mkdir(path.join(app, 'Contents/Resources/licenses/electron'), { recursive: true });
for (const filename of ['LICENSE', 'LICENSES.chromium.html']) await fs.copyFile(path.join(root, 'node_modules/electron/dist', filename), path.join(app, 'Contents/Resources/licenses/electron', filename));
const asarHeaderHash = createHash('sha256').update(getRawHeader(path.join(app, 'Contents/Resources/app.asar')).headerString).digest('hex');
run('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${asarHeaderHash}`, path.join(app, 'Contents/Info.plist')]);
const unpacked = path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules');
for (const filename of [path.join(unpacked, '@ffmpeg-installer/darwin-arm64/ffmpeg'), path.join(unpacked, '@ffprobe-installer/darwin-arm64/ffprobe'), path.join(app, 'Contents/Resources/audio-helper/weijian-audio-helper')]) {
  await fs.chmod(filename, 0o755);
  run('/usr/bin/codesign', ['--force', '--sign', '-', filename]);
}
// Sign the enclosing bundle after the shipped command line executables.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
const signature = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const zip = path.join(release, `BeeCut-${metadata.version}-mac-arm64.zip`);
await fs.rm(zip, { force: true });
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
const verification = await fs.mkdtemp(path.join(release, '.verify-'));
let extractedSignature;
try { run('/usr/bin/ditto', ['-x', '-k', zip, verification]); extractedSignature = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', path.join(verification, 'BeeCut.app')]); }
finally { await fs.rm(verification, { recursive: true, force: true }); }
const hash = createHash('sha256');
for await (const chunk of createReadStream(zip)) hash.update(chunk);
const sha256 = hash.digest('hex');
await fs.writeFile(`${zip}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
const minimumMacOS = run('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', path.join(app, 'Contents/Info.plist')]).trim();
const electronVersion = JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const report = { version: metadata.version, platform: 'darwin-arm64', minimumMacOS, electronVersion, signing: 'ad-hoc', notarized: false, app, zip, zipBytes: (await fs.stat(zip)).size, sha256, signature: signature.trim(), extractedSignature: extractedSignature.trim(), verifiedAt: new Date().toISOString() };
const reportText = JSON.stringify(report, null, 2);
await fs.writeFile(path.join(release, `package-verification-${metadata.version}.json`), reportText);
await fs.writeFile(path.join(release, 'package-verification.json'), reportText);
console.log(JSON.stringify(report, null, 2));

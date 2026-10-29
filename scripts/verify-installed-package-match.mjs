import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const exec = promisify(execFile);
const installed = path.join(homedir(), 'Applications/BeeCut.app');
const released = path.join(root, 'release/BeeCut.app');
const output = path.resolve(process.argv[2] || path.join(root, `artifacts/installed-${metadata.version}`));
await fs.mkdir(output, { recursive: true });
const sha = async filename => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
};
async function manifest(folder) {
  const entries = [];
  const resolvedRoot = await fs.realpath(folder);
  async function walk(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const filename = path.join(directory, name);
      const relative = path.relative(folder, filename).split(path.sep).join('/');
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) {
        assert.ok((await fs.realpath(filename)).startsWith(`${resolvedRoot}${path.sep}`), `Escaping app symlink ${relative}`);
        entries.push({ path: relative, type: 'symlink', target: await fs.readlink(filename), mode: stat.mode & 0o777 });
      } else if (stat.isDirectory()) await walk(filename);
      else {
        assert.ok(stat.isFile(), `Unexpected app filesystem entry ${relative}`);
        entries.push({ path: relative, type: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: await sha(filename) });
      }
    }
  }
  await walk(folder);
  return entries;
}

const receipt = { startedAt: new Date().toISOString(), installed, released, operation: 'read-only installed/release package equivalence; no GUI or userData mutation' };
try {
  const source = await manifest(released);
  const actual = await manifest(installed);
  assert.deepEqual(actual, source, 'Installed app file bytes, modes and symlink targets must exactly match released app');
  const signature = await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', installed]);
  const version = (await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents/Info.plist')])).stdout.trim();
  assert.equal(version, metadata.version);
  const packageReceipt = JSON.parse(await fs.readFile(path.join(root, `release/package-verification-${metadata.version}.json`), 'utf8'));
  assert.equal(await sha(packageReceipt.zip), packageReceipt.sha256);
  const manifestPath = path.join(output, 'installed-release-file-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ version, entries: actual }, null, 2));
  Object.assign(receipt, {
    passed: true, version, completedAt: new Date().toISOString(),
    entries: actual.length, files: actual.filter(entry => entry.type === 'file').length, symlinks: actual.filter(entry => entry.type === 'symlink').length,
    manifestPath, manifestSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex'),
    zip: packageReceipt.zip, zipSha256: packageReceipt.sha256, signature: (signature.stdout + signature.stderr).trim(), differences: [],
  });
  const reportPath = path.join(output, 'installed-release-equivalence.json');
  await fs.writeFile(reportPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: true, entries: receipt.entries, files: receipt.files, symlinks: receipt.symlinks, version, zipSha256: receipt.zipSha256, reportPath }, null, 2));
} catch (error) {
  Object.assign(receipt, { passed: false, failedAt: new Date().toISOString(), error: { message: error.message, stack: error.stack } });
  await fs.writeFile(path.join(output, 'installed-release-equivalence-failure.json'), JSON.stringify(receipt, null, 2));
  console.error(error);
  process.exitCode = 1;
}

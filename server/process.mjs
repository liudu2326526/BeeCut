import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';

// Electron can read modules inside ASAR, but child_process needs real executable
// files. Only the actual archive path segment maps to the unpacked sibling.
export const executablePath = filename => filename.replace(/(^|[\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
export const ffmpegPath = executablePath(ffmpeg.path);
export const ffprobePath = executablePath(ffprobe.path);
// Exclude playlist/script demuxers: imported files may not fetch URLs or read
// extra local files through HLS, concat, DASH, or other indirect protocols.
export const inputFormats = 'mov,matroska,avi,mp3,wav,aiff,flac,ogg,aac,image2,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe,gif';
export const inputSafetyArgs = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', inputFormats];

export function run(binary, args, { cwd, timeout = 30000, onProgress, onChild, maxOutput = 1024 * 1024, signal: abortSignal } = {}) {
  if (abortSignal?.aborted) return Promise.reject(Object.assign(new Error('处理已取消'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', stopped = false, settled = false, cancelled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      abortSignal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killer.unref();
    };
    let killer;
    const onAbort = () => { cancelled = true; stop(); };
    const timer = setTimeout(stop, timeout);
    timer.unref();
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    onChild?.(child);
    child.stdout.on('data', data => {
      const chunk = data.toString();
      stdout = (stdout + chunk).slice(-maxOutput);
      onProgress?.(chunk);
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-maxOutput); });
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => {
      if (cancelled) finish(Object.assign(new Error('处理已取消，本地进程已退出'), { name: 'AbortError' }));
      else if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(stopped ? '处理超时，已停止本地进程' : `${binary.includes('ffprobe') ? '素材探测' : '视频处理'}失败（${signal || code}）：${stderr.slice(-5000)}`));
    });
  });
}

export async function probe(filename, options) {
  const { stdout } = await run(ffprobePath, ['-v', 'error', ...inputSafetyArgs, '-show_format', '-show_streams', '-of', 'json', filename], options);
  try { return JSON.parse(stdout); }
  catch { throw new Error('无法解析素材流信息'); }
}

let availability;
export function getAvailability() {
  return availability ??= Promise.all([
    run(ffmpegPath, ['-version']).then(() => true, () => false),
    run(ffprobePath, ['-version']).then(() => true, () => false),
    run(ffmpegPath, ['-hide_banner', '-filters']).then(({ stdout, stderr }) => ({ drawtext: /\bdrawtext\b/.test(stdout + stderr), subtitles: /\bsubtitles\b/.test(stdout + stderr) }), () => ({ drawtext: false, subtitles: false })),
  ]).then(([ffmpegAvailable, ffprobeAvailable, filters]) => ({ ffmpegAvailable, ffprobeAvailable, filters }));
}

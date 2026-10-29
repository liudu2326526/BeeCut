import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { newProject } from '../shared/model.mjs';

// The demo is a local fixture: AI generated artwork, a gentle generated camera
// move, and synthesized audio. It never reads the user's Jianying projects.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.API_URL || 'http://127.0.0.1:4318';
const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
const imagePath = resolve(process.env.DEMO_IMAGE || resolve(root, 'public/demo/mountain-vortex.png'));
const sourceDir = resolve(dataDir, 'demo-sources');

function ffmpeg(args) {
  return new Promise((done, reject) => {
    const child = spawn(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-12000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? done() : reject(new Error(`FFmpeg exited ${code}: ${error}`)));
  });
}

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error || response.statusText}`);
  return result;
}

async function main() {
  const health = await json('/api/health');
  if (!health.ffmpegAvailable || !health.ffprobeAvailable) throw new Error('Local media tools are unavailable.');
  await access(imagePath);
  await mkdir(sourceDir, { recursive: true });
  const videoPaths = ['云海_远山.mp4', '云海_旋涡.mp4'].map(name => resolve(sourceDir, name));
  const filters = [
    "scale=1440:810:force_original_aspect_ratio=increase,crop=1440:810,zoompan=z='1.02+on*0.00014':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,format=yuv420p",
    "scale=1440:810:force_original_aspect_ratio=increase,crop=1440:810,zoompan=z='1.12-on*0.00013':x='iw/2-iw/zoom/2+12':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,format=yuv420p",
  ];
  for (let i = 0; i < videoPaths.length; i++) {
    console.log(`Generating ${basename(videoPaths[i])} (15 seconds)…`);
    await ffmpeg(['-loop', '1', '-i', imagePath, '-vf', filters[i], '-t', '15', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-movflags', '+faststart', videoPaths[i]]);
  }
  const audioPath = resolve(sourceDir, '远行_氛围配乐.wav');
  const note = 'if(lt(mod(t,16),4),261.63,if(lt(mod(t,16),8),329.63,if(lt(mod(t,16),12),392,293.66)))';
  const tone = `0.045*(sin(2*PI*130.81*t)+0.45*sin(2*PI*196*t))+0.035*sin(2*PI*(${note})*t)*pow(sin(PI*mod(t,4)/4),2)`;
  console.log('Generating synthesized ambient music (30 seconds)…');
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=${tone.replaceAll(',', '\\,')}:s=48000:d=30`, '-af', 'afade=t=in:d=1.5,afade=t=out:st=27:d=3', '-ac', '2', '-c:a', 'pcm_s16le', audioPath]);
  const form = new FormData();
  for (const file of [...videoPaths, audioPath]) form.append('files', new Blob([await readFile(file)]), basename(file));
  const { media } = await json('/api/media', { method: 'POST', body: form });
  const videos = media.filter(item => item.type === 'video');
  const audio = media.find(item => item.type === 'audio');
  if (videos.length !== 2 || !audio) throw new Error('The demo needs two videos and one audio track.');
  const project = { ...newProject('云海 · 一场远行'), width: 1280, height: 720, fps: 30, media };
  project.clips = videos.map((item, index) => ({ id: crypto.randomUUID(), mediaId: item.id, track: 'video', start: index * 15, sourceStart: 0, duration: 15, speed: 1, volume: 1 }));
  project.clips.push({ id: crypto.randomUUID(), mediaId: audio.id, track: 'audio', start: 0, sourceStart: 0, duration: 30, speed: 1, volume: 0.55 });
  project.subtitles = [
    { id: crypto.randomUUID(), text: '向山海出发', start: 3, duration: 4, fontSize: 44, color: '#FFFFFF', position: 'bottom' },
    { id: crypto.randomUUID(), text: '把每一刻，剪成故事', start: 21, duration: 5, fontSize: 44, color: '#FFFFFF', position: 'bottom' },
  ];
  const { project: saved } = await json('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
  await writeFile(resolve(dataDir, 'demo.json'), `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`Saved ${resolve(dataDir, 'demo.json')}`);
  console.log('Demo artwork: AI generated. Demo music: synthesized locally.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { ffmpegPath } from '../server/process.mjs';
import { newProject, pictureTransformAt, animationAlphaAt, visualLayersAt } from '../shared/model.mjs';
import { ANIMATION_TYPES, TRANSITION_TYPES, animationEffectAt, transitionEffectAt, transitionSampleStyle, transitionRenderFilters } from '../shared/effects.mjs';
const exec = promisify(execFile), W = 320, H = 180, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const near = (actual, expected, tolerance, name) => assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} != ${expected}`);
const hash = data => createHash('sha256').update(data).digest('hex');
const types = ['pushLeft', 'pushRight', 'slideLeft', 'slideRight', 'fadeWhite'];
// Original deterministic RGBA fixtures, not output-derived expected pixels.
function sourcePixel(index, x, y) {
  const color = index === 0 ? [40 + Math.floor(100 * x / (W - 1)), 15, 190] : [210, 20 + Math.floor(150 * x / (W - 1)), 30];
  return [...color, x >= W * .4 && x < W * .6 && y >= H * .4 && y < H * .6 ? 0 : 255];
}
function png(index) {
  const crc = bytes => { let value = -1; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ -1) >>> 0; };
  const chunk = (type, value) => { const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(value.length); checksum.writeUInt32BE(crc(Buffer.concat([name, value]))); return Buffer.concat([size, name, value, checksum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Buffer.from(index < 2 ? sourcePixel(index, x, y) : [0, 255, 0, 255]).copy(raw, y * (W * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function harness(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-v08-effects-')), runtime = await createApp({ dataDir: path.join(directory, 'Library') });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runtime.queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const api = async (url, options, status = 200) => { const response = await fetch(origin + url, options), body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  const upload = async (bytes, name) => { const form = new FormData(); form.append('files', new Blob([bytes]), name); return (await api('/api/media', { method: 'POST', body: form }, 201)).media[0]; };
  const media = await Promise.all([0,1,2].map(index => upload(png(index), `original-pattern-${index}.png`)));
  const save = async project => { const saved = (await api('/api/projects', post(project))).project; assert.deepEqual((await api('/api/projects/' + saved.id)).project, saved); return saved; };
  const render = async (project, fps = 30) => {
    let job = await api('/api/exports', post({ project, settings: { width: W, height: H, fps } }), 202);
    for (let n = 0; n < 3000 && !['completed', 'failed'].includes(job.status); n++) { await delay(20); job = await api('/api/exports/' + job.id); }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const filename = path.join(directory, job.id + '.mp4'); await fs.writeFile(filename, Buffer.from(await (await fetch(origin + job.url)).arrayBuffer())); return filename;
  };
  const frames = async filename => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filename, '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 })).stdout;
  const clip = (id, index, start, duration, extra = {}) => ({ id, mediaId: media[index].id, track: 'video', layer: 1, start, sourceStart: 0, duration, speed: 1, volume: 0, ...extra });
  return { directory, origin, media, api, upload, save, render, frames, clip };
}
async function evidence(name, value) {
  if (!process.env.WEIJIAN_V08_EFFECTS_EVIDENCE_DIR) return;
  await fs.mkdir(process.env.WEIJIAN_V08_EFFECTS_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.WEIJIAN_V08_EFFECTS_EVIDENCE_DIR, name + '.json'), JSON.stringify(value, null, 2));
}
const pixel = (frames, n, x, y) => [...frames.subarray((n * W * H + y * W + x) * 3, (n * W * H + y * W + x) * 3 + 3)];

test('v08 effects own finite canvas motion and additive white/compound alpha while old defaults remain valid', () => {
  assert.ok(types.every(type => TRANSITION_TYPES.includes(type))); assert.ok(['zoomFade','rotateFade'].every(type => ANIMATION_TYPES.includes(type)));
  for (const p of [-1,0,.25,.5,1,2]) {
    const q = Math.max(0, Math.min(1, p));
    for (const type of types.slice(0,4)) {
      const value = transitionEffectAt(type, p), right = type.endsWith('Right');
      near(value.incoming.translate.x, (right ? 1 : -1) * (q - 1), 1e-12, type + ' incoming');
      if (type.startsWith('push')) near(value.outgoing.translate.x, (right ? 1 : -1) * q, 1e-12, type + ' outgoing');
      else near(value.outgoing.clipRect.width, 1 - q, 1e-12, type + ' retained stationary region');
      const plan = transitionRenderFilters(type, clock => `min(1,max(0,${clock}))`); assert.ok(plan.combineFilter.includes('shortest=1')); assert.ok(!JSON.stringify(plan).includes('geq'));
    }
    const white = transitionEffectAt('fadeWhite', p); near(white.whiteOpacity, 1 - Math.max(0,1-2*q) - Math.max(0,2*q-1), 1e-12, 'white coverage'); assert.equal(white.blackOpacity, 0);
  }
  const project = { width: W, height: H };
  assert.deepEqual(animationEffectAt('zoomFade', .5, project), { scale: .75, x: 0, y: 0, rotation: 0, alpha: .5 });
  assert.deepEqual(animationEffectAt('rotateFade', .5, project), { scale: 1, x: 0, y: 0, rotation: -45, alpha: .5 });
  assert.equal(transitionSampleStyle({ weight: 1 }), undefined);
  assert.equal(transitionSampleStyle({ translate: { x: .25, y: 0 }, clipRect: { x: 0, y: 0, width: .5, height: 1 } }).transform, 'translate(25%, 0%)');
  assert.throws(() => transitionRenderFilters('pushLeft', 'T'), /时钟/); assert.throws(() => transitionEffectAt('missing-effect', .5), /未知/);
});

test('v08 real API persists and exports five transitions with independent shifted-pixel/alpha oracle at fractional cuts24/30/60fps', { timeout: 120000 }, async t => {
  const h = await harness(t), duration = 1.137, window = .63, length = duration * 6;
  const project = await h.save({ ...newProject('五种空间和淡白转场'), width: W, height: H, fps: 24, media: h.media, clips: [h.clip('base',2,0,length,{layer:0}),
    ...Array.from({length:6},(_,i)=>h.clip('part-'+i,i%2,i*duration,duration,{transform:{opacity:.6},mask:{type:'rectangle',width:.8,height:.8},...(i<5?{transitionOut:{type:types[i],duration:window,nextClipId:'part-'+(i+1)}}:{})}))] });
  assert.deepEqual(project.clips.slice(1,6).map(c=>c.transitionOut.type),types);
  const bad = structuredClone(project); bad.clips[1].transitionOut.type = 'missing-spatial'; await h.api('/api/projects', post(bad), 400);
  const observations=[];let probes=0,skips=0;
  for (const fps of [24,30,60]) {
    const frames = await h.frames(await h.render(project,fps)), count = Math.ceil(length*fps-1e-8); assert.equal(frames.length/(W*H*3),count);
    let maximumError=0;
    for(let n=0;n<count;n++)for(const y of [48,90,132])for(const x of [20,60,100,140,180,220,260,300]){
      const at=n/fps;let index=Math.min(5,Math.floor(at/duration)),sx=x,weights=[1,0],white=0;
      const transition=types.findIndex((_,i)=>at>=(i+1)*duration-window/2&&at<(i+1)*duration+window/2);
      if(transition>=0){const type=types[transition],p=(at-((transition+1)*duration-window/2))/window;
        if(type==='fadeWhite'){index=transition;weights=[Math.max(0,1-2*p),Math.max(0,2*p-1)];white=1-weights[0]-weights[1];}
        else{const right=type.endsWith('Right'),incoming=right?x<W*p:x>=W*(1-p);if(Math.abs(x-(right?W*p:W*(1-p)))<=4){skips++;continue;}index=transition+Number(incoming);if(incoming)sx=x+(right?W*(1-p):-W*(1-p));else if(type.startsWith('push'))sx=x+(right?-W*p:W*p);}
      }
      const source=(i)=>sourcePixel(i%2,Math.max(0,Math.min(W-1,Math.round(sx))),y);
      // Exclusions depend on intended geometry, never observed output colors.
      const boundaries=[W*.1,W*.9,...(y>=H*.4&&y<H*.6?[W*.4,W*.6]:[])];
      if(boundaries.some(edge=>Math.abs(sx-edge)<=4)){skips++;continue;}
      const rgbaA=source(index),rgbaB=source(index+1),inside=sx>=W*.1&&sx<W*.9&&y>=H*.1&&y<H*.9;
      const a=inside?rgbaA[3]/255*.6*weights[0]:0,b=inside?rgbaB[3]/255*.6*weights[1]:0;
      const expected=[0,1,2].map(c=>rgbaA[c]*a+rgbaB[c]*b+255*white+(c===1?255*(1-a-b-white):0)),actual=pixel(frames,n,x,y);
      for(let c=0;c<3;c++){maximumError=Math.max(maximumError,Math.abs(actual[c]-expected[c]));near(actual[c],expected[c],12,`${fps}fps n${n} xy${x},${y} sourceX${sx} phase${transition} channel${c}`);}probes++;
    }
    const cut=(types.indexOf('fadeWhite')+1)*duration,layer=visualLayersAt(project,cut).find(l=>l.layer===1);near(layer.whiteOpacity,1,1e-12,'preview model white at cut');
    observations.push({fps,decodedFrames:count,maximumChannelError:maximumError});
  }
  await evidence('transitions-real-output',{scope:'Actual production HTTP save/reopen/render with original RGBA gradients and transparent holes, .6 key opacity/mask over green; independent source coordinate oracle, no transition helper used for expected output',types,probes,skips,observations});
  t.diagnostic(JSON.stringify({probes,skips,observations}));
});

test('v08 compound entry/exit animations multiply real key opacity and sample fractional global frame poses', { timeout: 120000 }, async t => {
  const h=await harness(t),duration=1.137,clips=['zoomFade','rotateFade'].map((type,i)=>h.clip(type,1,.013+i*1.31,duration,{transform:{scale:.5,opacity:.6},animation:{in:.43,out:.37,inType:type,outType:type,easing:'easeOut'}}));
  const project=await h.save({...newProject('复合缩放与旋转渐显隐'),width:W,height:H,media:h.media,clips:[h.clip('base',2,0,3,{layer:0}),...clips]});
  let probes=0,maximumError=0;const observations=[];
  for(const fps of [24,30,60]){const frames=await h.frames(await h.render(project,fps));assert.equal(frames.length/(W*H*3),3*fps);
    for(const clip of clips)for(let n=Math.ceil(clip.start*fps);n<Math.ceil((clip.start+duration)*fps);n++){
      const local=n/fps-clip.start,u=Math.max(0,Math.min(1,local/.43,(duration-local)/.37)),p=1-(1-u)**2;
      const scale=clip.id==='zoomFade'?.5*(.5+.5*p):.5,rotation=clip.id==='rotateFade'?-90*(1-p):0,alpha=.6*p;
      const sampled=pictureTransformAt(clip,n/fps,project);near(sampled.scale,scale,1e-10,'numeric scale');near(sampled.rotation,rotation,1e-10,'numeric angle');near(animationAlphaAt(clip,n/fps),p,1e-10,'numeric compound alpha');
      const angle=rotation*Math.PI/180;
      for(const y of [30,60,90,120,150])for(const x of [30,70,110,150,190,230,270]){
        const dx=x-W/2,dy=y-H/2,sx=(dx*Math.cos(angle)+dy*Math.sin(angle))/scale+W/2,sy=(-dx*Math.sin(angle)+dy*Math.cos(angle))/scale+H/2;
        // Eight output pixels, as in the existing fractional-frame regression,
        // exclude affine/chroma edge ringing by intended geometry alone.
        if(Math.min(Math.abs(sx),Math.abs(sx-W),Math.abs(sy),Math.abs(sy-H),...(sy>H*.4&&sy<H*.6?[Math.abs(sx-W*.4),Math.abs(sx-W*.6)]:[]),...(sx>W*.4&&sx<W*.6?[Math.abs(sy-H*.4),Math.abs(sy-H*.6)]:[]))*scale<=8)continue;
        const inside=sx>=0&&sx<W&&sy>=0&&sy<H,rgba=sourcePixel(1,Math.max(0,Math.min(W-1,Math.round(sx))),Math.max(0,Math.min(H-1,Math.round(sy)))),a=inside?rgba[3]/255*alpha:0;
        const expected=[rgba[0]*a,rgba[1]*a+255*(1-a),rgba[2]*a],actual=pixel(frames,n,x,y);
        for(let c=0;c<3;c++){maximumError=Math.max(maximumError,Math.abs(actual[c]-expected[c]));near(actual[c],expected[c],14,`${fps} ${clip.id} n${n} ${x},${y} c${c}`);}probes++;
      }
    }
    observations.push({fps,decodedFrames:3*fps});
  }
  await evidence('compound-animations-real-output',{scope:'Actual API exports; independent inverse affine geometry and alpha over a green lower layer, non-frame start. Entry and exit easeOut, all output-covered frames, preselected interior pixels; transparent holes retained.',probes,maximumError,observations});t.diagnostic(JSON.stringify({probes,maximumError,observations}));
});

test('v08 picture transitions leave actual exported original audio unchanged', {timeout:120000},async t=>{
  const h=await harness(t),audioMedia=[];
  for(const [index,tone]of[440,880].entries()){
    const source=path.join(h.directory,'tone-'+tone+'.mp4'),image=path.join(h.directory,'tone-'+tone+'.png');await fs.writeFile(image,png(index));
    await exec(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-y','-loop','1','-i',image,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=2`,'-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ac','2',source]);
    audioMedia.push(await h.upload(await fs.readFile(source),path.basename(source)));
  }
  const duration=1.137,clips=Array.from({length:6},(_,i)=>({...h.clip('sound-'+i,0,i*duration,duration),mediaId:audioMedia[i%2].id,volume:.4,layer:0,...(i<5?{transitionOut:{type:types[i],duration:.63,nextClipId:'sound-'+(i+1)}}:{})}));
  const project=await h.save({...newProject('原声不随画面转场改变'),width:W,height:H,media:audioMedia,clips}),baseline=structuredClone(project);baseline.clips.forEach(c=>c.transitionOut={type:'none',duration:0});
  const files=[await h.render(project),await h.render(baseline)],pcm=[];
  for(const file of files)pcm.push((await exec(ffmpegPath,['-hide_banner','-loglevel','error','-i',file,'-vn','-f','f32le','-'],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout);
  assert.equal(pcm[0].length,pcm[1].length);assert.equal(hash(pcm[0]),hash(pcm[1]),'picture-only effects must not change any exported decoded audio sample');
  await evidence('original-audio-preservation',{scope:'Real H264/AAC production exports of the same six audio-bearing clips, with all five new picture transitions vs disabled; complete decoded stereo float PCM byte comparison',sourceTonesHz:[440,880],decodedFloatSamples:pcm[0].length/4,SHA256:hash(pcm[0]),exactEqual:true});
});

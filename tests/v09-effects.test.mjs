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
const types = ['splitOpen', 'splitClose', 'boxOpen'];
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
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Buffer.from(index < 2 ? sourcePixel(index, x, y) : index===2 ? [0, 255, 0, 255] : [...sourcePixel(1,x,y).slice(0,3),255]).copy(raw, y * (W * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function harness(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-v09-effects-')), runtime = await createApp({ dataDir: path.join(directory, 'Library') });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runtime.queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const api = async (url, options, status = 200) => { const response = await fetch(origin + url, options), body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  const upload = async (bytes, name) => { const form = new FormData(); form.append('files', new Blob([bytes]), name); return (await api('/api/media', { method: 'POST', body: form }, 201)).media[0]; };
  const media = await Promise.all([0,1,2,3].map(index => upload(png(index), `original-pattern-${index}.png`)));
  const save = async project => { const saved = (await api('/api/projects', post(project))).project; assert.deepEqual((await api('/api/projects/' + saved.id)).project, saved); return saved; };
  const render = async (project, fps = 30) => {
    let job = await api('/api/exports', post({ project, settings: { width: W, height: H, fps } }), 202);
    for (let n = 0; n < 3000 && !['completed', 'failed'].includes(job.status); n++) { await delay(20); job = await api('/api/exports/' + job.id); }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const filename = path.join(directory, job.id + '.mp4'); await fs.writeFile(filename, Buffer.from(await (await fetch(origin + job.url)).arrayBuffer()));
    if (process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR) {
      await fs.mkdir(process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR, { recursive: true });
      const name = `render-${project.name}-${fps}-${hash(JSON.stringify(project)).slice(0,8)}`;
      await fs.copyFile(filename, path.join(process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR, name + '.mp4'));
      await evidence(name, { project, outputSHA256: hash(await fs.readFile(filename)), settings: { width: W, height: H, fps } });
    }
    return filename;
  };
  const frames = async filename => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filename, '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 })).stdout;
  const clip = (id, index, start, duration, extra = {}) => ({ id, mediaId: media[index].id, track: 'video', layer: 1, start, sourceStart: 0, duration, speed: 1, volume: 0, ...extra });
  return { directory, origin, media, api, upload, save, render, frames, clip };
}
async function evidence(name, value) {
  if (!process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR) return;
  await fs.mkdir(process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.WEIJIAN_V09_EFFECTS_EVIDENCE_DIR, name + '.json'), JSON.stringify(value, null, 2));
}
const pixel = (frames, n, x, y) => [...frames.subarray((n * W * H + y * W + x) * 3, (n * W * H + y * W + x) * 3 + 3)];

// Expected geometry below is written from the effect specification rather than
// reading production samples/expressions back as an oracle.
function incomingAt(type, p, x, y) {
  const rx = Math.abs(2 * (x + .5) / W - 1), ry = Math.abs(2 * (y + .5) / H - 1);
  return type === 'splitOpen' ? rx < p : type === 'splitClose' ? rx >= 1 - p : rx < p && ry < p;
}
function transitionEdgeDistance(type, p, x, y) {
  const size = type === 'splitClose' ? 1 - p : p;
  return Math.min(Math.abs(Math.abs(x + .5 - W / 2) - W * size / 2), ...(type === 'boxOpen' ? [Math.abs(Math.abs(y + .5 - H / 2) - H * size / 2)] : []));
}
function affineEdge(sx, sy, scale, masked = false) {
  return Math.min(Math.abs(sx), Math.abs(sx-W), Math.abs(sy), Math.abs(sy-H),
    ...(masked ? [Math.abs(sx-W*.1),Math.abs(sx-W*.9),Math.abs(sy-H*.1),Math.abs(sy-H*.9)] : []),
    ...(sy>H*.4&&sy<H*.6 ? [Math.abs(sx-W*.4),Math.abs(sx-W*.6)] : []),
    ...(sx>W*.4&&sx<W*.6 ? [Math.abs(sy-H*.4),Math.abs(sy-H*.6)] : [])) * scale;
}

test('v09 catalogs own complementary windows and compound sine/polynomial channels with exact endpoints', () => {
  for(const type of ['dissolve','wipeLeft','wipeRight','fadeBlack','wipeUp','wipeDown','circleOpen','circleClose','pushLeft','pushRight','slideLeft','slideRight','fadeWhite','splitOpen','splitClose','boxOpen']) assert.ok(TRANSITION_TYPES.includes(type));
  for(const type of ['fade','slideLeft','slideRight','zoom','slideUp','slideDown','rotate','pop','zoomFade','rotateFade','spinZoom','swingFade']) assert.ok(ANIMATION_TYPES.includes(type));
  for(const raw of [-1,0,.125,.25,.5,.75,1,2]) {
    const p=Math.max(0,Math.min(1,raw));
    for(const type of types) {
      const value=transitionEffectAt(type,raw),size=type==='splitClose'?1-p:p;
      assert.deepEqual(value.incoming.clipRect,{x:(1-size)/2,y:type==='boxOpen'?(1-size)/2:0,width:size,height:type==='boxOpen'?size:1,outside:type==='splitClose'});
      assert.equal(value.outgoing.clipRect.outside,!value.incoming.clipRect.outside);
      assert.equal(value.incoming.weight,1);assert.equal(value.outgoing.weight,1);assert.equal(value.blackOpacity,0);assert.equal(value.whiteOpacity,0);
      const plan=transitionRenderFilters(type,clock=>`min(1,max(0,${clock}))`);
      assert.equal(plan.outgoingFilter,'null');assert.equal(plan.incomingFilter,'null');assert.ok(plan.combineFilter.includes('shortest=1'));assert.ok(!/geq|split=|scale=|hstack/.test(plan.combineFilter));
      for(const x of [0,80,159,160,239,319])for(const y of [0,45,89,90,134,179])if(p===0||p===1)assert.equal(incomingAt(type,p,x,y),p===1);
    }
    const spin=animationEffectAt('spinZoom',raw,{width:W,height:H}),swing=animationEffectAt('swingFade',raw,{width:W,height:H});
    near(spin.scale,.1+.9*p,1e-12,'spin scale');near(spin.rotation,-180+180*p,1e-12,'spin rotation');near(spin.alpha,p,1e-12,'spin alpha');
    near(swing.rotation,20*Math.sin(6*Math.PI*p)*(1-p),1e-12,'damped swing angle');near(swing.alpha,p,1e-12,'swing alpha');near(swing.scale,1,0,'swing no scaling');
  }
  const sample=transitionEffectAt('boxOpen',.5).outgoing,style=transitionSampleStyle({...sample,translate:{x:.25,y:0}});
  assert.ok(style.clipPath.startsWith('polygon(evenodd,'));assert.equal(style.transform,'translate(25%, 0%)');
  assert.equal(transitionSampleStyle({clipRect:{x:.25,y:.25,width:.5,height:.5}}).clipPath,'inset(25% 25% 25% 25%)');
  assert.deepEqual(animationEffectAt('zoomFade',.5,{width:W,height:H}),{scale:.75,x:0,y:0,rotation:0,alpha:.5});
  assert.throws(()=>transitionEffectAt('not-window',.5),/未知/);assert.throws(()=>animationEffectAt('not-swing',.5,{width:W,height:H}),/未知/);
});

test('v09 actual HTTP exports three window transitions with independent RGBA geometry at fractional cuts24/30/60fps', {timeout:120000}, async t => {
  const h=await harness(t),duration=1.137,window=.63,start=.013,length=start+duration*4;
  const project=await h.save({...newProject('互补双门与矩形窗口'),width:W,height:H,fps:30,media:h.media,clips:[h.clip('base',2,0,length,{layer:0}),
    ...Array.from({length:4},(_,i)=>h.clip('part-'+i,i%2,start+i*duration,duration,{transform:{x:12,y:-4,scale:.8,opacity:.6},mask:{type:'rectangle',width:.8,height:.8},...(i<3?{transitionOut:{type:types[i],duration:window,nextClipId:'part-'+(i+1)}}:{})}))]});
  assert.deepEqual(project.clips.slice(1,4).map(c=>c.transitionOut.type),types);
  const bad=structuredClone(project);bad.clips[1].transitionOut.type='not-window';await h.api('/api/projects',post(bad),400);
  let probes=0,skips=0;const observations=[];
  for(const fps of [24,30,60]) {
    const frames=await h.frames(await h.render(project,fps)),count=Math.ceil(length*fps-1e-8);assert.equal(frames.length/(W*H*3),count);let maximumError=0;
    for(let n=0;n<count;n++)for(const y of [30,60,90,120,150])for(const x of [20,60,100,140,180,220,260,300]) {
      const at=n/fps,phase=types.findIndex((_,i)=>at>=start+(i+1)*duration-window/2&&at<start+(i+1)*duration+window/2);
      let index=at<start?-1:Math.min(3,Math.floor((at-start)/duration));
      if(phase>=0) { const p=(at-(start+(phase+1)*duration-window/2))/window;
        if(transitionEdgeDistance(types[phase],p,x,y)<=4){skips++;continue;}index=phase+Number(incomingAt(types[phase],p,x,y)); }
      const sx=(x-W/2-12)/.8+W/2,sy=(y-H/2+4)/.8+H/2;
      if(affineEdge(sx,sy,.8,true)<=4){skips++;continue;}
      const rgba=sourcePixel(index%2,Math.max(0,Math.min(W-1,Math.round(sx))),Math.max(0,Math.min(H-1,Math.round(sy)))),inside=index>=0&&sx>=W*.1&&sx<W*.9&&sy>=H*.1&&sy<H*.9,a=inside?rgba[3]/255*.6:0;
      const expected=[rgba[0]*a,rgba[1]*a+255*(1-a),rgba[2]*a],actual=pixel(frames,n,x,y);
      for(let c=0;c<3;c++){maximumError=Math.max(maximumError,Math.abs(actual[c]-expected[c]));near(actual[c],expected[c],12,`${fps}fps n${n} xy${x},${y} phase${phase} channel${c}`);}probes++;
    }
    observations.push({fps,decodedFrames:count,maximumChannelError:maximumError});
  }
  await evidence('transitions-real-output',{scope:'Real HTTP save/reopen/export. Independent centered-window pixel membership and inverse affine mapping over green; original gradient RGBA with holes, .6 opacity, rectangular mask, .013 start, .63 fractional windows.',types,probes,skips,observations});t.diagnostic(JSON.stringify({probes,skips,observations}));
});

test('v09 actual compound animations preserve key pose/opacity and non-frame phases at24/30/60fps', {timeout:120000}, async t => {
  const h=await harness(t),duration=1.137,values=(scale,x,rotation,opacity)=>({scale,x,y:0,rotation,opacity});
  const clips=['spinZoom','swingFade'].map((type,i)=>h.clip(type,1,.013+i*1.31,duration,{transformKeys:[{id:'first-'+i,time:0,values:values(.45,-10,-5,.3),easing:'linear'},{id:'last-'+i,time:duration,values:values(.55,10,5,.7),easing:'linear'}],animation:{in:.43,out:.37,inType:type,outType:type,easing:'easeOut'}}));
  const project=await h.save({...newProject('旋转放大与衰减摆动'),width:W,height:H,media:h.media,clips:[h.clip('base',2,0,3,{layer:0}),...clips]});
  const bad=structuredClone(project);bad.clips[1].animation.inType='not-swing';await h.api('/api/projects',post(bad),400);
  let probes=0,skips=0,maximumError=0;const observations=[];
  for(const fps of [24,30,60]) {
    const frames=await h.frames(await h.render(project,fps));assert.equal(frames.length/(W*H*3),3*fps);
    for(const clip of clips)for(let n=Math.ceil(clip.start*fps);n<Math.ceil((clip.start+duration)*fps);n++) {
      const local=n/fps-clip.start,q=local/duration,u=Math.max(0,Math.min(1,local/.43,(duration-local)/.37)),p=1-(1-u)**2;
      const x=-10+20*q,scale=(.45+.1*q)*(clip.id==='spinZoom'?.1+.9*p:1),rotation=-5+10*q+(clip.id==='spinZoom'?-180+180*p:20*Math.sin(6*Math.PI*p)*(1-p)),alpha=(.3+.4*q)*p;
      const sampled=pictureTransformAt(clip,n/fps,project);for(const [key,value]of Object.entries({x,scale,rotation}))near(sampled[key],value,1e-10,'numeric '+key);near(animationAlphaAt(clip,n/fps),p,1e-10,'numeric alpha');
      const angle=rotation*Math.PI/180;
      for(const y of [30,60,90,120,150])for(const px of [30,70,110,150,190,230,270]) {
        const dx=px-W/2-x,dy=y-H/2,sx=(dx*Math.cos(angle)+dy*Math.sin(angle))/scale+W/2,sy=(-dx*Math.sin(angle)+dy*Math.cos(angle))/scale+H/2;
        if(affineEdge(sx,sy,scale)<=8){skips++;continue;}
        const inside=sx>=0&&sx<W&&sy>=0&&sy<H,rgba=sourcePixel(1,Math.max(0,Math.min(W-1,Math.round(sx))),Math.max(0,Math.min(H-1,Math.round(sy)))),a=inside?rgba[3]/255*alpha:0;
        const expected=[rgba[0]*a,rgba[1]*a+255*(1-a),rgba[2]*a],actual=pixel(frames,n,px,y);
        for(let c=0;c<3;c++){maximumError=Math.max(maximumError,Math.abs(actual[c]-expected[c]));near(actual[c],expected[c],14,`${fps} ${clip.id} n${n} ${px},${y} c${c}`);}probes++;
      }
    }
    observations.push({fps,decodedFrames:3*fps});
  }
  await evidence('compound-animations-real-output',{scope:'Production exports vs independent inverse affine geometry/key interpolation/compound alpha. Entry/exit easeOut, original RGBA holes, green lower layer, non-grid .013 clip starts. All covered output frames, preselected interior pixels.',probes,skips,maximumError,observations});t.diagnostic(JSON.stringify({probes,skips,maximumError,observations}));
});

test('v09 new animation transition holds retain project-grid head/tail alpha at mixed output FPS', {timeout:120000}, async t => {
  const h=await harness(t),start=1.613,duration=1.137,end=start+duration,projectFPS=30,window=.6,observations=[];let probes=0,maximumError=0;
  for(const type of ['spinZoom','swingFade']) {
    const moving=h.clip('moving',3,start,duration,{animation:{in:.2,out:.2,inType:type,outType:type,easing:'easeOut'},transitionOut:{type:'dissolve',duration:window,nextClipId:'after'}});
    const project=await h.save({...newProject('首尾动画快照-'+type),width:W,height:H,fps:projectFPS,media:h.media,clips:[h.clip('base',2,0,4,{layer:0}),h.clip('before',3,0,start,{transform:{opacity:0},transitionOut:{type:'dissolve',duration:window,nextClipId:'moving'}}),moving,h.clip('after',3,end,4-end,{transform:{opacity:0}})]});
    for(const fps of [24,30,60]) {
      const frames=await h.frames(await h.render(project,fps));assert.equal(frames.length/(W*H*3),4*fps);let heldProbes=0;
      for(let n=Math.ceil((start-window/2)*fps);n<Math.ceil((end+window/2)*fps);n++) {
        const at=n/fps,sample=at<start?Math.ceil(start*projectFPS-1e-8)/projectFPS:at>=end?(Math.ceil(end*projectFPS-1e-8)-1)/projectFPS:at;
        const local=sample-start,u=Math.max(0,Math.min(1,local/.2,(duration-local)/.2)),p=1-(1-u)**2;
        const weight=at<start+window/2?Math.min(1,(at-(start-window/2))/window):at>=end-window/2?Math.max(0,1-(at-(end-window/2))/window):1;
        // The opaque source has a constant red plane, so this strict center
        // probe isolates held alpha independently of rotating/scaling gradients.
        const expected=210*p*weight,actual=pixel(frames,n,W/2,H/2)[0];maximumError=Math.max(maximumError,Math.abs(actual-expected));near(actual,expected,9,`${type} ${fps} n${n} held center alpha`);probes++;if(at<start||at>=end)heldProbes++;
      }
      observations.push({type,fps,decodedFrames:4*fps,heldProbes,heldFirst:Math.ceil(start*projectFPS)/projectFPS,heldLast:(Math.ceil(end*projectFPS)-1)/projectFPS});
    }
  }
  await evidence('project-edge-holds-real-output',{scope:'Independent project30fps head/tail times, real mixed24/30/60fps export, strict opaque red center alpha. Actual entry and exit pose tests above cover geometry; this isolates source snapshot phase.',probes,maximumError,observations});t.diagnostic(JSON.stringify({probes,maximumError,observations}));
});

test('v09 picture-only windows and compound animations preserve complete original audio PCM', {timeout:120000}, async t=>{
  const h=await harness(t),audioMedia=[];
  for(const [index,tone]of [440,880].entries()) {
    const source=path.join(h.directory,'tone-'+tone+'.mp4'),image=path.join(h.directory,'tone-'+tone+'.png');await fs.writeFile(image,png(index));
    await exec(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-y','-loop','1','-i',image,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=2`,'-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ac','2',source]);audioMedia.push(await h.upload(await fs.readFile(source),path.basename(source)));
  }
  const duration=1.137,clips=Array.from({length:4},(_,i)=>({...h.clip('sound-'+i,0,.013+i*duration,duration),mediaId:audioMedia[i%2].id,sourceStart:.2,volume:.4,layer:0,animation:{in:.2,out:.2,inType:i%2?'swingFade':'spinZoom',outType:i%2?'swingFade':'spinZoom',easing:'easeOut'},...(i<3?{transitionOut:{type:types[i],duration:.63,nextClipId:'sound-'+(i+1)}}:{})}));
  const project=await h.save({...newProject('视觉变化原声不变'),width:W,height:H,media:audioMedia,clips}),baseline=structuredClone(project);baseline.clips.forEach(c=>{c.transitionOut={type:'none',duration:0};c.animation={in:0,out:0};});
  const files=[await h.render(project),await h.render(baseline)],pcm=[];
  for(const file of files)pcm.push((await exec(ffmpegPath,['-hide_banner','-loglevel','error','-i',file,'-vn','-f','f32le','-'],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout);
  assert.equal(pcm[0].length,pcm[1].length);assert.equal(hash(pcm[0]),hash(pcm[1]));
  await evidence('original-audio-preservation',{scope:'Actual production H264/AAC export; same four audio clips with picture-only windows and entry/exit animations vs disabled. Every decoded stereo f32 sample compared, not perceptual/speaker verification.',sourceTonesHz:[440,880],decodedFloatSamples:pcm[0].length/4,SHA256:hash(pcm[0]),exactEqual:true});
});

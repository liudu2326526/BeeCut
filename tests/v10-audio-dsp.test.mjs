import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { newProject } from '../shared/model.mjs';
import { compileAudioPlan, createAudioDSP, AUDIO_DSP_VERSION } from '../shared/audio-dsp.mjs';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/store.mjs';
import { createAudioClockCache, AUDIO_CLOCK_LIMITS } from '../server/audio-clock.mjs';
import { run, ffmpegPath } from '../server/process.mjs';

const RATE=48000,delay=239,exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const media={id:'source',hasAudio:true,type:'audio',duration:30};
const clip=(fields={})=>({id:'sound',mediaId:'source',track:'audio',layer:0,start:0,sourceStart:0,duration:4,speed:1,volume:.5,...fields});
const project=clips=>({...newProject(),width:128,height:128,media:[media],clips});
function inputFor(plan,first,frames,oscillator=(local,ch)=>.08*Math.sin(2*Math.PI*(ch?1600:1000)*local/RATE)) {
  const result={};
  for(const c of plan.clips) {
    const data=new Float32Array(frames*2);
    for(let n=0;n<frames;n++)if(first+n>=c.first&&first+n<c.end)for(let ch=0;ch<2;ch++)data[n*2+ch]=oscillator(first+n-c.first,ch,c);
    result[c.id]=data;
  }
  return result;
}
function render(plan,{first=0,end=plan.outputFrames,block=4096,oscillator,state}={}) {
  const dsp=createAudioDSP(plan,{frame:first,state}),out=new Float32Array((end-first)*2);
  for(let frame=first;frame<end;frame+=block){const n=Math.min(block,end-frame);out.set(dsp.process(inputFor(plan,frame,n,oscillator),n),(frame-first)*2);}
  return {out,dsp};
}
function maximumError(a,b){assert.equal(a.length,b.length);let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));return maximum;}

test('shared DSP is bit-identical across128/257/4096 blocks, includes239-sample low-level delay, and bounds explicit high-amplitude limiter',()=>{
  const p=project([clip({duration:2,pan:.5,audioEffects:{highpass:{enabled:true,frequency:80},lowpass:{enabled:true,frequency:12000},echo:{enabled:true,delay:.2,decay:.4}},audioGainKeys:[{id:'a',time:0,gain:.5,easing:'easeOut',phase:[1-1e-8,1]},{id:'b',time:2,gain:1.5,easing:'linear',phase:[0,1]}]})]),plan=compileAudioPlan(p);
  assert.equal(plan.version,AUDIO_DSP_VERSION);
  const full=render(plan),workletSized=render(plan,{block:128}),odd=render(plan,{block:257});
  assert.deepEqual(workletSized.out,full.out);assert.deepEqual(odd.out,full.out);
  const low=compileAudioPlan(project([clip({duration:.1,volume:1})])),dc=render(low,{oscillator:()=>.04}).out;
  for(let n=0;n<delay;n++)assert.equal(dc[n*2],0);
  assert.ok(Math.abs(dc[delay*2]-.04/.95)<1e-7);
  const loud=compileAudioPlan(project([clip({duration:1,volume:2,audioGainKeys:[{id:'g',time:0,gain:2}]})]));
  const a=render(loud,{oscillator:n=>n%1100<550?1:-1}),b=render(loud,{block:128,oscillator:n=>n%1100<550?1:-1});
  assert.deepEqual(a.out,b.out);
  for(const sample of a.out)assert.ok(Number.isFinite(sample)&&Math.abs(sample)<=1);
  assert.ok(a.out.some(x=>Math.abs(x)>.99));
});

test('shared state checkpoints and2s warm seek preserve20Hz filters,1s echo, gain phases and linked limiter within8e-5',()=>{
  const p=project([clip({duration:16,volume:.6,pan:-.25,audioEffects:{highpass:{enabled:true,frequency:20},lowpass:{enabled:true,frequency:20},echo:{enabled:true,delay:1,decay:.8}},audioGainKeys:[{id:'a',time:0,gain:.25,easing:'easeIn',phase:[0,1e-200]},{id:'b',time:16,gain:1.7,easing:'linear',phase:[0,1]}]})]);
  const plan=compileAudioPlan(p),oscillator=(n,ch)=>.2*Math.sin(2*Math.PI*(ch?19:21)*n/RATE)+.05*Math.sin(2*Math.PI*1000*n/RATE);
  const full=render(plan,{oscillator}).out;
  for(const seconds of [2.5,7.133,14.125]) {
    const target=Math.round(seconds*RATE),start=target-2*RATE,warm=render(plan,{first:start,end:target,oscillator}),resumed=render(plan,{first:target,end:target+12000,state:warm.dsp.snapshot(),block:128,oscillator});
    assert.ok(maximumError(resumed.out,full.subarray(target*2,(target+12000)*2))<=.00008);
    const clone=structuredClone(warm.dsp.snapshot()),checkpoint=createAudioDSP(plan,{state:clone});
    assert.equal(checkpoint.frame,target);
    assert.deepEqual(checkpoint.process(inputFor(plan,target,128,oscillator),128),resumed.out.subarray(0,256));
  }
});

test('hot gain/key deletion and replacement reset interval lookup while preserving filter/echo state; DSPchanges require warm state',()=>{
  const base=clip({duration:5,audioEffects:{echo:{enabled:true,delay:.2,decay:.4}},audioGainKeys:[{id:'a',time:0,gain:.5,easing:'linear'},{id:'b',time:1,gain:1},{id:'c',time:2,gain:.6},{id:'d',time:4,gain:1.5}]}),plan=compileAudioPlan(project([base]));
  const before=render(plan,{end:3*RATE}),saved=before.dsp.snapshot();
  const changed=compileAudioPlan(project([{...base,pan:.5,audioGainKeys:[]}]));
  before.dsp.updatePlan(changed);const out=before.dsp.process(inputFor(changed,3*RATE,4096),4096);
  assert.ok(out.every(Number.isFinite));
  // A fresh current-parameter run includes the same echo history; only the
  // first limiter delay window still contains actual pre-edit gain history.
  const current=render(changed,{end:3*RATE+4096}).out.subarray(3*RATE*2);
  assert.ok(maximumError(out.subarray(delay*2),current.subarray(delay*2))<1e-7);
  const replacement=compileAudioPlan(project([{...base,audioGainKeys:[{id:'x',time:0,gain:.2},{id:'y',time:5,gain:1.8,easing:'linear'}]}]));
  before.dsp.updatePlan(replacement);assert.ok(before.dsp.process(inputFor(replacement,before.dsp.frame,128),128).every(Number.isFinite));
  const effect=compileAudioPlan(project([{...base,audioEffects:{highpass:{enabled:true,frequency:120}}}]));
  assert.throws(()=>before.dsp.updatePlan(effect),/需要准备/);
  assert.throws(()=>createAudioDSP(effect,{state:saved}),/不匹配/);
});

function wave(seconds=4,hz=1000) {
  const samples=Math.round(seconds*RATE),data=Buffer.alloc(44+samples*4);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);data.writeUInt32LE(RATE,24);data.writeUInt32LE(RATE*4,28);data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*4,40);
  for(let n=0;n<samples;n++)for(let ch=0;ch<2;ch++)data.writeInt16LE(Math.round(.06*Math.sin(2*Math.PI*(ch?1600:hz)*n/RATE)*32767),44+(n*2+ch)*2);
  return data;
}
async function apiFixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v10-api-')),runtime=await createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.queue.close();await new Promise(r=>{server.close(r);server.closeAllConnections?.();});await fs.rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`,post=async(route,body)=>{const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const form=new FormData();form.append('files',new Blob([wave()]),'tone.wav');const imported=await fetch(origin+'/api/media',{method:'POST',body:form});assert.equal(imported.status,201);const m=(await imported.json()).media[0];
  const p={...project([clip({mediaId:m.id,start:.137019,duration:3.5})]),media:[m]};
  const terminal=async(id,clock=true)=>{for(let n=0;n<3000;n++){const job=await(await fetch(origin+(clock?'/api/audio-clock-prepares/':'/api/exports/')+id)).json();if(['completed','failed','cancelled'].includes(job.status))return job;await pause(5);}throw Error('job timeout');};
  const prepare=async(p)=>{const response=await post('/api/audio-clock-prepares',{project:p});assert.equal(response.status,202);const job=await terminal(response.body.id);assert.equal(job.status,'completed',JSON.stringify(job));return job;};
  return {dir,runtime,origin,post,p,m,terminal,prepare};
}

test('real prepare/range API shares source clock with WAV/MP4, preserves DSP-only cache identity, and rejects unleased or unsafe ranges',async t=>{
  const h=await apiFixture(t),job=await h.prepare(h.p),asset=job.assets[0];
  assert.equal(asset.frames,Math.round(3.5*RATE));assert.equal(asset.format,'f32le');assert.equal(Object.hasOwn(asset,'filename'),false);
  const pcm=new Float32Array(asset.frames*2);
  for(let first=0;first<asset.frames;first+=16384){const response=await fetch(h.origin+asset.url+`?first=${first}&frames=16384&lease=${job.id}`);assert.equal(response.status,200);const part=new Float32Array(await response.arrayBuffer());pcm.set(part,first*2);assert.equal(Number(response.headers.get('X-PCM-Frames')),part.length/2);}
  for(const suffix of [`?first=0&frames=16385&lease=${job.id}`,`?first=-1&frames=1&lease=${job.id}`,`?first=0&frames=1&lease=missing`])assert.ok((await fetch(h.origin+asset.url+suffix)).status>=400);
  const eof=await fetch(h.origin+asset.url+`?first=${asset.frames}&frames=1&lease=${job.id}`);assert.equal(eof.status,200);assert.equal((await eof.arrayBuffer()).byteLength,0);
  const changed={...h.p,clips:[{...h.p.clips[0],pan:.5,volume:.25,audioEffects:{highpass:{enabled:true,frequency:80},lowpass:{enabled:true,frequency:12000},echo:{enabled:true,delay:.2,decay:.4}},audioGainKeys:[{id:'a',time:0,gain:.5,easing:'easeOut'},{id:'b',time:3.5,gain:1.5}]}]};
  const other=await h.prepare(changed);assert.equal(other.assets[0].key,asset.key,'DSP-only edits do not regenerate source PCM');
  const plan=compileAudioPlan(changed),dsp=createAudioDSP(plan),expected=new Float32Array(plan.outputFrames*2);
  for(let frame=0;frame<plan.outputFrames;frame+=128){const frames=Math.min(128,plan.outputFrames-frame),input=new Float32Array(frames*2),c=plan.clips[0];for(let n=0;n<frames;n++)if(frame+n>=c.first&&frame+n<c.end){input[n*2]=pcm[(frame+n-c.first)*2];input[n*2+1]=pcm[(frame+n-c.first)*2+1];}expected.set(dsp.process({sound:input},frames),frame*2);}
  const waveJob=await h.post('/api/audio-previews',{project:changed});assert.equal(waveJob.status,202);const done=await h.terminal(waveJob.body.id,false);assert.equal(done.status,'completed',done.error);
  const file=path.join(h.runtime.store.dirs.exports,done.id+'.wav'),{stdout}=await exec(ffmpegPath,['-v','error','-i',file,'-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:8*1024*1024});
  const actual=new Float32Array(stdout.buffer,stdout.byteOffset,stdout.length/4);assert.ok(maximumError(actual,expected)<.00008);
  const videoJob=await h.post('/api/exports',{project:changed,settings:{width:128,height:128,fps:30,quality:'high'}});assert.equal(videoJob.status,202);
  const movie=await h.terminal(videoJob.body.id,false);assert.equal(movie.status,'completed',movie.error);
  const decoded=await exec(ffmpegPath,['-v','error','-i',path.join(h.runtime.store.dirs.exports,movie.id+'.mp4'),'-vn','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:8*1024*1024});
  const aac=new Float32Array(decoded.stdout.buffer,decoded.stdout.byteOffset,decoded.stdout.length/4);
  const amp=(data,hz,at,ch)=>{let re=0,im=0;for(let n=0;n<4800;n++){const x=data[(Math.round((at-.05)*RATE)+n)*2+ch],u=2*Math.PI*hz*n/RATE;re+=x*Math.cos(u);im+=x*Math.sin(u);}return Math.hypot(re,im)/2400;};
  for(const at of [.75,1.5,2.5,3.25])for(const [ch,hz]of [[0,1000],[1,1600]])assert.ok(Math.abs(amp(aac,hz,at,ch)/amp(expected,hz,at,ch)-1)<.05);
  const shifted={...h.p,clips:[{...h.p.clips[0],sourceStart:.25,duration:3.25}]},shift=await h.prepare(shifted);assert.notEqual(shift.assets[0].key,asset.key);
  await fetch(h.origin+'/api/audio-clock-prepares/'+job.id,{method:'DELETE'});assert.equal((await fetch(h.origin+asset.url+`?first=0&frames=1&lease=${job.id}`)).status,410);
  const bad=await h.post('/api/audio-clock-prepares',{project:h.p,clipIds:['missing']});assert.equal(bad.status,400);
  await h.runtime.queue.close();assert.deepEqual(await fs.readdir(h.runtime.store.dirs.work),[]);
});

test('cache crash orphans count as owned cleanup, retain failed cleanup for retry, and active publication survives concurrent pruning',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v10-orphans-')),store=await createStore(dir),cache=createAudioClockCache(store),originalRm=fs.rm,originalRename=fs.rename;
  t.after(async()=>{fs.rm=originalRm;fs.rename=originalRename;await cache.close();await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(cache.directory);const orphan=path.join(cache.directory,'a'.repeat(64)+'.pcm'),json=path.join(cache.directory,'b'.repeat(64)+'.json'),temporary=path.join(cache.directory,'c'.repeat(64)+'.json.11111111-2222-3333-4444-555555555555.tmp');
  const h=await fs.open(orphan,'w');await h.truncate(AUDIO_CLOCK_LIMITS.unleasedBytes+8);await h.close();await fs.writeFile(json,'{}');await fs.writeFile(temporary,'owned incomplete metadata');await fs.writeFile(path.join(cache.directory,'foreign-note.txt'),'preserve');
  let deny=true;fs.rm=async(file,...args)=>{if(deny&&file===orphan)throw Object.assign(new Error('controlled cleanup EACCES'),{code:'EACCES'});return originalRm(file,...args);};
  await assert.rejects(cache.close(),/EACCES/);deny=false;await cache.close();fs.rm=originalRm;
  assert.deepEqual(await fs.readdir(cache.directory),['foreign-note.txt']);
  // A new live cache owns its in-progress key until BOTH file renames finish.
  const live=createAudioClockCache(store);await fs.writeFile(path.join(store.dirs.media,'tone.wav'),wave());await store.addMedia([{...media,filename:'tone.wav'}]);
  const work=path.join(store.dirs.work,'publish');await fs.mkdir(work);
  const controls={runProcess:(args,{binary=ffmpegPath,...options}={})=>run(binary,args,options)};
  let release,entered;const held=new Promise(r=>release=r),atRename=new Promise(r=>entered=r);let firstKey;
  fs.rename=async(from,to)=>{if(!firstKey&&String(to).startsWith(live.directory)&&String(to).endsWith('.json')){firstKey=path.basename(to,'.json');entered();await held;}return originalRename(from,to);};
  const pending=live.prepare(project([clip({duration:2})]),null,work,controls,'first');
  try {
    await atRename;
    await live.prepare(project([clip({sourceStart:.1,duration:2})]),null,work,controls,'second');
    assert.ok((await fs.stat(path.join(live.directory,firstKey+'.pcm'))).size>0,'active PCM without manifest is protected');
  } finally {release();await pending;fs.rename=originalRename;await live.close();}
});

test('cache validates source and PCM bytes, expires leases, and can regenerate corruption without source/DSP ambiguity',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v10-cache-')),store=await createStore(dir),file=path.join(store.dirs.media,'tone.wav');let clock=0;
  const cache=createAudioClockCache(store,{now:()=>clock});t.after(async()=>{await cache.close();await fs.rm(dir,{recursive:true,force:true});});
  await fs.writeFile(file,wave());await store.addMedia([{...media,filename:'tone.wav'}]);
  const work=path.join(store.dirs.work,'direct');await fs.mkdir(work);
  const controls={runProcess:(args,{binary=ffmpegPath,...options}={})=>run(binary,args,options)};
  const p=project([clip({duration:2})]),first=(await cache.prepare(p,null,work,controls,'first'))[0];
  assert.equal((await cache.range(first.key,0,128,'first')).frames,128);
  await fs.writeFile(first.filename,Buffer.alloc(first.frames*8));
  await assert.rejects(cache.range(first.key,0,128,'first'),/损坏/);
  const regenerated=(await cache.prepare(p,null,work,controls,'next'))[0];assert.equal(regenerated.key,first.key);assert.ok((await cache.range(first.key,100,128,'next')).buffer.some(x=>x!==0));
  await fs.writeFile(file,wave(4,1200));const changed=(await cache.prepare(p,null,work,controls,'third'))[0];assert.notEqual(changed.key,first.key);
  clock=AUDIO_CLOCK_LIMITS.leaseMilliseconds+1;await assert.rejects(cache.range(changed.key,0,1,'third'),/过期/);
});

test('offline mix retains failed file-handle cleanup until close retry',async t=>{
  const h=await apiFixture(t),originalOpen=fs.open;let deny=true,closed=0;
  fs.open=async(...args)=>{
    const file=await originalOpen(...args);
    if(String(args[0]).startsWith(h.runtime.store.dirs.work)&&path.basename(String(args[0]))==='audio-mix.wav'&&args[1]==='w')return{
      write:(...values)=>file.write(...values),close:async()=>{if(deny)throw new Error('controlled handle close EACCES');await file.close();closed++;},
    };
    return file;
  };
  try{
    const response=await h.post('/api/audio-previews',{project:h.p}),job=await h.terminal(response.body.id,false);
    assert.equal(job.status,'failed');assert.match(job.error,/句柄清理失败/);
    await assert.rejects(h.runtime.queue.close(),/handle close EACCES/);
    deny=false;await h.runtime.queue.close();assert.equal(closed,1);assert.deepEqual(await fs.readdir(h.runtime.store.dirs.work),[]);
  }finally{deny=false;fs.open=originalOpen;}
});

test('releasing completed source leases promptly enforces the unleased disk budget',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v10-release-')),store=await createStore(dir),cache=createAudioClockCache(store);
  t.after(async()=>{await cache.close();await fs.rm(dir,{recursive:true,force:true});});await fs.mkdir(cache.directory);
  const lease=cache.startLease('source-session');
  for(const digit of ['d','e']) {
    const key=digit.repeat(64);lease.keys.add(key);const file=await fs.open(path.join(cache.directory,key+'.pcm'),'w');await file.truncate(345600000);await file.close();await fs.writeFile(path.join(cache.directory,key+'.json'),'{}');
  }
  await cache.release('source-session');
  const pcm=(await fs.readdir(cache.directory)).filter(f=>f.endsWith('.pcm'));let bytes=0;for(const name of pcm)bytes+=(await fs.stat(path.join(cache.directory,name))).size;
  assert.ok(bytes<=AUDIO_CLOCK_LIMITS.unleasedBytes);assert.equal(pcm.length,1);
});

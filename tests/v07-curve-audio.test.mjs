import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {unlinkSync}from'node:fs';import{execFile}from'node:child_process';import{promisify}from'node:util';import path from'node:path';import os from'node:os';import {createStore}from'../server/store.mjs';import{createExportQueue}from'../server/render.mjs';import{ffmpegPath}from'../server/process.mjs';import{validateProject}from'../server/validate.mjs';import{newProject,changeClipTiming,sourceTimeAt,sourceTimesAt,curveAudioPlan}from'../shared/model.mjs';
import {curveAudioTimeMapBatch} from '../shared/speed-curve.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let sourcePromise;
async function sourceFixture(){
 return sourcePromise??= (async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v07-source-')),file=path.join(dir,'source.mp4');await promisify(execFile)(ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=red:s=128x128:r=2:d=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=60','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k',file]);return file})();
}
after(async()=>{if(sourcePromise)await fs.rm(path.dirname(await sourcePromise),{recursive:true,force:true})});
async function fixture(t,{seconds=60,...hooks}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v07-')),store=await createStore(dir),filename='source.mp4';
 await fs.copyFile(await sourceFixture(),path.join(store.dirs.media,filename));
 const media={id:'source',name:filename,filename,type:'video',duration:60,width:128,height:128,hasAudio:true,url:'/media/source.mp4',thumbnailUrl:'',size:(await fs.stat(path.join(store.dirs.media,filename))).size};await store.addMedia([media]);
 const clip=changeClipTiming({id:'clip',mediaId:media.id,track:'video',start:0,sourceStart:0,duration:seconds,speed:1,volume:1},{speedCurve:{sourceDuration:seconds,points:[{id:'a',position:0,speed:.5},{id:'b',position:1,speed:2}]}},media);
 const project=validateProject({...newProject('bounded audio'),width:128,height:128,media:[media],clips:[clip]},store),queue=createExportQueue(store,hooks);
 t.after(async()=>{await queue.close();await fs.rm(dir,{recursive:true,force:true})});return{dir,store,queue,project};
}
async function terminal(queue,id){for(let i=0;i<3000;i++){const job=queue.get(id);if(['completed','failed','cancelled'].includes(job.status))return job;await pause(10)}throw Error('terminal timeout')}
async function empty(store){assert.deepEqual(await fs.readdir(store.dirs.work),[]);assert.deepEqual((await fs.readdir(store.dirs.exports)).filter(f=>f.includes('partial')),[])}
const settings={width:128,height:128,fps:5,quality:'high'};

test('sample maps are range-batched and source batch sampling preserves freshness and clamped mapping',()=>{
 const clip=changeClipTiming({id:'a',start:2,sourceStart:1,duration:4,speed:1},{speedCurve:{sourceDuration:600,points:[{id:'a',position:0,speed:.5},{id:'b',position:1,speed:2}]}},{duration:1000});
 const plan=curveAudioPlan(clip.speedCurve);assert.ok(plan.mapCount>512);let count=0,previous;
 for(let first=0;first<plan.mapCount;first+=4096){const batch=curveAudioTimeMapBatch(clip.speedCurve,first);assert.ok(batch.length<=4096);for(const b of batch){if(previous){assert.ok(b.sourceFrame>previous.sourceFrame);assert.ok(b.outputFrame>previous.outputFrame)}previous=b;count++}}
 assert.equal(count,plan.mapCount);assert.ok(previous.sourceFrame<plan.sourceSamples);assert.ok(previous.outputFrame<plan.samples);assert.throws(()=>curveAudioTimeMapBatch(clip.speedCurve,0,4097),/范围无效/);
 const times=Array.from({length:2049},(_,i)=>clip.start-1+(clip.duration+2)*i/2048);const sampled=sourceTimesAt(clip,times);for(let i=0;i<times.length;i++)assert.equal(sampled[i],sourceTimeAt(clip,times[i]));
 const before=sourceTimesAt(clip,[20])[0];clip.speedCurve.points[0].speed=.8;const after=sourceTimesAt(clip,[20])[0];assert.notEqual(before,after);assert.equal(after,sourceTimeAt(clip,20));
});

test('public audio plans reject unsafe or out-of-project domains before deriving sample ranges',()=>{
 const curve={sourceDuration:60,points:[{position:0,speed:.5},{position:1,speed:2}]};
 for(const sourceDuration of[NaN,Infinity,Number.MAX_VALUE,0,-1,3600.01])assert.throws(()=>curveAudioPlan({...curve,sourceDuration}),/源区间无效/);
 assert.throws(()=>curveAudioPlan({...curve,sourceDuration:3600}),/最长支持900秒/);
 assert.throws(()=>curveAudioPlan({...curve,points:Array.from({length:129},(_,i)=>({position:i/128,speed:1}))}),/源区间无效/);
 assert.throws(()=>curveAudioTimeMapBatch(curve,Number.MAX_SAFE_INTEGER+1),/范围无效/);
 assert.equal(curveAudioPlan({sourceDuration:3600,points:[{position:0,speed:4},{position:1,speed:4}]}).mapCount,0);
 // Independent dense source-domain integration gives this 900s boundary.
 const boundary={...curve,sourceDuration:905.9164843192043};
 const plan=curveAudioPlan(boundary);assert.equal(plan.samples,43200000);assert.equal(plan.mapCount,45295);
 const last=curveAudioTimeMapBatch(boundary,45056);assert.equal(last.length,239);assert.ok(last.at(-1).outputFrame<43200000);
});

test('a voiced curve beyond the former 512-block limit completes through one continuous stretcher and retains the source tail',{timeout:120000},async t=>{
 const h=await fixture(t),job=h.queue.enqueue(h.project,{...settings,fps:2});let previous=0;
 while(!['completed','failed','cancelled'].includes(h.queue.get(job.id).status)){
  const progress=h.queue.get(job.id).progress;assert.ok(progress>=previous);previous=progress;await pause(10);
 }
 const done=h.queue.get(job.id);assert.equal(done.status,'completed',done.error);assert.equal(done.progress,100);assert.ok(curveAudioPlan(h.project.clips[0].speedCurve).mapCount>512);
 const duration=h.project.clips[0].duration,file=path.join(h.store.dirs.exports,job.id+'.mp4');
 const {stdout:raw}=await promisify(execFile)(ffmpegPath,['-v','error','-ss',String(duration-.21),'-i',file,'-t','0.2','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
 const pcm=Array.from({length:raw.length/4},(_,i)=>raw.readFloatLE(i*4));assert.ok(pcm.length>=9500);const rms=Math.sqrt(pcm.reduce((sum,n)=>sum+n*n,0)/pcm.length);assert.ok(rms>.03,'actual voiced source tail survives, not only padded duration');
 let best={hz:0,power:0};for(let hz=420;hz<=460;hz++){let re=0,im=0;for(let i=0;i<pcm.length;i++){const sample=pcm[i]*(.5-.5*Math.cos(2*Math.PI*i/(pcm.length-1))),phase=2*Math.PI*hz*i/48000;re+=sample*Math.cos(phase);im+=sample*Math.sin(phase)}const power=re*re+im*im;if(power>best.power)best={hz,power}}
 assert.ok(Math.abs(best.hz-440)<=440*.02,JSON.stringify(best));t.diagnostic(JSON.stringify({duration,mapFrames:curveAudioPlan(h.project.clips[0].speedCurve).mapCount,tailRms:rms,tailPeakHz:best.hz}));await h.queue.close();await empty(h.store);
});

test('active decode, stretch, append and final mux cancellation wait for owned children and remove all intermediates',{timeout:120000},async t=>{
 for(const target of['curve-decode','curve-stretch','curve-append','video-mux'])await t.test(target,async t=>{
  let fixtureValue,resolveReached;const reached=new Promise(r=>resolveReached=r);let cancelled=false,closedChildren=0,spawned=0;
  const h=await fixture(t,{onStage(stage,id){if(stage===target&&target==='curve-append'&&!cancelled){cancelled=true;fixtureValue.queue.cancel(id);resolveReached()}},onChild(child,stage,id){spawned++;child.once('close',()=>closedChildren++);if(stage===target&&!cancelled){cancelled=true;setTimeout(()=>{fixtureValue.queue.cancel(id);resolveReached()},10)}}});fixtureValue=h;
  const job=h.queue.enqueue(h.project,settings);await reached;await h.queue.close();assert.equal(h.queue.get(job.id).status,'cancelled');assert.equal(closedChildren,spawned,'close awaits every started child');await empty(h.store);assert.deepEqual(await fs.readdir(h.store.dirs.exports),[]);
 });
});

test('real decoder failure and lost intermediate failure clean their partial PCM/WAV and allow next jobs',{timeout:120000},async t=>{
 for(const kind of['decoder','stretch-input'])await t.test(kind,async t=>{
  let h,damaged=false;h=await fixture(t,{onStage(stage,id){if(kind==='stretch-input'&&stage==='curve-stretch'&&!damaged){damaged=true;unlinkSync(path.join(h.store.dirs.work,id,'curve-audio-0.source.f32le'))}}});
  if(kind==='decoder')await fs.writeFile(path.join(h.store.dirs.media,'source.mp4'),'not a media file');
  const job=h.queue.enqueue(h.project,settings);const done=await terminal(h.queue,job.id);assert.equal(done.status,'failed');assert.match(done.error,/视频处理失败|素材探测/);await h.queue.close();await empty(h.store);assert.deepEqual(await fs.readdir(h.store.dirs.exports),[]);
 });
});

test('disk capacity rejection and injected ENOSPC during PCM append leave no files or leaked handles',{timeout:120000},async t=>{
 for(const kind of['capacity','append'])await t.test(kind,async t=>{
  const h=await fixture(t,{seconds:4}),originalOpen=fs.open,originalStatfs=fs.statfs;let injected=false;
  if(kind==='capacity')fs.statfs=async filename=>String(filename).startsWith(h.store.dirs.work)?{bavail:0,bsize:4096}:originalStatfs(filename);
  else fs.open=async(...args)=>{const handle=await originalOpen(...args);if(String(args[0]).startsWith(h.store.dirs.work)&&String(args[0]).endsWith('.wav')){let bytes=0;return{close:()=>handle.close(),write:async(...writeArgs)=>{const result=await handle.write(...writeArgs);bytes+=result.bytesWritten;if(bytes>44&&!injected){injected=true;throw Object.assign(new Error('controlled ENOSPC'),{code:'ENOSPC'})}return result}}}return handle};
  try{const job=h.queue.enqueue(h.project,settings);const done=await terminal(h.queue,job.id);assert.equal(done.status,'failed');assert.match(done.error,kind==='capacity'?/磁盘空间不足/:/ENOSPC/);await h.queue.close();await empty(h.store);if(kind==='append')assert.equal(injected,true)}finally{fs.open=originalOpen;fs.statfs=originalStatfs}
 });
});

test('close waits through final cleanup and failed cleanup retains ownership for explicit close retry',{timeout:120000},async t=>{
 await t.test('late close during cleanup',async t=>{
  let release,enter;const held=new Promise(r=>release=r),entered=new Promise(r=>enter=r);let h;
  h=await fixture(t,{seconds:4,removeWork:async(filename,options)=>{if(path.dirname(filename)===h.store.dirs.work){enter();await held}return fs.rm(filename,options)}});
  const job=h.queue.enqueue(h.project,settings);await entered;let closed=false;const close=h.queue.close().then(()=>closed=true);assert.equal(h.queue.cancel(job.id).status,'completed');await pause(30);assert.equal(closed,false);release();await close;await empty(h.store);assert.ok((await fs.stat(path.join(h.store.dirs.exports,job.id+'.mp4'))).size>0);
 });
 await t.test('retained cleanup failure',async t=>{
  let fail=true,h;h=await fixture(t,{seconds:4,removeWork:async(filename,options)=>{if(fail&&path.dirname(filename)===h.store.dirs.work)throw Object.assign(new Error('controlled cleanup EACCES'),{code:'EACCES'});return fs.rm(filename,options)}});
  const job=h.queue.enqueue(h.project,settings);assert.equal((await terminal(h.queue,job.id)).status,'completed');await pause(20);assert.match(h.queue.get(job.id).cleanupError,/EACCES/);await assert.rejects(h.queue.close(),/EACCES/);assert.ok((await fs.readdir(h.store.dirs.work)).includes(job.id));fail=false;await h.queue.close();assert.equal(h.queue.get(job.id).cleanupError,undefined);await empty(h.store);
 });
});

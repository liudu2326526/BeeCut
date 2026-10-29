import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, HttpError } from './store.mjs';
import { ffmpegPath, inputSafetyArgs } from './process.mjs';
import { renderCurveAudio, sourceAudioHelperPath } from './curve-audio.mjs';
import { clipTiming, clipSpeedCurve } from '../shared/model.mjs';
import { clipAudioSampleRange } from '../shared/audio.mjs';
import { AUDIO_DSP_RATE } from '../shared/audio-dsp.mjs';

export const AUDIO_CLOCK_VERSION = 'source-clock-pcm-f32-stereo-48k-1';
export const AUDIO_CLOCK_LIMITS = Object.freeze({ rangeFrames: 16384, unleasedBytes: 512*1024*1024,
  unleasedFiles: 128, leaseMilliseconds: 10*60*1000, leases: 4 });
const bytesPerFrame = 8, keyPattern = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const signature = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const decimal = n => { if (!Number.isFinite(n)) throw new RangeError('音频源时钟无效'); return n.toFixed(12).replace(/\.?0+$/,'') || '0'; };
// This producer owns identity stretch as well as nonidentity atempo. Reusing
// it for preview/export avoids the old atempo=1 tail flush defect.
export function audioTempoFilter(speed) {
  if (speed === 1) return 'anull';
  const parts = [];
  while (speed > 2) { parts.push('atempo=2'); speed /= 2; }
  while (speed < .5) { parts.push('atempo=0.5'); speed /= .5; }
  return [...parts, `atempo=${decimal(speed)}`].join(',');
}
async function hashFile(filename, controls = {}) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) { controls.checkCancelled?.(); hash.update(bytes); }
  return hash.digest('hex');
}
async function plainFile(filename) {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new HttpError(400,'音频缓存或源必须是本地普通文件');
  return stat;
}
async function appendBytes(source, target, sourceOffset, length, controls) {
  const input = await fs.open(source,'r');let output;
  try {
    output=await fs.open(target,'w');
    const buffer = Buffer.alloc(64*1024); let read = 0;
    while (read < length) {
      controls.checkCancelled?.();
      const {bytesRead} = await input.read(buffer,0,Math.min(buffer.length,length-read),sourceOffset+read);
      if (!bytesRead) break;
      let written=0;
      while(written<bytesRead){const result=await output.write(buffer,written,bytesRead-written,read+written);if(!result.bytesWritten)throw new Error('源时钟 PCM 写入中断');written+=result.bytesWritten;}
      read += bytesRead;
    }
    // At most one quantized sample of curve rounding differs from the global
    // clip grid. Preserve the old explicit apad tail rule, not a new stretch.
    const zero = Buffer.alloc(64*1024);
    while (read < length) { controls.checkCancelled?.(); const n=Math.min(zero.length,length-read),result=await output.write(zero,0,n,read);if(!result.bytesWritten)throw new Error('源时钟 PCM 写入中断');read+=result.bytesWritten; }
  } finally {
    const owned=[input,...(output?[output]:[])],results=await Promise.allSettled(owned.map(h=>h.close())),failed=owned.filter((_,i)=>results[i].status==='rejected');
    if(failed.length){const error=new Error('源时钟 PCM 文件句柄清理失败');error.cleanupHandles=failed;throw error;}
  }
}

export function createAudioClockCache(store, { audioHelperPath = sourceAudioHelperPath, now = Date.now } = {}) {
  const directory = path.join(store.root,'audio-clock-cache'), sources = new Map(), verified = new Map(), leases = new Map(), cleanup = new Set(), publishing = new Set(), openHandles = new Set();
  let decoderIdentity, helperIdentity, closed = false, maintenance, pruneTask;
  const files = key => ({ pcm:path.join(directory,key+'.pcm'), manifest:path.join(directory,key+'.json') });
  function expire() {let changed=false;for (const [id,lease] of leases) if (lease.until < now()){leases.delete(id);changed=true;}return changed;}
  function requestPrune() {
    const task=(pruneTask??Promise.resolve()).catch(()=>{}).then(prune);pruneTask=task;
    // A failed deletion remains in cleanup. This handler prevents an ignored
    // HTTP DELETE/maintenance promise from becoming an unhandled rejection;
    // close retries the same owned cleanup and still reports persistent errors.
    task.then(()=>{if(pruneTask===task)pruneTask=null;},()=>{if(pruneTask===task)pruneTask=null;});
    return task;
  }
  function startLease(id) {
    if (closed) throw new HttpError(503,'音频服务正在关闭');
    if(expire())requestPrune();
    if(!maintenance){maintenance=setInterval(()=>{if(expire())requestPrune();},60000);maintenance.unref();}
    if (!leases.has(id)) {
      if (leases.size >= AUDIO_CLOCK_LIMITS.leases) throw new HttpError(429,'实时音频准备会话过多，请释放旧预览后重试');
      leases.set(id,{keys:new Set(),until:now()+AUDIO_CLOCK_LIMITS.leaseMilliseconds});
    }
    return leases.get(id);
  }
  const pinned = key => { expire(); return [...leases.values()].some(l=>l.keys.has(key)); };
  async function remove(filename) {
    cleanup.add(filename);
    await fs.rm(filename,{force:true}); cleanup.delete(filename);
  }
  async function identity(needsHelper) {
    decoderIdentity ??= hashFile(ffmpegPath).catch(error=>{decoderIdentity=null;throw error;});
    if(needsHelper)helperIdentity ??= hashFile(audioHelperPath).catch(error=>{helperIdentity=null;throw error;});
    return { decoder: await decoderIdentity, helper: needsHelper ? await helperIdentity : null };
  }
  async function sourceIdentity(media, controls) {
    const filename=store.mediaPath(media), stat=await plainFile(filename), sig=signature(stat), cached=sources.get(media.id);
    if (cached?.signature === sig) return {...cached,filename};
    const sha256=await hashFile(filename,controls);
    if (signature(await plainFile(filename)) !== sig) throw new Error('准备音频时素材发生变化，请重试');
    const value={signature:sig,sha256};sources.set(media.id,value);
    while(sources.size>256)sources.delete(sources.keys().next().value);
    return {...value,filename};
  }
  async function describe(clip, controls) {
    const media=store.media.get(clip.mediaId);
    if (!media?.hasAudio) throw new HttpError(400,'所选片段没有音频');
    const needsHelper=clipSpeedCurve(clip)&&!clip.speedCurve.points.every(p=>p.speed===clip.speedCurve.points[0].speed);
    const source=await sourceIdentity(media,controls), engines=await identity(needsHelper), timing=clipTiming(clip), range=clipAudioSampleRange(clip);
    const segments=timing.segments.map(part=>({...part,samples:clipAudioSampleRange({start:clip.start+part.start,duration:part.duration}).count}));
    const clock={sourceStart:clip.sourceStart,duration:clip.duration,offset:range.offset,frames:range.count,
      segments,curve:clip.speedCurve ? {sourceDuration:clip.speedCurve.sourceDuration,
        points:clip.speedCurve.points.map(p=>({position:p.position,speed:p.speed,phase:p.phase??[0,1]}))}:null};
    const key=digest(JSON.stringify([AUDIO_CLOCK_VERSION,source.sha256,engines,clock]));
    return {key,source,engines,clock,range,timing,media,clip};
  }
  async function readCache(key) {
    const names=files(key);
    try {
      const metaStat=await plainFile(names.manifest);
      if(metaStat.size>65536n)return null;
      const meta=JSON.parse(await fs.readFile(names.manifest,'utf8'));
      if(meta.version!==AUDIO_CLOCK_VERSION||meta.key!==key||meta.sampleRate!==48000||meta.channels!==2||meta.format!=='f32le'||!Number.isSafeInteger(meta.frames)||meta.frames<1||meta.frames>900*48000||!keyPattern.test(meta.sha256))return null;
      const stat=await plainFile(names.pcm), sig=signature(stat);
      if(stat.size!==BigInt(meta.frames*8))return null;
      if(verified.get(key)!==sig){if(await hashFile(names.pcm)!==meta.sha256)return null;verified.set(key,sig);}
      return {...meta,filename:names.pcm};
    } catch(error) { if(error.code==='ENOENT'||error instanceof SyntaxError||error instanceof HttpError)return null;throw error; }
  }
  async function prune() {
    await fs.mkdir(directory,{recursive:true});expire();
    const candidates=[];let bytes=0;
    for await(const entry of await fs.opendir(directory)) {
      if(!entry.isFile())continue;
      const temporary=/^([a-f0-9]{64})\.json\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.exec(entry.name);
      if(temporary){if(!publishing.has(temporary[1]))await remove(path.join(directory,entry.name));continue;}
      const extension=path.extname(entry.name);if(!['.pcm','.json'].includes(extension))continue;
      const key=entry.name.slice(0,-extension.length);if(!keyPattern.test(key)||pinned(key)||publishing.has(key))continue;
      const names=files(key);
      if(extension==='.json') {
        try{await plainFile(names.pcm);}catch(error){if(error.code==='ENOENT'||error instanceof HttpError){await remove(names.manifest);verified.delete(key);continue;}throw error;}
        continue;
      }
      // A process may die after the PCM rename but before its manifest rename.
      // Such owned cache bytes count neither as ready nor as an eternal pin.
      try{await plainFile(names.manifest);}catch(error){if(error.code==='ENOENT'||error instanceof HttpError){await remove(names.pcm);verified.delete(key);continue;}throw error;}
      const stat=await fs.stat(names.pcm);
      candidates.push({key,time:stat.mtimeMs,bytes:stat.size});bytes+=stat.size;
      while(candidates.length>AUDIO_CLOCK_LIMITS.unleasedFiles||bytes>AUDIO_CLOCK_LIMITS.unleasedBytes) {
        candidates.sort((a,b)=>a.time-b.time);const old=candidates.shift();bytes-=old.bytes;
        const f=files(old.key);await remove(f.manifest);await remove(f.pcm);verified.delete(old.key);
      }
    }
  }
  async function prepareOne(clip, workDir, controls) {
    const selected=await describe(clip,controls),{key,range,source,timing}=selected;
    let cached=await readCache(key);
    if(cached)return cached;
    const capacity=await fs.statfs(workDir);
    if(capacity.bavail*capacity.bsize < range.count*8+16*1024*1024)throw new Error('实时音频临时磁盘空间不足');
    const output=path.join(workDir,`clock-${clip.index}.pcm`);
    if(clipSpeedCurve(clip)&&!clip.speedCurve.points.every(p=>p.speed===clip.speedCurve.points[0].speed)) {
      const prepared=await renderCurveAudio(clip,source.filename,workDir,{...controls,audioHelperPath});
      await appendBytes(path.join(workDir,prepared.filename),output,44,range.count*8,controls);
      await fs.rm(path.join(workDir,prepared.filename));
    } else {
      const args=['-v','error','-y','-nostdin','-threads','2','-filter_complex_threads','1'],graph=[],labels=[];
      const curve=clipSpeedCurve(clip);
      const spans=curve?[{sourceStart:clip.sourceStart,sourceDuration:curve.sourceDuration,speed:curve.points[0].speed,start:0,duration:clip.duration}]:timing.segments;
      spans.forEach((part,index)=>{
        args.push(...inputSafetyArgs,'-ss',decimal(part.sourceStart),'-t',decimal(part.sourceDuration),'-i',source.filename);
        const count=curve?range.count:clipAudioSampleRange({start:clip.start+part.start,duration:part.duration}).count;
        if(!count)return;
        graph.push(`[${index}:a:0]asetpts=PTS-STARTPTS,${audioTempoFilter(part.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=${count},asetpts=N/SR/TB[p${index}]`);labels.push(`[p${index}]`);
      });
      if(!labels.length)throw new Error('片段没有可处理音频样本');
      graph.push(`${labels.join('')}${labels.length>1?`concat=n=${labels.length}:v=0:a=1,`:''}apad,atrim=end_sample=${range.count}[out]`);
      args.push('-filter_complex',graph.join(';'),'-map','[out]','-vn','-ar','48000','-ac','2','-c:a','pcm_f32le','-f','f32le',output);
      controls.onStage?.('clock-decode');await controls.runProcess(args,{cwd:workDir,timeout:30*60*1000});
    }
    controls.checkCancelled?.();
    if((await fs.stat(output)).size!==range.count*8)throw new Error('源时钟 PCM 样本数不完整');
    if(signature(await plainFile(source.filename))!==source.signature)throw new Error('准备音频时素材发生变化，请重试');
    const sha256=await hashFile(output,controls),meta={version:AUDIO_CLOCK_VERSION,key,frames:range.count,sampleRate:48000,channels:2,format:'f32le',sha256,sourceSha256:source.sha256,engines:selected.engines};
    await fs.mkdir(directory,{recursive:true});const names=files(key);
    // Publication paths join the caller's retained cleanup ownership until
    // both PCM and manifest have been atomically published.
    controls.ownCleanup?.(names.pcm);controls.ownCleanup?.(names.manifest);
    publishing.add(key);
    try { await fs.rename(output,names.pcm);await atomicJson(names.manifest,meta); }
    catch(error) {
      if(!controls.ownCleanup){cleanup.add(names.pcm);cleanup.add(names.manifest);}
      throw error;
    } finally { publishing.delete(key); }
    controls.releaseCleanup?.(names.pcm);controls.releaseCleanup?.(names.manifest);
    verified.set(key,signature(await plainFile(names.pcm)));
    cached={...meta,filename:names.pcm};return cached;
  }
  return {
    directory,
    startLease,
    hasLease(id){if(expire())requestPrune();return leases.has(id);},
    release(id){return leases.delete(id)?requestPrune():Promise.resolve();},
    async prepare(project,clipIds,workDir,controls={},leaseId) {
      const lease=startLease(leaseId),selected=clipIds?new Set(clipIds):null;
      const clips=project.clips.filter(c=>(!selected||selected.has(c.id))&&store.media.get(c.mediaId)?.hasAudio);
      if(selected&&[...selected].some(id=>!clips.some(c=>c.id===id)))throw new HttpError(400,'音频准备片段无效或没有音轨');
      const result=[];let done=0;const duration=clips.reduce((n,c)=>n+c.duration,0)||1;
      for(let index=0;index<clips.length;index++) {
        controls.checkCancelled?.();const clip={...clips[index],index};
        let asset;
        try{asset=await prepareOne(clip,workDir,{...controls,onProgress:p=>controls.onProgress?.((done+clip.duration*p)/duration)});}
        catch(error){if(error.cleanupHandles){for(const h of error.cleanupHandles)openHandles.add(h);delete error.cleanupHandles;}throw error;}
        lease.keys.add(asset.key);lease.until=now()+AUDIO_CLOCK_LIMITS.leaseMilliseconds;
        result.push({clipId:clip.id,key:asset.key,url:`/api/audio-clock-assets/${asset.key}`,frames:asset.frames,sampleRate:48000,channels:2,format:'f32le',filename:asset.filename});
        done+=clip.duration;controls.onProgress?.(done/duration);
      }
      await prune();return result;
    },
    async range(key,first,count,leaseId) {
      if(!keyPattern.test(key)||!Number.isSafeInteger(first)||first<0||!Number.isInteger(count)||count<1||count>AUDIO_CLOCK_LIMITS.rangeFrames)throw new HttpError(400,'音频 PCM 范围无效');
      if(expire())requestPrune();const lease=leases.get(leaseId);
      if(!lease||!lease.keys.has(key))throw new HttpError(410,'音频准备会话已过期，请重新准备');
      const asset=await readCache(key);if(!asset)throw new HttpError(409,'音频缓存缺失或损坏，请重新准备');
      if(first>asset.frames)throw new HttpError(416,'音频 PCM 读取起点超过片段范围');
      lease.until=now()+AUDIO_CLOCK_LIMITS.leaseMilliseconds;
      const frames=Math.min(count,Math.max(0,asset.frames-first)),buffer=Buffer.alloc(frames*8);
      const input=await fs.open(asset.filename,'r');
      openHandles.add(input);
      try {let read=0;while(read<buffer.length){const{bytesRead}=await input.read(buffer,read,buffer.length-read,first*8+read);if(!bytesRead)throw new Error('音频缓存读取不完整');read+=bytesRead;}}
      finally{await input.close();openHandles.delete(input);}
      return {buffer,frames,sampleRate:48000,channels:2};
    },
    async close(){closed=true;clearInterval(maintenance);leases.clear();if(pruneTask)await pruneTask.catch(()=>{});for(const h of [...openHandles]){await h.close();openHandles.delete(h);}for(const filename of [...cleanup])await remove(filename);await requestPrune();},
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { compileAudioPlan, createAudioDSP } from '../shared/audio-dsp.mjs';

export const AUDIO_MIX_BLOCK_FRAMES = 4096;
function waveHeader(samples) {
  const bytes=samples*8;
  if(!Number.isSafeInteger(samples)||samples<1||bytes+36>0xffffffff)throw new RangeError('混音 WAV 样本数超出容量');
  const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(bytes+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(3,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(384000,28);b.writeUInt16LE(8,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;
}
async function writeAll(file, bytes) {
  for(let at=0;at<bytes.length;) { const {bytesWritten}=await file.write(bytes,at,bytes.length-at);if(!bytesWritten)throw new Error('混音 PCM 写入中断');at+=bytesWritten; }
}

// Node and AudioWorklet execute the same kernel. Only bounded file IO belongs
// here; there is no second implementation of DSP/envelopes/mix/limiting.
export async function renderAudioMix(project, assets, output, {fps=project.fps,checkCancelled=()=>{},onProgress=()=>{},onStage=()=>{}}={}) {
  const plan=compileAudioPlan(project,{fps}), dsp=createAudioDSP(plan),handles=new Map();
  const capacity=await fs.statfs(path.dirname(output));
  if(capacity.bavail*capacity.bsize<plan.outputFrames*8+16*1024*1024)throw new Error('工程混音临时磁盘空间不足');
  let target, failure;
  try {
    for(const clip of plan.clips) {
      const asset=assets.find(a=>a.clipId===clip.id);
      // Inaudible clips need no prepared data offline. Realtime can prepare
      // them ahead of unmuting, without changing the saved DSP plan.
      if(!asset&&clip.enabled&&clip.base!==0)throw new Error(`片段 ${clip.id} 缺少源音频 PCM`);
      if(asset)handles.set(clip.id,await fs.open(asset.filename,'r'));
    }
    target=await fs.open(output,'w');await writeAll(target,waveHeader(plan.outputFrames));
    const buffers=new Map([...handles.keys()].map(id=>[id,Buffer.alloc(AUDIO_MIX_BLOCK_FRAMES*8)]));
    onStage('audio-mix');
    for(let frame=0;frame<plan.outputFrames;frame+=AUDIO_MIX_BLOCK_FRAMES) {
      checkCancelled();const frames=Math.min(AUDIO_MIX_BLOCK_FRAMES,plan.outputFrames-frame),inputs={};
      for(const clip of plan.clips) {
        const handle=handles.get(clip.id);if(!handle)continue;
        const first=Math.max(frame,clip.first),end=Math.min(frame+frames,clip.end);if(end<=first)continue;
        const buffer=buffers.get(clip.id);buffer.fill(0,0,frames*8);
        const length=(end-first)*8,offset=(first-frame)*8;let read=0;
        while(read<length) {const{bytesRead}=await handle.read(buffer,offset+read,length-read,(first-clip.first)*8+read);if(!bytesRead)throw new Error('混音源 PCM 读取不完整');read+=bytesRead;}
        inputs[clip.id]=new Float32Array(buffer.buffer,buffer.byteOffset,frames*2);
      }
      const mixed=dsp.process(inputs,frames);
      await writeAll(target,Buffer.from(mixed.buffer,mixed.byteOffset,mixed.byteLength));
      onProgress((frame+frames)/plan.outputFrames);
    }
    checkCancelled();return {frames:plan.outputFrames,bytes:plan.outputFrames*8+44,plan};
  } catch(error) { failure=error;throw error; }
  finally {
    const owned=[...handles.values(),...(target?[target]:[])],results=await Promise.allSettled(owned.map(h=>h.close()));
    const failed=owned.filter((_,i)=>results[i].status==='rejected');
    if(failed.length){const error=new AggregateError([...(failure?[failure]:[]),...results.filter(r=>r.status==='rejected').map(r=>r.reason)],`混音文件句柄清理失败${failure?`（${failure.message}）`:''}`);error.cleanupHandles=failed;throw error;}
  }
}

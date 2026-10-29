import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, ffmpegPath, inputSafetyArgs} from './process.mjs';
import {assertSpeedCurveSupported, curveAudioTimeMapBatch, CURVE_AUDIO_ENGINE_ID} from '../shared/speed-curve.mjs';

const RATE=48000, CHANNELS=2, FRAME_BYTES=8;
export const sourceAudioHelperPath=fileURLToPath(new URL('../desktop/audio-helper/bin/darwin-arm64/weijian-audio-helper',import.meta.url));
const number=value=>{
  if(!Number.isFinite(value))throw new RangeError('曲线音频时间或速度无效');
  const text=value.toFixed(12).replace(/\.?0+$/,'')||'0';return text==='-0'?'0':text;
};
async function writeAll(file,bytes){
  for(let at=0;at<bytes.length;){const{bytesWritten}=await file.write(bytes,at,bytes.length-at);if(!bytesWritten)throw new Error('曲线音频中间文件写入中断');at+=bytesWritten;}
}
function waveHeader(samples){
  const bytes=samples*FRAME_BYTES;if(bytes+36>0xffffffff)throw new RangeError('曲线音频超过 WAV 容量');
  const b=Buffer.alloc(44);b.write('RIFF',0);b.writeUInt32LE(bytes+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(CHANNELS,22);b.writeUInt32LE(RATE,24);b.writeUInt32LE(RATE*FRAME_BYTES,28);b.writeUInt16LE(FRAME_BYTES,32);b.writeUInt16LE(32,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;
}

// The caller owns this directory and the child lifecycle on all outcomes. The
// production export/preview queue supplies its fixed, packaged helper path.
export async function renderCurveAudio(clip,sourceFile,workDir,{
  runProcess=(args,{binary=ffmpegPath,...options}={})=>run(binary,args,options),
  audioHelperPath=sourceAudioHelperPath,checkCancelled=()=>{},onProgress=()=>{},onStage=()=>{},
}={}){
  const plan=assertSpeedCurveSupported(clip.speedCurve);
  if(plan.flat)throw new Error('恒速片段无需曲线音频预处理');
  await fs.access(audioHelperPath,constants.X_OK).catch(()=>{throw new Error('缺少本地保调音频引擎，请重新构建或安装完整桌面应用');});
  const base=`curve-audio-${clip.index}`,source=path.join(workDir,`${base}.source.f32le`),raw=path.join(workDir,`${base}.stretched.f32le`),map=path.join(workDir,`${base}.time-map.tsv`),filename=`${base}.wav`,target=path.join(workDir,filename);
  const sourceBytes=plan.sourceSamples*FRAME_BYTES,outputBytes=plan.samples*FRAME_BYTES;
  const required=Math.max(sourceBytes+outputBytes,2*outputBytes)+plan.mapCount*24+16*1024*1024,capacity=await fs.statfs(workDir);
  if(capacity.bavail*capacity.bsize<required)throw new Error(`曲线音频临时磁盘空间不足，需要约${Math.ceil(required/1024/1024)}MB`);
  checkCancelled();onStage('curve-decode');
  await runProcess(['-hide_banner','-y','-nostdin','-loglevel','error','-threads','2',...inputSafetyArgs,'-ss',number(clip.sourceStart),'-t',number(clip.speedCurve.sourceDuration),'-i',sourceFile,'-map','0:a:0','-vn','-af',`aresample=${RATE},aformat=sample_fmts=flt:channel_layouts=stereo,apad,atrim=end_sample=${plan.sourceSamples},asetpts=N/SR/TB`,'-c:a','pcm_f32le','-f','f32le',source],{cwd:workDir,timeout:30*60*1000});
  checkCancelled();if((await fs.stat(source)).size!==sourceBytes)throw new Error('曲线音频源 PCM 时长不完整');
  const mapping=await fs.open(map,'w');let mapBytes=0;
  try{
    for(let first=0;first<plan.mapCount;first+=4096){checkCancelled();const batch=curveAudioTimeMapBatch(clip.speedCurve,first);const bytes=Buffer.from(batch.map(p=>`${p.sourceFrame}\t${p.outputFrame}\n`).join(''));await writeAll(mapping,bytes);mapBytes+=bytes.length;}
  }finally{await mapping.close();}
  let pending='',protocolError,completed,previous=0;
  const line=text=>{
    if(!text.trim())return;
    try{const item=JSON.parse(text);if(!['study','process','complete'].includes(item.phase)||!Number.isFinite(item.progress)||item.progress<previous||item.progress>1)throw new Error('invalid audio progress');previous=item.progress;onProgress(item.progress);if(item.phase==='complete')completed=item;}
    catch(error){protocolError??=error;}
  };
  checkCancelled();onStage('curve-stretch');
  await runProcess(['stretch','--input',source,'--output',raw,'--map',map,'--source-frames',String(plan.sourceSamples),'--output-frames',String(plan.samples),'--channels',String(CHANNELS),'--sample-rate',String(RATE)],{binary:audioHelperPath,cwd:workDir,timeout:30*60*1000,onProgress:chunk=>{
    pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end));pending=pending.slice(end+1);}if(pending.length>65536){protocolError??=new Error('audio progress line too long');pending='';}
  }});
  if(pending)line(pending);
  checkCancelled();if(protocolError||completed?.outputFrames!==plan.samples||completed?.retrievedFrames!==plan.samples)throw new Error(`保调音频引擎输出协议或采样数无效${protocolError?': '+protocolError.message:''}`);
  if((await fs.stat(raw)).size!==outputBytes)throw new Error('保调音频输出时长不完整');
  // Drop selected-source PCM before wrapping output: peak disk is
  // max(source+raw, raw+WAV), not the sum of all three files.
  await fs.rm(source);await fs.rm(map);checkCancelled();onStage('curve-append');
  const input=await fs.open(raw,'r');let written=0;
  try{
    const output=await fs.open(target,'w');
    try{
      await writeAll(output,waveHeader(plan.samples));const buffer=Buffer.alloc(64*1024);
      while(written<outputBytes){checkCancelled();const{bytesRead}=await input.read(buffer,0,Math.min(buffer.length,outputBytes-written),written);if(!bytesRead)throw new Error('保调音频数据不完整');await writeAll(output,buffer.subarray(0,bytesRead));written+=bytesRead;}
    }finally{await output.close();}
  }finally{await input.close();}
  checkCancelled();await fs.rm(raw);onProgress(1);
  return{filename,engine:CURVE_AUDIO_ENGINE_ID,samples:plan.samples,sourceSamples:plan.sourceSamples,mapFrames:plan.mapCount,mapBytes,sourcePcmBytes:sourceBytes,waveBytes:written+44,processBlockFrames:256};
}

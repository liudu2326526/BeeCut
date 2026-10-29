import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {renderCurveAudio, sourceAudioHelperPath} from '../server/curve-audio.mjs';
import {ffmpegPath, run} from '../server/process.mjs';
import {curveAudioPlan, curveAudioTimeMapBatch, CURVE_AUDIO_ENGINE_ID} from '../shared/speed-curve.mjs';

const exec=promisify(execFile),SR=48000;
function independentClock(curve){
  const N=100000,times=[0],points=curve.points;
  const ease=u=>u*u*(3-2*u);
  const rate=u=>{
    const i=Math.min(points.length-2,Math.max(0,points.findLastIndex(p=>p.position<=u)));
    const a=points[i],b=points[i+1],[lo,hi]=a.phase??[0,1],q=(u-a.position)/(b.position-a.position);
    return a.speed+(b.speed-a.speed)*(ease(lo+(hi-lo)*q)-ease(lo))/(ease(hi)-ease(lo));
  };
  for(let i=0;i<N;i++)times.push(times.at(-1)+curve.sourceDuration*(1/rate(i/N)+1/rate((i+1)/N))/(2*N));
  return {duration:times.at(-1),at(source){const u=Math.max(0,Math.min(N,source/curve.sourceDuration*N)),i=Math.min(N-1,Math.floor(u));return times[i]+(times[i+1]-times[i])*(u-i);}};
}
function wave(buffer){
  let channels,bits,format,data;
  assert.equal(buffer.toString('ascii',0,4),'RIFF');
  for(let at=12;at+8<=buffer.length;){const id=buffer.toString('ascii',at,at+4),size=buffer.readUInt32LE(at+4);if(id==='fmt '){format=buffer.readUInt16LE(at+8);channels=buffer.readUInt16LE(at+10);bits=buffer.readUInt16LE(at+22);}if(id==='data'){data=buffer.subarray(at+8,at+8+size);break;}at+=8+size+(size%2);}
  assert.ok([3,65534].includes(format));assert.equal(bits,32);assert.equal(channels,2);assert.ok(data);
  return Array.from({length:data.length/8},(_,i)=>[data.readFloatLE(i*8),data.readFloatLE(i*8+4)]);
}
function window(pcm,center,seconds,channel=0){
  const start=Math.round((center-seconds/2)*SR),length=Math.round(seconds*SR);
  assert.ok(start>=0&&start+length<=pcm.length);
  return Float64Array.from({length},(_,i)=>pcm[start+i][channel]*(.5-.5*Math.cos(2*Math.PI*i/(length-1))));
}
function power(samples,hz){
  const angle=2*Math.PI*hz/SR,c=Math.cos(angle),s=Math.sin(angle);let x=1,y=0,re=0,im=0;
  for(const value of samples){re+=value*x;im+=value*y;const next=x*c-y*s;y=x*s+y*c;x=next;}
  return re*re+im*im;
}
function peak(samples,expected){
  let best={hz:0,power:-1};
  for(let hz=expected-8;hz<=expected+8;hz+=.25){const p=power(samples,hz);if(p>best.power)best={hz,power:p};}
  return best.hz;
}
const rms=(pcm,from,to,channel=0)=>{
  let square=0,count=0;for(let i=Math.max(0,Math.round(from*SR));i<Math.min(pcm.length,Math.round(to*SR));i++){square+=pcm[i][channel]**2;count++;}return Math.sqrt(square/count);
};
async function harness(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v08-audio-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
async function fixture(dir,sourceDuration,type='pure'){
  const source=path.join(dir,'source.wav');
  const expression=type==='compound'?'.06*(sin(2*PI*220*t)+sin(2*PI*440*t)+sin(2*PI*880*t))':type==='markers'?`.12*sin(2*PI*t*(if(lt(t,${sourceDuration/4}),440,if(lt(t,${sourceDuration/2}),660,if(lt(t,${sourceDuration*3/4}),880,1100)))))`:'.12*sin(2*PI*440*t)';
  const escaped=expression.replaceAll(',', '\\,');
  await exec(ffmpegPath,['-v','error','-y','-f','lavfi','-i',`aevalsrc=${escaped}|0.5*(${escaped}):s=${SR}:d=${sourceDuration}`,'-c:a','pcm_f32le',source]);return source;
}

test('one sample-map owner has finite 900s capacity, bounded batches and no legacy audio-block representation',()=>{
  const curve={sourceDuration:905.9164843192043,points:[{position:0,speed:.5},{position:1,speed:2}]},plan=curveAudioPlan(curve);
  assert.equal(plan.samples,43200000);assert.equal(plan.mapCount,45295);assert.equal(plan.engine,CURVE_AUDIO_ENGINE_ID);let previous,count=0;
  for(let first=0;first<plan.mapCount;first+=4096)for(const point of curveAudioTimeMapBatch(curve,first)){
    if(previous){assert.ok(point.sourceFrame>previous.sourceFrame);assert.ok(point.outputFrame>previous.outputFrame);}assert.ok(point.sourceFrame<plan.sourceSamples&&point.outputFrame<plan.samples);previous=point;count++;
  }
  assert.equal(count,plan.mapCount);assert.ok(plan.idealTimeErrorBound<.0065);
  assert.throws(()=>curveAudioTimeMapBatch(curve,0,4097),/范围无效/);
  for(const sourceDuration of[Infinity,Number.MAX_VALUE,3600.01])assert.throws(()=>curveAudioPlan({...curve,sourceDuration}),/源区间无效/);
  const short={sourceDuration:.011,points:[{position:0,speed:.25},{position:1,speed:.251}]};assert.equal(curveAudioPlan(short).mapCount,0);assert.equal(curveAudioPlan(short).flat,false,'zero interior map entries are not a flat-curve identity');
});

test('actual continuous helper preserves pitch, sample clock, voiced tails and stereo through gentle, steep, phased and composite curves',{timeout:180000},async t=>{
  const dir=await harness(t),cases=[
    ['up',8,[.5,2],'pure'],['down',8,[2,.5],'pure'],
    ['shortup',.703125,[.25,4],'pure'],['shortdown',.703125,[4,.25],'pure'],
    ['critical',3.515625,[.25,4,.25,4,.25,4],'pure'],
    ['markers',8,[.5,2],'markers'],['compound',8,[.5,2,.75],'compound'],
    ['phased',2,[1,3],'pure'],['short-mapless',.011,[.25,.251],'pure'],
  ],diagnostics=[];
  for(const[name,sourceDuration,rates,type]of cases){
    const folder=path.join(dir,name);await fs.mkdir(folder);const source=await fixture(folder,sourceDuration,type),sourcePcm=wave(await fs.readFile(source));
    const curve={sourceDuration,points:rates.map((speed,i)=>({position:i/(rates.length-1),speed,...(name==='phased'&&i===0?{phase:[.3,.8]}:{})}))};
    const clock=independentClock(curve),clip={index:0,sourceStart:0,speedCurve:curve},work=path.join(folder,'work');await fs.mkdir(work);const progress=[];
    const result=await renderCurveAudio(clip,source,work,{onProgress:p=>progress.push(p)}),pcm=wave(await fs.readFile(path.join(work,result.filename)));
    assert.equal(pcm.length,Math.round(clock.duration*SR));assert.equal(result.engine,CURVE_AUDIO_ENGINE_ID);assert.ok(progress.every((p,i)=>!i||p>=progress[i-1]));assert.equal(progress.at(-1),1);assert.deepEqual(await fs.readdir(work),[result.filename]);
    const observations=[];
    if(name!=='short-mapless'){
      const components=type==='compound'?[220,440,880]:type==='markers'?[440,660,880,1100]:[440];
      for(let i=0;i<components.length;i++){
        const frequency=components[i],center=type==='markers'?clock.at(sourceDuration*(i+.5)/4):clock.duration*.5;
        const seconds=Math.min(name.startsWith('short')?.2:1,clock.duration*.5);
        const actual=peak(window(pcm,center,seconds),frequency);assert.ok(Math.abs(actual-frequency)<=Math.max(.5,frequency*.001),`${name} ${frequency}Hz -> ${actual}Hz`);observations.push({expectedHz:frequency,actualHz:actual,windowSeconds:seconds});
      }
    }
    const markers=[];
    if(type==='markers')for(let i=1;i<4;i++){
      const expected=clock.at(sourceDuration*i/4),before=[440,660,880,1100][i-1],after=[440,660,880,1100][i];let observed;
      for(let k=-20;k<=20;k++){const at=expected+k*.005,samples=window(pcm,at,.02);if(power(samples,after)>power(samples,before)){observed=at;break;}}
      assert.ok(observed!==undefined&&Math.abs(observed-expected)<=.04,`${name} source marker${i}: ${observed} vs ${expected}`);markers.push({expected,observed,error:observed-expected});
    }
    const tailWindow=Math.min(.05,clock.duration*.4),tailEnd=clock.duration-Math.min(.01,clock.duration*.05),tail=rms(pcm,tailEnd-tailWindow,tailEnd),sourceTail=rms(sourcePcm,sourceDuration-Math.min(.05,sourceDuration*.4),sourceDuration);
    assert.ok(tail>=sourceTail*.5,`${name} real source tail ${tail} vs source ${sourceTail}`);
    let maxJump=0,squareL=0,squareR=0,cross=0;
    for(let i=1;i<pcm.length;i++){
      const at=i/SR;if(markers.some(m=>Math.abs(at-m.expected)<.08)||at<.01||at>clock.duration-.01)continue;
      maxJump=Math.max(maxJump,Math.abs(pcm[i][0]-pcm[i-1][0]));squareL+=pcm[i][0]**2;squareR+=pcm[i][1]**2;cross+=pcm[i][0]*pcm[i][1];
    }
    assert.ok(maxJump<.06,`${name} internal PCM jump ${maxJump}`);if(squareL){assert.ok(Math.abs(Math.sqrt(squareR/squareL)-.5)<.001);assert.ok(cross/Math.sqrt(squareL*squareR)>.999);}
    diagnostics.push({name,samples:pcm.length,duration:clock.duration,tones:observations,markers,tailRms:tail,sourceTailRms:sourceTail,maxJump,mapFrames:result.mapFrames});
  }
  t.diagnostic(JSON.stringify(diagnostics));
});

test('native helper rejects malformed maps before output allocation and supervised timeout closes the actual child',{timeout:120000},async t=>{
  const dir=await harness(t),source=await fixture(dir,8),work=path.join(dir,'work');await fs.mkdir(work);
  await assert.rejects(renderCurveAudio({index:0,sourceStart:0,speedCurve:{sourceDuration:8,points:[{position:0,speed:.5},{position:1,speed:2}]}},source,work,{audioHelperPath:path.join(dir,'missing')}),/缺少本地保调/);
  let child,closed=false;
  await assert.rejects(renderCurveAudio({index:0,sourceStart:0,speedCurve:{sourceDuration:8,points:[{position:0,speed:.5},{position:1,speed:2}]}},source,work,{
    runProcess:(args,options={})=>run(options.binary??ffmpegPath,args,{...options,...(options.binary?{timeout:1,onChild:c=>{child=c;c.once('close',()=>closed=true);}}:{})}),
  }),/处理超时/);
  assert.ok(child&&closed);assert.throws(()=>process.kill(child.pid,0),/ESRCH/);
  const map=path.join(dir,'bad.tsv'),raw=path.join(dir,'raw.f32le'),output=path.join(dir,'bad-output.f32le');await fs.writeFile(raw,Buffer.alloc(48000*8));await fs.writeFile(map,'0\t0\n');
  await assert.rejects(exec(sourceAudioHelperPath,['stretch','--input',raw,'--output',output,'--map',map,'--source-frames','48000','--output-frames','48000','--channels','2','--sample-rate','48000']),/nonmonotonic/);
  await assert.rejects(fs.stat(output),/ENOENT/);
});

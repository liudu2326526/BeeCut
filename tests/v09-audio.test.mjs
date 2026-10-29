import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { ffmpegPath, run } from '../server/process.mjs';
import { compileAudioPlan, createAudioDSP } from '../shared/audio-dsp.mjs';
import { audioGainPlan } from '../shared/audio.mjs';
import { newProject, projectAudioLanes, clipAudioAudibility, clipAudioEnabled, audioGainAt,
  audioGainMultiplierAt, audioGainKeyProgressAt, audioGainKeyframes, audioGainKeyNavigation,
  upsertAudioGainKey, removeAudioGainKey, setAudioGainKeyEasing, clipAudioPanGains,
  clipAudioSampleRange, trimClip, splitClip, changeClipTiming, detachClipAudio, MAX_AUDIO_GAIN_KEYS } from '../shared/model.mjs';
import { resolveTimelinePlacement } from '../shared/timeline-placement.mjs';

const exec = promisify(execFile), RATE = 48000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ease = (type, u) => type === 'easeIn' ? u*u : type === 'easeOut' ? 2*u-u*u : type === 'easeInOut' ? 3*u*u-2*u*u*u : u;
const keyClip = (easing = 'easeInOut') => ({ id:'sound', mediaId:'source', track:'audio', layer:0, start:.137019, sourceStart:0, duration:4, speed:1, volume:.5,
  audioGainKeys:[{id:'a',time:.2,gain:.25,easing,phase:[.13,.91]},{id:'b',time:3.8,gain:1.75,easing:'linear',phase:[0,1]}] });
const independentGain = (type, t) => {
  const u=Math.max(0,Math.min(1,(t-.2)/3.6)), a=.13,b=.91;
  return .25+1.5*(ease(type,a+(b-a)*u)-ease(type,a))/(ease(type,b)-ease(type,a));
};
let sourcePromise;
async function sources() {
  return sourcePromise ??= (async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v09-sources-'));
    const files={};
    for (const hz of [440,660,880,1100]) {
      const file=path.join(dir,`tone${hz}.wav`);
      await run(ffmpegPath,['-v','error','-y','-f','lavfi','-i',`aevalsrc=0.04*sin(2*PI*${hz}*t)|0.04*sin(2*PI*${hz}*t):s=48000:d=6`,'-c:a','pcm_f32le',file]);files[`tone${hz}`]=file;
    }
    for (const [name,expr] of Object.entries({dc:'0.05|0.05',stereo:'0.04*sin(2*PI*440*t)|0.02*sin(2*PI*660*t)',multi:'0.01*sin(2*PI*220*t)+0.01*sin(2*PI*8800*t)|0.01*sin(2*PI*220*t)+0.01*sin(2*PI*8800*t)',impulse:"if(eq(n\\,9600)\\,0.1\\,0)|if(eq(n\\,9600)\\,0.1\\,0)"})) {
      const file=path.join(dir,`${name}.wav`);
      await run(ffmpegPath,['-v','error','-y','-f','lavfi','-i',`aevalsrc=${expr}:s=48000:d=6`,'-c:a','pcm_f32le',file]);files[name]=file;
    }
    const video=path.join(dir,'video.mp4');
    await run(ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=blue:s=128x128:r=30:d=6','-f','lavfi','-i','aevalsrc=0.04*sin(2*PI*220*t)|0.04*sin(2*PI*220*t):s=48000:d=6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',video]);files.video=video;
    return {dir,files};
  })();
}
after(async()=>{if(sourcePromise)await fs.rm((await sourcePromise).dir,{recursive:true,force:true});});
async function decode(file,filter) {
  const {stdout}=await exec(ffmpegPath,['-v','error','-i',file,...(filter?['-af',filter]:[]),'-vn','-ar','48000','-ac','2','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:32*1024*1024});return stdout;
}
const sample=(pcm,n,ch=0)=>pcm.readFloatLE((n*2+ch)*4);
function amplitude(pcm,hz,time,ch=0,seconds=.1) {
  const begin=Math.round((time-seconds/2)*RATE), count=Math.round(seconds*RATE);let re=0,im=0;
  for(let i=0;i<count;i++){const x=sample(pcm,begin+i,ch),angle=2*Math.PI*hz*i/RATE;re+=x*Math.cos(angle);im+=x*Math.sin(angle);}
  return 2*Math.hypot(re,im)/count;
}
async function fixture(t,names) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'weijian-v09-api-')),runtime=await createApp({dataDir:path.join(dir,'library')}),server=runtime.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await runtime.queue.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});await fs.rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const post=async(endpoint,value)=>{const r=await fetch(origin+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
  const form=new FormData(),files=(await sources()).files;
  for(const name of names)form.append('files',new Blob([await fs.readFile(files[name])]),path.basename(files[name]));
  const imported=await fetch(origin+'/api/media',{method:'POST',body:form});assert.equal(imported.status,201);const media=(await imported.json()).media;
  const byName=Object.fromEntries(names.map(name=>[name,media.find(m=>m.name===path.basename(files[name]))]));
  const project={...newProject('V09 numerical audio acceptance'),width:128,height:128,fps:30,media};
  const finish=async(project,video=false)=>{
    const r=await post(video?'/api/exports':'/api/audio-previews',video?{project,settings:{width:128,height:128,fps:30,quality:'high'}}:{project});assert.equal(r.status,202,JSON.stringify(r.body));let job=r.body;
    for(let i=0;i<3000&&!['completed','failed','cancelled'].includes(job.status);i++){await pause(10);job=await(await fetch(`${origin}/api/exports/${job.id}`)).json();}
    assert.equal(job.status,'completed',JSON.stringify(job));return path.join(runtime.store.dirs.exports,job.id+(video?'.mp4':'.wav'));
  };
  return {dir,runtime,origin,post,project,byName,finish};
}
const clip=(id,media,track='audio',fields={})=>({id,mediaId:media.id,track,layer:0,start:0,sourceStart:0,duration:4,speed:1,volume:1,...fields});

test('four independent audio lanes keep legacy overlap and own mute/solo including embedded original audio',()=>{
  const project=newProject(), media={hasAudio:true}, audio=clip('a',{id:'source'},'audio',{layer:2}),video={...audio,track:'video',layer:3};
  assert.deepEqual(projectAudioLanes({}),Array.from({length:4},()=>({muted:false,solo:false})));
  assert.equal(clipAudioEnabled(audio,media,project),true);
  project.audioLanes[2]={muted:true,solo:true};
  assert.equal(clipAudioAudibility(audio,media,project).reason,'lane-muted');assert.equal(clipAudioAudibility(video,media,project).reason,'solo-excluded');
  assert.equal(audioGainAt(audio,.5,project),0);project.audioLanes[2].muted=false;assert.equal(clipAudioEnabled(audio,media,project),true);
  const before=structuredClone(project);project.media=[{id:'source',type:'audio',duration:4}];project.clips=[audio];
  for(let layer=0;layer<4;layer++)assert.equal(resolveTimelinePlacement(project,{mediaId:'source',start:1,track:'audio',layer}).ok,true);
  assert.equal(resolveTimelinePlacement(project,{mediaId:'source',start:1,track:'audio',layer:4}).code,'LAYER_INVALID');
  assert.equal(before.audioLanes[2].solo,true);
});

test('gain key mutations, cubic owner and all easing subphases survive move/trim/split and all speed modes',()=>{
  const media={id:'source',type:'audio',duration:30,hasAudio:true};
  for(const easing of ['linear','easeIn','easeOut','easeInOut']){
    const original=keyClip(easing), cropped=trimClip(original,{start:original.start+.613,end:original.start+3.117},media),split=splitClip(original,original.start+1.917,media);
    for(const retained of [cropped,...split])for(let i=0;i<=70;i++){
      const time=retained.start+retained.duration*i/70;
      assert.ok(Math.abs(audioGainMultiplierAt(retained,time)-independentGain(easing,time-original.start))<1e-10);
    }
    for(const patch of [{start:4},{speed:2},{speedSegments:[{sourceDuration:1,speed:2},{sourceDuration:3,speed:.5}]},{speedCurve:{sourceDuration:4,points:[{id:'s0',position:0,speed:.5},{id:'s1',position:1,speed:2}]}}]){
      const next=changeClipTiming(original,patch,media);
      for(let i=0;i<=40;i++)assert.ok(Math.abs(audioGainMultiplierAt(next,next.start+next.duration*i/40)-independentGain(easing,original.duration*i/40))<1e-10);
    }
    const plan=audioGainPlan(original);
    for(const piece of plan)for(let i=0;i<=20;i++){
      const u=i/20,c=piece.coefficients,expected=independentGain(easing,piece.start+(piece.end-piece.start)*u);
      assert.ok(Math.abs(c[0]+u*(c[1]+u*(c[2]+u*c[3]))-expected)<1e-10);
    }
  }
  const source={...keyClip(),track:'video',layer:3,pan:-.5,audioEffects:{echo:{enabled:true,delay:.2,decay:.4}}};
  const detached=detachClipAudio({...newProject(),media:[media],clips:[source]},source.id,'detached',2).clips[1];
  assert.equal(detached.layer,2);assert.equal(detached.pan,-.5);assert.deepEqual(detached.audioGainKeys,source.audioGainKeys);assert.notEqual(detached.audioGainKeys,source.audioGainKeys);
  let keyed={...keyClip(),audioGainKeys:[]};keyed=upsertAudioGainKey(keyed,keyed.start+.3,.6,'easeOut');
  const current=audioGainKeyNavigation(keyed,keyed.start+.3).current;assert.equal(current.gain,.6);assert.equal(audioGainKeyframes(keyed).length,1);
  keyed=setAudioGainKeyEasing(keyed,current.id,'easeIn');assert.equal(audioGainKeyProgressAt(audioGainKeyframes(keyed)[0],.5),.25);
  assert.equal(audioGainMultiplierAt(removeAudioGainKey(keyed,current.id),keyed.start+.3),1);
  assert.deepEqual(clipAudioPanGains({pan:-.5}),{left:1,right:.5});
  const dense={...keyClip(),audioGainKeys:Array.from({length:128},(_,i)=>({id:'dense'+i,time:.1+3.8*i/127,gain:1,easing:'linear',phase:[0,1]}))};
  assert.deepEqual(trimClip(dense,{},media).audioGainKeys,dense.audioGainKeys,'a no-op trim must not invent redundant boundary keys and exhaust the legal budget');
  // Legal saved phases may be very close to a stationary easing endpoint.
  // Subtracting two almost equal eased values must not destroy the envelope.
  for (const [easing,phase,formula] of [['easeOut',[1-1e-8,1],u=>2*u-u*u],['easeIn',[0,1e-200],u=>u*u]]) {
    const c={...keyClip(),start:0,duration:1,audioGainKeys:[{id:'a',time:0,gain:0,easing,phase},{id:'b',time:1,gain:1,easing:'linear',phase:[0,1]}]};
    const coefficients=audioGainPlan(c)[0].coefficients;
    for (const u of [.1,.25,.5,.75,1]) {
      assert.ok(Math.abs(audioGainMultiplierAt(c,u)-formula(u))<1e-10);
      assert.ok(Math.abs(coefficients[0]+u*(coefficients[1]+u*(coefficients[2]+u*coefficients[3]))-formula(u))<1e-10);
    }
  }
});

test('public save/reopen keeps four lanes and overlaps; malformed DSP/keys and total129 keys cannot overwrite saved project',async t=>{
  const h=await fixture(t,['tone440']),m=h.byName.tone440;
  const legacy={...h.project,clips:[clip('old0',m),clip('old1',m,'audio',{start:.25})]};delete legacy.audioLanes;
  const raw=Buffer.from(JSON.stringify(legacy));await fs.writeFile(path.join(h.runtime.store.dirs.projects,legacy.id+'.json'),raw);
  const read=await(await fetch(h.origin+'/api/projects/'+legacy.id)).json();assert.equal(read.project.audioLanes.length,4);
  assert.deepEqual(await fs.readFile(path.join(h.runtime.store.dirs.projects,legacy.id+'.json')),raw);
  const valid={...h.project,clips:[clip('lane0',m),clip('lane3',m,'audio',{layer:3,pan:.4,audioGainKeys:keyClip().audioGainKeys,audioEffects:{highpass:{enabled:true,frequency:80},echo:{enabled:true,delay:.3,decay:.4}}})]};valid.audioLanes[3].solo=true;
  const saved=await h.post('/api/projects',valid);assert.equal(saved.status,200,JSON.stringify(saved.body));const bytes=await fs.readFile(path.join(h.runtime.store.dirs.projects,valid.id+'.json'));
  const reread=(await(await fetch(h.origin+'/api/projects/'+valid.id)).json()).project;assert.equal(reread.clips[1].pan,.4);assert.equal(reread.audioLanes[3].solo,true);assert.deepEqual(reread.clips[1].audioGainKeys,valid.clips[1].audioGainKeys);
  const invalid=[];
  for(const value of [null,[],[{muted:false,solo:false}],Array.from({length:4},()=>({muted:null,solo:false}))])invalid.push({...valid,audioLanes:value});
  for(const patch of [{layer:4},{layer:.5},{pan:NaN},{pan:1.01},{audioGainKeys:null},{audioGainKeys:[{id:'bad',time:1,gain:-.01}]},{audioGainKeys:[{id:'bad',time:1,gain:1,easing:'wrong'}]},{audioGainKeys:[{id:'bad',time:1,gain:1,phase:[1,0]}]},{audioEffects:null},{audioEffects:{highpass:null}},{audioEffects:{highpass:{frequency:null}}},{audioEffects:{lowpass:{frequency:20001}}},{audioEffects:{echo:{delay:.009}}},{audioEffects:{echo:{decay:.81}}}])invalid.push({...valid,clips:[{...valid.clips[0],...patch},valid.clips[1]]});
  const many=Array.from({length:128},(_,i)=>({id:'g'+i,time:i*4/127,gain:1,easing:'linear',phase:[0,1]}));
  invalid.push({...valid,clips:[{...valid.clips[0],audioGainKeys:many},{...valid.clips[1],audioGainKeys:[{id:'one',time:0,gain:1}]}]});
  for(const bad of invalid){const reply=await h.post('/api/projects',bad);assert.equal(reply.status,400,JSON.stringify(reply));assert.deepEqual(await fs.readFile(path.join(h.runtime.store.dirs.projects,valid.id+'.json')),bytes);}
  assert.equal((await h.post('/api/audio-previews',{project:invalid.at(-1)})).status,400);
  assert.equal(MAX_AUDIO_GAIN_KEYS,128);await h.runtime.queue.close();assert.deepEqual(await fs.readdir(h.runtime.store.dirs.work),[]);
});

test('real WAV and AAC mixes isolate four lane tones, multiple solos, muted solo and video original sound',async t=>{
  const names=['video','tone440','tone660','tone880','tone1100'],h=await fixture(t,names),p={...h.project,clips:[clip('video',h.byName.video,'video'),...names.slice(1).map((name,i)=>clip('lane'+i,h.byName[name],'audio',{layer:i,volume:.5}))]};
  const inspect=async(project,expected,video=false)=>{
    const data=await decode(await h.finish(project,video));
    for(const hz of [220,440,660,880,1100]){const value=amplitude(data,hz,1.5);if(expected.includes(hz))assert.ok(value>.009,`${hz} audible ${value}`);else assert.ok(value<.001,`${hz} muted ${value}`);}
  };
  await inspect(p,[220,440,660,880,1100]);
  const mute=structuredClone(p);mute.audioLanes[1].muted=true;await inspect(mute,[220,440,880,1100]);
  const solo=structuredClone(p);solo.audioLanes[2].solo=true;await inspect(solo,[880]);await inspect(solo,[880],true);
  solo.audioLanes[3].solo=true;await inspect(solo,[880,1100]);solo.audioLanes[2].muted=true;await inspect(solo,[1100]);solo.audioLanes[3].muted=true;await inspect(solo,[]);
});

test('shared per-sample gain producer preserves all four retained easing phases without frame quantization',()=>{
  for(const easing of ['linear','easeIn','easeOut','easeInOut']){
    const original=keyClip(easing),retained=trimClip(original,{start:original.start+.613,end:original.start+3.117},{duration:6,type:'audio'});
    for(const c of [original,retained]){
      const plan=compileAudioPlan({fps:30,media:[{id:'source',hasAudio:true}],clips:[c],subtitles:[]}),dsp=createAudioDSP(plan),range=clipAudioSampleRange(c);let maximum=0;
      for(let first=0;first<plan.outputFrames;first+=4096){
        const frames=Math.min(4096,plan.outputFrames-first),input=new Float32Array(frames*2);
        for(let n=0;n<frames;n++)if(first+n>=range.first&&first+n<range.end)input[n*2]=input[n*2+1]=.05;
        const raw=dsp.process({sound:input},frames);
        for(let n=0;n<frames;n+=13){const global=first+n-239;if(global<range.first||global>=range.end)continue;const local=(global-range.first)/RATE+range.offset,expected=.05*.5*independentGain(easing,c.start-original.start+local)/.95;maximum=Math.max(maximum,Math.abs(raw[n*2]-expected));}
      }
      assert.ok(maximum<.00008,JSON.stringify({easing,maximum}));
    }
  }
});

test('actual fractional audio splits assign each global sample once while preserving the gain envelope',async t=>{
  const h=await fixture(t,['dc']),base={...keyClip(),mediaId:h.byName.dc.id};
  const whole=await decode(await h.finish({...h.project,clips:[base]}));
  for(const local of [(43824+.55)/48000,(43824+.95)/48000]){
    const parts=splitClip(base,base.start+local,h.byName.dc),output=await decode(await h.finish({...h.project,clips:parts}));
    const ranges=parts.map(c=>clipAudioSampleRange(c)),fullRange=clipAudioSampleRange(base);
    assert.equal(ranges[0].end,ranges[1].first);assert.equal(ranges[0].count+ranges[1].count,fullRange.count);
    assert.equal(output.length,whole.length);let maximum=0,index=0;
    for(let n=Math.ceil((base.start+.02)*RATE);n<Math.floor((base.start+base.duration-.02)*RATE);n++){const error=Math.abs(sample(output,n)-sample(whole,n));if(error>maximum){maximum=error;index=n;}}
    if(maximum>=.00008)t.diagnostic(JSON.stringify({cut:Math.ceil((base.start+local)*RATE),index,window:Array.from({length:7},(_,i)=>({n:index+i-3,whole:sample(whole,index+i-3),split:sample(output,index+i-3)}))}));
    assert.ok(maximum<.00008,JSON.stringify({local,maximum}));
  }
});

test('actual stereo balance has defined channel ratios and generated WAV/AAC apply base times gain automation and fades',async t=>{
  const h=await fixture(t,['stereo','video']),m=h.byName.stereo;
  for(const pan of [-1,-.5,0,.5,1]){
    const c=clip('balance',m,'audio',{pan}),data=await decode(await h.finish({...h.project,clips:[c]})),left=amplitude(data,440,1.5,0),right=amplitude(data,660,1.5,1);
    const expectedL=.04/.95*(pan>0?1-pan:1),expectedR=.02/.95*(pan<0?1+pan:1);
    for(const [actual,expected] of [[left,expectedL],[right,expectedR]])assert.ok(expected===0?actual<.001:Math.abs(actual/expected-1)<.02,JSON.stringify({pan,left,right,expectedL,expectedR}));
  }
  const four=await decode(await h.finish({...h.project,clips:[clip('maximum',m,'audio',{volume:2,audioGainKeys:[{id:'g',time:0,gain:2}]})]}));
  assert.ok(Math.abs(amplitude(four,440,1.5)/(.04*4/.95)-1)<.02,'offline base2 times key2 is gain4, not the HTML volume cap');
  const c=clip('automated',m,'audio',{start:.137019,volume:.5,pan:.5,fadeIn:.4,fadeOut:.4,audioGainKeys:[{id:'a',time:0,gain:.5,easing:'easeIn',phase:[0,1]},{id:'b',time:4,gain:1.5,easing:'linear',phase:[0,1]}]});
  const p={...h.project,clips:[clip('picture',h.byName.video,'video',{audioDetached:true}),c]},wave=await decode(await h.finish(p)),movie=await decode(await h.finish(p,true));
  for(const local of [.2,1,2,3,3.8]){
    // Independent zero-key calibration of the unchanged FFmpeg4.4 limiter
    // measured239 samples (5ms attack buffer minus one), retained in artifacts.
    const delay=239/48000,at=c.start+local+delay,fade=Math.min(1,local/.4,(4-local)/.4),expected=.04*.5*.5*(.5+(local/4)**2)*fade/.95;
    const a=amplitude(wave,440,at,0,.02),b=amplitude(movie,440,at,0,.02);
    // 20ms is not an integer number of440Hz cycles; use a matching sine window
    // normalization measured from the independent raw oscillator at this phase.
    const first=Math.round((at-.01)*RATE),count=Math.round(.02*RATE);let re=0,im=0;
    for(let n=0;n<count;n++){const phase=2*Math.PI*440*(first+n-Math.ceil(c.start*RATE)-239)/RATE,x=Math.sin(phase),angle=2*Math.PI*440*n/RATE;re+=x*Math.cos(angle);im+=x*Math.sin(angle);}
    const factor=2*Math.hypot(re,im)/count;
    assert.ok(Math.abs(a/(expected*factor)-1)<.02,JSON.stringify({local,a,expected,factor}));
    assert.ok(Math.abs(b/a-1)<.05,JSON.stringify({local,a,b}));
  }
});

test('constant, stepped and smooth-curve source clocks apply the same gain automation after speed processing',async t=>{
  const h=await fixture(t,['tone440']),m=h.byName.tone440,original=clip('clock',m,'audio',{volume:.5,audioGainKeys:[{id:'a',time:0,gain:.5,easing:'easeInOut',phase:[0,1]},{id:'b',time:4,gain:1.5,easing:'linear',phase:[0,1]}]});
  for(const patch of [{speed:2},{speedSegments:[{sourceDuration:2,speed:2},{sourceDuration:2,speed:.5}]},{speedCurve:{sourceDuration:4,points:[{id:'a',position:0,speed:.5},{id:'b',position:1,speed:2}]}}]){
    const c=changeClipTiming(original,patch,m),plain=await decode(await h.finish({...h.project,clips:[{...c,audioGainKeys:[]}]})),automated=await decode(await h.finish({...h.project,clips:[c]}));
    for(const u of [.25,.5,.75]){
      const time=c.duration*u+239/48000,actual=amplitude(automated,440,time)/amplitude(plain,440,time),expected=.5+3*u*u-2*u*u*u;
      assert.ok(Math.abs(actual/expected-1)<.02,JSON.stringify({patch,u,actual,expected}));
    }
  }
});

test('highpass/lowpass have numeric stopbands and single-tap echo has exact impulse delay, decay and clip-tail cutoff',async t=>{
  const h=await fixture(t,['multi','impulse']),m=h.byName.multi;
  const base=clip('eq',m),plain=await decode(await h.finish({...h.project,clips:[base]}));
  const hp=await decode(await h.finish({...h.project,clips:[{...base,audioEffects:{highpass:{enabled:true,frequency:2000}}}]}));
  const lp=await decode(await h.finish({...h.project,clips:[{...base,audioEffects:{lowpass:{enabled:true,frequency:1000}}}]}));
  assert.ok(amplitude(hp,220,1.5)/amplitude(plain,220,1.5)<.05);assert.ok(amplitude(hp,8800,1.5)/amplitude(plain,8800,1.5)>.95);
  assert.ok(amplitude(lp,8800,1.5)/amplitude(plain,8800,1.5)<.05);assert.ok(amplitude(lp,220,1.5)/amplitude(plain,220,1.5)>.95);
  const c=clip('echo',h.byName.impulse,'audio',{duration:.7,audioEffects:{echo:{enabled:true,delay:.3,decay:.5}}});
  const data=await decode(await h.finish({...h.project,clips:[c]}));
  const peaks=[];for(let n=0;n<data.length/8;n++)if(Math.abs(sample(data,n))>.02)peaks.push(n);
  assert.equal(peaks.length,2);assert.ok(Math.abs(peaks[1]-peaks[0]-.3*RATE)<=1);assert.ok(Math.abs(sample(data,peaks[1])/sample(data,peaks[0])-.5)<.005);
  const tail={...c,duration:.4},cut=await decode(await h.finish({...h.project,clips:[tail]}));
  assert.equal(cut.length/8,.4*RATE);assert.equal(Array.from({length:cut.length/8},(_,n)=>sample(cut,n)).filter(x=>Math.abs(x)>.02).length,1);
});

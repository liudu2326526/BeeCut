import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { ffmpegPath } from '../server/process.mjs';
import { newProject, clipTiming, changeClipTiming, sourceTimeAt, sourceRateAt, timelineTimeAtSource, splitClip, trimClip, speedCurveSamples, speedCurvePointBounds, updateSpeedCurvePoint, createSpeedCurve, decodeInputCount, curveRenderKnots, transformAt, animationAlphaAt, curveAudioPlan, speedCurveMaxSourceSlope } from '../shared/model.mjs';
const exec = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by ${Math.abs(a-b)} > ${tolerance}`);
const point = (position, speed, id) => ({ id: id ?? `p${String(position).replace('.', '_')}`, position, speed, phase: [0, 1] });
// Independent Simpson source-domain clock. No owner integration or inverse
// routines are used to compute this reference table.
function oracle(curve) {
  const rate = u => {
    const points = curve.points;
    if (u <= 0) return points[0].speed;
    if (u >= 1) return points.at(-1).speed;
    const i = points.findIndex((p, i) => i + 1 < points.length && u < points[i + 1].position);
    const a = points[i], b = points[i + 1], q = (u-a.position)/(b.position-a.position), [lo,hi] = a.phase ?? [0,1];
    const e = x => x*x*(3-2*x), z = (e(lo+(hi-lo)*q)-e(lo))/(e(hi)-e(lo));
    return a.speed+(b.speed-a.speed)*z;
  };
  const count=10000, times=[0];
  for(let i=0;i<count;i++) {const a=i/count,b=(i+1)/count;times.push(times.at(-1)+curve.sourceDuration/count/6*(1/rate(a)+4/rate((a+b)/2)+1/rate(b)));}
  const timeAt = u => {const v=Math.max(0,Math.min(count,u*count)),i=Math.min(count-1,Math.floor(v));return times[i]+(times[i+1]-times[i])*(v-i);};
  const sourceAt = t => {let lo=0,hi=count;while(hi-lo>1){const m=(lo+hi)>>>1;if(times[m]<=t)lo=m;else hi=m;}return curve.sourceDuration/count*(lo+Math.max(0,Math.min(1,(t-times[lo])/(times[hi]-times[lo]))));};
  return {rate,timeAt,sourceAt,duration:times.at(-1)};
}

test('smooth source speeds integrate invertibly and retain exact clipped subcurves, source edits and independent eased poses', () => {
  const base={id:'curve',start:2,sourceStart:1,duration:4,speed:1,volume:1};
  const curves=[{sourceDuration:4,points:[point(0,.25),point(1,4)]},{sourceDuration:4,points:[point(0,4),point(1,.25)]},{sourceDuration:4,points:[point(0,1),point(.25,3),point(.5,.5),point(.75,3),point(1,1)]}];
  for(const curve of curves){
    const c=changeClipTiming(base,{speedCurve:curve},{duration:10}), reference=oracle(curve);
    near(c.duration,reference.duration,1e-7);assert.equal(clipTiming(c).mode,'curve');assert.equal(decodeInputCount(c),1);
    for(let i=0;i<=1000;i++){
      const s=1+4*i/1000,t=timelineTimeAtSource(c,s);
      near(t-2,reference.timeAt(i/1000),3e-7);near(sourceTimeAt(c,t),s,1e-8);near(sourceRateAt(c,t),reference.rate(i/1000),1e-8);
    }
    const cut=2+c.duration*.37,[left,right]=splitClip(c,cut,{duration:10});near(left.duration+right.duration,c.duration,1e-8);near(clipTiming(left).sourceEnd,right.sourceStart,1e-8);
    for(let i=0;i<=1000;i++){const t=2+c.duration*i/1000;near(sourceTimeAt(t<cut?left:right,t),sourceTimeAt(c,t),1e-8);near(sourceRateAt(t<cut?left:right,t),sourceRateAt(c,t),1e-7);}
    const trimmed=trimClip(c,{start:2+c.duration*.13,end:2+c.duration*.81},{duration:10});
    for(let i=0;i<=500;i++){const t=trimmed.start+trimmed.duration*i/500;near(sourceTimeAt(trimmed,t),sourceTimeAt(c,t),1e-8);}
    const samples=speedCurveSamples(c,51);assert.equal(samples.length,51);near(samples.at(-1).time,c.start+c.duration,1e-8);
    const bounds=speedCurvePointBounds(c,c.speedCurve.points[0].id);assert.equal(bounds.fixed,true);
    const regular=changeClipTiming(c,{speed:2},{duration:10});near(regular.duration,2);assert.equal(regular.speedCurve,undefined);
    const step=changeClipTiming(c,{speedSegments:[{sourceDuration:4,speed:2}]},{duration:10});near(step.duration,2);assert.equal(step.speedCurve,undefined);
    const knots=curveRenderKnots(curve);assert.ok(knots.sampledMaxTimeError<.0001);
    // Independently sample each exported Hermite interval, rather than accept
    // the producer's own error summary as proof.
    let max=0;
    for(let i=0;i+1<knots.points.length;i++)for(let j=0;j<=32;j++){
      const a=knots.points[i],b=knots.points[i+1],q=j/32,d=b.sourceOffset-a.sourceOffset;
      const A=3*(b.time-a.time)-d*(2/a.rate+1/b.rate),B=2*(a.time-b.time)+d*(1/a.rate+1/b.rate);
      const actual=a.time+q*(d/a.rate+q*(A+q*B));max=Math.max(max,Math.abs(actual-reference.timeAt(a.position+(b.position-a.position)*q)));
    }
    assert.ok(max<.0001,`forward timestamp approximation ${max}`);
  }
  assert.throws(()=>changeClipTiming({...base,duration:.04},{speedCurve:{sourceDuration:.04,points:[point(0,4),point(1,4)]}},{duration:10}),/短于0.04秒/);
  const valid=changeClipTiming(base,{speedCurve:{sourceDuration:4,points:[point(0,.25),point(1,4)]}},{duration:10});
  assert.throws(()=>changeClipTiming(valid,{sourceStart:9.999},{duration:10}),/剩余区间/);
  const tinySlow=changeClipTiming({...base,duration:.04},{speedCurve:{sourceDuration:.04,points:[point(0,.25),point(1,.25)]}},{duration:10});
  const minimum=trimClip(tinySlow,{end:tinySlow.start+.04},{duration:10});near(minimum.duration,.04);near(clipTiming(minimum).sourceDuration,.01);
  const c=createSpeedCurve(base,'montage',{duration:10});
  assert.throws(()=>updateSpeedCurvePoint(c,c.speedCurve.points[1].id,{position:.8,speed:5},{duration:10}),/变化过陡/);
  const moved=updateSpeedCurvePoint(c,c.speedCurve.points[1].id,{position:.3,speed:2},{duration:10});near(moved.speedCurve.points[1].position,.3);near(moved.speedCurve.points[1].speed,2);
  assert.throws(()=>changeClipTiming(base,{speedCurve:{sourceDuration:4,points:Array.from({length:128},(_,i)=>point(i/127,i%2?4:.25))}},{duration:10}),/变化过陡/);
  for(const easing of ['easeIn','easeOut']){
    const pose={...base,transformKeys:[{id:'a',time:0,easing,values:{scale:1,x:0,y:0,rotation:0,opacity:.2}},{id:'b',time:4,easing:'linear',values:{scale:.5,x:100,y:0,rotation:0,opacity:.8}}],animation:{in:1,out:0,inType:'fade',easing}};
    const [a,b]=splitClip(pose,3.3,{duration:10});for(let i=0;i<=400;i++){const t=2+i*.01;near(transformAt(t<b.start?a:b,t).opacity,transformAt(pose,t).opacity,1e-8);}
    near(animationAlphaAt(pose,2.5),easing==='easeIn'?.25:.75);
  }
});

async function setup(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'weijian-v06-'));const runtime=await createApp({dataDir:path.join(dir,'library')});const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await runtime.queue.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const make=args=>exec(ffmpegPath,['-hide_banner','-loglevel','error','-y',...args]);
  const importFile=async filename=>{const f=new FormData();f.append('files',new Blob([await readFile(filename)]),path.basename(filename));const r=await fetch(`${origin}/api/media`,{method:'POST',body:f});const b=await r.json();assert.equal(r.status,201,JSON.stringify(b));return b.media[0];};
  const save=async project=>{const r=await fetch(`${origin}/api/projects`,post(project)),b=await r.json();assert.equal(r.status,200,JSON.stringify(b));const loaded=await(await fetch(`${origin}/api/projects/${project.id}`)).json();assert.deepEqual(loaded.project,b.project);return b.project;};
  const render=async(project,fps=30)=>{const r=await fetch(`${origin}/api/exports`,post({project,settings:{width:320,height:180,fps}}));let job=await r.json();assert.equal(r.status,202,JSON.stringify(job));for(let i=0;i<3000&&!['completed','failed'].includes(job.status);i++){await pause(20);job=await(await fetch(`${origin}/api/exports/${job.id}`)).json();}assert.equal(job.status,'completed',JSON.stringify(job));const file=path.join(dir,`${job.id}.mp4`);await writeFile(file,Buffer.from(await(await fetch(`${origin}${job.url}`)).arrayBuffer()));return file;};
  return {dir,origin,make,importFile,save,render};
}
async function markerSource(h){
  const raw=path.join(h.dir,'barcode.rgb'),file=path.join(h.dir,'barcode.mp4'),fd=await open(raw,'w');
  for(let n=0;n<240;n++){
    const pixels=Buffer.alloc(320*180*3);const colors=[[230,30,30],[20,230,30],[20,50,230],[230,230,20]],color=colors[Math.floor(n/60)];
    for(let y=0;y<180;y++)for(let x=0;x<320;x++){const i=(y*320+x)*3;pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];}
    for(let bit=0;bit<8;bit++)for(let y=20;y<60;y++)for(let x=32+bit*32;x<64+bit*32;x++){const i=(y*320+x)*3;pixels[i]=pixels[i+1]=pixels[i+2]=(n&(1<<bit))?255:0;}
    await fd.write(pixels);
  }
  await fd.close();
  const args=['-f','rawvideo','-pixel_format','rgb24','-video_size','320x180','-framerate','60','-i',raw];for(const hz of [440,660,880,1100])args.push('-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=1`);
  args.push('-filter_complex','[1:a][2:a][3:a][4:a]concat=n=4:v=0:a=1[a]','-map','0:v:0','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file);await h.make(args);return h.importFile(file);
}

test('production API continuous clocks preserve source frame identities and voiced pitch for worst ramps, nonlinear nodes and split/trim', {timeout:180000},async t=>{
  const h=await setup(t),media=await markerSource(h);const base={id:'curve',mediaId:media.id,track:'video',start:0,sourceStart:0,duration:4,speed:1,volume:1};
  const cases=[['up',[point(0,.25),point(1,4)]],['down',[point(0,4),point(1,.25)]],['multi',[point(0,1),point(.25,3),point(.5,.5),point(.75,3),point(1,1)]],['shortup',[point(0,.25),point(1,4)]],['shortdown',[point(0,4),point(1,.25)]],['gentle128',Array.from({length:128},(_,i)=>point(i/127,i%2?1.01:.99,`g${i}`))],['critical',Array.from({length:6},(_,i)=>point(i/5,i%2?4:.25,`d${i}`))],['random',[point(0,.7),point(.125,1.5),point(.25,2.3),point(.375,1.2),point(.5,.8),point(.625,1.7),point(.75,2),point(.875,1.1),point(1,.7)]]];
  const diagnostics=[];
  for(const [name,points] of cases){
    const clip=changeClipTiming(base,{speedCurve:{sourceDuration:name==='critical'?3.515625:name.startsWith('short')?.703125:4,points} },media),expected=oracle(clip.speedCurve);
    const project=await h.save({...newProject(name),width:320,height:180,media:[media],clips:[clip]});
    for(const mutate of [p=>p.clips[0].speed=2,p=>p.clips[0].speedSegments=[{sourceDuration:4,speed:1}],p=>p.clips[0].speedCurve.points[0].position=.1,p=>p.clips[0].speedCurve.points[0].speed=0,p=>p.clips[0].duration+=.01,p=>p.clips[0].speedCurve.sourceDuration=.001]){const p=structuredClone(project);mutate(p);assert.equal((await fetch(`${h.origin}/api/projects`,post(p))).status,400);}
    const variants=name==='up'||name==='critical'?[['original',[clip]],['original24',[clip]],['original60',[clip]],['split',splitClip(clip,clip.duration*.37,media)],['trim',[trimClip(clip,{start:clip.duration*.13,end:clip.duration*.81},media)]]]:[['original',[clip]]];
    for(const [variant,clips] of variants){
      const fps=variant==='original24'?24:variant==='original60'?60:30;
      const file=await h.render({...project,id:crypto.randomUUID(),clips},fps);
      const rgb=(await exec(ffmpegPath,['-v','error','-i',file,'-map','0:v:0','-vsync','0','-pix_fmt','rgb24','-f','rawvideo','-'],{encoding:'buffer',maxBuffer:60*1024*1024})).stdout;
      const count=rgb.length/(320*180*3),total=Math.max(...clips.map(c=>c.start+c.duration));assert.equal(count,Math.ceil(total*fps-.00001));let maxSourceError=0,checked=0;
      for(let n=0;n<count;n++){
        const t=n/fps,active=clips.find(c=>t>=c.start-1e-9&&t<c.start+c.duration-1e-9);if(!active)continue;
        let frame=0;for(let bit=0;bit<8;bit++){const i=(n*320*180+40*320+48+bit*32)*3;if(rgb[i]+rgb[i+1]+rgb[i+2]>380)frame|=1<<bit;}
        const source=expected.sourceAt(t),error=Math.abs(frame/60-source);maxSourceError=Math.max(maxSourceError,error);checked++;
        assert.ok(error<=1/60+.0003,`${name}/${variant} frame${n} barcode${frame} source=${source} error=${error}`);
      }
      const pcm=(await exec(ffmpegPath,['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','-'],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout;
      const amplitude=(center,hz)=>{const length=960;let re=0,im=0;for(let i=0;i<length;i++){const at=Math.max(0,Math.min(pcm.length/4-1,Math.round(center*48000)-480+i)),v=pcm.readFloatLE(at*4),phase=2*Math.PI*hz*i/48000;re+=v*Math.cos(phase);im+=v*Math.sin(phase);}return 2*Math.hypot(re,im)/length;};
      const changes=[];let previous=440;for(let tick=2;tick<Math.floor(total*100)-2;tick++){const time=tick/100;if(variant==='trim'&&(time<clips[0].start+.05||time>clips[0].start+clips[0].duration-.05))continue;const tones=[440,660,880,1100].map(hz=>[hz,amplitude(time,hz)]).sort((a,b)=>b[1]-a[1]);if(tones[0][1]>.02&&tones[0][0]!==previous){changes.push({time,hz:tones[0][0]});previous=tones[0][0];}}
      if(variant.startsWith('original'))for(let i=1;i<4&&i<clip.speedCurve.sourceDuration;i++){const boundary=expected.timeAt(i/clip.speedCurve.sourceDuration),observed=changes.find(c=>c.hz===[440,660,880,1100][i]);assert.ok(observed,`${name} missing ${i} audio marker`);assert.ok(Math.abs(observed.time-boundary)<.1,`${name} audio marker${i}: ${observed.time} vs ${boundary}`);}
      let shortAudio;
      if(name.startsWith('short')){
        assert.ok(amplitude(clip.duration*.5,440)>.04,`${name} pitch preserved`);
        assert.ok(amplitude(clip.duration-.03,440)>.02,`${name} voiced tail retained`);
        const spectrum=[];for(let hz=380;hz<=500;hz++){const length=4800;let re=0,im=0;for(let i=0;i<length;i++){const at=Math.round(clip.duration*.5*48000)-length/2+i,v=pcm.readFloatLE(at*4);re+=v*Math.cos(2*Math.PI*hz*i/48000);im+=v*Math.sin(2*Math.PI*hz*i/48000);}spectrum.push({hz,amplitude:2*Math.hypot(re,im)/length});}
        const peak=spectrum.sort((a,b)=>b.amplitude-a.amplitude)[0];assert.ok(Math.abs(peak.hz-440)<=8,`${name} actual 100ms spectrum peak ${peak.hz}`);
        let maxSampleJump=0;for(let at=480;at<Math.min(pcm.length/4,Math.round(clip.duration*48000)-480);at++)maxSampleJump=Math.max(maxSampleJump,Math.abs(pcm.readFloatLE(at*4)-pcm.readFloatLE((at-1)*4)));
        assert.ok(maxSampleJump<.06,`${name} encoded sine internal PCM is bounded by the pre-frozen .06 standard: ${maxSampleJump}`);
        shortAudio={peak,midAmplitude:amplitude(clip.duration*.5,440),tailAmplitude:amplitude(clip.duration-.03,440),maxSampleJump,plan:curveAudioPlan(clip.speedCurve)};
      }
      diagnostics.push({name,variant,shortAudio,frames:count,checked,maxSourceError,expectedAudioMarkers:[1,2,3].map(source=>expected.timeAt(source/clip.speedCurve.sourceDuration)),observedAudioMarkers:changes});
    }
  }
  t.diagnostic(JSON.stringify(diagnostics));
});

test('fractional source seeks, non-grid splits and adjacent picture ownership retain each sampled barcode at all output clocks', {timeout:120000},async t=>{
  const h=await setup(t),media=await markerSource(h),stats=[];
  for(const mode of ['constant','segments']){
    const first={id:'first',mediaId:media.id,track:'video',start:.007,sourceStart:.125,duration:1.201,speed:1.3,volume:0};
    if(mode==='segments'){first.speed=1;first.speedSegments=[{sourceDuration:.6,speed:1.3},{sourceDuration:.9,speed:.75}];first.duration=.6/1.3+.9/.75;}
    const end=first.start+first.duration,sourceEnd=mode==='constant'?.125+first.duration*1.3:1.625;
    const after={...first,id:'after',start:end,sourceStart:sourceEnd,duration:.5,speed:1.4,speedSegments:[]};
    const sourceAt=time=>{if(time>=end)return sourceEnd+(time-end)*1.4;const local=time-.007;return mode==='constant'?.125+local*1.3:local<.6/1.3?.125+local*1.3:.725+(local-.6/1.3)*.75;};
    for(const split of [false,true])for(const fps of [24,29.97,30,60]){
      const clips=[...(split?splitClip(first,.628,media):[first]),after],project={...newProject('fractional clock'),width:320,height:180,media:[media],clips};
      const file=await h.render(await h.save(project),fps),rgb=(await exec(ffmpegPath,['-v','error','-i',file,'-vsync','0','-pix_fmt','rgb24','-f','rawvideo','-'],{encoding:'buffer',maxBuffer:40*1024*1024})).stdout;
      const count=rgb.length/(320*180*3);let maximum=0,checked=0;assert.equal(count,Math.ceil((end+.5)*fps-.00001));
      for(let n=0;n<count;n++){const time=n/fps;if(time<.007||time>=end+.5)continue;let frame=0;for(let bit=0;bit<8;bit++){const at=(n*320*180+40*320+48+bit*32)*3;if(rgb[at]+rgb[at+1]+rgb[at+2]>380)frame|=1<<bit;}const expected=sourceAt(time),error=Math.abs(frame/60-expected);maximum=Math.max(maximum,error);checked++;assert.ok(error<=1/60+.0003,`${mode}/split=${split}/${fps} n${n} source${expected} barcode${frame} error${error}`);}
      stats.push({mode,split,fps,frames:count,checked,maxSourceError:maximum});
    }
  }
  t.diagnostic(JSON.stringify(stats));
});

test('quadratic key and animation easing exports independent actual alpha and geometry through split and retained phases', {timeout:120000},async t=>{
  const h=await setup(t),files=['blue','lime'].map(c=>path.join(h.dir,`${c}.png`));for(let i=0;i<files.length;i++)await h.make(['-f','lavfi','-i',`color=${['blue','lime'][i]}:s=320x180`,'-frames:v','1',files[i]]);
  const media=await Promise.all(files.map(f=>h.importFile(f))),stats=[];
  for(const easing of ['easeIn','easeOut']){
    const ease=u=>easing==='easeIn'?u*u:1-(1-u)*(1-u),base={id:'base',mediaId:media[1].id,track:'video',start:0,sourceStart:0,duration:2,speed:1,volume:0};
    const moving={...base,id:'moving',mediaId:media[0].id,layer:1,transformKeys:[{id:'a',time:0,easing,values:{scale:.5,x:0,y:0,rotation:0,opacity:.2}},{id:'b',time:2,easing:'linear',values:{scale:.25,x:40,y:0,rotation:0,opacity:.8}}],animation:{in:1,out:0,inType:'fade',easing}};
    for(const [variant,pieces] of [['original',[moving]],['split',splitClip(moving,1.3,media[0])],['trim',[trimClip(moving,{start:1.1,end:1.8},media[0])]]]){
      const project=await h.save({...newProject('quadratic ease'),width:320,height:180,media,clips:[base,...pieces]}),file=await h.render(project),rgb=(await exec(ffmpegPath,['-v','error','-i',file,'-vsync','0','-pix_fmt','rgb24','-f','rawvideo','-'],{encoding:'buffer',maxBuffer:20*1024*1024})).stdout;
      const pixel=(n,x,y)=>[...rgb.subarray((n*320*180+y*320+x)*3,(n*320*180+y*320+x)*3+3)];let maxAlphaError=0;
      for(let n=1;n<60;n++){const time=n/30;if(variant==='trim'&&(time<1.1||time>=1.8))continue;const p=ease(time/2),alpha=(.2+.6*p)*(time<1?ease(time):1),center=160+40*p,scale=.5-.25*p,at=pixel(n,Math.round(center),90),error=Math.abs(at[2]-255*alpha);maxAlphaError=Math.max(maxAlphaError,error);assert.ok(error<12,`${easing}/${variant}/n${n} independent alpha ${alpha} got ${at}`);if(alpha>.15){const xs=[];for(let x=0;x<320;x++)if(pixel(n,x,90)[2]>255*alpha*.5)xs.push(x);near((Math.min(...xs)+Math.max(...xs))/2,center,3);near(Math.max(...xs)-Math.min(...xs)+1,320*scale,5);}}
      stats.push({easing,variant,maxAlphaError});
    }
  }
  t.diagnostic(JSON.stringify(stats));
});


test('curve support limits reject excessive points and above-envelope rates while accepting long continuous audio', async t=>{
  const h=await setup(t),media=await markerSource(h),base={id:'a',mediaId:media.id,track:'video',start:0,sourceStart:0,duration:4,speed:1,volume:1};
  const clip=changeClipTiming(base,{speedCurve:{sourceDuration:4,points:[point(0,.25),point(1,4)]}},media),project=await h.save({...newProject('capacity'),media:[media],clips:[clip]});
  const long={...project,id:crypto.randomUUID(),clips:Array.from({length:10},(_,i)=>({...clip,id:`block${i}`,start:i*clip.duration}))};
  const response=await fetch(`${h.origin}/api/projects`,post(long));assert.equal(response.status,200,JSON.stringify(await response.json()));
  const gentle=changeClipTiming(base,{speedCurve:{sourceDuration:4,points:Array.from({length:128},(_,i)=>point(i/127,i%2?1.01:.99,`g${i}`))}},media);
  const tooMany={...project,id:crypto.randomUUID(),clips:[gentle,{...clip,id:'extra',start:gentle.duration}]};const nodes=await fetch(`${h.origin}/api/projects`,post(tooMany));assert.equal(nodes.status,400);assert.match(JSON.stringify(await nodes.json()),/节点总数/);
  for(const factor of[1,1.001,.999]){const curve={sourceDuration:.703125*factor,points:[point(0,.25),point(1,4)]};near(speedCurveMaxSourceSlope(curve),8/factor,1e-10);if(factor<1){assert.throws(()=>changeClipTiming(base,{speedCurve:curve},media),/变化过陡/);const bad={...project,clips:[{...clip,speedCurve:curve,duration:oracle(curve).duration}]};const r=await fetch(`${h.origin}/api/projects`,post(bad));assert.equal(r.status,400);assert.match(JSON.stringify(await r.json()),/变化过陡/);}else{const legal=changeClipTiming(base,{speedCurve:curve},media);await h.save({...project,id:crypto.randomUUID(),clips:[legal]});}}
  const phased={sourceDuration:2,points:[{...point(0,1),phase:[.3,.8]},point(1,3)]},e=u=>u*u*(3-2*u);near(speedCurveMaxSourceSlope(phased),2*.5*1.5/(e(.8)-e(.3))/2,1e-12);
});

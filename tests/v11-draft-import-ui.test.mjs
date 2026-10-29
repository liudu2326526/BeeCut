import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import electronPath from 'electron';

const exec = promisify(execFile);
const renderer = String.raw`
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JianyingDraftImport} from './src/JianyingDraftImport.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify({a,b}));
const reports = [];
const base = (patch = {}) => ({id:'session-1',status:'ready',canCommit:true,profile:{format:'jianying-json',version:360000,applicationVersion:'5.9.0',supported:true},summary:{materials:1,clips:1,subtitles:1},materials:[{sourceId:'source-a',name:'自制片段.mp4',sourcePath:'materials/自制片段.mp4',status:'ready'}],mappings:[{sourcePath:'/tracks/0/segments/0/target_timerange/start',sourceValue:1234567,targetPath:'/clips/0/start',targetValue:1.234567,rule:'整数微秒 ÷ 1,000,000；不按帧取整',loss:'小数秒以 IEEE754 保存'}],issues:[],...patch});
let root;
async function mount(props) {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '<button id="previous">原编辑器焦点</button><div id="root"></div>';
  document.querySelector('#previous').focus();
  root = createRoot(document.querySelector('#root'));
  await act(async () => {root.render(React.createElement(JianyingDraftImport, props)); await wait(1);});
}
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === name || node.getAttribute('aria-label') === name);
async function click(name) {
  const node = button(name); check(node, 'missing button ' + name);
  await act(async () => {node.click(); await wait(3);});
}
async function advance(ms = 10) { await act(async () => {await wait(ms);}); }
async function scenario(name, run) { await run(); reports.push({name,passed:true}); }
const normalBridge = {chooseJianyingDraft: async () => ({grantId:'folder-grant',directory:'/chosen/draft'}),chooseJianyingMedia:async () => ({grantId:'media-grant',path:'/chosen/exact.mp4'})};

window.testResult = (async () => {
await scenario('scoped grant scan, explicit warning acknowledgement, save guard and completed project callback', async () => {
  const calls = []; let saved = false, imported = null;
  await mount({bridge:normalBridge,onClose:()=>{},onBeforeCommit:async()=>{calls.push('save');return saved;},onImported:p=>{calls.push('opened');imported=p;},call:async (url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/commit')) return base({status:'completed',project:{id:'new-project',importReportId:'session-1'}});
    return base({issues:[{severity:'warning',code:'STYLE_LOSS',message:'字体样式转为可编辑纯文本'}]});
  }});
  check(document.body.textContent.includes('明文 360000 结构') && document.body.textContent.includes('新版私有格式可能无法导入'),'entry discloses limited readable profile before choosing any draft');
  await click('选择草稿文件夹');
  check(button('导入为新工程').disabled, 'warnings must require acknowledgement');
  check(document.body.textContent.includes('应用版本 5.9.0') && document.body.textContent.includes('草稿结构 360000'), 'application/schema versions must remain separate');
  check(document.body.textContent.includes('1234567') && document.body.textContent.includes('1.234567'), 'both mapping values must render');
  await act(async()=>document.querySelector('[aria-label="确认兼容与损失说明"]').click());
  await click('导入为新工程');
  check(document.querySelector('[role="alert"]').textContent.includes('当前工程尚未保存'), 'save error visible');
  check(!calls.some(c=>c.url?.endsWith('/commit')), 'failed save must not start commit');
  saved = true; await click('导入为新工程');
  equal(imported,{id:'new-project',importReportId:'session-1'},'only committed saved project opens');
  equal(JSON.parse(calls.find(c=>c.url === '/api/jianying/imports').options.body),{grantId:'folder-grant'},'scan sends grant only');
  equal(JSON.parse(calls.find(c=>c.url?.endsWith('/commit')).options.body),{acknowledgeWarnings:true},'ack forwarded');
  check(calls.indexOf('opened') > calls.lastIndexOf('save'), 'save guard precedes replacement');
});
await scenario('missing media require exact source grant; relink refresh clears acknowledgement', async()=>{
  let selection, body;
  const blocked = base({status:'blocked',canCommit:false,materials:[{sourceId:'source-a',name:'相同名称.mp4',sourcePath:'/old/a.mp4',status:'needs-relink'}],issues:[{severity:'error',code:'MISSING',message:'需选择原素材'}]});
  await mount({bridge:{...normalBridge,chooseJianyingMedia:async p=>{selection=p;return {grantId:'exact-grant',path:'/new/a.mp4'};}},onClose:()=>{},call:async(url,options)=>{
    if(url.endsWith('/relink')) {body=JSON.parse(options.body);return base({issues:[{severity:'warning',code:'IDENTITY_UNVERIFIED',message:'来源无摘要，用户选择身份未证实'}]});}
    return blocked;
  }});
  await click('选择草稿文件夹'); check(button('导入为新工程').disabled,'missing source blocks');
  await click('定位 相同名称.mp4');
  equal(selection,{sessionId:'session-1',sourceId:'source-a'},'native selection binds source and session');
  equal(body,{sourceId:'source-a',grantId:'exact-grant'},'renderer never forwards filesystem path');
  check(button('导入为新工程').disabled,'new identity warning requires new acknowledgement');
  check(!document.querySelector('[aria-label="确认兼容与损失说明"]').checked,'acknowledgement reset');
});
await scenario('multi timeline selection uses selected identity; unsupported opaque draft has no commit control and text stays inert', async()=>{
  let selected;
  await mount({bridge:normalBridge,onClose:()=>{},call:async(url,options)=>{
    if(url.endsWith('/timeline')) {selected=JSON.parse(options.body);return base({selectedTimelineId:'time-b',timelines:[{id:'time-a',name:'时间线一'},{id:'time-b',name:'时间线二'}]});}
    return base({status:'needs-timeline',canCommit:false,selectedTimelineId:null,timelines:[{id:'time-a',name:'时间线一'},{id:'time-b',name:'时间线二'}]});
  }});
  await click('选择草稿文件夹'); check(button('导入为新工程').disabled,'timeline not auto selected');
  await act(async()=>{const select=document.querySelector('select');select.value='time-b';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(3);});
  equal(selected,{timelineId:'time-b'},'explicit selected timeline sent');
  check(!button('导入为新工程').disabled,'supported chosen timeline ready');
  await mount({bridge:normalBridge,onClose:()=>{},call:async()=>base({status:'unsupported',canCommit:false,profile:{format:'opaque',version:null,applicationVersion:'11.0.0',supported:false},issues:[{severity:'error',code:'OPAQUE_CONTENT',message:'<img id="injected"> 当前版本草稿不是可识别 JSON'}]})});
  await click('选择草稿文件夹');
  check(!button('导入为新工程'),'unsupported has no commit button');
  check(document.body.textContent.includes('当前版本草稿不是可识别 JSON') && !document.querySelector('#injected'),'draft strings render as inert text');
});
await scenario('cancel during unresolved scan awaits owned session cleanup; cleanup failure keeps session retryable',async()=>{
  let scanResolve, cleanupResolve, closed=0, deletes=0;
  const pending = new Promise(resolve=>{scanResolve=resolve;});
  await mount({bridge:normalBridge,onClose:()=>closed++,call:async(url,options)=>{
    if(options?.method==='DELETE') {deletes++;if(deletes===1)throw new Error('暂时无法清理');return new Promise(resolve=>cleanupResolve=resolve);}
    return pending;
  }});
  await click('选择草稿文件夹'); await click('取消');
  equal(closed,0,'unresolved scan keeps dialog until session returned');
  await act(async()=>{scanResolve(base());await wait(3);});
  check(document.querySelector('[role="alert"]').textContent.includes('取消未完成'),'cleanup failure visible');
  check(button('导入为新工程').disabled && button('重新选择').disabled,'failed cleanup retains ownership and blocks new work');
  equal(closed,0,'failed cleanup cannot close');
  await click('取消'); equal(deletes,2,'retained session supports cleanup retry');
  equal(closed,0,'await cleanup before close');
  await act(async()=>{cleanupResolve({status:'cancelled'});await wait(3);});
  equal(closed,1,'close after successful cleanup');
});
await scenario('asynchronous scan and copy poll to completion once; Escape stops background editor shortcuts',async()=>{
  let phase='scan', polls=0, imported=0, backgroundKeys=0;
  const background = ()=>backgroundKeys++;
  window.addEventListener('keydown',background);
  await mount({bridge:normalBridge,onClose:()=>{},onBeforeCommit:async()=>true,onImported:()=>imported++,call:async(url,options)=>{
    if(url.endsWith('/commit')) {phase='commit';return base({status:'importing',canCommit:false,progress:{phase:'copy',completed:1,total:2}});}
    if(url==='/api/jianying/imports')return base({status:'scanning',canCommit:false});
    polls++;return phase==='scan'?base():base({status:'completed',project:{id:'async-project'}});
  }});
  await click('选择草稿文件夹'); check(button('导入为新工程').disabled,'scanning cannot commit');
  await advance(380); check(!button('导入为新工程').disabled,'scan polling reaches ready');
  await act(async()=>document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true})));
  equal(backgroundKeys,0,'modal shortcuts do not reach editor');
  await click('导入为新工程'); check(button('导入为新工程').disabled,'copy cannot duplicate commit');
  await advance(380);equal(imported,1,'async committed project opens exactly once');
  check(polls>=2,'both scan and copy observed via GET');
  window.removeEventListener('keydown',background);
});
await scenario('saved report is read only and close never cancels the prior import',async()=>{
  const calls=[];let closed=0;
  await mount({reportId:'persisted-id',onClose:()=>closed++,call:async(url,options)=>{calls.push({url,options});return base({status:'completed'});}});
  await advance();
  equal(calls.map(c=>c.url),['/api/jianying/reports/persisted-id'],'saved report endpoint');
  check(!button('选择草稿文件夹') && !button('导入为新工程'),'report has no filesystem mutation controls');
  await click('关闭');equal(closed,1,'saved report closes');
  equal(calls.length,1,'saved report close never DELETEs persisted session');
});
await scenario('large reports render bounded pages while downloaded report retains every mapping and issue',async()=>{
  const mappings=Array.from({length:120},(_,i)=>({sourcePath:'/source/'+i,sourceValue:i,targetPath:'/target/'+i,targetValue:i,rule:'保留'}));
  const issues=Array.from({length:120},(_,i)=>({severity:'warning',code:'UNKNOWN_'+i,message:'未知字段 '+i}));
  let downloaded;
  await mount({bridge:normalBridge,onClose:()=>{},call:async()=>base({mappings,issues})});
  await click('选择草稿文件夹');
  equal(document.querySelectorAll('tbody tr').length,50,'mapping DOM bounded to one page');
  equal(document.querySelectorAll('.jianying-import-issues li').length,50,'issue DOM bounded to one page');
  await click('字段映射下一页');
  check(document.querySelector('tbody tr').textContent.includes('/source/50'),'second page begins at real offset');
  await click('字段映射下一页');equal(document.querySelectorAll('tbody tr').length,20,'last page shows remainder');
  check(button('字段映射下一页').disabled,'last page cannot exceed actual data');
  const oldCreate=URL.createObjectURL, oldRevoke=URL.revokeObjectURL, oldClick=HTMLAnchorElement.prototype.click;
  URL.createObjectURL=blob=>{downloaded=blob;return 'blob:component-test';};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};
  try {await click('保存预检报告');const report=JSON.parse(await downloaded.text());equal(report.mappings.length,120,'download has all mapping rows');equal(report.issues.length,120,'download has all issues');}
  finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;HTMLAnchorElement.prototype.click=oldClick;}
});
await scenario('a pending commit HTTP request still polls real counts; GET and POST completion replace the editor once',async()=>{
  let finishPost, imported=0, gets=0;
  await mount({bridge:normalBridge,onClose:()=>{},onBeforeCommit:async()=>true,onImported:()=>imported++,call:async(url,options)=>{
    if(url==='/api/jianying/imports')return base();
    if(url.endsWith('/commit'))return new Promise(resolve=>finishPost=resolve);
    gets++;
    return gets===1?base({status:'importing',canCommit:false,progress:{phase:'copy',completed:1,total:3}}):base({status:'completed',canCommit:false,project:{id:'committed'}});
  }});
  await click('选择草稿文件夹');await click('导入为新工程');
  await advance(380);
  check(document.body.textContent.includes('复制素材 1 / 3'),'actual count visible while POST still pending');
  check(Math.abs(document.querySelector('progress').value-100/3)<1e-10,'bar derives actual completed/total');
  await advance(580);equal(imported,1,'GET completed invokes replacement');
  await act(async()=>{finishPost(base({status:'completed',canCommit:false,project:{id:'committed'}}));await wait(3);});
  equal(imported,1,'POST completed does not invoke duplicate replacement');
});
await scenario('cancel racing publication reports committed outcome without switching or claiming cancellation success',async()=>{
  let finishPost, imported=0, closed=0;
  const complete=base({status:'completed',canCommit:false,project:{id:'already-committed'}});
  await mount({bridge:normalBridge,onClose:()=>closed++,onBeforeCommit:async()=>true,onImported:()=>imported++,call:async(url,options)=>{
    if(options?.method==='DELETE')return complete;
    if(url.endsWith('/commit'))return new Promise(resolve=>finishPost=resolve);
    return base();
  }});
  await click('选择草稿文件夹');await click('导入为新工程');await click('取消');
  check(document.body.textContent.includes('取消请求到达时，独立工程已经保存'),'actual committed outcome visible');
  equal(imported,0,'cancel intent preserves current editor');equal(closed,0,'outcome remains reviewable');
  await act(async()=>{finishPost(complete);await wait(3);});
  equal(imported,0,'late POST completion cannot undo cancel intent');
  await click('关闭');equal(closed,1,'user can close truthful completed outcome');
});
await scenario('unsupported selected timeline can switch to another declared timeline and uses its authoritative preflight',async()=>{
  let selected;
  const timelines=[{id:'opaque-timeline',name:'不可读时间线'},{id:'readable-timeline',name:'明文时间线'}];
  await mount({bridge:normalBridge,onClose:()=>{},call:async(url,options)=>{
    if(url.endsWith('/timeline')){selected=JSON.parse(options.body);return base({selectedTimelineId:'readable-timeline',timelines,status:'ready',canCommit:true,issues:[]});}
    return base({status:'unsupported',canCommit:false,selectedTimelineId:'opaque-timeline',timelines,issues:[{severity:'error',code:'OPAQUE_CONTENT',message:'所选时间线不是可读 JSON'}]});
  }});
  await click('选择草稿文件夹');
  const select=document.querySelector('[aria-label="选择剪映时间线"]');
  check(!select.disabled,'unsupported timeline must not disable switching to other declared timelines');
  check(!button('导入为新工程'),'unsupported timeline cannot commit');
  await act(async()=>{select.value='readable-timeline';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(3);});
  equal(selected,{timelineId:'readable-timeline'},'only selected declared identity sent for new preflight');
  check(!button('导入为新工程').disabled,'fresh service canCommit enables readable selected timeline');
  check(!document.body.textContent.includes('所选时间线不是可读 JSON'),'old unsupported issue replaced by authoritative new report');
});
if(root) await act(async()=>root.unmount());
return {coverage:'React component + simulated native-grant/service contracts; no native dialog or filesystem proof',tests:reports};
})();
`;

test('Jianying import component enforces preflight, warning, ownership, cancellation and persisted report states', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'weijian-draft-ui-'));
  try {
    await build({ stdin: { contents: renderer, resolveDir: process.cwd(), sourcefile: 'draft-component-test.jsx', loader: 'jsx' }, bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outfile: path.join(dir, 'renderer.js'), logLevel: 'silent' });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><script type="module" src="./renderer.js"></script></body></html>');
    // Resolve Electron's public require from the workspace rather than infer the
    // platform bundle layout. Only this hidden component harness runs here.
    await mkdir(path.join(dir, 'user-data'));
    const main = `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'user-data'))});app.setPath('sessionData',${JSON.stringify(path.join(dir,'user-data'))});app.whenReady().then(async()=>{let w;try{w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});await w.loadFile(${JSON.stringify(path.join(dir,'index.html'))});const result=await w.webContents.executeJavaScript('window.testResult');process.stdout.write('DRAFT_UI_RESULT='+JSON.stringify(result)+'\\n');w.destroy();app.quit();}catch(e){process.stderr.write(String(e.stack||e)+'\\n');w?.destroy();app.exit(1);}});`;
    await writeFile(path.join(dir, 'main.cjs'), main);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await exec(electronPath, [path.join(dir, 'main.cjs')], { env, timeout: 25000, maxBuffer: 1000000 });
    const line = result.stdout.split('\n').find(line => line.startsWith('DRAFT_UI_RESULT='));
    assert.ok(line, result.stdout + result.stderr);
    const report = JSON.parse(line.slice('DRAFT_UI_RESULT='.length));
    assert.equal(report.tests.length, 10);
    assert.ok(report.tests.every(item => item.passed), JSON.stringify(report));
    t.diagnostic(JSON.stringify(report));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

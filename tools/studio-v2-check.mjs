/** Isolated browser QA; does not send microphone, analytics, or live AI traffic.
 * Run from repository root: node tools/studio-v2-check.mjs
 * Optional env vars: PLAYWRIGHT_MODULE, CHROME_PATH, THREE_VENDOR_ROOT,
 * STUDIO_SHOT_DIR (screenshots default to the OS temp directory).
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, extname, isAbsolute, relative, resolve} from 'node:path';
import {mkdir, mkdtemp, readFile, writeFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = resolve(root, '..');
const requireHere = createRequire(import.meta.url);
let playwright;
if(process.env.PLAYWRIGHT_MODULE) playwright=requireHere(process.env.PLAYWRIGHT_MODULE);
else {try {playwright=requireHere('playwright');} catch {playwright=requireHere(resolve(outputs,'Exchange-Universe-Monitor-Public/node_modules/playwright'));}}
const localChrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_PATH = process.env.CHROME_PATH || (await access(localChrome).then(()=>true,()=>false)?localChrome:undefined);
const origin = 'https://digital-twin-studio-qa.invalid';
const localBase = '/digital-twin-demo/';
const remoteChat = 'https://test-rammeshgar-webpage.netlify.app/api/chat';
const remoteTranscribe = 'https://test-rammeshgar-webpage.netlify.app/api/transcribe';
const shots = process.env.STUDIO_SHOT_DIR ? resolve(process.env.STUDIO_SHOT_DIR) : await mkdtemp(resolve(tmpdir(), 'twin-studio-qa-'));
const selectedCases=process.env.STUDIO_CASES?.split(',').map(x=>x.trim()).filter(Boolean)||[];
const selected=label=>!selectedCases.length||selectedCases.some(x=>label.includes(x));
const layoutOnly=process.env.STUDIO_LAYOUT_ONLY==='1';
const renderAssets=process.env.STUDIO_RENDER_ASSETS==='1'||!layoutOnly;
await mkdir(shots, {recursive:true});
const exists = f => access(f).then(()=>true,()=>false);
const vendorCandidates = [process.env.THREE_VENDOR_ROOT, resolve(root,'vendor/three'), resolve(outputs,'Working-Studio-Release-Candidate/avatar/vendor/three')].filter(Boolean);
let vendorRoot,corePath;
for (const candidate of vendorCandidates) {
  for(const name of ['build/three.module.min.js','build/three.module.js']) if(await exists(resolve(candidate,name))){vendorRoot=candidate;corePath=name;break;}
  if(vendorRoot)break;
}
assert(vendorRoot,'No local Three.js distribution available. Set THREE_VENDOR_ROOT to the pinned Three.js package root.');
const core = await readFile(resolve(vendorRoot,corePath),'utf8');
const revision = core.match(/const REVISION\s*=\s*['"](\d+)/)?.[1] || core.slice(0,500).match(/\bconst \w+\s*=\s*['"](\d+)['"]/)?.[1] || 'unknown';
console.log(`Three.js QA fixture revision: ${revision}, ${vendorRoot}`);
if(revision!=='167') console.warn('QA uses a compatible local Three.js fixture, not the pinned production r167. Confirm the exact renderer separately.');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.glb':'model/gltf-binary','.woff':'font/woff','.woff2':'font/woff2'};
const browser = await playwright.chromium.launch({headless:true, executablePath:CHROME_PATH, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const results=[], allUnexpected=[], allExternal=[];
const check = (name, ok, details={}) => {results.push({name,ok:!!ok,details});console.log(`${ok?'PASS':'FAIL'} ${name}${ok?'':` ${JSON.stringify(details)}`}`);};
async function probe(name, fn){try{await fn();}catch(error){check(name,false,{error:error.message});}}

async function pageFixture({width,height,scheme='light',motion='no-preference',modelFailure=false,webglFailure=false}){
  const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:scheme,reducedMotion:motion,serviceWorkers:'block'});
  await context.addInitScript(({webglFailure})=>{
    // Even if a test accidentally activates a control no hardware or speech call occurs.
    Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true,configurable:true});
    if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('QA prevents real microphone access','NotAllowedError');};
    if(window.speechSynthesis) window.speechSynthesis.speak=()=>{};
    if(webglFailure){const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/^webgl/i.test(kind))return null;return getContext.call(this,kind,...args);};}
  },{webglFailure});
  const calls=[],errors=[],missing=[],external=[];
  const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
  async function serve(route, folder, suffix){
    const file=resolve(folder,'.'+suffix),sub=relative(folder,file);
    if(sub.startsWith('..')||isAbsolute(sub))return route.fulfill({status:403,body:''});
    try{return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file),headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}
    catch(error){if(suffix.endsWith('/favicon.ico'))return route.fulfill({status:204,body:''});missing.push(suffix);return route.fulfill({status:404,body:''});}
  }
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(['data:','blob:'].includes(url.protocol))return route.continue();
    if(url.href===remoteChat){
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      const data=req.postDataJSON();calls.push(data);
      await new Promise(r=>setTimeout(r,160));
      if((data.message||'').includes('QA force error'))return route.fulfill({status:503,contentType:'application/json',headers:cors,json:{error:'QA simulated service unavailable'}});
      return route.fulfill({status:200,contentType:'application/json',headers:cors,json:{answer:'QA fixture response — no live AI request.',interactionId:'qa-only'}});
    }
    if(url.href===remoteTranscribe){external.push('Transcription requested unexpectedly');return route.fulfill({status:403,headers:cors,json:{error:'QA blocks microphone traffic'}});}
    if(url.origin===origin){
      // The existing portfolio's common analytics loader intentionally isn't needed for QA.
      if(url.pathname==='/assets/portfolio-analytics.js')return route.fulfill({contentType:'application/javascript',body:'// no analytics in QA'});
      if(!url.pathname.startsWith(localBase))return route.fulfill({status:404,body:''});
      let path='/'+decodeURIComponent(url.pathname.slice(localBase.length));if(path.endsWith('/'))path+='index.html';
      if(modelFailure&&path.endsWith('.glb'))return route.fulfill({status:503,body:''});
      return serve(route,root,path);
    }
    const threeMatch=url.href.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+(\/[^?]*)/);
    if(threeMatch)return serve(route,vendorRoot,threeMatch[1].startsWith('/build/three.module')?`/${corePath}`:threeMatch[1]);
    external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+localBase, {waitUntil:'domcontentloaded',timeout:30_000});
  await page.waitForFunction(()=>document.querySelector('#ai-mascot-toggle')&&window.PortfolioTheme,{},{timeout:10_000});
  await page.evaluate(async()=>{await document.fonts.ready;});
  return {context,page,calls,errors,missing,external,finish:async(label)=>{allUnexpected.push(...errors.map(error=>({label,error})));allExternal.push(...external);check(`${label}: no missing local requests`,missing.length===0,{missing});await context.close();}};
}

const snapshot = page => page.evaluate(()=>{
  const view = (sel)=>{const e=document.querySelector(sel);if(!e)return null;const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,display:s.display,visible:s.visibility,animationDuration:s.animationDuration,transitionDuration:s.transitionDuration,dataset:{...e.dataset}};};
  const chips=[...document.querySelectorAll('[data-ai-prompt]')].map(e=>({label:e.textContent.trim(),rect:e.getBoundingClientRect().toJSON()}));
  const stage=view('#ai-mascot-stage'),form=view('#ai-chat-form'),launcher=view('#ai-mascot-toggle'),canvas=view('#ai-mascot-stage canvas'),promptList=view('.ai-prompt-list');
  return {viewport:{width:innerWidth,height:innerHeight},bodyWidth:document.documentElement.scrollWidth,scrollY,theme:document.documentElement.dataset.theme,active:document.activeElement?.id,panel:view('#ai-mascot-panel'),stage,form,launcher,canvas,promptList,chips,loader:view('#ai-mascot-loader'),status:document.querySelector('#ai-mascot-status')?.textContent.trim(),expanded:document.querySelector('#ai-mascot-toggle')?.getAttribute('aria-expanded'),panelHidden:document.querySelector('#ai-mascot-panel')?.getAttribute('aria-hidden'),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
});
const isVisible = (rect, viewport) => !!rect&&rect.width>0&&rect.height>0&&rect.visible!=='hidden'&&rect.x>=-2&&rect.right<=viewport.width+2&&rect.y>=-2&&rect.bottom<=viewport.height+2;
const centerVisible = (rect, viewport) => !!rect&&rect.width>0&&rect.height>0&&rect.x+rect.width/2>=0&&rect.x+rect.width/2<=viewport.width&&rect.y+rect.height/2>=0&&rect.y+rect.height/2<=viewport.height;
const within = (rect, host) => !!host&&rect.left>=host.x-2&&rect.right<=host.right+2&&rect.top>=host.y-2&&rect.bottom<=host.bottom+2;
async function waitReady(page){await page.waitForFunction(()=>/^Ready/.test(document.querySelector('#ai-mascot-status')?.textContent||'')&&document.querySelector('#ai-mascot-loader')?.classList.contains('is-hidden'),{},{timeout:30_000});}
async function mute(page){const button=page.locator('#ai-mascot-voice-toggle');if(await button.getAttribute('aria-pressed')==='true')await button.click();}
async function captureClip(page, selector, file){
  const clip=await page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
  return page.screenshot({path:file,clip,timeout:45_000});
}
async function captureRenderer(page, file){
  // Test-only capture: hide HTML overlays so the file is the actual renderer,
  // not an image of instructions/buttons composited atop it. Restore afterward.
  const overlay=await page.addStyleTag({content:'#ai-mascot-stage .studio-view-hud,#ai-mascot-stage .studio-view-controls{visibility:hidden!important}'});
  try{await captureClip(page,'#ai-mascot-stage canvas',file);}
  finally{await overlay.evaluate(el=>el.remove());}
}

try {
  for (const [width,height,scheme,motion] of [[1280,720,'dark','no-preference'],[1920,1080,'light','no-preference'],[390,844,'light','no-preference'],[320,667,'dark','reduce']]) {
    const label=`${width}x${height}-${scheme}${motion==='reduce'?'-reduced':''}`;
    if(!selected(label))continue;
    await probe(`${label}: complete viewport scenario`,async()=>{
      const fixture=await pageFixture({width,height,scheme,motion});const {page}=fixture;
      try {
        await page.waitForTimeout(150);
        let before=await snapshot(page);
        check(`${label}: no horizontal page overflow`,before.bodyWidth<=width+1,before);
        check(`${label}: expected theme`,before.theme===scheme,before);
        check(`${label}: launcher visible in first screen`,centerVisible(before.launcher,before.viewport),before);
        check(`${label}: 3D is intent-lazy`,!before.canvas&&before.panelHidden==='true'&&before.expanded==='false',before);
        await page.screenshot({path:resolve(shots,`${label}-closed.png`)});
        // Test keyboard entry on every viewport.
        await page.locator('#ai-mascot-toggle').focus();await page.keyboard.press('Enter');
        await waitReady(page);await page.waitForTimeout(350);
        const active=await snapshot(page);
        check(`${label}: accessible open state`,active.panelHidden==='false'&&active.expanded==='true',active);
        check(`${label}: canvas loaded at nonzero display size`,active.canvas&&active.canvas.height>100&&active.canvas.width>100,active);
        check(`${label}: stage and composer visible together`,(width>=900?isVisible(active.stage,active.viewport):centerVisible(active.stage,active.viewport))&&isVisible(active.form,active.viewport),active);
        check(`${label}: no horizontal overflow with conversation`,active.bodyWidth<=width+1,active);
        check(`${label}: all three suggested question buttons fit`,active.chips.length===3&&active.chips.every(chip=>within(chip.rect,active.promptList)),active);
        if(motion==='reduce') check(`${label}: reduced motion reaches renderer`,active.reducedMotion&&active.stage?.dataset.motion==='reduced',active);
        check(`${label}: renderer reports idle state`,active.panel?.dataset.studioState==='idle',active);
        await page.screenshot({path:resolve(shots,`${label}-active.png`)});
        if(width===1920&&renderAssets){
          try{await captureClip(page,'#ai-mascot-stage',resolve(shots,'stage-desktop.png'));await captureRenderer(page,resolve(shots,'renderer-desktop.png'));}
          catch(error){console.warn('Desktop renderer asset capture failed:',error.message);}
        }
        if(!layoutOnly)await mute(page);
        if(width===1280&&!layoutOnly){
          const sound=page.locator('#studio-sound-toggle');
          check(`${label}: interface sounds are opt-in`,await sound.getAttribute('aria-pressed')==='false');
          if(await sound.isEnabled()){
            await sound.click();await page.waitForFunction(()=>document.querySelector('#studio-sound-toggle')?.getAttribute('aria-pressed')==='true',{},{timeout:5000});
            await sound.click();check(`${label}: explicit sound enable/disable`,await sound.getAttribute('aria-pressed')==='false');
          }
          await page.locator('[data-ai-prompt]').first().click();
          await page.getByText('QA fixture response — no live AI request.',{exact:true}).waitFor({timeout:5000});
          check(`${label}: suggestion submits exact existing prompt`,fixture.calls.length===1&&fixture.calls[0].message===await page.locator('[data-ai-prompt]').first().getAttribute('data-ai-prompt'),{calls:fixture.calls});
          await page.locator('#ai-chat-input').fill('QA force error');await page.locator('#ai-send-btn').click();
          await page.getByText('QA simulated service unavailable',{exact:true}).waitFor({timeout:5000});
          check(`${label}: API failure leaves composer usable`,await page.locator('#ai-chat-input').isEnabled(),await snapshot(page));
          await page.locator('#ai-chat-input').fill('QA recovery question');await page.locator('#ai-chat-input').press('Enter');
          await page.waitForFunction(()=>[...document.querySelectorAll('.ai-message-bot')].filter(e=>e.textContent.includes('QA fixture response')).length>=2&&document.querySelector('#ai-chat-input').disabled===false,{},{timeout:15000}).catch(error=>{console.warn('Recovery diagnostic:',JSON.stringify(fixture.calls));throw error;});
          check(`${label}: follow-up recovers with previousInteractionId`,fixture.calls.at(-1).previousInteractionId==='qa-only'&&fixture.calls.length===3,{calls:fixture.calls});
          await page.screenshot({path:resolve(shots,`${label}-chat.png`)});
          const theme=page.locator('[data-theme-toggle]').first();await theme.click();
          await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
          check(`${label}: theme switch keeps conversation and 3D`,(await snapshot(page)).canvas?.width>0&&await page.getByText('QA fixture response — no live AI request.',{exact:true}).count()===2,await snapshot(page));
        }
        if(width===1920&&!layoutOnly){
          const canvasRect=await page.locator('#ai-mascot-stage canvas').boundingBox();
          await page.mouse.move(canvasRect.x+canvasRect.width*.54,canvasRect.y+canvasRect.height*.45);
          await page.mouse.down();await page.mouse.move(canvasRect.x+canvasRect.width*.65,canvasRect.y+canvasRect.height*.48,{steps:12});await page.mouse.up();
          await page.waitForTimeout(150);
          const manual=await snapshot(page);check(`${label}: manual orbit takes precedence`,manual.stage?.dataset.cameraMode==='manual',manual);
          await page.locator('#ai-mascot-reset-view').click();await page.waitForTimeout(300);
          check(`${label}: Reset view returns to the studio camera`,(await snapshot(page)).stage?.dataset.cameraMode==='studio',await snapshot(page));
          await page.locator('#ai-mascot-expand').click();await page.waitForTimeout(350);
          check(`${label}: portrait camera toggle changes real camera mode`,(await snapshot(page)).stage?.dataset.cameraMode==='portrait',await snapshot(page));
          await page.waitForTimeout(900);
          try{await captureRenderer(page,resolve(shots,'renderer-portrait.png'));}catch(error){console.warn('Portrait renderer asset capture failed:',error.message);}
        }
        if(width===1920&&layoutOnly&&renderAssets){
          await page.locator('#ai-mascot-expand').click();await page.waitForTimeout(1200);
          try{await captureRenderer(page,resolve(shots,'renderer-portrait.png'));}catch(error){console.warn('Portrait renderer asset capture failed:',error.message);}
        }
        await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.id==='ai-mascot-toggle',{},{timeout:3000}).catch(()=>{});
        const closed=await snapshot(page);
        check(`${label}: Escape closes and restores focus`,closed.panelHidden==='true'&&closed.expanded==='false'&&closed.active==='ai-mascot-toggle',closed);
        if(width===1920){await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#ai-mascot-toggle')?.getAttribute('aria-expanded')==='true',{},{timeout:3000}).catch(()=>{});const reopened=await snapshot(page);check(`${label}: keyboard reopens existing renderer`,reopened.expanded==='true'&&reopened.canvas?.width>0,reopened);if(reopened.expanded==='true')await page.locator('#ai-mascot-close').click();}
      } finally {await fixture.finish(label);}
    });
  }
  for(const [label,fail] of [['forced-model-failure',{modelFailure:true}],['forced-webgl-failure',{webglFailure:true}]]) if(!layoutOnly&&selected(label)) await probe(`${label}: complete fallback scenario`,async()=>{
    const fixture=await pageFixture({width:1280,height:720, ...fail});const {page}=fixture;
    try {
      await page.locator('#ai-mascot-toggle').click();
      await page.waitForFunction(()=>/unavailable|text.only|no 3d|limited|not support/i.test(document.querySelector('#ai-mascot-status')?.textContent||''),{},{timeout:15000}).catch(()=>{});
      const failed=await snapshot(page);
      check(`${label}: clear fallback status`,/unavailable|text.only|no 3d|limited|not support/i.test(failed.status||''),failed);
      await mute(page);await page.locator('#ai-chat-input').fill('QA fallback');await page.locator('#ai-send-btn').click();
      await page.getByText('QA fixture response — no live AI request.',{exact:true}).waitFor({timeout:5000});
      check(`${label}: text chat actually answers with 3D unavailable`,fixture.calls.length===1,{calls:fixture.calls});
      await page.screenshot({path:resolve(shots,`${label}.png`)});
    } finally {await fixture.finish(label);}
  });
} finally {
  await browser.close();
  check('No unhandled page errors (including failure scenarios)',allUnexpected.length===0,{unexpected:allUnexpected});
  check('No attempted real transcription or microphone traffic',!allExternal.includes('Transcription requested unexpectedly'),{allExternal});
  const failed=results.filter(r=>!r.ok);await writeFile(resolve(shots,'results.json'),JSON.stringify({revision,shots,passed:results.length-failed.length,failed:failed.length,results,unexpected:allUnexpected,blockedExternal:[...new Set(allExternal)]},null,2));
  console.log(`${results.length-failed.length}/${results.length} checks passed. Screenshots and details: ${shots}`);
  if(failed.length) process.exitCode=1;
}

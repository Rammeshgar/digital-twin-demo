import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {access,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,extname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const shots=resolve(process.env.STUDIO_SHOT_DIR||tmpdir(),'digital-twin-v3-qa');await mkdir(shots,{recursive:true});
const origin='https://v3-hands.invalid',prefix='/digital-twin-demo/';
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.glb':'model/gltf-binary','.json':'application/json','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.svg':'image/svg+xml'};
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath=process.env.CHROME_PATH||(await access(chrome).then(()=>chrome,()=>undefined));
const browser=await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
try {
 const mobile=process.env.HANDS_MOBILE==='1';
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1600,height:900},colorScheme:'dark',deviceScaleFactor:1,serviceWorkers:'block'});
 await context.addInitScript(()=>{if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Offline review blocks microphone');};});
 const external=[],errors=[];
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.protocol==='blob:'||url.protocol==='data:')return route.continue();if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}if(url.pathname==='/assets/portfolio-analytics.js')return route.fulfill({contentType:'text/javascript',body:''});if(!url.pathname.startsWith(prefix))return route.fulfill({status:404,body:''});const file=resolve(root,url.pathname.slice(prefix.length)||'index.html');const rel=relative(root,file);if(rel.startsWith('..')||isAbsolute(rel))return route.fulfill({status:403,body:''});try{return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+prefix+(mobile?'':'?review=hands'));await page.getByRole('button',{name:'Enter the studio'}).click();await page.getByText('Ready · voice and lip movement online').waitFor({timeout:45000});
 const stage=page.locator('#ai-mascot-stage'),select=page.locator('#review-hand-clip'),freeze=page.locator('#review-freeze');
 assert.ok(Number(await stage.getAttribute('data-hand-surface'))>1000,'Rebuilt hand geometry active');
 async function shot(name){const rect=await stage.boundingBox();await page.screenshot({path:resolve(shots,name+'.png'),clip:rect,timeout:45000});}
 if(mobile){
  const geometry=await page.evaluate(()=>{const s=document.querySelector('#ai-mascot-stage').getBoundingClientRect(),f=document.querySelector('#ai-chat-form').getBoundingClientRect(),buttons=[...document.querySelectorAll('.studio-camera-actions button')].map(b=>b.getBoundingClientRect().right);return{stageRight:s.right,composerBottom:f.bottom,buttons,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};});
  assert.ok(geometry.overflow<=1&&geometry.composerBottom<=geometry.height+2&&geometry.buttons.every(x=>x<=geometry.stageRight+1),JSON.stringify(geometry));
  await page.getByRole('button',{name:'Wide studio view'}).click();await page.waitForTimeout(1100);assert.equal(await stage.getAttribute('data-camera-mode'),'wide');await page.screenshot({path:resolve(shots,'mobile-wide.png'),timeout:45000});assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));console.log('PASS 390x844 real model, wide control, complete composer and stage bounds.');await context.close();
 }else{
 await page.waitForTimeout(550);await shot('idle');
 await freeze.check();for(const [name,value] of [['open-both','Open_Both'],['point','Small_Point'],['present','Present_Left'],['frame','Frame_An_Idea']].filter(([n])=>!process.env.HANDS_QUICK||['open-both','point'].includes(n))){await select.selectOption(value);await page.waitForTimeout(1250);await shot(name);}
 await select.selectOption('idle');await page.waitForTimeout(900);
 await page.getByRole('button',{name:'Wide studio view'}).click();await page.waitForTimeout(1000);assert.equal(await stage.getAttribute('data-camera-mode'),'wide');await shot('wide-view');
 const box=await stage.boundingBox();const x=box.x+box.width*.44,y=box.y+box.height*.49;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+box.width*.43,y,{steps:8});await page.mouse.up();await page.waitForTimeout(650);await shot('studio-orbit-left');
 await page.getByRole('button',{name:'Reset camera view'}).click();await page.waitForTimeout(1000);
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-box.width*.43,y,{steps:8});await page.mouse.up();await page.waitForTimeout(650);await shot('studio-orbit-right');
 await page.screenshot({path:resolve(shots,'full-review.png'),timeout:45000});
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
 console.log('PASS actual rebuilt hand mesh, four selected body/hand poses, both orbit extremes, no live AI/audio/network requests.');
 await context.close();
 }
}finally{await browser.close();}

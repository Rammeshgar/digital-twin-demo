import {createRequire} from 'node:module';
import {access,readFile} from 'node:fs/promises';
import {dirname,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath=process.env.CHROME_PATH||(await access(chrome).then(()=>chrome,()=>undefined));
const browser=await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://hand-rig.test')return route.abort();if(url.pathname==='/'){return route.fulfill({contentType:'text/html',body:'<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.min.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>'});}const file=resolve(root,'.'+url.pathname);let type=extname(file)==='.glb'?'model/gltf-binary':'text/javascript';return route.fulfill({contentType:type,body:await readFile(file)});});
 await page.goto('https://hand-rig.test/');
 const data=await page.evaluate(async()=>{const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('three/addons/libs/meshopt_decoder.module.js'),{refineHandSurface}=await import('/hand-surface.mjs'),{createHandPerformance}=await import('/hand-poses.mjs');const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);const {scene}=await loader.loadAsync('/assets/sadeq-digital-twin.meshopt.glb');scene.updateMatrixWorld(true);
 const mesh=scene.getObjectByName('body'),stats=refineHandSurface(mesh),weights=mesh.geometry.attributes.skinWeight;let maxDeviation=0;for(let i=stats.verticesBefore;i<weights.count;i++){let sum=0;for(let c=0;c<4;c++)sum+=weights.getComponent(i,c);maxDeviation=Math.max(maxDeviation,Math.abs(sum-1));}
 const hands=createHandPerformance(scene),ids=[...Array.from({length:15},(_,i)=>16+i),...Array.from({length:15},(_,i)=>35+i)],bones=ids.map(id=>scene.getObjectByName(`bone_${id}`));const snapshot=()=>bones.map(b=>b.quaternion.clone());const pose=(category,name)=>{for(let i=0;i<45;i++)hands.update(.033,category,name,.5,1,i*.033);return snapshot()};const idle=pose('idle','Idle_Breathe'),open=pose('gesture','Open_Both'),point=pose('gesture','Small_Point'),frame=pose('gesture','Frame_An_Idea');const countChange=(a,b)=>a.filter((q,i)=>q.angleTo(b[i])>.025).length;return {stats,normalizedMidpointWeights:maxDeviation,rigJoints:hands.count,openVsIdle:countChange(idle,open),pointVsOpen:countChange(open,point),roundedVsOpen:countChange(open,frame),allFinite:bones.every(b=>b.quaternion.toArray().every(Number.isFinite)),bodyMaterialGroups:mesh.geometry.groups.length};});
 if(data.rigJoints!==30||data.openVsIdle<20||data.pointVsOpen<10||data.roundedVsOpen<20||!data.allFinite||data.normalizedMidpointWeights>1e-5||data.bodyMaterialGroups!==2)throw Error(JSON.stringify(data));console.log(JSON.stringify(data,null,2));
}finally{await browser.close();}

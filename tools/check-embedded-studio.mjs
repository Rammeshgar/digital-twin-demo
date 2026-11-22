/** Local fixture for the standalone and same-origin portfolio assistant contract.
 * All HTTP requests are intercepted; no live AI, tracking or hardware access.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);
let playwright;
if (process.env.PLAYWRIGHT_MODULE) playwright = requireHere(process.env.PLAYWRIGHT_MODULE);
else {
    try { playwright = requireHere('playwright'); }
    catch { playwright = requireHere(resolve(repo, '../../Exchange-Universe-Monitor-Public/node_modules/playwright')); }
}
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.CHROME_PATH || (await access(chrome).then(() => chrome, () => undefined));
const browser = await playwright.chromium.launch({ headless:true, executablePath, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
const origin = 'https://twin-integration-qa.invalid';
const foreign = 'https://unrelated-preview.invalid';
const base = '/digital-twin-demo/';
const mimeTypes = {
    '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8', '.json':'application/json', '.glb':'model/gltf-binary', '.woff2':'font/woff2',
    '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.ico':'image/x-icon',
};
const hostFixture = `<!doctype html><meta charset="utf-8"><style>
    body { margin:0; } iframe { border:0; display:block; width:100vw; height:calc(100vh - 45px) }
    button { height:40px; }
</style><button id="launch">Ask Sadeq's AI</button><script>
    window.events=[]; window.frame=null;
    document.querySelector('#launch').onclick=()=>{
        const frame=document.createElement('iframe'); window.frame=frame;
        frame.id='twin';frame.title='Digital Twin';frame.setAttribute('allow','microphone');
        frame.src=${JSON.stringify(origin + base + '?embed=assistant')};document.body.append(frame);
    };
    window.addEventListener('message',e=>{
        if(e.source===window.frame?.contentWindow && e.origin===${JSON.stringify(origin)})window.events.push(e.data?.type);
    });
</script>`;
const log = [];
function pass(label) { log.push(label); console.log('PASS', label); }
async function fixture(viewport) {
    const context = await browser.newContext({viewport, colorScheme:'light', serviceWorkers:'block'});
    const requests = [], unexpected = [], errors = [];
    await context.addInitScript(() => {
        window.__micRequests = 0;
        window.__trackStops = 0;
        // Hold a synthetic permission result until the QA test releases it.
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
            window.__micRequests++;
            return new Promise(resolve => {
                window.__releaseMic = () => resolve({getTracks:()=>[{stop:()=>{window.__trackStops++;}}]});
            });
        };
        if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
    });
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        requests.push(url.pathname);
        if ((url.origin === origin || url.origin === foreign) && url.pathname === '/host') {
            return route.fulfill({contentType:'text/html',body:hostFixture});
        }
        if (url.origin === origin && url.pathname === '/assets/portfolio-analytics.js') {
            return route.fulfill({contentType:'application/javascript',body:'window.__analyticsLoaded=true;'});
        }
        if (url.origin === origin && url.pathname === '/digital-twin/') {
            return route.fulfill({contentType:'text/html',body:'<main id="inside"><article id="design"></article><article id="limits"></article></main>'});
        }
        if (url.origin === origin && url.pathname.startsWith(base)) {
            const suffix = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
            const file = resolve(repo,suffix), sub = relative(repo,file);
            if (sub.startsWith('..') || isAbsolute(sub)) return route.fulfill({status:403,body:''});
            return route.fulfill({contentType:mimeTypes[extname(file)]||'application/octet-stream',body:await readFile(file)});
        }
        if (url.origin === 'https://test-rammeshgar-webpage.netlify.app' && url.pathname === '/api/chat') {
            const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
            if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors,body:''});
            return route.fulfill({status:200,headers:cors,json:{answer:'Fixture reply only.',interactionId:'fixture'}});
        }
        if (url.pathname === '/favicon.ico') return route.fulfill({status:204,body:''});
        unexpected.push(url.href);
        return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error=>errors.push(error.message));
    return {context,page,requests,unexpected,errors};
}
const waitHost = (page,type) => page.waitForFunction(type => window.events?.includes(type),type,{timeout:20_000});
const frameMessage = (page,data) => page.evaluate(data=>window.frame.contentWindow.postMessage(data,location.origin),data);
async function openEmbed(page) {
    await page.click('#launch');
    await waitHost(page,'twin-ready');
    return page.frames().find(frame=>frame.url().includes('?embed=assistant'));
}
async function checkLayout(frame) {
    const layout = await frame.evaluate(() => {
        const rect = id=>document.querySelector(id).getBoundingClientRect().toJSON();
        return {
            width:innerWidth,height:innerHeight,embedded:document.documentElement.dataset.twinEmbed,
            panel:rect('#ai-mascot-panel'),stage:rect('#ai-mascot-stage'),form:rect('#ai-chat-form'),
            header:getComputedStyle(document.querySelector('.site-header')).display,
            intro:getComputedStyle(document.querySelector('.hero-intro')).display,
            footer:getComputedStyle(document.querySelector('footer')).display,
            actions:rect('.ai-mascot-header-actions'),fullApp:rect('#ai-open-standalone'),
            analytics:window.__analyticsLoaded, mic:window.__micRequests,
        };
    });
    assert.equal(layout.embedded,'assistant');
    assert.equal(layout.header,'none');assert.equal(layout.intro,'none');assert.equal(layout.footer,'none');
    assert.ok(Math.abs(layout.panel.width-layout.width)<=2,JSON.stringify(layout));
    assert.ok(Math.abs(layout.panel.height-layout.height)<=2,JSON.stringify(layout));
    assert.ok(layout.stage.height>60 && layout.form.height>40);
    assert.ok(layout.form.bottom<=layout.height+2 && layout.form.right<=layout.width+2,JSON.stringify(layout));
    assert.ok(layout.actions.right<=layout.width+2 && layout.fullApp.width>=40,JSON.stringify(layout));
    assert.equal(await frame.locator('#ai-open-standalone').getAttribute('target'),'_top');
    assert.ok(!layout.analytics && !layout.mic);
}

try {
    let f = await fixture({width:1280,height:720});
    try {
        await f.page.goto(origin+base);
        await f.page.waitForFunction(()=>window.__analyticsLoaded===true);
        assert.equal(await f.page.locator('#ai-mascot-panel').getAttribute('aria-hidden'),'true');
        assert.equal(await f.page.locator('#inside,#architecture,#evidence').count(),0);
        assert.equal(await f.page.locator('a[href="/digital-twin/"]').count(),2);
        assert.ok(!f.requests.some(path=>path.endsWith('.glb')));
        pass('Standalone: direct launch, no duplicate case, analytics once and model lazy');
        for (const [old,next] of [['inside','inside'],['architecture','inside'],['art-direction','design'],['limits-heading','limits']]) {
            await f.page.goto(origin+base+'#'+old);
            await f.page.waitForURL(origin+'/digital-twin/#'+next);
        }
        pass('Legacy technical anchors forward to canonical portfolio sections');
        await f.page.goto(foreign+'/host');
        await f.page.click('#launch');
        await f.page.frameLocator('#twin').locator('#ai-mascot-toggle').waitFor();
        const cross = f.page.frames().find(frame=>frame.url().includes('?embed=assistant'));
        await cross.waitForSelector('#ai-mascot-toggle');
        assert.equal(await cross.locator('#ai-mascot-panel').getAttribute('aria-hidden'),'true');
        assert.ok(!await cross.evaluate(()=>document.documentElement.dataset.twinEmbed));
        pass('Unrelated-origin iframe does not auto-open or enter embed mode');
        assert.equal(f.errors.length,0,JSON.stringify(f.errors));
    } finally {await f.context.close();}

    for (const viewport of [{width:1280,height:720},{width:390,height:844},{width:320,height:667}]) {
        f=await fixture(viewport);
        try {
            const {page}=f;
            await page.goto(origin+'/host');
            assert.ok(!f.requests.some(path=>path.startsWith(base)),'Assistant loads before visitor launch');
            const frame = await openEmbed(page);
            assert.ok(frame);
            await checkLayout(frame);
            await frameMessage(page,{type:'portfolio-theme',theme:'dark'});
            await frame.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
            // A wrong event source or wrong origin must not be able to dispose.
            await frame.evaluate(()=>{
                dispatchEvent(new MessageEvent('message',{data:{type:'twin-dispose'},origin:location.origin,source:window}));
                dispatchEvent(new MessageEvent('message',{data:{type:'twin-dispose'},origin:'https://unrelated.invalid',source:parent}));
            });
            assert.equal(await frame.locator('#ai-mascot-panel').getAttribute('aria-hidden'),'false');
            assert.ok(!f.requests.includes('/assets/portfolio-analytics.js'),'Embedded duplicate analytics request');
            pass(`${viewport.width}×${viewport.height}: launch handshake, no duplicate analytics, theme and full-frame layout`);
            if (viewport.width===1280) {
                await frame.waitForFunction(()=>document.querySelector('#ai-mascot-loader').classList.contains('is-hidden'),null,{timeout:30_000});
                await frame.locator('#ai-mascot-voice-toggle').click();
                await frame.locator('#ai-chat-input').fill('Fixture question');
                await frame.locator('#ai-send-btn').click();
                await frame.waitForFunction(()=>document.querySelector('#ai-chat-log').textContent.includes('Fixture reply only.'));
                await frame.locator('#ai-mascot-close').click();
                await waitHost(page,'twin-close');
                assert.equal(await frame.locator('#ai-mascot-panel').getAttribute('aria-hidden'),'true');
                assert.equal(await frame.locator('#ai-mascot-stage canvas').count(),0);
                pass('Desktop: mock text reply and child close button stop the renderer and close');
            } else if (viewport.width===390) {
                await frame.locator('#ai-mic-btn').click();
                await frame.waitForFunction(()=>window.__micRequests===1);
                await frameMessage(page,{type:'twin-dispose'});
                await waitHost(page,'twin-disposed');
                await frame.evaluate(()=>window.__releaseMic());
                await frame.waitForFunction(()=>window.__trackStops===1);
                assert.equal(await frame.locator('#ai-mascot-panel').getAttribute('aria-hidden'),'true');
                pass('Phone: closing during pending microphone permission releases delayed tracks');
            } else {
                await frame.locator('#ai-mascot-expand').click();
                await checkLayout(frame);
                await frame.locator('#ai-chat-input').press('Escape');
                await waitHost(page,'twin-close');
                pass('Compact phone: compact portrait toggle retains complete frame and Escape closes');
            }
            assert.equal(f.errors.length,0,JSON.stringify(f.errors));
            assert.equal(f.unexpected.length,0,JSON.stringify(f.unexpected));
        } finally {await f.context.close();}
    }
} finally { await browser.close(); }
console.log(`All ${log.length} embedded/standalone integration checks passed.`);

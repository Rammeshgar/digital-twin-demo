import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Private, dependency-free local preview of the same subpath used by GitHub Pages.
// Production analytics intentionally never run in this preview. The application
// source and public service URLs are unchanged.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = '/digital-twin-demo/';
const port = Number(process.argv[2] || 4917);
const types = new Map(Object.entries({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
}));

const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (pathname === '/' || pathname === '/digital-twin/' || pathname === '/digital-twin') {
        // These pages belong to the portfolio repository, not this app's preview.
        response.writeHead(302, { Location: pathname === '/' ? 'https://rammeshgar.github.io/' : 'https://rammeshgar.github.io/digital-twin/' }).end(); return;
    }
    if (pathname === '/assets/portfolio-analytics.js') {
        response.writeHead(200, { 'Content-Type': types.get('.js'), 'Cache-Control': 'no-store' });
        response.end('// Analytics omitted in the private studio preview.\n'); return;
    }
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end('Not found'); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
        response.writeHead(403).end(); return;
    }
    const absolute = resolve(root, relative);
    if (!absolute.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error('Not a file');
        response.writeHead(200, {
            'Content-Type': types.get(extname(absolute)) || 'application/octet-stream',
            'Content-Length': info.size, 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        if (request.method === 'HEAD') response.end();
        else createReadStream(absolute).pipe(response);
    } catch { response.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => {
    console.log(`Digital Twin private preview: http://127.0.0.1:${port}${prefix}`);
});

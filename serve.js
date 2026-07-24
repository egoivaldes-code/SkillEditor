'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, 'sprite-forge');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  // Decode and normalise the URL path; reject anything with null bytes
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath.includes('\0')) { res.writeHead(400); res.end('Bad Request'); return; }

  // Default to index.html
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Resolve against the static root and verify containment
  const resolved = path.resolve(ROOT, urlPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  try {
    const data = fs.readFileSync(resolved);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(5000, '0.0.0.0', () => console.log('Serving sprite-forge on 0.0.0.0:5000'));

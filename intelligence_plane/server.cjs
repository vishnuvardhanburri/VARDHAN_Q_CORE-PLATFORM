// ===================================================================
// VARDHAN Q-CORE — Intelligence Plane Hardened Production Web Server
// ===================================================================
// Serves the pre-compiled Vite Single Page Application (SPA) with
// strict HTTP method validation, path traversal defense, and security headers.
// ===================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.resolve(__dirname, 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const server = http.createServer((req, res) => {
  // 1. Method check: TRACE is strictly forbidden (XST defense)
  if (req.method === 'TRACE') {
    res.writeHead(405, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      'Allow': 'GET, HEAD, OPTIONS'
    });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  // 1b. Payload size check (prevent oversized body DOS)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 65536) {
    res.writeHead(413, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Payload Too Large' }));
  }

  // 2. Traversal & null-byte validation
  const rawUrl = req.url || '/';
  if (rawUrl.includes('\0') || rawUrl.includes('%00')) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Bad Request: Null byte detected' }));
  }

  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch (_e) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Bad Request: Malformed URI encoding' }));
  }

  if (rawUrl.includes('..') || decodedUrl.includes('..')) {
    res.writeHead(400, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Bad Request: Path traversal rejected' }));
  }

  // 3. API route separation: Web console does not serve /api/
  const urlPath = decodedUrl.split('?')[0];
  if (urlPath.startsWith('/api/') || urlPath === '/api') {
    res.writeHead(404, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Not Found: API requests must target control plane' }));
  }

  // 4. Method restriction for static frontend: only GET, HEAD, OPTIONS allowed
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.writeHead(405, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      'Allow': 'GET, HEAD, OPTIONS'
    });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      'Allow': 'GET, HEAD, OPTIONS'
    });
    return res.end();
  }

  // 5. Static file serving & SPA fallback
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(DIST_DIR, safePath);

  // Guard against directory escape
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ error: 'Forbidden' }));
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': contentType
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    } else {
      // SPA Fallback: serve index.html for GET/HEAD navigation routes
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(INDEX_HTML).pipe(res);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INFO] Vardhan Q-Core Intelligence Plane listening on http://0.0.0.0:${PORT}`);
});

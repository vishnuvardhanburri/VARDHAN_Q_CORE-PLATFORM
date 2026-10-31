// ===================================================================
// VARDHAN Q-CORE — Intelligence Plane Hardened Production Web Server
// ===================================================================
// Serves the pre-compiled Vite Single Page Application (SPA) with
// strict HTTP method validation, path traversal defense, and security
// headers. Proxies /api/ requests to the control plane backend so the
// React app can run on a single origin without CORS issues.
// ===================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
// Control-plane URL — override with VARDHAN_CONTROL_PLANE_URL env var.
// Defaults to localhost:8080 (Docker / production layout).
const CONTROL_PLANE_URL = (process.env.VARDHAN_CONTROL_PLANE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
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

  // 3. API proxy: forward /api/ and /v1/ to the control plane backend
  const urlPath = decodedUrl.split('?')[0];
  if (urlPath.startsWith('/api/') || urlPath === '/api' || urlPath.startsWith('/v1/')) {
    // Parse the control plane URL
    let cpHost, cpPort, cpBase;
    try {
      const cpUrl = new URL(CONTROL_PLANE_URL);
      cpHost = cpUrl.hostname;
      cpPort = parseInt(cpUrl.port || (cpUrl.protocol === 'https:' ? '443' : '80'), 10);
      cpBase = cpUrl.pathname.replace(/\/$/, '');
    } catch (_e) {
      cpHost = '127.0.0.1';
      cpPort = 8080;
      cpBase = '';
    }

    // Collect request body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const proxyPath = cpBase + req.url;
      const proxyReq = http.request(
        {
          hostname: cpHost,
          port: cpPort,
          method: req.method,
          path: proxyPath,
          headers: {
            ...req.headers,
            host: `${cpHost}:${cpPort}`,
            'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
            'x-forwarded-host': req.headers.host || `localhost:${PORT}`,
          },
        },
        (proxyRes) => {
          // Forward all response headers except hop-by-hop
          const forwardHeaders = { ...proxyRes.headers };
          delete forwardHeaders['transfer-encoding'];
          // Expose token rotation header to the browser
          if (proxyRes.headers['authorization-new-token']) {
            forwardHeaders['access-control-expose-headers'] =
              (forwardHeaders['access-control-expose-headers'] || '') +
              ',authorization-new-token';
          }
          res.writeHead(proxyRes.statusCode || 502, forwardHeaders);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({
          error: 'Control plane unreachable',
          detail: err.message,
          target: CONTROL_PLANE_URL,
        }));
      });
      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    });
    return; // response handled by proxy
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
      const stream = fs.createReadStream(filePath);
      stream.on('error', (streamErr) => {
        console.error(`[ERROR] Failed to read static file ${filePath}:`, streamErr.message);
        if (!res.headersSent) {
          res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });
      stream.pipe(res);
    } else {
      // Check if INDEX_HTML exists before serving
      if (!fs.existsSync(INDEX_HTML)) {
        console.error(`[ERROR] Static index file not found at ${INDEX_HTML}`);
        res.writeHead(404, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/plain; charset=utf-8'
        });
        return res.end('Vardhan Q-Core Intelligence Plane: Frontend assets not found.');
      }
      // SPA Fallback: serve index.html for GET/HEAD navigation routes
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8'
      });
      if (req.method === 'HEAD') return res.end();
      const indexStream = fs.createReadStream(INDEX_HTML);
      indexStream.on('error', (streamErr) => {
        console.error(`[ERROR] Failed to read ${INDEX_HTML}:`, streamErr.message);
        if (!res.headersSent) {
          res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });
      indexStream.pipe(res);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INFO] Vardhan Q-Core Intelligence Plane listening on http://0.0.0.0:${PORT}`);
});

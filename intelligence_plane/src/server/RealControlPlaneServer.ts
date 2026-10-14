import http from 'http';
import { RealControlPlane } from './control_plane/RealControlPlane.ts';
import * as fs from 'fs';

const cp = new RealControlPlane();
const logStream = fs.createWriteStream('/tmp/real_cp_debug.log', { flags: 'a' });

const server = http.createServer(async (req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);
  if (req.url?.startsWith('/api/v1/organizations/') && req.url?.endsWith('/security/validate') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        console.log('Body received:', body);
        const request = JSON.parse(body);
        const orgId = req.url!.split('/')[4];
        const receipt = await cp.seal(request, orgId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(receipt));
      } catch (e) {
        console.error('Error sealing receipt:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8080, () => {
  console.log('Real Control Plane API listening on port 8080');
  console.log(`IDENTITY_FINGERPRINT: ${cp['fingerprint']}`);
});

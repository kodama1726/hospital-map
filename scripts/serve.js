// docs/ をローカルで配信する（node scripts/serve.js → http://localhost:8080）
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[\\/])+/, '');
  const file = path.join(ROOT, p === path.sep || p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

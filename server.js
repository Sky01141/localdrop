// LocalDrop サーバー (PairDrop方式): 同一ネットワーク自動発見 / 6桁ペアリング / 公開ルーム / シグナリング / WebSocket中継
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADJ = ['あおい', 'しずかな', 'はやい', 'まるい', 'ねむい', 'かるい', 'つよい', 'ゆかいな'];
const ANI = ['キツネ', 'ペンギン', 'タヌキ', 'フクロウ', 'カワウソ', 'イルカ', 'ウサギ', 'クマ'];
const pick = (a) => a[crypto.randomInt(a.length)];
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').slice(0, n);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/share-target')) { res.writeHead(303, { Location: '/' }); return res.end(); }
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...(p === '/sw.js' ? { 'Cache-Control': 'no-cache' } : {}) });
    res.end(data);
  });
});

// 同じ公開IP(IPv6は/64)= 同じネットワーク。プライベートIP同士は全部 'lan'。
function ipKeyOf(req) {
  let ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  if (ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip) || /^(f[cd]|fe80)/i.test(ip)) return 'lan';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

const peers = new Map();     // id -> {id, ws, name, device, ipKey, secrets:Set, room, joined}
const pairKeys = new Map();  // 6桁 -> {id, secret, exp}
const revoked = new Map();   // 解除されたsecret -> 期限 (オフラインだった相手にも後から伝える)
const send = (p, o) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const shared = (a, b) => [...a.secrets].filter((s) => b.secrets.has(s));
function how(a, b) {
  if (a.id === b.id || !a.joined || !b.joined) return null;
  if (shared(a, b).length) return 'paired';
  if (a.room && a.room === b.room) return 'room';
  if (a.ipKey === b.ipKey) return 'network';
  return null;
}
function push() {
  for (const a of peers.values()) {
    if (!a.joined) continue;
    const list = [];
    for (const b of peers.values()) { const h = how(a, b); if (h) list.push({ id: b.id, name: b.name, device: b.device, how: h }); }
    send(a, { type: 'peers', peers: list });
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
wss.on('connection', (ws, req) => {
  const p = { id: crypto.randomUUID(), ws, name: '', device: '', ipKey: ipKeyOf(req), secrets: new Set(), room: null, joined: false, fails: 0 };
  peers.set(p.id, p);
  ws.alive = true; ws.on('pong', () => (ws.alive = true));
  send(p, { type: 'hello', id: p.id });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'join':
        p.name = clean(m.name, 20) || pick(ADJ) + pick(ANI); p.device = clean(m.device, 40);
        const gone = [];
        for (const s of (Array.isArray(m.secrets) ? m.secrets : []).slice(0, 50)) {
          if (!/^[0-9a-f]{32}$/.test(s)) continue;
          if ((revoked.get(s) || 0) > Date.now()) gone.push(s); else p.secrets.add(s);
        }
        if (gone.length) send(p, { type: 'unpaired', secrets: gone });
        p.joined = true; push(); break;
      case 'profile':
        p.name = clean(m.name, 20) || p.name; p.device = clean(m.device, 40); push(); break;
      case 'signal': case 'relay': {
        const t = peers.get(m.to);
        if (!t || !how(p, t)) break;
        if (m.type === 'signal') send(t, { type: 'signal', from: p.id, data: m.data });
        else if (typeof m.s === 'string') send(t, { type: 'relay', from: p.id, s: m.s });
        else if (typeof m.b === 'string') send(t, { type: 'relay', from: p.id, b: m.b });
        break;
      }
      case 'pair-start': {
        for (const [k, v] of pairKeys) if (v.id === p.id) pairKeys.delete(k);
        let key; do key = String(crypto.randomInt(1e6)).padStart(6, '0'); while (pairKeys.has(key));
        pairKeys.set(key, { id: p.id, secret: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 120000 });
        send(p, { type: 'pair-key', key, ttl: 120 }); break;
      }
      case 'pair-join': {
        const k = pairKeys.get(String(m.key)), a = k && peers.get(k.id);
        if (!k || k.exp < Date.now() || !a || a === p) {
          send(p, { type: 'pair-error' });
          if (++p.fails > 5) ws.close();
          break;
        }
        pairKeys.delete(String(m.key));
        a.secrets.add(k.secret); p.secrets.add(k.secret);
        send(a, { type: 'paired', secret: k.secret }); send(p, { type: 'paired', secret: k.secret });
        push(); break;
      }
      case 'unpair': {
        const t = peers.get(m.to), sh = t ? shared(p, t) : [];
        if (!sh.length) break;
        sh.forEach((s) => revoked.set(s, Date.now() + 30 * 864e5));
        for (const q of peers.values()) { const hit = sh.filter((s) => q.secrets.delete(s)); if (hit.length) send(q, { type: 'unpaired', secrets: hit }); }
        push(); break;
      }
      case 'room-join': {
        let id = String(m.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (id.length !== 5) id = Array.from(crypto.randomBytes(5), (b) => ALPHA[b % 32]).join('');
        p.room = id; send(p, { type: 'room', id }); push(); break;
      }
      case 'room-leave': p.room = null; push(); break;
    }
  });
  ws.on('close', () => {
    peers.delete(p.id);
    for (const [k, v] of pairKeys) if (v.id === p.id) pairKeys.delete(k);
    push();
  });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [k, v] of pairKeys) if (v.exp < Date.now()) pairKeys.delete(k);
}, 30000);

server.listen(PORT, '0.0.0.0', () => console.log(`LocalDrop: http://localhost:${PORT}`));

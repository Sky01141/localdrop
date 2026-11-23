'use strict';
const $ = (s) => document.querySelector(s);
const h = (t, o = {}, ...k) => { const e = Object.assign(document.createElement(t), o); e.append(...k); return e; };
const fmt = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);
const PAL = ['#e4572e', '#2e86de', '#1ba672', '#8e5cf0', '#d98a00', '#c2338a'];
const ADJ = ['あおい', 'しずかな', 'はやい', 'まるい', 'ねむい', 'かるい', 'つよい', 'ゆかいな'];
const ANI = ['キツネ', 'ペンギン', 'タヌキ', 'フクロウ', 'カワウソ', 'イルカ', 'ウサギ', 'クマ'];
const pickR = (a) => a[Math.floor(Math.random() * a.length)];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let colorIdx = 0, toastT;
const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 3200); };

/* ---------- ZIP (無圧縮) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = ~0; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function makeZip(entries) {
  const parts = [], cd = [], enc = new TextEncoder(); let off = 0;
  for (const e of entries) {
    const nm = enc.encode(e.name), crc = crc32(e.data), sz = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(lh.buffer, nm, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    cd.push(ch.buffer, nm); off += 30 + nm.length + sz;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cd.reduce((a, b) => a + b.byteLength, 0), true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end.buffer], { type: 'application/zip' });
}
async function saveZip(it) {
  const entries = [];
  for (let i = 0; i < it.files.length; i++) entries.push({ name: it.files[i].name, data: new Uint8Array(await (await (await fetch(it.urls[i])).blob()).arrayBuffer()) });
  const url = URL.createObjectURL(makeZip(entries)), a = h('a', { href: url, download: 'localdrop.zip' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- 自分の名前と機種 ---------- */
let myName = store.get('ld-name') || pickR(ADJ) + pickR(ANI), myDevice = '';
async function detectDevice() {
  const ua = navigator.userAgent; let model = '';
  const ud = navigator.userAgentData;
  if (ud && ud.getHighEntropyValues) { try { model = (await ud.getHighEntropyValues(['model'])).model || ''; } catch {} }
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? model || 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '端末';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'ブラウザ';
  return os + ' · ' + br;
}
const deviceReady = detectDevice().then((d) => { myDevice = d; showMe(); });
function showMe() { $('#myname').value = myName; $('#mydev').textContent = myDevice + (roomId ? ' · ルーム ' + roomId : ''); }
$('#myname').onchange = () => {
  myName = $('#myname').value.trim().slice(0, 20) || pickR(ADJ) + pickR(ANI);
  store.set('ld-name', myName); showMe(); wsSend({ type: 'profile', name: myName, device: myDevice });
};
$('#myname').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };

/* ---------- 状態 ---------- */
const peers = new Map();
let current = null, pending = null, ws, me = null, roomId = null, pairT = null;
const params = new URLSearchParams(location.search);
let urlRoom = /^[A-Za-z0-9]{5}$/.test(params.get('room') || '') ? params.get('room') : null, urlPair = /^\d{6}$/.test(params.get('pair') || '') ? params.get('pair') : null;
const fromShare = params.has('shared');
if (location.search) history.replaceState(null, '', location.pathname);
const secrets = (() => { try { return JSON.parse(store.get('ld-secrets') || '[]'); } catch { return []; } })();
const saveSecrets = () => store.set('ld-secrets', JSON.stringify(secrets));
const wsSend = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const dcOpen = (p) => !!p.dc && p.dc.readyState === 'open';
const ready = (p) => !!p && (dcOpen(p) || p.relay);
const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
const fromB64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
const tag = (p) => p.device + (p.how === 'paired' ? ' · ペア済み' : p.how === 'room' ? ' · ルーム' : '');
function tx(p, x) { // 直接通信(WebRTC)が使えればそれ、だめならサーバー経由
  if (dcOpen(p)) p.dc.send(x);
  else wsSend(typeof x === 'string' ? { type: 'relay', to: p.id, s: x } : { type: 'relay', to: p.id, b: toB64(x) });
}

/* ---------- サーバー接続 ---------- */
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = async () => {
    $('#dot').classList.add('on');
    await deviceReady;
    wsSend({ type: 'join', name: myName, device: myDevice, secrets });
    const r = roomId || urlRoom; urlRoom = null; if (r) wsSend({ type: 'room-join', id: r });
    if (urlPair) { wsSend({ type: 'pair-join', key: urlPair }); urlPair = null; }
  };
  ws.onmessage = (e) => onServer(JSON.parse(e.data));
  ws.onclose = () => {
    $('#dot').classList.remove('on');
    const old = [...peers.values()]; peers.clear(); current = null;
    old.forEach((p) => { clearTimeout(p.timer); p.pc && p.pc.close(); });
    render(); setTimeout(connect, 2000);
  };
}
function onServer(m) {
  if (m.type === 'hello') me = m;
  else if (m.type === 'peers') syncPeers(m.peers);
  else if (m.type === 'signal') { const p = peers.get(m.from); if (p) p.q = p.q.then(() => onSignal(p, m.data)).catch(console.error); }
  else if (m.type === 'relay') { const p = peers.get(m.from); if (p) onData(p, m.s !== undefined ? m.s : fromB64(m.b)); }
  else if (m.type === 'pair-key') {
    $('#pairShow').hidden = false; $('#pairCode').textContent = m.key; $('#pairQr').innerHTML = QR.svg(location.origin + '/?pair=' + m.key);
    $('#pairNote').textContent = '相手がコードを入力するかQRを読み取ると完了します(2分間有効)';
    clearTimeout(pairT); pairT = setTimeout(() => { $('#pairShow').hidden = true; }, m.ttl * 1000);
  } else if (m.type === 'paired') {
    if (!secrets.includes(m.secret)) secrets.push(m.secret); saveSecrets();
    $('#pairShow').hidden = true; $('#pairIn').value = ''; clearTimeout(pairT);
    if ($('#dlg').open) $('#dlg').close();
    toast('ペアにしました。次回からは別のネットワークでも自動でつながります。');
  } else if (m.type === 'pair-error') toast('コードが違うか、期限切れです。');
  else if (m.type === 'unpaired') { for (const k of m.secrets) { const i = secrets.indexOf(k); if (i >= 0) secrets.splice(i, 1); } saveSecrets(); }
  else if (m.type === 'room') { roomId = m.id; renderRoom(); showMe(); }
}
function newPeer(it) {
  const p = { id: it.id, name: it.name, device: it.device, how: it.how, color: PAL[colorIdx++ % PAL.length], pc: null, dc: null, relay: false, log: [], q: Promise.resolve(), rx: null, tx: new Map(), unread: 0 };
  p.timer = setTimeout(() => { if (peers.get(p.id) === p && !ready(p)) { p.relay = true; render(); } }, 5000); // 5秒つながらなければサーバー経由
  return p;
}
function syncPeers(list) {
  const ids = new Set(list.map((p) => p.id));
  for (const [id, p] of peers) if (!ids.has(id)) { peers.delete(id); clearTimeout(p.timer); p.pc && p.pc.close(); if (current === id) current = null; }
  for (const it of list) {
    let p = peers.get(it.id);
    if (!p) { p = newPeer(it); peers.set(it.id, p); if (me.id < it.id) startRtc(p, true); }
    p.name = it.name; p.device = it.device; p.how = it.how;
  }
  render();
}
function startRtc(p, initiator) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  p.pc = pc;
  pc.onicecandidate = (e) => e.candidate && wsSend({ type: 'signal', to: p.id, data: { ice: e.candidate } });
  pc.onconnectionstatechange = () => {
    if (peers.get(p.id) !== p) return;
    if (['failed', 'closed'].includes(pc.connectionState)) { p.pc = p.dc = null; p.relay = true; }
    render();
  };
  if (initiator) {
    setupChannel(p, pc.createDataChannel('data'));
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => wsSend({ type: 'signal', to: p.id, data: { sdp: pc.localDescription } }));
  } else pc.ondatachannel = (e) => setupChannel(p, e.channel);
}
async function onSignal(p, d) {
  if (!p.pc) startRtc(p, false);
  if (d.sdp) {
    await p.pc.setRemoteDescription(d.sdp);
    if (d.sdp.type === 'offer') { await p.pc.setLocalDescription(await p.pc.createAnswer()); wsSend({ type: 'signal', to: p.id, data: { sdp: p.pc.localDescription } }); }
  } else if (d.ice) { try { await p.pc.addIceCandidate(d.ice); } catch {} }
}
function setupChannel(p, dc) {
  p.dc = dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = 1 << 20;
  dc.onopen = render; dc.onclose = render;
  dc.onmessage = (e) => onData(p, e.data);
}

/* ---------- 送受信 ---------- */
const push = (p, item) => { p.log.push(item); render(); return item; };
function incoming(p, body) {
  if (current !== p.id || document.hidden) p.unread++;
  if (document.hidden) notify(p.name, body);
  updateTitle(); render();
}
function onData(p, d) {
  if (typeof d !== 'string') {
    const r = p.rx; if (!r) return;
    r.parts.push(d); r.got += d.byteLength; r.it.prog = (r.base + r.got) / r.it.total; render(); return;
  }
  const m = JSON.parse(d);
  if (m.t === 'msg') { push(p, { from: 'them', text: String(m.text) }); incoming(p, String(m.text).slice(0, 80)); }
  else if (m.t === 'offer') {
    const files = (Array.isArray(m.files) ? m.files : []).slice(0, 200).map((f) => ({ name: String(f.name).slice(0, 200), size: +f.size || 0 }));
    if (!files.length) return;
    push(p, { from: 'them', kind: 'files', id: String(m.id), files, state: 'offer', prog: 0, urls: [], total: files.reduce((a, f) => a + f.size, 0) || 1 });
    incoming(p, files.length > 1 ? files.length + '個のファイルを送ろうとしています' : files[0].name + ' を送ろうとしています');
  }
  else if (m.t === 'accept') sendFiles(p, m.id);
  else if (m.t === 'decline') { const t = p.tx.get(m.id); if (t) { t.it.state = 'declined'; p.tx.delete(m.id); render(); } }
  else if (m.t === 'start') { const it = p.log.find((x) => x.id === m.id && x.from === 'them' && x.state === 'receiving'); if (it) p.rx = { it, i: m.i, parts: [], got: 0, base: it.files.slice(0, m.i).reduce((a, f) => a + f.size, 0) }; }
  else if (m.t === 'end') { const r = p.rx; if (r && r.i === m.i) { r.it.urls[m.i] = URL.createObjectURL(new Blob(r.parts)); p.rx = null; render(); } }
  else if (m.t === 'done') { const it = p.log.find((x) => x.id === m.id && x.from === 'them'); if (it) { it.state = 'done'; it.prog = 1; render(); } }
}
function sendText(p, text) {
  if (!ready(p) || !text.trim()) return false;
  tx(p, JSON.stringify({ t: 'msg', text })); push(p, { from: 'me', text }); return true;
}
function offerFiles(p, files) {
  files = [...files]; if (!ready(p) || !files.length) return;
  const id = rid(), list = files.map((f) => ({ name: f.name, size: f.size }));
  const it = push(p, { from: 'me', kind: 'files', id, files: list, state: 'waiting', prog: 0, urls: [], total: list.reduce((a, f) => a + f.size, 0) || 1 });
  p.tx.set(id, { files, it }); tx(p, JSON.stringify({ t: 'offer', id, files: list }));
}
const sendTo = (p, { files = [], text = '' }) => { if (text) sendText(p, text); if (files.length) offerFiles(p, files); };
const drain = async (p) => {
  if (dcOpen(p)) { const dc = p.dc; if (dc.bufferedAmount > 4 << 20) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; }); }
  else while (ws.bufferedAmount > 1 << 20) await sleep(40);
};
async function sendFiles(p, id) {
  const t = p.tx.get(id); if (!t) return;
  const { files, it } = t; it.state = 'sending'; let base = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; tx(p, JSON.stringify({ t: 'start', id, i }));
      for (let off = 0; off < f.size;) {
        await drain(p);
        const buf = await f.slice(off, off + (dcOpen(p) ? 65536 : 32768)).arrayBuffer();
        tx(p, buf); off += buf.byteLength; it.prog = (base + off) / it.total; render();
      }
      tx(p, JSON.stringify({ t: 'end', id, i })); base += f.size;
    }
    tx(p, JSON.stringify({ t: 'done', id })); it.state = 'done'; it.prog = 1;
  } catch { it.state = 'failed'; }
  p.tx.delete(id); render();
}
function answer(p, it, ok) {
  if (!ready(p)) return;
  it.state = ok ? 'receiving' : 'declined'; it.prog = 0;
  tx(p, JSON.stringify({ t: ok ? 'accept' : 'decline', id: it.id })); render();
}

/* ---------- 通知・インストール・共有 ---------- */
const canNotify = 'Notification' in window;
function syncNotify() { const b = $('#bNotify'); b.hidden = !canNotify || Notification.permission === 'denied'; b.classList.toggle('on', canNotify && Notification.permission === 'granted'); }
$('#bNotify').onclick = async () => {
  if (Notification.permission === 'granted') return toast('通知はオンです。画面が裏にあるとき、受信をお知らせします。');
  const r = await Notification.requestPermission(); syncNotify(); toast(r === 'granted' ? '通知をオンにしました。' : '通知は許可されませんでした。');
};
async function notify(title, body) {
  if (!canNotify || Notification.permission !== 'granted') return;
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) return reg.showNotification(title, { body, tag: 'ld', icon: '/icon-192.png' }); new Notification(title, { body }); } catch {}
}
const updateTitle = () => { const n = [...peers.values()].reduce((a, p) => a + p.unread, 0); document.title = (n ? `(${n}) ` : '') + 'LocalDrop'; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) { const p = peers.get(current); if (p) p.unread = 0; updateTitle(); render(); } });
let deferred;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#bInstall').hidden = false; });
addEventListener('appinstalled', () => { $('#bInstall').hidden = true; });
$('#bInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#bInstall').hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

function setPending(x) { pending = x; renderBar(); toast('送る端末をタップしてください。'); }
function renderBar() {
  $('#bar').hidden = !pending; if (!pending) return;
  $('#barText').textContent = '送る内容: ' + [pending.files.length && `ファイル${pending.files.length}件`, pending.text && 'テキスト'].filter(Boolean).join(' + ') + ' → 端末をタップ';
}
$('#bBarX').onclick = () => { pending = null; renderBar(); };
async function loadShared() {
  try {
    const c = await caches.open('ld-share'), files = []; let text = '';
    for (const rq of await c.keys()) {
      const r = await c.match(rq);
      if (new URL(rq.url).pathname === '/shared-text') text = await r.text();
      else files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('X-Name') || 'file'), { type: r.headers.get('Content-Type') || '' }));
      await c.delete(rq);
    }
    if (files.length || text) setPending({ files, text });
  } catch {}
}
function stage(files, text) { // 貼り付け・ドロップの行き先
  const p = peers.get(current);
  if (p && ready(p)) sendTo(p, { files, text }); else setPending({ files, text });
}

/* ---------- 画面 ---------- */
const STATE = { waiting: '相手の承認待ち', sending: '送信中', receiving: '受信中', done: '完了', declined: '断られました', failed: '失敗' };
function bubble(p, it) {
  const mine = it.from === 'me';
  if (it.kind !== 'files') return h('div', { className: 'b ' + (mine ? 'me' : 'them'), textContent: it.text });
  const box = h('div', { className: 'b file ' + (mine ? 'me' : 'them') });
  it.files.forEach((f, i) => box.append(h('div', { className: 'fr' }, h('span', { className: 'fn', textContent: f.name }), h('small', { textContent: fmt(f.size) }), it.urls[i] ? h('a', { className: 'mini', href: it.urls[i], download: f.name, textContent: '保存' }) : '')));
  box.append(h('small', { textContent: it.state === 'offer' ? `${it.files.length}件・${fmt(it.total)}を受け取りますか?` : STATE[it.state] || '' }));
  if (['sending', 'receiving'].includes(it.state)) box.append(h('div', { className: 'bar2' }, h('span', { style: `width:${Math.round(it.prog * 100)}%` })));
  const act = h('div', { className: 'act' });
  if (it.state === 'offer') act.append(h('button', { className: 'pill sm', type: 'button', textContent: '受け取る', onclick: () => answer(p, it, true) }), h('button', { className: 'pill sm g', type: 'button', textContent: '断る', onclick: () => answer(p, it, false) }));
  if (it.state === 'done' && !mine && it.files.length > 1) act.append(h('button', { className: 'pill sm', type: 'button', textContent: 'ZIPで保存', onclick: () => saveZip(it) }));
  if (act.children.length) box.append(act);
  return box;
}
function drawSheet(p, sh) {
  sh.style.setProperty('--pc', p.color);
  $('#sorb').textContent = [...p.name][0] || '?'; $('#sname').textContent = p.name;
  $('#sdev').textContent = tag(p) + (dcOpen(p) ? '' : ready(p) ? ' · サーバー経由' : ' · 接続中…');
  $('#bUnpair').hidden = p.how !== 'paired';
  const on = ready(p); $('#text').disabled = $('#send').disabled = $('#bPick').disabled = !on;
  const log = $('#log'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.replaceChildren(...(p.log.length ? p.log.map((it) => bubble(p, it)) : [h('p', { className: 'hint', textContent: 'メッセージを送る・ファイルを選ぶ・ここにドロップ、のどれでも送れます。' })]));
  if (atEnd) log.scrollTop = log.scrollHeight;
}
function draw() {
  if (current && !peers.has(current)) current = null;
  const p = peers.get(current), sh = $('#sheet');
  sh.classList.toggle('open', !!p); sh.inert = !p; document.body.classList.toggle('sheet-open', !!p);
  if (p) drawSheet(p, sh);
  const W = $('#stage').clientWidth, H = $('#stage').clientHeight, layer = $('#peerLayer'), list = [...peers.values()], n = list.length;
  layer.replaceChildren(); $('#empty').hidden = n > 0;
  const rx = Math.max(20, Math.min(W * .36, 300, W / 2 - 72)), ry = Math.max(20, Math.min(H * .33, 240, H / 2 - 58));
  list.forEach((q, i) => {
    const a = ((-60 + (i * 360) / n) * Math.PI) / 180, act = q.log.find((it) => it.kind === 'files' && ['sending', 'receiving'].includes(it.state));
    const on = ready(q), direct = dcOpen(q), ask = q.log.some((it) => it.state === 'offer');
    const b = h('button', { className: 'peer' + (on ? '' : ' wait') + (current === q.id ? ' sel' : '') + (ask ? ' ask' : ''), type: 'button', onclick: () => openPeer(q) },
      h('span', { className: 'orb' }, h('span', { className: 'prog' }), [...q.name][0] || '?', h('i', { className: 'st' + (direct ? ' on' : on ? ' relay' : '') }), q.unread ? h('em', { className: 'badge', textContent: q.unread }) : ''),
      h('b', { textContent: q.name }), h('small', { textContent: tag(q) }));
    b.dataset.pid = q.id; b.style.cssText = `left:${W / 2 + Math.cos(a) * rx}px;top:${H / 2 + Math.sin(a) * ry}px;--pc:${q.color};--prog:${act ? Math.round(act.prog * 100) : 0}`;
    layer.append(b);
  });
}
let raf = 0;
const render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
function openPeer(p) {
  if (pending) { if (ready(p)) { sendTo(p, pending); pending = null; renderBar(); } else toast('接続中です。少し待ってからもう一度タップしてください。'); }
  current = p.id; p.unread = 0; updateTitle(); render();
}
$('#bClose').onclick = () => { current = null; render(); };
$('#bUnpair').onclick = () => { const p = peers.get(current); if (p) wsSend({ type: 'unpair', to: p.id }); };
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#dlg').open && current) { current = null; render(); } });
addEventListener('resize', render);

$('#form').onsubmit = (e) => { e.preventDefault(); const p = peers.get(current); if (p && sendText(p, $('#text').value)) $('#text').value = ''; };
$('#bPick').onclick = () => $('#pick').click();
$('#pick').onchange = (e) => { const p = peers.get(current); if (p) offerFiles(p, e.target.files); e.target.value = ''; };

// ドラッグ&ドロップ(端末の上にドロップ=その端末へ) と 貼り付け
const clearDrop = () => document.querySelectorAll('.peer.drop').forEach((x) => x.classList.remove('drop'));
addEventListener('dragover', (e) => { e.preventDefault(); clearDrop(); const t = e.target.closest && e.target.closest('.peer'); if (t) t.classList.add('drop'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) clearDrop(); });
addEventListener('drop', (e) => {
  e.preventDefault(); clearDrop();
  const files = [...e.dataTransfer.files], text = files.length ? '' : e.dataTransfer.getData('text/plain');
  if (!files.length && !text) return;
  const t = e.target.closest && e.target.closest('.peer'), p = t && peers.get(t.dataset.pid);
  if (p && ready(p)) { sendTo(p, { files, text }); current = p.id; p.unread = 0; render(); } else stage(files, text);
});
addEventListener('paste', (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const files = [...((e.clipboardData && e.clipboardData.files) || [])], text = files.length ? '' : (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (files.length || text) { e.preventDefault(); stage(files, text); }
});

/* ---------- つなぐ(ペア・ルーム・QR) ---------- */
const dlg = $('#dlg');
$('#bConnect').onclick = () => dlg.showModal();
$('#dClose').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function tab(which) {
  $('#pPair').hidden = which !== 'pair'; $('#pRoom').hidden = which !== 'room';
  $('#tPair').setAttribute('aria-selected', which === 'pair'); $('#tRoom').setAttribute('aria-selected', which === 'room');
}
$('#tPair').onclick = () => tab('pair'); $('#tRoom').onclick = () => tab('room');
const copyText = async (t, msg) => { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast(t); } };
$('#pairCode').onclick = () => copyText($('#pairCode').textContent, 'コードをコピーしました。');
$('#roomCode').onclick = () => copyText($('#roomCode').textContent, 'コードをコピーしました。');
$('#bPair').onclick = () => wsSend({ type: 'pair-start' });
$('#bPairJoin').onclick = () => { const k = $('#pairIn').value.replace(/\D/g, ''); if (k.length !== 6) return toast('6桁の数字を入力してください。'); wsSend({ type: 'pair-join', key: k }); };
$('#bRoom').onclick = () => wsSend({ type: 'room-join' });
$('#bRoomJoin').onclick = () => { const id = $('#roomIn').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (id.length !== 5) return toast('5文字のコードを入力してください。'); wsSend({ type: 'room-join', id }); };
$('#bRoomLeave').onclick = () => { wsSend({ type: 'room-leave' }); roomId = null; renderRoom(); showMe(); };
const roomLink = () => location.origin + '/?room=' + roomId;
$('#bRoomCopy').onclick = () => copyText(roomLink(), 'リンクをコピーしました。');
function renderRoom() { $('#roomShow').hidden = !roomId; if (roomId) { $('#roomCode').textContent = roomId; $('#roomQr').innerHTML = QR.svg(roomLink()); } }
for (const [inp, btn] of [['#pairIn', '#bPairJoin'], ['#roomIn', '#bRoomJoin']]) $(inp).onkeydown = (e) => { if (e.key === 'Enter') $(btn).click(); };

/* ---------- 起動 ---------- */
showMe(); syncNotify(); render(); connect();
if (fromShare) loadShared();
if (typeof module !== 'undefined') module.exports = { makeZip };

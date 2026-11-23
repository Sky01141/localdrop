/* 最小のQRコード生成 (バイトモード / 誤り訂正L / バージョン1〜10)。アルゴリズムは Project Nayuki 方式。 */
const QR = (() => {
  const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], BLK = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
  const raw = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = ((z << 1) ^ ((z >>> 7) * 0x11d)) & 255; z ^= ((y >>> i) & 1) * x; } return z; };
  const divisor = (d) => { const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = mul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; };
  const remainder = (data, div) => { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => (r[i] ^= mul(c, f))); } return r; };

  function encode(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let v = 1;
    for (; v <= 10; v++) { const cap = Math.floor(raw(v) / 8) - ECC[v - 1] * BLK[v - 1]; if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break; }
    if (v > 10) throw new Error('too long');
    const capBits = (Math.floor(raw(v) / 8) - ECC[v - 1] * BLK[v - 1]) * 8, bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, capBits - bits.length)); while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    const nb = BLK[v - 1], ecl = ECC[v - 1], rawCw = Math.floor(raw(v) / 8), short = Math.floor(rawCw / nb), nShort = nb - (rawCw % nb), div = divisor(ecl), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + short - ecl + (i < nShort ? 0 : 1)); k += d.length; const e = remainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== short - ecl || j >= nShort) out.push(b[i]); });
    return { v, cw: out };
  }
  const fb = (mask) => { const d = (1 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((d << 10) | r) ^ 0x5412; };
  const putFormat = (s, n, mask) => {
    const b = fb(mask), g = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) s(8, i, g(i)); s(8, 7, g(6)); s(8, 8, g(7)); s(7, 8, g(8));
    for (let i = 9; i < 15; i++) s(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) s(n - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) s(8, n - 15 + i, g(i));
    s(8, n - 8, true);
  };
  const inv = (k, x, y) => [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][k];
  function penalty(m) {
    const n = m.length; let p = 0, dark = 0;
    for (let y = 0; y < n; y++) {
      let rx = 1, ry = 1;
      for (let x = 0; x < n; x++) {
        if (m[y][x]) dark++;
        if (x > 0) {
          if (m[y][x] === m[y][x - 1]) { rx++; p += rx === 5 ? 3 : rx > 5 ? 1 : 0; } else rx = 1;
          if (m[x][y] === m[x - 1][y]) { ry++; p += ry === 5 ? 3 : ry > 5 ? 1 : 0; } else ry = 1;
          if (y > 0 && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x] && m[y][x] === m[y - 1][x - 1]) p += 3;
        }
      }
    }
    return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  }
  function matrix(text) {
    const { v, cw } = encode(text), n = v * 4 + 17;
    const m = Array.from({ length: n }, () => Array(n).fill(false)), fn = Array.from({ length: n }, () => Array(n).fill(false));
    const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    const na = v > 1 ? Math.floor(v / 7) + 2 : 0, pos = [];
    if (na) { const step = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2; pos.push(6); for (let p = n - 7; pos.length < na; p -= step) pos.splice(1, 0, p); }
    pos.forEach((cx, i) => pos.forEach((cy, j) => { if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    putFormat(set, n, 0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const c = ((b >>> i) & 1) === 1, a = n - 11 + (i % 3), k = Math.floor(i / 3); set(a, k, c); set(k, a, c); } }
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fn[y][x] && i < cw.length * 8) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    let best = null, bp = Infinity;
    for (let k = 0; k < 8; k++) {
      const c = m.map((r) => r.slice());
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && inv(k, x, y)) c[y][x] = !c[y][x];
      putFormat((x, y, d) => { c[y][x] = d; }, n, k);
      const p = penalty(c); if (p < bp) { bp = p; best = c; }
    }
    return best;
  }
  function svg(text) {
    const m = matrix(text), n = m.length; let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + 4},${y + 4}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges" role="img" aria-label="QRコード"><path d="${d}" fill="#0e2a33"/></svg>`;
  }
  return { svg, matrix };
})();
if (typeof module !== 'undefined') module.exports = QR;

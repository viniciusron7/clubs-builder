/* ============================================================================
 * share.js — Share builds by URL (?b=) and export images (PNG).
 * No dependencies. Exposes window.Share.
 * ========================================================================== */
window.Share = (function () {
  // ---- base64url <-> UTF-8 text ----
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // ---- build <-> compact string ----
  // v2: {v:2, a:archetypeId, l:level, h:height, w:weight,
  //      t:{attrId:val}, p:[playstyleIds], pu:{playstyleId:{before,after}}}
  function encode(build) {
    const obj = { v: 2, a: build.archetypeId, l: build.level, h: build.height, w: build.weight };
    if (build.attributes && Object.keys(build.attributes).length) obj.t = build.attributes;
    if (build.playstyles && build.playstyles.length) obj.p = build.playstyles;
    if (build.playstylePurchases && Object.keys(build.playstylePurchases).length) obj.pu = build.playstylePurchases;
    if (build.signatures && Object.keys(build.signatures).length) obj.s = build.signatures;
    if (build.positions && build.positions.length) obj.po = build.positions;
    if (build.disabledAttrs && build.disabledAttrs.length) obj.da = build.disabledAttrs;
    if (build.sumExcluded && build.sumExcluded.length) obj.se = build.sumExcluded;
    return b64urlEncode(JSON.stringify(obj));
  }
  function decode(str) {
    try {
      const o = JSON.parse(b64urlDecode(str));
      return {
        archetypeId: o.a || null,
        level: o.l != null ? o.l : 1,
        height: o.h != null ? o.h : window.DATA.defaultHeight,
        weight: o.w != null ? o.w : window.DATA.defaultWeight,
        attributes: o.t || {},
        playstyles: o.p || [],
        playstylePurchases: o.pu || {},
        signatures: o.s || {},
        positions: o.po || [],
        disabledAttrs: o.da || [],
        sumExcluded: o.se || [],
      };
    } catch (e) {
      return null;
    }
  }

  function toUrl(build) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('b', encode(build));
    return url.toString();
  }
  function fromUrl() {
    const b = new URLSearchParams(window.location.search).get('b');
    return b ? decode(b) : null;
  }
  function replaceUrl(build) {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('b', encode(build));
      window.history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  // ---- export image: build card drawn on canvas (robust) ----
  const PAL = {
    bg: '#0d1420', panel: '#162030', card: '#1c2838', track: '#0b1018', border: '#2a3a4a',
    text: '#eaeaea', sec: '#c8cdd3', muted: '#6b7280', accent: '#34d399', blue: '#3b82f6', special: '#a855f7',
  };
  function loadImage(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  async function renderCard(build, d) {
    const D = window.DATA, C = window.Calc, L = D.labels;
    const attrName = (id) => (L.attribute[id] || id);
    const cats = d.arch.position === 'GK' ? d.categories : d.categories.filter((c) => c.id !== 'goalkeeping');
    // footer PlayStyle items: 4 signature (with +) + equipped regular items
    const sigItems = C.signatureSlots(build, d.categories).filter((s) => s.playStyleId).map((s) => ({ id: s.playStyleId, plus: s.isPlus }));
    const regItems = (build.playstyles || []).map((id) => ({ id, plus: false }));
    const items = sigItems.concat(regItems);

    // preload images
    const archImg = await loadImage('archetypes/' + d.arch.iconFileName);
    const psImgs = {};
    for (const it of items) { const p = C.playstyle(it.id); if (p) { const key = it.id + (it.plus ? '+' : ''); if (!psImgs[key]) psImgs[key] = await loadImage((it.plus ? 'playstyles/plus/' : 'playstyles/') + p.iconFileName); } }

    // layout
    const W = 1120, pad = 40, colGap = 20, colCount = 3;
    const colW = (W - 2 * pad - (colCount - 1) * colGap) / colCount;
    const headH = 150;
    const rowH = 34, catHeadH = 30, cardPad = 14, cardGap = 16;
    const catH = (c) => cardPad * 2 + catHeadH + c.attributes.length * rowH;
    const colY = [headH + pad, headH + pad, headH + pad];
    const place = [];
    cats.forEach((c) => {
      const ci = colY.indexOf(Math.min(...colY));
      place.push({ c, x: pad + ci * (colW + colGap), y: colY[ci] });
      colY[ci] += catH(c) + cardGap;
    });
    let bottom = Math.max(...colY);
    const psRows = Math.ceil(items.length / 4);
    const footH = items.length ? 40 + psRows * 64 : 0;
    const H = bottom + footH + pad;

    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';

    // background
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);

    // ---- header ----
    ctx.fillStyle = PAL.panel; roundRect(ctx, pad, pad, W - 2 * pad, headH - pad, 14); ctx.fill();
    ctx.strokeStyle = PAL.border; ctx.lineWidth = 1; ctx.stroke();
    if (archImg) ctx.drawImage(archImg, pad + 18, pad + 16, 76, 76);
    ctx.fillStyle = PAL.text; ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(L.archetype[d.arch.id] || d.arch.id, pad + 110, pad + 46);
    ctx.fillStyle = PAL.muted; ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText((L.position[d.arch.position.toLowerCase()] || d.arch.position).toUpperCase(), pad + 110, pad + 72);

    // stats on the right
    const stat = (label, val, x, color) => {
      ctx.textAlign = 'right';
      ctx.fillStyle = PAL.muted; ctx.font = '600 12px system-ui'; ctx.fillText(label, x, pad + 36);
      ctx.fillStyle = color || PAL.text; ctx.font = '700 24px system-ui'; ctx.fillText(val, x, pad + 64);
      ctx.textAlign = 'left';
    };
    const rx = W - pad - 24;
    stat('LVL', String(build.level), rx, PAL.text);
    stat('AP', String(d.ap.available), rx - 110, d.ap.available < 0 ? '#ef4444' : PAL.accent);
    const overalls = C.overallMapForValues(build.positions || [], d, null);
    const overallValues = Object.values(overalls);
    if (overallValues.length) stat(overallValues.length > 1 ? 'MIN EST OVR' : 'EST OVR', String(Math.min(...overallValues)), rx - 220, PAL.accent);
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL.sec; ctx.font = '600 15px system-ui';
    ctx.fillText(build.height + 'cm / ' + build.weight + 'kg', rx, pad + 92);
    if (d.accel) { ctx.fillStyle = PAL.blue; ctx.font = '700 14px system-ui'; ctx.fillText(d.accel, rx, pad + 114); }
    ctx.textAlign = 'left';
    if (overallValues.length) {
      ctx.fillStyle = PAL.sec; ctx.font = '600 13px system-ui';
      ctx.fillText(Object.entries(overalls).map(([position, overall]) => position + ' ' + overall).join('  ·  '), pad + 110, pad + 100);
    }

    // ---- categories ----
    place.forEach(({ c, x, y }) => {
      const h = catH(c);
      ctx.fillStyle = PAL.card; roundRect(ctx, x, y, colW, h, 12); ctx.fill();
      ctx.strokeStyle = PAL.border; ctx.stroke();
      ctx.fillStyle = PAL.accent; ctx.font = '700 15px system-ui';
      ctx.fillText((L.category[c.id] || c.id).toUpperCase(), x + cardPad, y + cardPad + 16);
      let ry = y + cardPad + catHeadH;
      c.attributes.forEach((a) => {
        const val = a.currentValue;
        ctx.fillStyle = a.isKeyAttribute ? PAL.accent : PAL.sec;
        ctx.font = '600 14px system-ui';
        ctx.fillText((a.isKeyAttribute ? '★ ' : '') + attrName(a.id), x + cardPad, ry + 14);
        ctx.textAlign = 'right';
        ctx.fillStyle = C.barColor(val); ctx.font = '700 15px system-ui';
        ctx.fillText(a.displayType === 'stars' ? val + '★' : String(val), x + colW - cardPad, ry + 14);
        ctx.textAlign = 'left';
        // bar — star attributes range from 1..maxValue (2..5), not 1..99
        const span = a.displayType === 'stars' ? Math.max(1, a.maxValue - 1) : 98;
        const bw = colW - cardPad * 2, bx = x + cardPad, by = ry + 20;
        ctx.fillStyle = PAL.track; roundRect(ctx, bx, by, bw, 6, 3); ctx.fill();
        ctx.fillStyle = C.barColor(val); roundRect(ctx, bx, by, Math.max(2, bw * (val - 1) / span), 6, 3); ctx.fill();
        ry += rowH;
      });
    });

    // ---- PlayStyles (signature + equipped) ----
    if (items.length) {
      let fy = bottom + 6;
      ctx.fillStyle = PAL.muted; ctx.font = '700 13px system-ui';
      ctx.fillText('PLAYSTYLES', pad, fy + 12);
      fy += 30;
      const cellW = (W - 2 * pad) / 4;
      items.forEach((it, i) => {
        const p = C.playstyle(it.id); if (!p) return;
        const cx = pad + (i % 4) * cellW, cy = fy + Math.floor(i / 4) * 64;
        ctx.fillStyle = PAL.card; roundRect(ctx, cx, cy, cellW - 12, 54, 10); ctx.fill();
        ctx.strokeStyle = it.plus ? PAL.special : PAL.border; ctx.stroke();
        const img = psImgs[it.id + (it.plus ? '+' : '')];
        if (img) ctx.drawImage(img, cx + 10, cy + 11, 32, 32);
        ctx.fillStyle = PAL.text; ctx.font = '600 13px system-ui';
        let name = ((L.playStyle[it.id] && L.playStyle[it.id].name) || it.id) + (it.plus ? '+' : '');
        ctx.fillText(name.length > 16 ? name.slice(0, 15) + '…' : name, cx + 50, cy + 30);
        if (it.plus) { ctx.fillStyle = PAL.special; ctx.font = '700 9px system-ui'; ctx.fillText('SIGNATURE', cx + 50, cy + 44); }
      });
    }
    return cv;
  }

  async function saveImage(build, derived, filename) {
    const canvas = await renderCard(build, derived);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('toBlob falhou'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'fc26-build.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        resolve();
      }, 'image/png');
    });
  }

  return { encode, decode, toUrl, fromUrl, replaceUrl, saveImage, renderCard };
})();

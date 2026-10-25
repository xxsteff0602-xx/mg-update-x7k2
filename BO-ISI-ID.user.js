// ==UserScript==
// @name         MEGA GAMING - Isi TID + User ID ke Sheet & Auto Confirm Deposit
// @namespace    mega-gaming
// @version      3.8
// @updateURL    https://raw.githubusercontent.com/xxsteff0602-xx/mg-update-x7k2/main/BO-ISI-ID.user.js
// @downloadURL  https://raw.githubusercontent.com/xxsteff0602-xx/mg-update-x7k2/main/BO-ISI-ID.user.js
// @description  Baca deposit di BO (semua domain panel UG / GIGA), isi Username + Transaction ID ke Buku di aplikasi MEGA GAMING (atau Google Sheet), dicocokkan dengan nama pengirim myBCA, dan opsional auto confirm deposit yang cocok.
// @include      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// ==/UserScript==
(function () {
  'use strict';
  // Domain panel sering ganti, jadi @include * dipakai. Di luar domain yang ada kata "admin"/"backoffice"
  // script langsung berhenti. Hanya jalan di halaman utama, bukan iframe.
  if (!/admin|backoffice/i.test(location.hostname) || window.top !== window.self) return;
  // Hanya jalan di halaman deposit:
  //   GIGA: /transactions/instant_transaction/deposit_only   UG: /instant_transaction/deposit_only
  if (!/\/instant_transaction\/deposit_only/i.test(location.pathname)) return;

  const every = () => Math.min(60, Math.max(3, Number(GM_getValue('every', 10)) || 10)) * 1000;   // baca tabel tiap x detik (diatur di panel)
  const FAST = 2000;            // cek "ada deposit baru?" ke aplikasi tiap 2 detik (murah, tanpa baca tabel)
  const MAX_AGE = 36 * 3600e3;  // abaikan transaksi lebih tua dari 36 jam
  const MAX_CONFIRM_PER_SCAN = 3;
  const MAX_REJECT_PER_SCAN = 2;

  // ---------------- pengaturan ----------------
  // Link Sheet + kode rahasia berlaku untuk semua situs. Nama tab (label), mode confirm, batas nominal
  // dan izin PEND DISIMPAN PER SITUS (hostname), supaya BO brand lain tidak ikut ke tab rekening ini.
  const H = location.hostname;
  const cfg = () => ({
    url: GM_getValue('url', ''), secret: GM_getValue('secret', ''),
    label: GM_getValue('label@' + H, ''),                          // kosong = script mati di situs ini
    mode: GM_getValue('mode@' + H, 'off'),                         // off | tandai | on
    rej: GM_getValue('rej@' + H, 'off'),                           // auto reject: off | tandai | on
    max: Number(GM_getValue('max@' + H, 5000000)) || 5000000,      // batas nominal auto confirm
    pend: GM_getValue('pend@' + H, false),                         // boleh auto confirm kalau di myBCA masih PEND
  });
  // ---------------- tampilan (Shadow DOM, tidak bentrok dengan CSS BO) ----------------
  const ST = { msg: 'memulai…', bad: false, filled: 0, waiting: 0, ready: 0, done: 0, notes: [], scanning: false, last: 0 };
  let host, root, open = false, draft = null;
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:Nunito,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{position:fixed;left:14px;bottom:14px;z-index:2147483000;color:#12302f}
  #pn{position:absolute;left:0;bottom:calc(100% + 10px)}
  .below #pn{bottom:auto;top:calc(100% + 10px)}.right #pn{left:auto;right:0}
  .pill{display:flex;align-items:center;gap:10px;padding:7px 13px 7px 8px;border-radius:999px;cursor:grab;user-select:none;touch-action:none;
    background:#fff;border:1.5px solid #b7e4d3;box-shadow:0 6px 22px rgba(10,60,50,.22);transition:transform .15s,box-shadow .15s}
  .pill:hover{transform:translateY(-1px);box-shadow:0 10px 28px rgba(10,60,50,.28)}.pill.drag{cursor:grabbing;transition:none}
  .logo{width:28px;height:28px;border-radius:10px;display:grid;place-items:center;font:800 12px/1 Nunito,system-ui;color:#fff;background:linear-gradient(135deg,#17c48a,#0a8a5f);letter-spacing:-.3px;position:relative;flex:none}
  .dot{position:absolute;right:-3px;top:-3px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;background:#12b76a}
  .dot.bad{background:#e5372a}.dot.idle{background:#98a2b3}.dot.scan{background:#f5a50b;animation:p 1s infinite}
  @keyframes p{50%{opacity:.35}}
  .t{display:flex;flex-direction:column;line-height:1.2}
  .t b{font:800 13.5px Nunito,system-ui;color:#0b2423}
  .t span{font:600 12px Nunito,system-ui;color:#4a6662;max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chip{font:800 10.5px Nunito,system-ui;padding:4px 9px;border-radius:999px;letter-spacing:.5px;background:#eef3f2;color:#3f5a56}
  .chip.warn{background:#fff0cc;color:#8a5200}.chip.red{background:#ffe1dd;color:#b42318}
  .panel{width:360px;max-width:calc(100vw - 28px);max-height:min(80vh,680px);overflow:auto;overscroll-behavior:contain;border-radius:20px;padding:18px;
    background:#fff;border:1.5px solid #cfe9df;box-shadow:0 22px 56px rgba(10,60,50,.3)}
  .panel::-webkit-scrollbar{width:9px}.panel::-webkit-scrollbar-thumb{background:#c5d9d3;border-radius:8px}
  .hd{display:flex;align-items:center;gap:11px;margin-bottom:14px}
  .hd .logo{width:38px;height:38px;border-radius:12px;font-size:14px}
  .hd h3{margin:0;font:800 17px Nunito,system-ui;color:#0b2423}.hd small{display:block;font:600 12px Nunito,system-ui;color:#557470;margin-top:2px}
  .x{width:32px;height:32px;border-radius:10px;border:1px solid #d5e5e0;background:#f4f8f7;color:#2f4b47;cursor:pointer;font:700 14px Nunito,system-ui}.x:hover{background:#e6f0ed}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}
  .st{padding:11px 12px 10px;border-radius:14px;background:#f3f8f6;border:1px solid #dcebe5}
  .st b{display:block;font:800 24px/1.1 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#0b2423}.st span{font:700 11px Nunito,system-ui;letter-spacing:.5px;color:#557470;text-transform:uppercase}
  .st.g{background:#e6f8f0;border-color:#bfe9d6}.st.g b{color:#0a7a52}.st.y{background:#fff6dd;border-color:#f3dfa3}.st.y b{color:#8a5200}
  .msg{padding:10px 12px;border-radius:12px;font:600 13px/1.45 Nunito,system-ui;background:#e6f8f0;color:#0a5d3f;border:1px solid #bfe9d6;margin-bottom:12px}
  .msg.bad{background:#ffe9e6;color:#a1251a;border-color:#f5bdb7}
  .notes{margin:-4px 0 12px;padding:0;list-style:none;font:600 12.5px/1.45 Nunito,system-ui;color:#3d5a56}.notes li{padding:5px 0;border-bottom:1px dashed #d7e6e1}
  .f{margin-bottom:13px}.f>label{display:block;font:800 11.5px Nunito,system-ui;letter-spacing:.5px;text-transform:uppercase;color:#2f4b47;margin-bottom:6px}
  .f input[type=text],.f input[type=password],.f input[type=number]{width:100%;height:42px;padding:0 13px;border-radius:12px;border:1.5px solid #c9dcd6;background:#fff;color:#0b2423;font:600 14px Nunito,system-ui;outline:none}
  .f input:focus{border-color:#12a874;box-shadow:0 0 0 3px rgba(18,168,116,.2)}
  .f small{display:block;margin-top:6px;font:500 12px/1.45 Nunito,system-ui;color:#557470}
  .seg{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;border-radius:14px;background:#eaf1ef}
  .seg button{height:38px;border:0;border-radius:11px;background:transparent;color:#3f5a56;font:800 13px Nunito,system-ui;cursor:pointer}
  .seg button:hover{background:#dfeae7}
  .seg button.on{background:linear-gradient(135deg,#17c48a,#0a8a5f);color:#fff;box-shadow:0 4px 12px rgba(10,138,95,.35)}
  .seg button.on.danger{background:linear-gradient(135deg,#f0584b,#d12d20);box-shadow:0 4px 12px rgba(209,45,32,.35)}
  .warn{margin-top:9px;padding:10px 12px;border-radius:12px;font:600 12.5px/1.5 Nunito,system-ui;background:#ffe9e6;color:#a1251a;border:1px solid #f5bdb7}
  .row2{display:flex;align-items:center;gap:12px}.grow{flex:1}
  .sw{position:relative;width:46px;height:26px;border-radius:99px;background:#c5d3cf;border:0;cursor:pointer;flex:none;transition:.15s}
  .sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:.15s}
  .sw.on{background:#12a874}.sw.on::after{left:23px}
  .sec{margin:16px 0 10px;padding-top:12px;border-top:1px solid #e3eeea;font:800 11.5px Nunito,system-ui;letter-spacing:.8px;text-transform:uppercase;color:#0a8a5f}
  .btns{display:flex;gap:9px;margin-top:16px}
  .b{flex:1;height:44px;border-radius:13px;border:1.5px solid #c9dcd6;background:#fff;color:#12302f;font:800 13.5px Nunito,system-ui;cursor:pointer}.b:hover{background:#f0f6f4}
  .b.p{border:0;background:linear-gradient(135deg,#17c48a,#0a8a5f);color:#fff;box-shadow:0 6px 16px rgba(10,138,95,.35)}.b.p.danger{background:linear-gradient(135deg,#f0584b,#d12d20);box-shadow:0 6px 16px rgba(209,45,32,.35)}
  .ft{margin-top:11px;font:600 12px Nunito,system-ui;color:#557470;text-align:center}`;
  // Nama brand dibaca dari gambar logo web (nama file seperti ..._VIP555__3100x800.png, alt "homepage..")
  function brand() {
    const im = [...document.images].find((i) => /__([A-Za-z0-9]{3,})__\d+x\d+/i.test(i.currentSrc || i.src || '')) || [...document.images].find((i) => /^homepage/i.test(i.alt || ''));
    if (!im) return { name: '', src: '' };
    const m = String(im.currentSrc || im.src).match(/__([A-Za-z0-9]{3,})__\d+x\d+/i);
    return { name: m ? m[1].toUpperCase() : '', src: im.currentSrc || im.src };
  }
  const cfgLabelText = () => { const c = cfg(); return c.label || 'belum diatur'; };
  const modeChip = (c) => c.mode === 'on' ? '<span class="chip red">AUTO CONFIRM</span>' : c.mode === 'tandai' ? '<span class="chip warn">TANDAI</span>' : '';
  function loadFont() {
    if (document.getElementById('mg-nunito')) return;
    const l = document.createElement('link'); l.id = 'mg-nunito'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@500;600;700;800;900&display=swap';
    (document.head || document.documentElement).appendChild(l);
  }
  function ensureUI() {
    if (host) return;
    loadFont();
    host = document.createElement('div'); host.id = 'mg-bo-root'; document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' }); root.innerHTML = '<style>' + CSS + '</style><div class="wrap" id="wrap"><div class="pill" id="pill" title="Klik: buka panel · Tarik: geser"></div><div id="pn"></div></div>';
    initDrag();
    const closeP = () => { if (!open) return; open = false; draft = null; root.getElementById('pn').innerHTML = ''; render(); };
    document.addEventListener('pointerdown', (e) => { if (open && !e.composedPath().includes(host)) closeP(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeP(); }, true);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
  }
  function render() {
    ensureUI(); const c = cfg();
    const bad = ST.bad || !c.url, idle = !c.url || !c.label;
    const sub = !c.url ? 'klik untuk mengatur' : !c.label ? 'mati di situs ini' : (ST.scanning ? 'memeriksa…' : ST.filled + ' terisi · ' + ST.waiting + ' menunggu');
    root.getElementById('pill').innerHTML = '<div class="logo">MG<i class="dot ' + (bad ? 'bad' : idle ? 'idle' : ST.scanning ? 'scan' : '') + '"></i></div><div class="t"><b>' + esc(c.label || brand().name || 'MEGA GAMING') + '</b><span>' + esc(sub) + '</span></div>' + modeChip(c);
    const pn = root.getElementById('pn'); applyPos();
    if (!open) { pn.innerHTML = ''; return; }
    if (pn.firstChild) { live(); return; }                    // panel sudah terbuka: hanya segarkan angka, jangan bangun ulang (scroll + isian tetap)
    panel();
  }
  function live() {
    const q = (id) => root.getElementById(id); if (!q('v-fill')) return;
    q('v-fill').textContent = ST.filled; q('v-wait').textContent = ST.waiting; q('v-done').textContent = ST.done;
    const ago = ST.last ? Math.max(0, Math.round((Date.now() - ST.last) / 1000)) + ' dtk lalu' : '–';
    const m = q('v-msg'); m.textContent = ST.msg + ' · ' + ago; m.className = 'msg' + (ST.bad ? ' bad' : '');
    const n = q('v-notes'); n.innerHTML = ST.notes.slice(0, 4).map((x) => '<li>' + esc(x) + '</li>').join('');
  }
  function panel() {
    const c = cfg(); const pn = root.getElementById('pn'); const old = pn.querySelector('.panel'); const keep = old ? old.scrollTop : 0;
    const bd = brand();
    const d = draft || (draft = { url: c.url, secret: c.secret, label: c.label || bd.name, mode: c.mode, rej: c.rej, max: c.max, pend: c.pend, every: every() / 1000 });
    const ago = ST.last ? Math.max(0, Math.round((Date.now() - ST.last) / 1000)) + ' dtk lalu' : '–';
    pn.innerHTML = '<div class="panel"><div class="hd"><div class="logo">MG</div><div style="min-width:0"><h3>ID → Buku</h3><small>' + (bd.name ? '<b style="color:#0a8a5f">' + esc(bd.name) + '</b> · ' : '') + esc(H) + '</small></div><button class="x" data-a="resetpos" title="Kembalikan pil ke pojok kiri bawah" style="margin-left:auto;margin-right:6px;width:auto;padding:0 9px;font:700 10.5px Nunito,system-ui">Reset posisi</button><button class="x" style="margin-left:0" data-a="close" title="Tutup">✕</button></div>'
      + '<div class="stats"><div class="st g"><b id="v-fill">' + ST.filled + '</b><span>Terisi</span></div><div class="st y"><b id="v-wait">' + ST.waiting + '</b><span>Menunggu</span></div><div class="st"><b id="v-done">' + ST.done + '</b><span>Confirm</span></div></div>'
      + '<div class="msg' + (ST.bad ? ' bad' : '') + '" id="v-msg">' + esc(ST.msg) + ' · ' + ago + '</div>'
      + '<ul class="notes" id="v-notes">' + ST.notes.slice(0, 4).map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>'
      + '<div class="sec">Sambungan (semua situs)</div>'
      + '<div class="f"><label>Link tujuan</label><input type="text" data-k="url" value="' + esc(d.url) + '" placeholder="http://127.0.0.1:8765/bo"><small>Dari aplikasi: Buku → Sambungkan BO. Atau link Apps Script (/exec) untuk Google Sheet.</small></div>'
      + '<div class="f"><label>Kode rahasia</label><input type="password" data-k="secret" value="' + esc(d.secret) + '" placeholder="kode dari aplikasi"></div>'
      + '<div class="f"><label>Baca tabel tiap (detik)</label><input type="number" data-k="every" value="' + esc(d.every) + '" min="3" max="60"><small>3–60. Selain itu, tabel langsung dibaca saat aplikasi dapat deposit baru atau tabel BO berubah.</small></div>'
      + '<div class="sec">Situs ini</div>'
      + '<div class="f"><label>Nama rekening</label><input type="text" data-k="label" value="' + esc(d.label) + '" placeholder="misal VIP555"><small>' + (bd.name && !c.label ? 'Terdeteksi dari logo web: <b>' + esc(bd.name) + '</b>. Simpan kalau benar. ' : '') + 'Kosongkan kalau BO ini tidak memakai rekening myBCA ini: script mati di situs ini.</small></div>'
      + '<div class="f"><label>Auto confirm deposit</label><div class="seg">' + [['off', 'Mati'], ['tandai', 'Tandai'], ['on', 'Otomatis']].map(([v, l]) => '<button data-a="mode" data-v="' + v + '" class="' + (d.mode === v ? 'on' + (v === 'on' ? ' danger' : '') : '') + '">' + l + '</button>').join('') + '</div>'
      + '<small>' + (d.mode === 'off' ? 'Hanya mengisi User ID dan Deposit ID (khusus Bank / BCA).' : d.mode === 'tandai' ? 'Menandai baris yang AKAN di-confirm, tanpa menekan apa pun. Pakai ini dulu.' : '') + '</small>'
      + (d.mode === 'on' ? '<div class="warn"><b>Hati-hati:</b> script akan menekan Confirm sendiri pada deposit yang cocok. Pastikan sudah menjalankan mode Tandai dan hasilnya benar.</div>' : '') + '</div>'
      + '<div class="f"><label>Auto reject deposit</label><div class="seg">' + [['off', 'Mati'], ['tandai', 'Tandai'], ['on', 'Otomatis']].map(([v, l]) => '<button data-a="rej" data-v="' + v + '" class="' + (d.rej === v ? 'on' + (v === 'on' ? ' danger' : '') : '') + '">' + l + '</button>').join('') + '</div>'
      + '<small>' + (d.rej === 'tandai' ? 'Menandai baris yang AKAN di-reject beserta alasannya, tanpa menekan apa pun.' : d.rej === 'on' ? '' : 'Reject: nominal beda, nama beda jelas, atau tanpa bukti, setelah masa tunggu (atur di aplikasi: Pengaturan > Auto reject). E-wallet tidak disentuh.') + '</small>'
      + (d.rej === 'on' ? '<div class="warn"><b>Hati-hati:</b> script akan me-reject deposit sendiri. Jalankan mode Tandai dulu dan cek tanda merahnya benar.</div>' : '') + '</div>'
      + (d.mode !== 'off' ? '<div class="f"><label>Batas nominal (Rp)</label><input type="number" data-k="max" value="' + esc(d.max) + '" min="0"><small>Di atas ini tidak di-confirm otomatis.</small></div>'
        + '<div class="f row2"><div class="grow"><label style="margin:0">Boleh saat masih PEND</label><small>Mati = tunggu sampai sudah posting di myBCA (lebih aman).</small></div><button class="sw' + (d.pend ? ' on' : '') + '" data-a="pend"></button></div>' : '')
      + '<div class="btns"><button class="b" data-a="test">Tes koneksi</button><button class="b p' + (d.mode === 'on' ? ' danger' : '') + '" data-a="save">' + (d.mode === 'on' ? 'Aktifkan' : 'Simpan') + '</button></div>'
      + '<div class="ft" id="ft">Membaca tabel tiap ' + (every() / 1000) + ' detik · langsung saat ada deposit baru</div></div>';
    const np = pn.querySelector('.panel'); if (np) np.scrollTop = keep;
  }
  // pil bisa digeser (posisi diingat), klik tanpa geser = buka/tutup panel
  const wrapEl = () => root.getElementById('wrap');
  function applyPos() {
    const w = wrapEl(); if (!w) return; let p = null;
    try { p = JSON.parse(GM_getValue('pos', 'null')); } catch (e) { p = null; }
    if (p && typeof p.x === 'number') {
      const pw = w.offsetWidth || 160, ph = w.offsetHeight || 40;
      const x = Math.min(Math.max(0, p.x), Math.max(0, innerWidth - pw)), y = Math.min(Math.max(0, p.y), Math.max(0, innerHeight - ph));
      w.style.left = x + 'px'; w.style.top = y + 'px'; w.style.bottom = 'auto';
      w.classList.toggle('below', y + ph / 2 < innerHeight / 2); w.classList.toggle('right', x + pw / 2 > innerWidth / 2);
    } else { w.style.left = '14px'; w.style.top = 'auto'; w.style.bottom = '14px'; w.classList.remove('below', 'right'); }
  }
  function initDrag() {
    const pill = root.getElementById('pill'), w = wrapEl(); let d = null;
    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; const r = w.getBoundingClientRect();
      d = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false }; pill.setPointerCapture(e.pointerId);
    });
    pill.addEventListener('pointermove', (e) => {
      if (!d) return; const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true; pill.classList.add('drag');
      GM_setValue('pos', JSON.stringify({ x: d.ox + dx, y: d.oy + dy })); applyPos();
    });
    const end = () => {
      if (!d) return; const moved = d.moved; d = null; pill.classList.remove('drag');
      if (!moved) { open = !open; draft = null; root.getElementById('pn').innerHTML = ''; render(); }
    };
    pill.addEventListener('pointerup', end); pill.addEventListener('pointercancel', () => { d = null; pill.classList.remove('drag'); });
    addEventListener('resize', applyPos); applyPos();
  }
  function onInput(e) { const k = e.target.dataset && e.target.dataset.k; if (k && draft) draft[k] = e.target.value; }
  async function onClick(e) {
    const a = e.target.closest('[data-a]'); if (!a) return; const act = a.dataset.a;
    if (act === 'close') { open = false; render(); return; }
    if (act === 'resetpos') { GM_setValue('pos', 'null'); applyPos(); return; }
    if (act === 'rej') { draft.rej = a.dataset.v; panel(); return; }
    if (act === 'mode') { draft.mode = a.dataset.v; panel(); return; }
    if (act === 'pend') { draft.pend = !draft.pend; panel(); return; }
    if (act === 'test') {
      const ft = root.getElementById('ft'); ft.textContent = 'Menguji…';
      try { await post({ url: String(draft.url || '').trim(), secret: String(draft.secret || '').trim() }, []); ft.style.color = '#0a7a52'; ft.textContent = 'Terhubung dan kode rahasia benar'; }
      catch (err) { ft.style.color = '#b42318'; ft.textContent = 'Gagal: ' + err; }
      return;
    }
    if (act === 'save') {
      GM_setValue('url', String(draft.url || '').trim()); GM_setValue('secret', String(draft.secret || '').trim()); GM_setValue('label@' + H, String(draft.label || '').trim());
      GM_setValue('mode@' + H, draft.mode); GM_setValue('rej@' + H, draft.rej || 'off'); GM_setValue('max@' + H, Number(String(draft.max).replace(/\D/g, '')) || 5000000); GM_setValue('pend@' + H, !!draft.pend);
      GM_setValue('every', Math.min(60, Math.max(3, Number(String(draft.every).replace(/\D/g, '')) || 10)));
      draft = null; open = false; root.getElementById('pn').innerHTML = ''; status('tersimpan'); scan();
    }
  }
  const openPanel = () => { ensureUI(); open = true; draft = null; root.getElementById('pn').innerHTML = ''; render(); };
  GM_registerMenuCommand('Buka panel MEGA GAMING', openPanel);

  // status dari scan -> tampilan
  function saveST() { try { GM_setValue('st@' + H, JSON.stringify({ filled: ST.filled, waiting: ST.waiting, done: ST.done, msg: ST.msg, bad: ST.bad, notes: ST.notes, last: ST.last })); } catch (e) { /* abaikan */ } }
  function loadST() { try { Object.assign(ST, JSON.parse(GM_getValue('st@' + H, '{}'))); ST.scanning = false; } catch (e) { /* abaikan */ } }
  function status(t, bad) { ST.msg = t; ST.bad = !!bad; ST.last = Date.now(); saveST(); render(); }

  // tanda di baris BO
  function mark(r, kind) {
    const tr = r.tr; if (!tr) return;
    const cols = { ok: '#12b76a', soon: '#fdb022', done: '#12b76a', rej: '#e5372a' };
    tr.style.boxShadow = kind ? 'inset 5px 0 0 ' + cols[kind] : '';
    let chip = tr.querySelector('.mg-chip');
    if (!kind) { if (chip) chip.remove(); return; }
    const txt = kind === 'ok' ? '✓ ' + r.user : kind === 'soon' ? 'siap confirm' : kind === 'rej' ? 'reject: ' + (r.rejWhy || '') : 'confirmed';
    if (!chip) { chip = document.createElement('span'); chip.className = 'mg-chip'; (r.cell || tr).appendChild(chip); }
    chip.textContent = 'MG · ' + txt;
    chip.style.cssText = 'display:block;width:max-content;margin:3px 0 0 0;white-space:nowrap;padding:2px 8px;border-radius:999px;font:700 10px system-ui;letter-spacing:.3px;color:' + (kind === 'soon' ? '#7a4b00' : kind === 'rej' ? '#fff' : '#04251a') + ';background:' + (kind === 'soon' ? '#fdc65c' : kind === 'rej' ? '#e5372a' : '#6ee7b7');
  }

  // ---------------- baca tabel BO ----------------
  const clean = (t) => String(t || '').replace(/[↑↓⇅]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const BADGES = /^(new|first time|baru|vip|refund|pending)$/i;
  const COLS = {
    date: ['transaction date', 'tanggal', 'date'],
    id: ['transaction id', 'trx id', 'id transaksi', 'transaction no'],
    name: ['account name', 'nama rekening', 'nama akun'],
    user: ['username', 'user name', 'user id'],
    credit: ['credit', 'kredit'],
    fund: ['fund method', 'metode'],
    status: ['status'],
    receipt: ['receipt', 'bukti'],
  };
  const colIdx = (ths, k) => ths.findIndex((h) => COLS[k].some((n) => h.startsWith(n)));

  function findTable() {
    for (const t of document.querySelectorAll('table')) {
      const ths = [...t.querySelectorAll('thead th')].map((h) => clean(h.textContent));
      if (colIdx(ths, 'id') >= 0 && colIdx(ths, 'credit') >= 0 && colIdx(ths, 'user') >= 0 && t.querySelector('tbody tr td')) return { t, ths };
    }
    return null;
  }

  let DEAD = [];      // deposit yang di-reject / dibatalkan di BO (oleh staff atau script): pasangan banknya dilepas
  function parseRows() {
    const f = findTable(); if (!f) return null;
    DEAD = [];
    const I = {}; Object.keys(COLS).forEach((k) => { I[k] = colIdx(f.ths, k); });
    const out = [];
    f.t.querySelectorAll('tbody tr').forEach((tr) => {
      const td = tr.querySelectorAll('td');
      if (td.length < f.ths.length || td.length < 5) return;
      const lines = (c) => (c ? c.innerText.split('\n').map((x) => x.replace(/MG · .*$/, '').trim()).filter(Boolean) : []);   // buang chip tanda dari script ini
      const credit = parseFloat(String(td[I.credit].innerText).replace(/[^\d.]/g, '')) || 0;
      if (credit <= 0) return;                                          // hanya deposit (Credit), WD diabaikan
      const fund = I.fund >= 0 ? td[I.fund].innerText.replace(/\s+/g, ' ').trim() : '';
      if (!isBCA(fund)) return;                                         // hanya deposit Bank / BCA; BRI, BNI, e-wallet, QRIS tidak disentuh
      if (/qris/i.test(fund)) return;                                   // QRIS tidak lewat myBCA
      const wallet = /e-?wallet|ovo|dana|gopay|go-pay|link\s*aja|shopee|isaku/i.test(fund);   // e-wallet: staff proses manual (harus lihat bukti)
      const txid = (lines(td[I.id])[0] || '').replace(/\s+/g, '');
      const user = lines(td[I.user]).filter((x) => !BADGES.test(x))[0] || '';
      const name = I.name >= 0 ? (lines(td[I.name])[0] || '').split(' / ')[0].trim() : '';
      const m = (I.date >= 0 ? td[I.date].innerText : '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/) || [];
      const boWhen = m[1] ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;   // jam menurut BO (zona BO bisa beda dengan PC)
      const when = boWhen ? boWhen + skew() : 0;
      if (!(txid && user && (!when || Date.now() - when < MAX_AGE))) return;
      const first = (I.status >= 0 ? lines(td[I.status])[0] : '') || '';      // "qrishoki in progress" TIDAK sama dengan "In Progress"
      const inProg = /^in\s*progr?ess$/i.test(first);
      if (!inProg && /reject|cancel|fail|declin|tolak|batal|gagal|expire/i.test(first)) { DEAD.push({ txid, user, amount: Math.round(credit) }); return; }   // deposit gagal: tidak boleh memakai transfer siapa pun
      const link = tr.querySelector('a.confirm-link');
      out.push({ txid, user, name, amount: Math.round(credit), fund, inProg, boWhen,
                 href: link ? (link.getAttribute('href') || '') : '', tr, cell: td[I.user], wallet, when,
                 noReceipt: I.receipt >= 0 ? !!td[I.receipt].querySelector('.btn-danger .fa-times, .btn-danger .fa-xmark, a.btn-danger') && !/view/i.test(td[I.receipt].innerText) : false,
                 rejUrl: (tr.querySelector('a.rejectSingle[data-url*="/reject/' + txid + '"]') || {}).dataset ? tr.querySelector('a.rejectSingle[data-url*="/reject/' + txid + '"]').dataset.url : '' });
    });
    return out;
  }

  // ---------------- kirim ke Sheet ----------------
  function post(c, rows) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST', url: c.url, timeout: 30000, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify({ secret: c.secret, rows }),
        onload: (r) => { let j; try { j = JSON.parse(r.responseText); } catch (e) { reject('balasan bukan dari aplikasi / Apps Script, cek link'); return; } if (j.ok && j.rev != null) lastRev = j.rev; j.ok ? resolve(j) : reject(String(j.error || 'ditolak')); },
        onerror: () => reject('gagal terhubung'), ontimeout: () => reject('timeout'),
      });
    });
  }

  const load = (k) => { try { return JSON.parse(GM_getValue(k, '{}')); } catch (e) { return {}; } };
  // Selisih jam BO vs PC (kelipatan jam). Dipelajari dari deposit yang baru muncul saat script sedang jalan.
  const skew = () => Number(GM_getValue('skew@' + H, 0)) || 0;
  function learnSkew(d) {
    const h = Math.round(d / 3600e3);
    if (Math.abs(h) <= 3 && Math.abs(d - h * 3600e3) < 20 * 60e3 && h * 3600e3 !== skew()) GM_setValue('skew@' + H, h * 3600e3);
  }
  // Kapan script PERTAMA kali melihat tiap deposit (jam PC). Dipakai untuk masa tunggu reject, jadi tidak tergantung jam BO.
  function stampSeen(rows) {
    const seen = load('seen@' + H), now = Date.now();
    const live = now - (Number(GM_getValue('last@' + H, 0)) || 0) < 60e3;     // script jalan terus (scan terakhir < 1 menit lalu)
    rows.forEach((r) => { if (!seen[r.txid]) { seen[r.txid] = now; if (live && r.boWhen) learnSkew(now - r.boWhen); } r.seenAt = seen[r.txid]; });
    rows.forEach((r) => { r.when = r.boWhen ? r.boWhen + skew() : 0; });
    save('seen@' + H, seen); GM_setValue('last@' + H, now);
  }
  const toMatch = (r, c) => ({ kind: 'match', txid: r.txid, user: r.user, name: r.name, amount: r.amount, label: c.label, when: r.when || r.seenAt, done: !r.inProg, tzo: new Date().getTimezoneOffset() });
  function takeResults(j, dec, conf) {
    (j.results || []).forEach((x) => {
      if (x.matched) dec[String(x.txid)] = { sure: !!x.sure, pend: !!x.pend, confirmed: !!x.confirmed || !!conf[x.txid] };
      else if (x.matched === false && dec[String(x.txid)] && !dec[String(x.txid)].confirmed) delete dec[String(x.txid)];   // pasangan dilepas di aplikasi
    });
  }
  const save = (k, o) => { const keys = Object.keys(o); if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((x) => delete o[x]); GM_setValue(k, JSON.stringify(o)); };

  // ---------------- auto confirm ----------------
  // Syarat SEMUA harus terpenuhi (kalau tidak, dibiarkan untuk dicek manual):
  //  - baris BO berstatus In Progress dan punya link confirm deposit
  //  - Sheet mencocokkan nominal + nama dengan yakin dan tidak ada kandidat lain yang sama kuat (sure)
  //  - belum pernah di-confirm (dicek lokal dan di Sheet)
  //  - nominal <= batas, Fund Method bank, dan di BO hanya ada SATU deposit In Progress dengan nominal itu
  //  - kalau di myBCA masih PEND, hanya jika diizinkan
  const isBCA = (f) => /^bank\s*\/\s*bca\b/i.test(String(f || '').trim());     // hanya "Bank / BCA" (bukan BRI, BNI, SEABANK, e-wallet)
  function why(r, d, c, sameAmount) {
    if (!d) return 'belum cocok di Sheet';
    if (d.confirmed) return 'sudah di-confirm';
    if (!r.inProg) return 'bukan In Progress';
    if (!d.sure) return 'pencocokan nama kurang yakin';
    if (d.pend && !c.pend) return 'masih PEND di myBCA';
    if (r.amount > c.max) return 'di atas batas nominal';
    if (!isBCA(r.fund)) return 'bukan Fund Method Bank / BCA';
    if (sameAmount > 1) return 'ada deposit BO dengan nominal kembar';
    if (!/\/confirm\/[A-Za-z0-9]/i.test(r.href) || /confirm_withdraw|promotion_confirm|to_confirm/i.test(r.href)) return 'link confirm deposit tidak ditemukan';
    if (!r.href.includes(r.txid)) return 'link confirm tidak memuat TID (format beda)';
    return '';
  }

  async function confirmOne(r) {
    const url = r.href.startsWith('http') ? r.href : location.origin + r.href;
    let res; try { res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); } catch (e) { return 'gagal koneksi'; }
    let j = null; try { j = await res.clone().json(); } catch (e) { /* bukan JSON */ }
    if (j) { if (j.s && /error|warning|fail/i.test(String(j.s))) return 'ditolak server: ' + (j.m || ''); return ''; }
    return res.ok ? '' : 'HTTP ' + res.status;
  }

  // ---------------- auto reject ----------------
  const RE_FIELD = /remark|reason|alasan|note|keterangan|ket/i;
  const ntxt = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const REASON = { RECEIPT: 'without receipt', NAME: 'bank name not same', AMOUNT: 'amount not same' };
  const absUrl = (u) => new URL(u, location.href).href;
  async function rejectOne(r, kind) {
    const want = REASON[kind]; if (!want) return 'alasan tidak dikenal';
    let res; try { res = await fetch(absUrl(r.rejUrl), { credentials: 'include' }); } catch (e) { return 'gagal koneksi'; }
    if ((res.redirected && /login|signin/i.test(res.url)) || !res.ok) return res.ok ? 'sesi BO habis' : 'form HTTP ' + res.status;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (doc.querySelector('input[type=password]')) return 'sesi BO habis';
    const form = doc.querySelector('form[action*="/reject/"]') || doc.querySelector('#reject_form');
    if (!form) return 'form reject tidak ketemu (mungkin sudah diproses)';
    const action = absUrl(form.getAttribute('action') || r.rejUrl); let at = action; try { at = decodeURIComponent(action); } catch (e) { /* abaikan */ }
    if (!at.includes(r.txid)) return 'form menunjuk transaksi lain, dibatalkan';
    const sel = form.querySelector('select[name="remark"]') || [...form.querySelectorAll('select[name]')].find((x) => RE_FIELD.test(x.name)) || form.querySelector('select[name]');
    if (!sel) return 'dropdown alasan tidak ada';
    const opt = [...sel.options].find((o) => ntxt(o.textContent) === want) || [...sel.options].find((o) => ntxt(o.textContent).includes(want));
    if (!opt || !opt.value) return 'alasan "' + want.toUpperCase() + '" tidak ada di dropdown';
    const btn = form.querySelector('button[type=submit][name], input[type=submit][name]');
    const body = new URLSearchParams();
    form.querySelectorAll('input[type=hidden][name]').forEach((i) => body.set(i.name, i.value));
    const tok = (form.querySelector('input[name="_token"]') || doc.querySelector('input[name="_token"]') || {}).value || (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    if (tok) body.set('_token', tok);
    body.set(sel.name, opt.value);
    body.set(btn ? btn.name : 'rejectDeposit', btn ? (btn.value || 'REJECT') : 'REJECT');
    let p; try { p = await fetch(action, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: body.toString() }); } catch (e) { return 'gagal koneksi saat kirim'; }
    if (p.redirected && /login|signin/i.test(p.url)) return 'sesi BO habis';
    const j = await p.json().catch(() => null);
    if (!j) return 'respons bukan JSON (HTTP ' + p.status + ')';
    return (p.ok && (j.s === 'success' || j.status === 'success' || j.success === true)) ? '' : 'ditolak server: ' + (j.m || j.message || '');
  }

  let busy = false, rerun = false, lastRev = null;
  async function scan() {
    const c = cfg();
    if (!c.url) { status('klik untuk mengatur', true); return; }
    if (!c.label) { status('mati di situs ini (nama tab kosong). Klik untuk mengatur'); return; }
    if (busy) { rerun = true; return; } busy = true; ST.scanning = true; render();
    try {
      watchTable();
      const rows = parseRows();
      if (rows === null) { status('tabel transaksi tidak ada di halaman ini'); return; }
      stampSeen(rows);
      const dec = load('dec@' + H), conf = load('conf@' + H);

      // 0) deposit yang sudah di-reject / dibatalkan di BO tapi masih memegang baris bank: lepaskan, supaya deposit lain bisa memakainya
      const rel = DEAD.filter((d) => dec[d.txid] && !dec[d.txid].confirmed && !conf[d.txid]);
      if (rel.length) {
        await post(c, rel.map((d) => ({ kind: 'released', txid: d.txid, user: d.user, amount: d.amount, label: c.label })));
        rel.forEach((d) => { delete dec[d.txid]; }); save('dec@' + H, dec);
      }

      // 1) isi TID + User ID. In Progress yang belum di-confirm dikirim TIAP scan (status PEND / yakin bisa berubah);
      //    deposit yang sudah selesai (approved) cukup sekali dan hanya diisi kalau nama yakin cocok. Yang rejected tidak dikirim.
      const pick = rows.filter((r) => r.inProg ? !(dec[r.txid] && dec[r.txid].confirmed) && !conf[r.txid] : !dec[r.txid])
        .sort((a, b) => (a.when || a.seenAt) - (b.when || b.seenAt));      // deposit paling lama dipasangkan duluan
      if (pick.length) {
        const j = await post(c, pick.map((r) => toMatch(r, c)));
        takeResults(j, dec, conf); save('dec@' + H, dec);
      }
      const filled = rows.filter((r) => dec[r.txid]).length;
      rows.forEach((r) => mark(r, dec[r.txid] ? ((dec[r.txid].confirmed || conf[r.txid]) ? 'done' : 'ok') : null));

      // 2) auto confirm
      let ready = 0, done = 0, notes = [];
      if (c.mode !== 'off') {
        const prog = rows.filter((r) => r.inProg);
        for (const r of rows) {
          const d = dec[r.txid]; if (!d || d.confirmed || conf[r.txid]) continue;
          const same = prog.filter((x) => x.amount === r.amount).length;
          // member yang sama baru saja punya deposit nominal sama yang sudah approved: bisa jadi transfer lama dipakai dua kali
          const twin = rows.some((x) => !x.inProg && x.user === r.user && x.amount === r.amount && x.txid !== r.txid && Math.abs((x.when || x.seenAt) - (r.when || r.seenAt)) < 3 * 3600e3);
          const w = twin ? 'user sama baru saja deposit nominal sama (approved), cek manual' : why(r, d, c, same);
          if (w) { if (r.inProg && d) notes.push(r.amount.toLocaleString('id-ID') + ': ' + w); continue; }
          ready++;
          if (c.mode === 'tandai') { mark(r, 'soon'); continue; }
          if (done >= MAX_CONFIRM_PER_SCAN) continue;
          const fresh = load('conf@' + H); if (fresh[r.txid]) { conf[r.txid] = fresh[r.txid]; continue; }   // tab BO lain sudah meng-confirm
          conf[r.txid] = Date.now(); fresh[r.txid] = conf[r.txid]; save('conf@' + H, fresh);              // tandai dulu supaya tidak pernah dobel
          const err = await confirmOne(r);
          if (err) { delete conf[r.txid]; const f2 = load('conf@' + H); delete f2[r.txid]; save('conf@' + H, f2); notes.push('gagal confirm ' + r.amount.toLocaleString('id-ID') + ': ' + err); continue; }
          done++; dec[r.txid].confirmed = true; save('dec@' + H, dec);
          mark(r, 'done');
          try { await post(c, [{ kind: 'confirmed', txid: r.txid, user: r.user, name: r.name, amount: r.amount, label: c.label }]); } catch (e) { /* tidak fatal */ }
        }
      }
      // 3) auto reject (keputusan dari aplikasi: hanya reject kalau buktinya jelas)
      let rejNow = 0, rejSoon = 0;
      if (c.rej !== 'off') {
        const rejd = load('rejd@' + H);
        const cand = rows.filter((r) => r.inProg && !r.wallet && isBCA(r.fund) && r.rejUrl && (r.when || r.seenAt) && !rejd[r.txid] && !conf[r.txid] && !(dec[r.txid] && dec[r.txid].confirmed));
        if (cand.length) {
          const j = await post(c, cand.map((r) => ({ kind: 'judge', txid: r.txid, name: r.name, amount: r.amount, bornAt: r.when, seenAt: r.seenAt, noReceipt: r.noReceipt })));
          const vd = j.verdicts || {};
          for (const r of cand) {
            const v = vd[r.txid]; if (!v) continue;
            if (v.v !== 'reject') { if (v.v === 'skip' && !/masa tunggu|lebih tua|belum sehat/.test(v.why || '')) notes.push(r.amount.toLocaleString('id-ID') + ' dibiarkan: ' + v.why); continue; }
            r.rejWhy = v.reason === 'RECEIPT' ? 'WITHOUT RECEIPT' : v.reason === 'NAME' ? 'BANK NAME NOT SAME' : 'AMOUNT NOT SAME';
            notes.push(r.amount.toLocaleString('id-ID') + ' ' + r.rejWhy + ' — ' + v.why);
            if (c.rej === 'tandai') { mark(r, 'rej'); rejSoon++; continue; }
            if (rejNow >= MAX_REJECT_PER_SCAN) continue;
            rejd[r.txid] = Date.now(); save('rejd@' + H, rejd);              // tandai dulu supaya tidak pernah dobel
            const err = await rejectOne(r, v.reason);
            if (err) { delete rejd[r.txid]; save('rejd@' + H, rejd); notes.push('gagal reject ' + r.amount.toLocaleString('id-ID') + ': ' + err); if (/sesi/.test(err)) break; continue; }
            rejNow++; mark(r, 'rej');
            try { await post(c, [{ kind: 'rejected', txid: r.txid, user: r.user, name: r.name, amount: r.amount, reason: r.rejWhy, why: v.why, label: c.label }]); } catch (e) { /* tidak fatal */ }
          }
        }
      }
      ST.filled = filled; ST.waiting = rows.length - filled; ST.ready = ready; ST.done += done; ST.notes = notes;
      if (c.rej === 'tandai' && rejSoon) notes.unshift('Akan di-reject: ' + rejSoon + ' (mode Tandai)');
      if (rejNow) notes.unshift(rejNow + ' deposit di-reject barusan');
      status(c.mode === 'tandai' ? 'Siap confirm: ' + ready + ' (mode Tandai, belum menekan apa pun)' : c.mode === 'on' ? done + ' di-confirm barusan, auto confirm aktif' : 'Berjalan normal');
    } catch (e) { status(String(e), true); }
    finally { busy = false; ST.scanning = false; render(); if (rerun) { rerun = false; setTimeout(scan, 300); } }
  }

  // ---------------- deteksi cepat ----------------
  // a) tabel BO berubah (deposit baru masuk lewat ajax / refresh tabel) -> baca langsung
  let mo = null, moT = 0;
  const isMine = (n) => !!n && (n.nodeType === 1 ? !!n.closest('.mg-chip') : !!(n.parentElement && n.parentElement.closest('.mg-chip')));
  const ownMut = (m) => isMine(m.target) || (m.type === 'childList' && (m.addedNodes.length + m.removedNodes.length) > 0 && [...m.addedNodes, ...m.removedNodes].every(isMine));
  function watchTable() {
    const f = findTable(); if (!f || (mo && mo._t === f.t)) return;
    if (mo) mo.disconnect();
    mo = new MutationObserver((ms) => { if (ms.every(ownMut)) return; clearTimeout(moT); moT = setTimeout(scan, 700); });
    mo.observe(f.t, { childList: true, subtree: true, characterData: true }); mo._t = f.t;
  }
  // b) aplikasi baru mencatat deposit (angka rev berubah) -> baca langsung, tidak menunggu interval
  function pollRev() {
    const c = cfg();
    if (!c.label || !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(c.url || '')) return;   // hanya mode aplikasi (bukan Google Sheet)
    GM_xmlhttpRequest({ method: 'GET', url: c.url, timeout: 4000, onload: (r) => {
      let j; try { j = JSON.parse(r.responseText); } catch (e) { return; }
      if (j.rev == null) return;
      if (lastRev !== null && j.rev !== lastRev) scan();
      lastRev = j.rev;
    } });
  }

  // tampil langsung (dengan angka terakhir) walau halaman BO masih memuat atau baru di-refresh
  loadST(); ensureUI(); render();
  const kick = () => setTimeout(scan, 1200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick); else kick();
  (function loop() { setTimeout(() => { scan(); loop(); }, every()); })();
  setInterval(pollRev, FAST);
})();

'use strict';
/* ContrapTea, DOM UI: palette, inspector, wiring interactions, modals, save/share */

const UI = {
  canvas: null, wrap: null,
  view: { fit: 1, cw: 1, ch: 1, dpr: 1 },
  cam: { z: 1, cx: SIM.WORLD_W / 2, cy: SIM.WORLD_H / 2 },   // pan/zoom camera
  pointers: new Map(),   // active pointerId -> {sx, sy} (css px) for pinch tracking
  pinch: null,
  drag: null,            // {kind:'move'|'wire'|'hose'|'pan', ...}
  hoverTerminal: null,
  tickerUntil: 0,
};

/* ---------------- coordinate mapping & camera ---------------- */
function fitView() {
  const r = UI.wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  UI.canvas.width = r.width * dpr;
  UI.canvas.height = r.height * dpr;
  UI.view = { fit: Math.min(r.width / SIM.WORLD_W, r.height / SIM.WORLD_H), cw: r.width, ch: r.height, dpr };
  clampCam();
}
function viewScale() { return UI.view.fit * UI.cam.z; }
function clampCam() {
  const S = viewScale();
  const visW = UI.view.cw / S, visH = UI.view.ch / S;
  UI.cam.cx = visW >= SIM.WORLD_W ? SIM.WORLD_W / 2 : U.clamp(UI.cam.cx, visW / 2, SIM.WORLD_W - visW / 2);
  UI.cam.cy = visH >= SIM.WORLD_H ? SIM.WORLD_H / 2 : U.clamp(UI.cam.cy, visH / 2, SIM.WORLD_H - visH / 2);
}
function evtScreen(e) {
  const r = UI.canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function screenToWorld(sx, sy) {
  const S = viewScale();
  return [(sx - UI.view.cw / 2) / S + UI.cam.cx, (sy - UI.view.ch / 2) / S + UI.cam.cy];
}
function evtWorld(e) {
  const [sx, sy] = evtScreen(e);
  return screenToWorld(sx, sy);
}
function zoomAt(sx, sy, factor) {
  const [wx, wy] = screenToWorld(sx, sy);
  UI.cam.z = U.clamp(UI.cam.z * factor, 1, 4);
  const S = viewScale();
  UI.cam.cx = wx - (sx - UI.view.cw / 2) / S;
  UI.cam.cy = wy - (sy - UI.view.ch / 2) / S;
  clampCam();
}
function resetZoom() {
  UI.cam.z = 1;
  UI.cam.cx = SIM.WORLD_W / 2; UI.cam.cy = SIM.WORLD_H / 2;
  clampCam();
}

/* ---------------- palette ---------------- */
function buildPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  for (const disc of ['mech', 'elec', 'chem']) {
    const head = document.createElement('div');
    head.className = 'pal-head ' + disc;
    head.textContent = DISC_NAMES[disc] + (disc === 'chem' ? ' & process' : '');
    pal.appendChild(head);
    for (const type of PALETTE_ORDER[disc]) {
      const def = PARTS[type];
      const b = document.createElement('button');
      b.className = 'pal-item ' + disc;
      b.dataset.type = type;
      b.innerHTML = `<span class="ico">${def.ico}</span><span>${def.name}</span>`;
      b.title = def.desc;
      b.addEventListener('click', () => {
        if (Game.mode !== 'build') return;
        Game.placing = Game.placing === type ? null : type;
        Game.selected = null;
        refreshPalette(); refreshInspector();
      });
      pal.appendChild(b);
    }
  }
  refreshPalette();
}
function refreshPalette() {
  document.querySelectorAll('.pal-item').forEach(b => {
    const type = b.dataset.type;
    b.classList.toggle('placing', Game.placing === type);
    const unique = PARTS[type].unique && Game.state.parts.some(p => p.type === type);
    b.classList.toggle('disabled', !!unique);
  });
}

/* ---------------- hit testing (bigger slop for touch) ---------------- */
function partAt(wx, wy, slop = 6) {
  const parts = Game.state.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const def = PARTS[p.type];
    const [lx, ly] = U.toLocal(p, wx, wy);
    if (Math.abs(lx) <= def.w / 2 + slop && Math.abs(ly) <= def.h / 2 + slop) return p;
  }
  return null;
}
function terminalAt(wx, wy, r = 13) {
  for (const p of Game.state.parts) {
    for (const t of worldTerminals(p)) {
      if (U.dist(wx, wy, t.x, t.y) < r) return t;
    }
    if (p.type === 'pump') {
      const [ox, oy] = U.toWorld(p, PARTS.pump.outlet.x, PARTS.pump.outlet.y);
      if (U.dist(wx, wy, ox, oy) < r) return { x: ox, y: oy, idx: -1, part: p, outlet: true };
    }
  }
  return null;
}
function wireAt(wx, wy, tol = 9) {
  const termPos = (ref) => {
    const p = Game.state.parts.find(q => q.id === ref[0]);
    if (!p) return null;
    const t = worldTerminals(p)[ref[1]];
    return t ? [t.x, t.y] : null;
  };
  for (const w of Game.state.wires) {
    const a = termPos(w.a), b = termPos(w.b);
    if (!a || !b) continue;
    const mx = (a[0] + b[0]) / 2, my = Math.max(a[1], b[1]) + 30;
    if (U.segDist(wx, wy, a[0], a[1], mx, my) < tol || U.segDist(wx, wy, mx, my, b[0], b[1]) < tol) return w;
  }
  return null;
}

/* ---------------- pointer interactions ---------------- */
function bindPointer() {
  const cv = UI.canvas;

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const [sx, sy] = evtScreen(e);
    UI.pointers.set(e.pointerId, { sx, sy });
    if (UI.pointers.size === 2) { startPinch(); return; }
    if (UI.pinch) return;

    const [wx, wy] = screenToWorld(sx, sy);
    const touch = e.pointerType === 'touch';
    const slop = touch ? 14 : 6;
    const startPan = () => {
      UI.drag = { kind: 'pan', sx0: sx, sy0: sy, cx0: UI.cam.cx, cy0: UI.cam.cy, moved: false };
    };

    if (Game.mode === 'run') {
      // interactive overrides while running; anywhere else drags the camera
      const p = partAt(wx, wy, slop);
      if (p && p.type === 'switch') {
        Game.rt.switchState[p.id] = !Game.rt.switchState[p.id];
        setTicker(`🎚 Switch flipped ${Game.rt.switchState[p.id] ? 'ON' : 'OFF'}`);
      } else if (p && p.type === 'gate') {
        Game.rt.gateManual[p.id] = !Game.rt.gateOpen[p.id];
        setTicker('🚧 Gate override!');
      } else if (p && p.type === 'tap') {
        Game.rt.tapManual[p.id] = !Game.rt.tapOn[p.id];
        setTicker('🚰 Tap override!');
      } else {
        startPan();
      }
      return;
    }

    // placing a new part
    if (Game.placing) {
      const part = makePart(Game.placing, wx, wy);
      Game.state.parts.push(part);
      Game.selected = part.id;
      if (!e.shiftKey) Game.placing = null;
      refreshPalette(); refreshInspector(); saveLocal();
      return;
    }

    // start a wire / hose from a terminal
    const t = terminalAt(wx, wy, touch ? 22 : 13);
    if (t) {
      UI.drag = t.outlet
        ? { kind: 'hose', from: t, x: wx, y: wy }
        : { kind: 'wire', from: t, x: wx, y: wy };
      return;
    }

    // grab a part
    const p = partAt(wx, wy, slop);
    if (p) {
      Game.selected = p.id;
      UI.drag = { kind: 'move', part: p, dx: p.x - wx, dy: p.y - wy, moved: false };
      refreshInspector();
      return;
    }

    // select a wire?
    const w = wireAt(wx, wy, touch ? 16 : 9);
    if (w) { Game.selected = 'wire:' + w.id; refreshInspector(); return; }

    // empty space: drag pans the camera; a motionless tap deselects on release
    startPan();
  });

  cv.addEventListener('pointermove', (e) => {
    const [sx, sy] = evtScreen(e);
    if (UI.pointers.has(e.pointerId)) UI.pointers.set(e.pointerId, { sx, sy });
    if (UI.pinch) { updatePinch(); return; }

    const [wx, wy] = screenToWorld(sx, sy);
    Game.mouse = [wx, wy];
    UI.hoverTerminal = (Game.mode === 'build' && !UI.drag && e.pointerType !== 'touch') ? terminalAt(wx, wy) : null;
    updateCursor(wx, wy);
    if (!UI.drag) return;
    if (UI.drag.kind === 'pan') {
      if (Math.hypot(sx - UI.drag.sx0, sy - UI.drag.sy0) > 5) UI.drag.moved = true;
      const S = viewScale();
      UI.cam.cx = UI.drag.cx0 - (sx - UI.drag.sx0) / S;
      UI.cam.cy = UI.drag.cy0 - (sy - UI.drag.sy0) / S;
      clampCam();
    } else if (UI.drag.kind === 'move') {
      const p = UI.drag.part;
      p.x = Math.round((wx + UI.drag.dx) / 10) * 10;
      p.y = Math.round((wy + UI.drag.dy) / 10) * 10;
      UI.drag.moved = true;
    } else {
      UI.drag.x = wx; UI.drag.y = wy;
    }
  });

  cv.addEventListener('pointerup', (e) => {
    UI.pointers.delete(e.pointerId);
    if (UI.pinch) {
      if (UI.pointers.size < 2) UI.pinch = null;
      return;
    }
    const [wx, wy] = evtWorld(e);
    const touch = e.pointerType === 'touch';
    if (!UI.drag) return;
    if (UI.drag.kind === 'wire') {
      const t = terminalAt(wx, wy, touch ? 22 : 13);
      if (t && !t.outlet && !(t.part.id === UI.drag.from.part.id && t.idx === UI.drag.from.idx)) {
        Game.state.wires.push({ id: U.uid(), a: [UI.drag.from.part.id, UI.drag.from.idx], b: [t.part.id, t.idx] });
        saveLocal();
      }
    } else if (UI.drag.kind === 'hose') {
      const pid = UI.drag.from.part.id;
      Game.state.hoses = Game.state.hoses.filter(h => h.pump !== pid);
      if (U.dist(wx, wy, UI.drag.from.x, UI.drag.from.y) > 25) {
        Game.state.hoses.push({ id: U.uid(), pump: pid, tx: Math.round(wx / 10) * 10, ty: Math.round(wy / 10) * 10 });
      }
      saveLocal();
    } else if (UI.drag.kind === 'move' && UI.drag.moved) {
      saveLocal();
    } else if (UI.drag.kind === 'pan' && !UI.drag.moved && Game.mode === 'build') {
      Game.selected = null;
      refreshInspector();
    }
    UI.drag = null;
  });

  // an interrupted gesture (call, notification, window switch) must not stick
  cv.addEventListener('pointercancel', (e) => {
    UI.pointers.delete(e.pointerId);
    UI.pinch = null; UI.drag = null;
  });

  // scroll wheel zooms toward the cursor
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = evtScreen(e);
    zoomAt(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (Game.mode !== 'build') return;
    const p = selectedPart();
    if (e.key === 'Escape') { Game.placing = null; Game.selected = null; refreshPalette(); refreshInspector(); }
    if (!p && (e.key === 'Delete' || e.key === 'Backspace') && Game.selected && Game.selected.startsWith('wire:')) {
      const id = Game.selected.slice(5);
      Game.state.wires = Game.state.wires.filter(w => w.id !== id);
      Game.selected = null; refreshInspector(); saveLocal();
    }
    if (!p) return;
    if (e.key === 'r' || e.key === 'R') { p.rot = ((p.rot || 0) + (e.shiftKey ? -15 : 15)) % 360; saveLocal(); }
    if (e.key === 'Delete' || e.key === 'Backspace') deletePart(p);
    if (e.key === 'd' || e.key === 'D') duplicatePart(p);
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') p.x -= 10;
      if (e.key === 'ArrowRight') p.x += 10;
      if (e.key === 'ArrowUp') p.y -= 10;
      if (e.key === 'ArrowDown') p.y += 10;
      saveLocal();
    }
  });
}

/* cursor tells the player what a click will do */
function updateCursor(wx, wy) {
  let cur = 'default';
  if (UI.drag && UI.drag.kind === 'pan') cur = 'grabbing';
  else if (Game.mode === 'build') {
    if (UI.drag) cur = UI.drag.kind === 'move' ? 'grabbing' : 'crosshair';
    else if (Game.placing) cur = 'copy';
    else if (UI.hoverTerminal) cur = 'crosshair';
    else if (partAt(wx, wy)) cur = 'grab';
  } else {
    const p = partAt(wx, wy);
    if (p && (p.type === 'switch' || p.type === 'gate' || p.type === 'tap')) cur = 'pointer';
  }
  UI.canvas.style.cursor = cur;
}

/* two-finger pinch: zoom about the fingers' midpoint */
function startPinch() {
  UI.drag = null;
  const [a, b] = [...UI.pointers.values()];
  const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
  UI.pinch = { d0: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, z0: UI.cam.z, w0: screenToWorld(mx, my) };
}
function updatePinch() {
  const [a, b] = [...UI.pointers.values()];
  const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
  const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
  UI.cam.z = U.clamp(UI.pinch.z0 * (d / UI.pinch.d0), 1, 4);
  const S = viewScale();
  UI.cam.cx = UI.pinch.w0[0] - (mx - UI.view.cw / 2) / S;
  UI.cam.cy = UI.pinch.w0[1] - (my - UI.view.ch / 2) / S;
  clampCam();
}

function selectedPart() {
  return Game.selected && !Game.selected.startsWith('wire:')
    ? Game.state.parts.find(p => p.id === Game.selected) : null;
}
function deletePart(p) {
  Game.state.parts = Game.state.parts.filter(q => q.id !== p.id);
  Game.state.wires = Game.state.wires.filter(w => w.a[0] !== p.id && w.b[0] !== p.id);
  Game.state.hoses = Game.state.hoses.filter(h => h.pump !== p.id);
  Game.selected = null;
  refreshPalette(); refreshInspector(); saveLocal();
}
function duplicatePart(p) {
  if (PARTS[p.type].unique) return;
  const c = JSON.parse(JSON.stringify(p));
  c.id = U.uid(); c.x += 40; c.y += 40;
  Game.state.parts.push(c);
  Game.selected = c.id;
  refreshInspector(); saveLocal();
}

/* ---------------- inspector ---------------- */
function refreshInspector() {
  const el = document.getElementById('inspector');
  const p = selectedPart();
  if (Game.mode !== 'build' || (!p && !(Game.selected || '').startsWith('wire:'))) {
    el.classList.add('hidden'); return;
  }
  el.classList.remove('hidden');

  if (!p) {   // a wire is selected
    el.innerHTML = `<h3>🔌 Wire</h3><p class="desc">Carries current between two terminals.</p>
      <div class="insp-btns"><button class="danger" id="insp-del">🗑 Delete wire</button></div>`;
    el.querySelector('#insp-del').onclick = () => {
      const id = Game.selected.slice(5);
      Game.state.wires = Game.state.wires.filter(w => w.id !== id);
      Game.selected = null; refreshInspector(); saveLocal();
    };
    return;
  }

  const def = PARTS[p.type];
  let html = `<h3>${def.ico} ${def.name}</h3>
    <div class="disc-tag" style="color:${DISC_COLORS[def.disc]}">${DISC_NAMES[def.disc]} engineering</div>
    <p class="desc">${def.desc}</p>`;
  for (const pr of (def.props || [])) {
    const v = p.props[pr.key];
    if (pr.type === 'range') {
      html += `<div class="prop-row"><label>${pr.label}<span class="val" id="v_${pr.key}">${v}${pr.unit || ''}</span></label>
        <input type="range" data-k="${pr.key}" min="${pr.min}" max="${pr.max}" step="${pr.step}" value="${v}"></div>`;
    } else if (pr.type === 'select') {
      html += `<div class="prop-row"><label>${pr.label}</label><select data-k="${pr.key}">` +
        pr.options.map(o => `<option value="${o.v}" ${o.v === v ? 'selected' : ''}>${o.label}</option>`).join('') +
        `</select></div>`;
    } else if (pr.type === 'toggle') {
      html += `<div class="prop-row"><label><span>${pr.label}</span>
        <input type="checkbox" data-k="${pr.key}" ${v ? 'checked' : ''}></label></div>`;
    }
  }
  html += `<div class="insp-btns">
    <button id="insp-rot">↻ Rotate <kbd>R</kbd></button>
    <button id="insp-dup" ${def.unique ? 'disabled' : ''}>⿻ Copy <kbd>D</kbd></button>
    <button class="danger" id="insp-del">🗑 <kbd>Del</kbd></button></div>`;
  el.innerHTML = html;

  el.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      p.props[k] = parseFloat(inp.value);
      const lbl = el.querySelector('#v_' + k);
      const pr = def.props.find(q => q.key === k);
      if (lbl) lbl.textContent = p.props[k] + (pr.unit || '');
      saveLocal();
    });
  });
  el.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => { p.props[sel.dataset.k] = sel.value; saveLocal(); });
  });
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => { p.props[cb.dataset.k] = cb.checked; saveLocal(); });
  });
  el.querySelector('#insp-rot').onclick = () => { p.rot = ((p.rot || 0) + 15) % 360; saveLocal(); };
  el.querySelector('#insp-dup').onclick = () => duplicatePart(p);
  el.querySelector('#insp-del').onclick = () => deletePart(p);
}

/* ---------------- cup gauge ---------------- */
function refreshCupGauge() {
  const el = document.getElementById('cup-gauge');
  if (Game.mode !== 'run' || !Game.rt || !Game.rt.bindings.cupId) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const vs = Game.rt.vessels[Game.rt.bindings.cupId];
  const rows = [
    { nm: '🌡 Temp', v: vs.temp, max: 100, lo: IDEAL.tempLo, hi: IDEAL.tempHi, unit: '°C', col: '#e07040' },
    { nm: '💪 Strength', v: vs.conc * 100, max: 100, lo: IDEAL.strLo, hi: IDEAL.strHi, unit: '%', col: '#9c6a2f' },
    { nm: '💧 Volume', v: vs.vol, max: 300, lo: IDEAL.volFull, hi: 300, unit: 'ml', col: '#5a9ac9' },
  ];
  document.getElementById('btn-serve').classList.toggle('ready', vs.vol >= IDEAL.volFull);
  el.innerHTML = '<h4>☕ The Cup, live</h4>' + rows.map(r => `
    <div class="gauge"><div class="g-label"><span>${r.nm}</span><span>${Math.round(r.v)}${r.unit}</span></div>
    <div class="g-bar">
      <div class="g-ideal" style="left:${r.lo / r.max * 100}%;width:${(r.hi - r.lo) / r.max * 100}%"></div>
      <div class="g-fill" style="width:${U.clamp(r.v / r.max, 0, 1) * 100}%;background:${r.col}"></div>
    </div></div>`).join('') +
    (vs.items.length ? `<div style="font-size:11px;color:#e0a050">⚠️ ${vs.items.length} leaf bit(s) in the cup!</div>` : '');
}

/* ---------------- ticker ---------------- */
function setTicker(msg) {
  document.getElementById('ticker').textContent = msg;
  UI.tickerUntil = performance.now() + 4500;
}
function tickTicker() {
  if (Game.mode === 'run' && Game.rt) {
    const ev = Game.rt.events[Game.rt.events.length - 1];
    if (ev && ev._shown === undefined) { ev._shown = true; setTicker(ev.msg); }
  }
  if (performance.now() > UI.tickerUntil) {
    const el = document.getElementById('ticker');
    if (Game.mode === 'run') el.textContent = `⏱ t = ${Game.rt.t.toFixed(0)} s`;
    else el.textContent = 'BUILD: click a part in the palette, then click the workshop to place it. Drag between terminal dots to wire. R rotates.';
  }
}

/* ---------------- modals ---------------- */
function showModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-veil').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-veil').classList.add('hidden'); }

function showWelcome() {
  showModal(`
    <h2>⚙️ Welcome to ContrapTea 🫖</h2>
    <p>Your mission: <b>build a machine that makes a proper cup of tea.</b></p>
    <p>Use <b style="color:${DISC_COLORS.mech}">mechanical</b> parts to grind and move leaves,
       <b style="color:${DISC_COLORS.elec}">electrical</b> parts to heat, pump and sequence,
       and <b style="color:${DISC_COLORS.chem}">chemistry</b> to steep it just right.
       There's no single answer: every machine is yours.</p>
    <p>The cup wants: <b>70–90 °C</b>, <b>40–70 % strength</b>, <b>at least 220 ml</b>, and <b>no leafy bits</b>.</p>
    <div class="modal-btns">
      <button class="go big" id="wl-ex">📦 Show me an example machine</button>
      <button class="big" id="wl-new">🔧 Start from scratch</button>
      <button id="wl-help">📖 Read the Handbook</button>
    </div>`);
  document.getElementById('wl-ex').onclick = () => { loadExample('starter'); closeModal(); };
  document.getElementById('wl-new').onclick = closeModal;
  document.getElementById('wl-help').onclick = () => { showHelp('basics'); };
}

function showExamples() {
  showModal(`
    <h2>📦 Example machines</h2>
    <p>Load one, run it, then rip it apart and make it yours. (This replaces your current build; Share it first if you want to keep it!)</p>
    <h3>${EXAMPLES.starter.name}</h3><p>${EXAMPLES.starter.blurb}</p>
    <div class="modal-btns"><button class="go" id="ex-starter">Load Starter Brewery</button></div>
    <h3>${EXAMPLES.grand.name}</h3><p>${EXAMPLES.grand.blurb}</p>
    <div class="modal-btns"><button class="go" id="ex-grand">Load Grand Tea Engine</button>
    <button id="ex-close">Cancel</button></div>`);
  document.getElementById('ex-starter').onclick = () => { loadExample('starter'); closeModal(); };
  document.getElementById('ex-grand').onclick = () => { loadExample('grand'); closeModal(); };
  document.getElementById('ex-close').onclick = closeModal;
}

function showHelp(tab) {
  const tabs = { basics: '🧰 Basics', mech: '⚙️ Mechanical', elec: '🔌 Electrical', chem: '⚗️ Chemical' };
  const bodies = {
    basics: `
      <p><b>Goal:</b> get 70–90 °C tea, 40–70 % strong, at least 220 ml, into <b>The Cup</b>, then hit <b>SERVE</b>.</p>
      <ul>
        <li>Click a palette part, then click the workshop to place it (<kbd>Shift</kbd>-click to place several).</li>
        <li>Drag parts to move. <kbd>R</kbd> rotates 15° (<kbd>Shift+R</kbd> back). <kbd>D</kbd> duplicates. <kbd>Del</kbd> deletes.</li>
        <li>Drag between the little <b>terminal dots</b> to run wires. Drag from a pump's top outlet to aim its <b>hose</b>.</li>
        <li><b>Getting around:</b> drag empty space to pan, pinch or scroll to zoom (or use the +/− buttons). On a phone, zoom in before wiring: fingers need room!</li>
        <li>Hit <b>▶ RUN</b> to watch your machine work from t = 0. You can flip switches, taps and gates by clicking them mid-run!</li>
        <li>Your build auto-saves in this browser. Use <b>Share</b> to export it as a code for friends.</li>
      </ul>`,
    mech: `
      <ul>
        <li><b>Gears mesh</b> when their teeth touch. Speed changes by the radius ratio and direction flips: small gear on big gear = speed up!</li>
        <li>Put a gear <i>centred on</i> a motor / spring motor / water wheel axle to drive it.</li>
        <li>The <b>grinder</b> and <b>Archimedes screw</b> have their own little pinion gears, mesh a gear against them to power them.</li>
        <li>The <b>water wheel</b> spins when water pours on it: free power, no battery needed.</li>
        <li><b>Chutes and funnels</b> are free-form: rotate them to steer anything that falls.</li>
      </ul>`,
    elec: `
      <ul>
        <li>A load runs when it's wired to a battery's <b>+ and −</b>. Switches, timers and thermostats go <b>in series</b> to control it.</li>
        <li><b>Voltage matters:</b> 24 V makes heaters hotter, motors and pumps faster, and drains the battery quicker. Watch its charge bar!</li>
        <li>The <b>timer</b> conducts between its ON and OFF times; chain several to choreograph fill → boil → pour → steep → serve.</li>
        <li>The <b>thermostat</b> (placed in a vessel) is feedback control: it cuts the circuit at its setpoint. No more boiling over.</li>
        <li>Wire a <b>tap</b> or <b>gate</b> to control it electrically; unwired ones just stay open (tap) or use their toggle (gate).</li>
      </ul>`,
    chem: `
      <ul>
        <li><b>Extraction:</b> tea steeps faster when the water is hotter, and <b>ground leaves brew ~4× faster</b> than whole ones (surface area!).</li>
        <li><b>Concentration:</b> strength = extracted tea ÷ water volume. Too long or too little water = stewed; too short = dishwater.</li>
        <li><b>Thermal mass:</b> big volumes heat slowly and hold heat; everything cools toward room temperature, so serve while it's hot.</li>
        <li><b>Separation:</b> the filter mesh lets liquid through and traps solids. Pour through it, no bits in the cup.</li>
        <li>Vessels <b>mix</b> whatever arrives: temperatures and strengths blend by volume. Dilution is a tool!</li>
      </ul>`,
  };
  showModal(`<h2>📖 The Engineer's Handbook</h2>
    <div class="tabs">${Object.keys(tabs).map(k =>
      `<button data-tab="${k}" class="${k === tab ? 'sel' : ''}">${tabs[k]}</button>`).join('')}</div>
    ${bodies[tab]}
    <div class="modal-btns"><button class="go" id="hp-close">Back to the workshop</button></div>`);
  document.querySelectorAll('#modal .tabs button').forEach(b => b.onclick = () => showHelp(b.dataset.tab));
  document.getElementById('hp-close').onclick = closeModal;
}

function showScore(sc) {
  const bar = (nm, v, col) => `<div class="sbar"><span class="nm">${nm}</span>
    <div class="tr"><div class="fl" style="width:${Math.round(v)}%;background:${col}"></div></div>
    <span>${Math.round(v)}</span></div>`;
  const badge = (k, earned) => `<span class="badge ${k} ${earned ? 'earned' : ''}">${DISC_NAMES[k]}${earned ? ' ✓' : ''}</span>`;
  showModal(`
    <h2 style="text-align:center">☕ The Verdict</h2>
    <div style="text-align:center">
      <div class="stars">${Array.from({ length: 5 }, (_, i) =>
        `<span style="animation-delay:${i * 90}ms">${i < sc.stars ? '★' : '☆'}</span>`).join('')}</div>
      <div class="score-title">${sc.title}</div>
      <p>${Math.round(sc.vol)} ml at ${Math.round(sc.temp)} °C, ${Math.round(sc.str)} % strength${sc.bits ? `, ${sc.bits} leafy bit(s) 😬` : ''}</p>
    </div>
    ${bar('Volume', sc.volScore, '#5a9ac9')}
    ${bar('Temperature', sc.tempScore, '#e07040')}
    ${bar('Strength', sc.strScore, '#9c6a2f')}
    <div class="badges">${badge('mech', sc.disc.mech)}${badge('elec', sc.disc.elec)}${badge('chem', sc.disc.chem)}</div>
    ${sc.tips.map(t => `<div class="tip">${t}</div>`).join('')}
    <div class="modal-btns">
      <button class="go big" id="sc-again">🔧 Back to the workshop</button>
      <button id="sc-share">🔗 Share this machine</button>
    </div>`);
  document.getElementById('sc-again').onclick = closeModal;
  document.getElementById('sc-share').onclick = () => showShare();
}

/* ---------------- save / share ---------------- */
function saveLocal() {
  try { localStorage.setItem('contraptea.save', JSON.stringify(Game.state)); } catch (e) { /* private mode */ }
}
function loadLocal() {
  try {
    const s = localStorage.getItem('contraptea.save');
    if (!s) return false;
    const st = JSON.parse(s);
    if (!st.parts || !st.parts.length) return false;
    Game.state = { parts: st.parts, wires: st.wires || [], hoses: st.hoses || [] };
    return true;
  } catch (e) { return false; }
}
function exportCode() {
  return 'TEA1.' + btoa(unescape(encodeURIComponent(JSON.stringify(Game.state))));
}
function importCode(code) {
  try {
    const raw = code.trim();
    if (!raw.startsWith('TEA1.')) throw new Error('bad header');
    const st = JSON.parse(decodeURIComponent(escape(atob(raw.slice(5)))));
    if (!Array.isArray(st.parts)) throw new Error('bad data');
    for (const p of st.parts) if (!PARTS[p.type]) throw new Error('unknown part ' + p.type);
    Game.state = { parts: st.parts, wires: st.wires || [], hoses: st.hoses || [] };
    Game.selected = null; Game.placing = null;
    refreshPalette(); refreshInspector(); saveLocal();
    return true;
  } catch (e) { return false; }
}
function showShare() {
  showModal(`
    <h2>🔗 Share your machine</h2>
    <p>Copy this code and send it to a friend; they can paste it with <b>Import</b>.</p>
    <textarea id="share-code" readonly>${exportCode()}</textarea>
    <div class="modal-btns">
      <button class="go" id="sh-copy">📋 Copy to clipboard</button>
      <button id="sh-close">Close</button>
    </div>`);
  const ta = document.getElementById('share-code');
  ta.onclick = () => ta.select();
  document.getElementById('sh-copy').onclick = () => {
    ta.select();
    (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject())
      .catch(() => document.execCommand('copy'));
    document.getElementById('sh-copy').textContent = '✅ Copied!';
  };
  document.getElementById('sh-close').onclick = closeModal;
}
function showImport() {
  showModal(`
    <h2>📥 Import a machine</h2>
    <p>Paste a ContrapTea share code below. (This replaces your current build.)</p>
    <textarea id="import-code" placeholder="TEA1.…"></textarea>
    <div class="modal-btns">
      <button class="go" id="im-go">Import</button>
      <button id="im-close">Cancel</button>
    </div>`);
  document.getElementById('im-go').onclick = () => {
    if (importCode(document.getElementById('import-code').value)) closeModal();
    else document.getElementById('im-go').textContent = '❌ Invalid code, try again';
  };
  document.getElementById('im-close').onclick = closeModal;
}

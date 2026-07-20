'use strict';
/* ContrapTea — game state, mode management, render loop */

const Game = {
  state: { parts: [], wires: [], hoses: [] },
  rt: null,
  mode: 'build',
  speed: 1,
  selected: null,
  placing: null,
  mouse: [0, 0],
};

/* ---------------- mode control ---------------- */
function startRun() {
  Game.rt = newRuntime(Game.state);
  Game.mode = 'run';
  Game.placing = null; Game.selected = null;
  refreshInspector();
  document.getElementById('btn-run').textContent = '■ STOP';
  document.getElementById('btn-run').classList.replace('go', 'stop');
  document.getElementById('btn-serve').classList.remove('hidden');
  document.getElementById('speed-wrap').classList.remove('hidden');
  const ml = document.getElementById('mode-label');
  ml.textContent = 'RUNNING'; ml.classList.add('running');
  setTicker('▶ The machine springs to life…');
}
function stopRun() {
  Game.mode = 'build';
  Game.rt = null;
  // clear manual overrides done mid-run
  document.getElementById('btn-run').textContent = '▶ RUN';
  document.getElementById('btn-run').classList.replace('stop', 'go');
  document.getElementById('btn-serve').classList.add('hidden');
  document.getElementById('speed-wrap').classList.add('hidden');
  const ml = document.getElementById('mode-label');
  ml.textContent = 'BUILD MODE'; ml.classList.remove('running');
  refreshCupGauge();
  setTicker('🔧 Back to the workshop.');
}
function serveNow() {
  if (Game.mode !== 'run' || !Game.rt) return;
  const sc = scoreCup(Game.rt);
  stopRun();
  if (sc) { showScore(sc); return; }
  showModal(`<h2>☕ No cup!</h2><p>Place <b>The Cup</b> from the palette — it's the whole point!</p>
    <div class="modal-btns"><button class="go" id="nc">OK</button></div>`);
  document.getElementById('nc').onclick = closeModal;
}
function loadExample(key) {
  const st = EXAMPLES[key].build();
  Game.state = st;
  Game.selected = null; Game.placing = null;
  if (Game.mode === 'run') stopRun();
  refreshPalette(); refreshInspector(); saveLocal();
  setTicker(`📦 Loaded "${EXAMPLES[key].name}" — press RUN to watch it, then make it yours!`);
}
function newMachine() {
  showModal(`<h2>🗑 Start fresh?</h2><p>This clears the whole workshop. Share your machine first if you want to keep it!</p>
    <div class="modal-btns"><button class="danger" id="nm-yes">Yes, clear it</button><button class="go" id="nm-no">Keep my machine</button></div>`);
  document.getElementById('nm-yes').onclick = () => {
    Game.state = { parts: [], wires: [], hoses: [] };
    Game.selected = null; Game.placing = null;
    if (Game.mode === 'run') stopRun();
    refreshPalette(); refreshInspector(); saveLocal(); closeModal();
  };
  document.getElementById('nm-no').onclick = closeModal;
}

/* ---------------- rendering ---------------- */
function render() {
  const g = UI.canvas.getContext('2d');
  const { s, ox, oy, dpr } = UI.view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, UI.canvas.width / dpr, UI.canvas.height / dpr);
  g.translate(ox, oy);
  g.scale(s, s);

  // workshop background
  g.fillStyle = '#2e2823';
  g.fillRect(0, 0, SIM.WORLD_W, SIM.WORLD_H);
  g.strokeStyle = 'rgba(255,240,210,.045)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= SIM.WORLD_W; x += 50) { g.moveTo(x, 0); g.lineTo(x, SIM.WORLD_H); }
  for (let y = 0; y <= SIM.WORLD_H; y += 50) { g.moveTo(0, y); g.lineTo(SIM.WORLD_W, y); }
  g.stroke();
  g.strokeStyle = 'rgba(255,240,210,.09)';
  g.strokeRect(0, 0, SIM.WORLD_W, SIM.WORLD_H);

  const rt = Game.rt;

  // hoses (under parts)
  for (const h of Game.state.hoses) {
    const pump = Game.state.parts.find(p => p.id === h.pump);
    if (!pump) continue;
    const [x1, y1] = U.toWorld(pump, PARTS.pump.outlet.x, PARTS.pump.outlet.y);
    g.strokeStyle = 'rgba(90,154,201,.85)';
    g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x1, y1);
    g.quadraticCurveTo((x1 + h.tx) / 2, Math.min(y1, h.ty) - 60, h.tx, h.ty);
    g.stroke();
    g.fillStyle = '#5a9ac9';
    g.beginPath(); g.arc(h.tx, h.ty, 6, 0, U.TAU); g.fill();
  }

  // wires (under parts)
  const termPos = (ref) => {
    const p = Game.state.parts.find(q => q.id === ref[0]);
    if (!p) return null;
    const t = worldTerminals(p)[ref[1]];
    return t ? [t.x, t.y] : null;
  };
  for (const w of Game.state.wires) {
    const a = termPos(w.a), b = termPos(w.b);
    if (!a || !b) continue;
    const sel = Game.selected === 'wire:' + w.id;
    g.strokeStyle = sel ? '#ffd24d' : 'rgba(212,175,55,.75)';
    g.lineWidth = sel ? 4 : 2.5;
    g.beginPath(); g.moveTo(a[0], a[1]);
    g.quadraticCurveTo((a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 30, b[0], b[1]);
    g.stroke();
  }

  // parts
  for (const p of Game.state.parts) {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(U.rad(p.rot || 0));
    PARTS[p.type].draw(g, p, rt);
    g.restore();

    if (Game.mode === 'build' && Game.selected === p.id) {
      const def = PARTS[p.type];
      g.save();
      g.translate(p.x, p.y); g.rotate(U.rad(p.rot || 0));
      g.strokeStyle = '#ffd24d'; g.lineWidth = 2; g.setLineDash([6, 5]);
      g.strokeRect(-def.w / 2 - 8, -def.h / 2 - 8, def.w + 16, def.h + 16);
      g.restore();
    }
  }

  // terminal dots (build mode)
  if (Game.mode === 'build') {
    for (const p of Game.state.parts) {
      for (const t of worldTerminals(p)) {
        const hov = UI.hoverTerminal && UI.hoverTerminal.part === p && UI.hoverTerminal.idx === t.idx;
        g.beginPath(); g.arc(t.x, t.y, hov ? 9 : 6, 0, U.TAU);
        g.fillStyle = hov ? '#ffd24d' : 'rgba(242,201,76,.75)';
        g.fill();
        g.strokeStyle = '#5c4a1c'; g.lineWidth = 1.5; g.stroke();
      }
      if (p.type === 'pump') {
        const [ox2, oy2] = U.toWorld(p, PARTS.pump.outlet.x, PARTS.pump.outlet.y);
        const hov = UI.hoverTerminal && UI.hoverTerminal.outlet && UI.hoverTerminal.part === p;
        g.beginPath(); g.arc(ox2, oy2, hov ? 9 : 6, 0, U.TAU);
        g.fillStyle = hov ? '#8fd8ff' : 'rgba(90,154,201,.9)'; g.fill();
        g.strokeStyle = '#1e3340'; g.stroke();
      }
    }
  }

  // wire/hose drag preview
  if (UI.drag && (UI.drag.kind === 'wire' || UI.drag.kind === 'hose')) {
    const f = UI.drag.from;
    g.strokeStyle = UI.drag.kind === 'wire' ? '#ffd24d' : '#8fd8ff';
    g.lineWidth = 3; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(f.x, f.y);
    g.quadraticCurveTo((f.x + UI.drag.x) / 2, Math.max(f.y, UI.drag.y) + 30, UI.drag.x, UI.drag.y);
    g.stroke();
    g.setLineDash([]);
  }

  // particles
  if (rt) {
    for (const q of rt.particles) {
      if (q.kind === 'drop') {
        g.fillStyle = U.mixColor('#7db8e8', '#7a4210', Math.min(1, q.conc * 1.2));
        g.globalAlpha = 0.9;
        g.beginPath(); g.arc(q.x, q.y, q.r, 0, U.TAU); g.fill();
        g.globalAlpha = 1;
      } else if (q.kind === 'leaf') {
        g.save(); g.translate(q.x, q.y); g.rotate((q.x + q.y) * 0.05);
        g.fillStyle = '#4f7a3c';
        g.beginPath(); g.ellipse(0, 0, 7, 4, 0, 0, U.TAU); g.fill();
        g.strokeStyle = '#35543a'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.stroke();
        g.restore();
      } else {
        g.fillStyle = '#5c4525';
        g.beginPath(); g.arc(q.x, q.y, q.r, 0, U.TAU); g.fill();
      }
    }
  }

  // placing ghost
  if (Game.mode === 'build' && Game.placing) {
    const [mx, my] = Game.mouse;
    g.save();
    g.globalAlpha = 0.5;
    g.translate(Math.round(mx / 10) * 10, Math.round(my / 10) * 10);
    PARTS[Game.placing].draw(g, makePart(Game.placing, 0, 0), null);
    g.restore();
  }
}

/* ---------------- loop ---------------- */
let _lastT = 0;
function frame(now) {
  const dtRaw = Math.min(0.05, (now - _lastT) / 1000 || 0.016);
  _lastT = now;

  if (Game.mode === 'run' && Game.rt) {
    let remaining = dtRaw * Game.speed;
    const h = 1 / 120;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 40) {
      const step = Math.min(h, remaining);
      simStep(Game.state, Game.rt, step);
      remaining -= step;
    }
  }

  render();
  refreshCupGauge();
  tickTicker();
  requestAnimationFrame(frame);
}

/* ---------------- boot ---------------- */
function boot() {
  UI.canvas = document.getElementById('game');
  UI.wrap = document.getElementById('canvas-wrap');
  fitView();
  window.addEventListener('resize', fitView);

  buildPalette();
  bindPointer();

  document.getElementById('btn-run').addEventListener('click', () => {
    Game.mode === 'run' ? stopRun() : startRun();
  });
  document.getElementById('btn-serve').addEventListener('click', serveNow);
  document.querySelectorAll('button.speed').forEach(b => {
    b.addEventListener('click', () => {
      Game.speed = parseInt(b.dataset.s, 10);
      document.querySelectorAll('button.speed').forEach(q => q.classList.toggle('sel', q === b));
    });
  });
  document.getElementById('btn-examples').addEventListener('click', showExamples);
  document.getElementById('btn-new').addEventListener('click', newMachine);
  document.getElementById('btn-share').addEventListener('click', showShare);
  document.getElementById('btn-import').addEventListener('click', showImport);
  document.getElementById('btn-help').addEventListener('click', () => showHelp('basics'));
  document.getElementById('modal-veil').addEventListener('click', (e) => {
    if (e.target.id === 'modal-veil') closeModal();
  });

  const hadSave = loadLocal();
  refreshPalette();
  if (!hadSave) showWelcome();

  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', boot);

/* exposed for debugging & automated tests */
window.TeaGame = {
  Game, startRun, stopRun, serveNow, loadExample,
  step: (dt) => { if (Game.rt) simStep(Game.state, Game.rt, dt); },
  score: () => Game.rt ? scoreCup(Game.rt) : null,
};

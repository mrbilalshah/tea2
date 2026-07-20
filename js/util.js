'use strict';
/* ContrapTea, small math & misc helpers (global namespace U) */

const U = {
  TAU: Math.PI * 2,

  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  rad: d => d * Math.PI / 180,

  uid: () => 'p' + Math.random().toString(36).slice(2, 9),

  // rotate a local vector by deg
  rot(x, y, deg) {
    const r = U.rad(deg), c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  },
  // part-local -> world
  toWorld(part, lx, ly) {
    const [x, y] = U.rot(lx, ly, part.rot || 0);
    return [part.x + x, part.y + y];
  },
  // world -> part-local
  toLocal(part, wx, wy) {
    return U.rot(wx - part.x, wy - part.y, -(part.rot || 0));
  },

  closestOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = U.clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
    return [x1 + dx * t, y1 + dy * t];
  },

  // distance from point to segment
  segDist(px, py, x1, y1, x2, y2) {
    const [cx, cy] = U.closestOnSeg(px, py, x1, y1, x2, y2);
    return Math.hypot(px - cx, py - cy);
  },

  // colour mix of two hex colours
  mixColor(c1, c2, t) {
    const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const a = p(c1), b = p(c2);
    const m = a.map((v, i) => Math.round(U.lerp(v, b[i], U.clamp(t, 0, 1))));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  },

  // rounded-rect path helper
  rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  },
};

const DISC_COLORS = { mech: '#e8933a', elec: '#f2c94c', chem: '#52bd9a' };
const DISC_NAMES = { mech: 'Mechanical', elec: 'Electrical', chem: 'Chemical' };

'use strict';
/* ContrapTea, runtime simulation.
   Build state (parts/wires/hoses) is immutable during a run; the runtime `rt`
   holds everything dynamic: particles, fluids, circuits, shaft speeds. */

const SIM = {
  GRAV: 900,            // px/s^2
  DROP_ML: 5,           // ml per water droplet
  DROP_R: 4,
  LEAF_R: 6,
  GROUND_R: 2.6,
  MAX_SOLIDS: 240,
  MAX_DROPS: 520,
  AMBIENT: 20,
  COOL_RATE: 0.004,     // /s toward ambient
  HEAT_DIV: 1.05,       // dT = W / (HEAT_DIV * ml)
  LEAF_YIELD: 0.18,     // total concentration a leaf can give a 250ml cup
  LEAF_K: 0.02,         // extraction rate /s (whole leaf)
  GROUND_K: 0.09,       // extraction rate /s (ground)
  GROUND_DOTS: 5,       // dots per ground leaf
  WORLD_W: 1600,
  WORLD_H: 1000,
};

function newRuntime(state) {
  const rt = {
    running: true, t: 0,
    particles: [],
    vessels: {},        // partId -> {vol, temp, conc, items:[{kind,extracted,yield,k,rx,ry}]}
    rpm: {},            // partId or 'pin:partId' -> rpm
    ang: {},            // partId -> accumulated angle (radians) for animation
    charge: {},         // batteryId -> joules remaining
    powered: {},        // loadId -> volts (0/undefined = off)
    switchState: {},    // switch/thermostat id -> closed?
    gateOpen: {},
    tapOn: {},
    tapAcc: {}, pumpAcc: {}, caddyAcc: {}, caddyLeft: {},
    tapManual: {}, gateManual: {},
    wheelRPM: {},
    events: [],
    flags: { ground: false, transported: false, wheelSpun: false, geared: false,
             powered: false, heated: false, steeped: false, filtered: false, pumped: false },
    lostDrops: 0,
    staticSegs: [],
    dynamicParts: [],   // parts whose segs change at runtime (gates, grinders)
    bindings: { heaters: {}, thermos: {}, pumps: {}, cupId: null },
    gearLinks: [],      // adjacency for shaft network
  };

  // vessels
  for (const p of state.parts) {
    const def = PARTS[p.type];
    if (def.getContainer) {
      rt.vessels[p.id] = { vol: 0, temp: SIM.AMBIENT, conc: 0, items: [] };
      if (p.type === 'cup') rt.bindings.cupId = p.id;
    }
    if (p.type === 'battery') rt.charge[p.id] = p.props.capacity * 1000;
    if (p.type === 'switch') rt.switchState[p.id] = !!p.props.on;
    if (p.type === 'thermostat') rt.switchState[p.id] = true;
    if (p.type === 'caddy') { rt.caddyLeft[p.id] = p.props.count; rt.caddyAcc[p.id] = 0; }
    if (p.type === 'waterwheel') rt.wheelRPM[p.id] = 0;
  }

  // static vs dynamic collision segments
  for (const p of state.parts) {
    if (p.type === 'gate' || p.type === 'grinder') rt.dynamicParts.push(p);
    else rt.staticSegs.push(...worldSegs(p, null));
  }

  // bind heaters / thermostats / pump inlets to the vessel containing them
  for (const p of state.parts) {
    if (p.type === 'heater') rt.bindings.heaters[p.id] = partBinding(state, p);
    if (p.type === 'thermostat') rt.bindings.thermos[p.id] = partBinding(state, p);
    if (p.type === 'pump') {
      rt.bindings.pumps[p.id] = partBinding(state, p);
      rt.pumpAcc[p.id] = 0;
    }
  }

  // mechanical adjacency: gear<->gear mesh, gear<->shaftOut lock, gear<->pinion mesh
  const net = computeGearNetwork(state);
  rt.gearNodes = net.nodes;
  rt.gearLinks = net.links;

  return rt;
}

/* Which vessel does a heater / thermostat / pump act on? (null if none) */
function findVesselAt(state, wx, wy, slack) {
  for (const c of state.parts) {
    const def = PARTS[c.type];
    if (!def.getContainer) continue;
    const box = def.getContainer(c);
    const [lx, ly] = U.toLocal(c, wx, wy);
    if (lx > box.x1 - slack && lx < box.x2 + slack && ly > box.y1 - slack && ly < box.y2 + slack) return c.id;
  }
  return null;
}
function partBinding(state, p) {
  if (p.type === 'heater') return findVesselAt(state, p.x, p.y, 12);
  if (p.type === 'thermostat') return findVesselAt(state, p.x, p.y + 20, 25);
  if (p.type === 'pump') {
    const [ix, iy] = U.toWorld(p, PARTS.pump.inlet.x, PARTS.pump.inlet.y);
    return findVesselAt(state, ix, iy, 32);
  }
  return null;
}

function computeGearNetwork(state) {
  const gears = state.parts.filter(p => p.type === 'gear');
  const nodes = [];  // {key, x, y, r, kind:'gear'|'driver'|'pin', part}
  for (const g of gears) nodes.push({ key: g.id, x: g.x, y: g.y, r: gearRadius(g), kind: 'gear', part: g });
  for (const p of state.parts) {
    const def = PARTS[p.type];
    if (def.shaftOut) {
      const [x, y] = U.toWorld(p, def.shaftOut.x, def.shaftOut.y);
      nodes.push({ key: 'drv:' + p.id, x, y, r: 0, kind: 'driver', part: p });
    }
    if (def.shaftIn) {
      const [x, y] = U.toWorld(p, def.shaftIn.x, def.shaftIn.y);
      nodes.push({ key: 'pin:' + p.id, x, y, r: def.shaftIn.r, kind: 'pin', part: p });
    }
  }
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = U.dist(a.x, a.y, b.x, b.y);
      if (a.kind === 'driver' && b.kind === 'gear' || a.kind === 'gear' && b.kind === 'driver') {
        if (d <= LOCK_TOL) {
          links.push({ a: a.key, b: b.key, ratio: 1, lock: true, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        }
      } else if (a.kind !== 'driver' && b.kind !== 'driver') {
        if (Math.abs(d - (a.r + b.r)) <= MESH_TOL) {
          // contact point sits between the two pitch circles
          const t = a.r / (a.r + b.r);
          links.push({
            a: a.key, b: b.key, ratio: -(a.r / b.r), inv: -(b.r / a.r),
            ax: a.x, ay: a.y, bx: b.x, by: b.y,
            cx: U.lerp(a.x, b.x, t), cy: U.lerp(a.y, b.y, t),
          });
        }
      }
    }
  }
  return { nodes, links };
}

/* -------- per-frame mechanical speed propagation -------- */
function solveMechanical(state, rt, dt) {
  const speeds = {};
  // drivers
  for (const p of state.parts) {
    if (p.type === 'motor') {
      const v = rt.powered[p.id] || 0;
      if (v > 0) speeds['drv:' + p.id] = 90 * (v / 12) * (p.props.reverse ? -1 : 1);
    } else if (p.type === 'spring_motor') {
      if (rt.t < p.props.duration) speeds['drv:' + p.id] = p.props.rpm * (p.props.reverse ? -1 : 1);
    } else if (p.type === 'waterwheel') {
      const w = rt.wheelRPM[p.id] || 0;
      if (Math.abs(w) > 0.5) speeds['drv:' + p.id] = w;
    }
  }
  // BFS through links
  const queue = Object.keys(speeds);
  while (queue.length) {
    const k = queue.shift();
    for (const l of rt.gearLinks) {
      let other = null, ratio = 1;
      if (l.a === k) { other = l.b; ratio = l.ratio; }
      else if (l.b === k) { other = l.a; ratio = l.inv !== undefined ? l.inv : l.ratio; }
      if (other && speeds[other] === undefined) {
        speeds[other] = speeds[k] * ratio;
        queue.push(other);
      }
    }
  }
  // write to rt.rpm and animate
  rt.rpm = {};
  for (const n of rt.gearNodes) {
    const s = speeds[n.key] || 0;
    rt.rpm[n.key] = s;
    rt.ang[n.part.id] = (rt.ang[n.part.id] || 0) + (s * U.TAU / 60) * dt;
    if (n.kind === 'gear' && Math.abs(s) > 1) rt.flags.geared = true;
  }
  // pump impeller animation
  for (const p of state.parts) {
    if (p.type === 'pump' && rt.powered[p.id]) rt.ang[p.id] = (rt.ang[p.id] || 0) + 8 * dt;
  }
}

/* -------- electrical network -------- */
function solveElectrical(state, rt, dt) {
  // update conductor closed-states
  for (const p of state.parts) {
    if (p.type === 'timer') rt.switchState[p.id] = rt.t >= p.props.ton && rt.t < p.props.toff;
    if (p.type === 'thermostat') {
      const vid = rt.bindings.thermos[p.id];
      const vs = vid && rt.vessels[vid];
      if (vs) {
        const closed = rt.switchState[p.id];
        // hysteresis: open above setpoint, re-close 3° below
        if (closed && vs.temp >= p.props.setpoint) {
          rt.switchState[p.id] = false;
          simEvent(rt, `🌡 Thermostat clicked OFF at ${Math.round(vs.temp)}°C`);
        } else if (!closed && vs.temp < p.props.setpoint - 3) rt.switchState[p.id] = true;
      }
    }
  }

  // node graph: terminal -> set of connected terminals
  const adj = {};
  const addEdge = (k1, k2) => {
    (adj[k1] = adj[k1] || []).push(k2);
    (adj[k2] = adj[k2] || []).push(k1);
  };
  for (const w of state.wires) addEdge(w.a[0] + ':' + w.a[1], w.b[0] + ':' + w.b[1]);
  for (const p of state.parts) {
    if (PARTS[p.type].conduct && rt.switchState[p.id]) addEdge(p.id + ':0', p.id + ':1');
  }
  const reach = (startKey) => {
    const seen = new Set([startKey]);
    const q = [startKey];
    while (q.length) {
      const k = q.shift();
      for (const n of (adj[k] || [])) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return seen;
  };

  const batteries = state.parts.filter(p => p.type === 'battery');
  const plusSets = [], minusSets = [];
  for (const b of batteries) {
    const alive = (rt.charge[b.id] || 0) > 0;
    plusSets.push(alive ? reach(b.id + ':0') : new Set());
    minusSets.push(alive ? reach(b.id + ':1') : new Set());
  }

  rt.powered = {};
  const loads = state.parts.filter(p => PARTS[p.type].terminals && !PARTS[p.type].conduct && p.type !== 'battery');
  for (const load of loads) {
    const t0 = load.id + ':0', t1 = load.id + ':1';
    let volts = 0, srcIdx = -1;
    for (let i = 0; i < batteries.length; i++) {
      const P = plusSets[i], M = minusSets[i];
      if ((P.has(t0) && M.has(t1)) || (P.has(t1) && M.has(t0))) {
        const v = parseInt(batteries[i].props.voltage, 10);
        if (v > volts) { volts = v; srcIdx = i; }
      }
    }
    if (volts > 0) {
      rt.powered[load.id] = volts;
      rt.flags.powered = true;
      // drain
      let watts = 10;
      if (load.type === 'heater') watts = load.props.watts * (volts / 12);
      else if (load.type === 'motor') watts = 100;
      else if (load.type === 'pump') watts = 80;
      rt.charge[batteries[srcIdx].id] = Math.max(0, rt.charge[batteries[srcIdx].id] - watts * dt);
    }
  }

  // gates & taps respond to power (or manual prop when unwired)
  const wired = new Set();
  for (const w of state.wires) { wired.add(w.a[0]); wired.add(w.b[0]); }
  for (const p of state.parts) {
    if (p.type === 'gate') {
      rt.gateOpen[p.id] = wired.has(p.id) ? !!rt.powered[p.id]
        : (rt.gateManual[p.id] !== undefined ? rt.gateManual[p.id] : !!p.props.open);
    }
    if (p.type === 'tap') {
      rt.tapOn[p.id] = wired.has(p.id) ? !!rt.powered[p.id]
        : (rt.tapManual[p.id] !== undefined ? rt.tapManual[p.id] : true);
    }
  }
}

/* -------- particles -------- */
function spawnDrop(rt, x, y, temp, conc, vx, vy) {
  if (rt.particles.filter(q => q.kind === 'drop').length >= SIM.MAX_DROPS) return;
  rt.particles.push({ kind: 'drop', x, y, px: x - (vx || 0) / 120, py: y - (vy || 0) / 120,
    r: SIM.DROP_R, temp: temp ?? SIM.AMBIENT, conc: conc || 0 });
}
function spawnSolid(rt, kind, x, y) {
  if (rt.particles.filter(q => q.kind !== 'drop').length >= SIM.MAX_SOLIDS) return;
  rt.particles.push({ kind, x, y, px: x + (Math.random() - 0.5), py: y, r: kind === 'leaf' ? SIM.LEAF_R : SIM.GROUND_R });
}

function simEvent(rt, msg) {
  rt.events.push({ t: rt.t, msg });
  if (rt.events.length > 60) rt.events.shift();
}

/* -------- main step (one substep of dt seconds) -------- */
function simStep(state, rt, dt) {
  rt.t += dt;

  solveElectrical(state, rt, dt);
  solveMechanical(state, rt, dt);

  /* emitters */
  for (const p of state.parts) {
    if (p.type === 'tap' && rt.tapOn[p.id]) {
      rt.tapAcc[p.id] = (rt.tapAcc[p.id] || 0) + p.props.flow * dt;
      const [sx, sy] = U.toWorld(p, PARTS.tap.spout.x, PARTS.tap.spout.y);
      while (rt.tapAcc[p.id] >= SIM.DROP_ML) {
        rt.tapAcc[p.id] -= SIM.DROP_ML;
        spawnDrop(rt, sx + (Math.random() - 0.5) * 5, sy, SIM.AMBIENT, 0, 0, 40);
      }
    }
    if (p.type === 'caddy' && rt.caddyLeft[p.id] > 0) {
      rt.caddyAcc[p.id] += dt;
      if (rt.caddyAcc[p.id] >= p.props.rate) {
        rt.caddyAcc[p.id] = 0;
        rt.caddyLeft[p.id]--;
        const [sx, sy] = U.toWorld(p, PARTS.caddy.dropAt.x, PARTS.caddy.dropAt.y);
        spawnSolid(rt, 'leaf', sx + (Math.random() - 0.5) * 8, sy);
      }
    }
  }

  /* collision segments: static + dynamic */
  const segs = rt.staticSegs.slice();
  for (const p of rt.dynamicParts) segs.push(...worldSegs(p, rt));

  const screws = state.parts.filter(p => p.type === 'screw');
  const wheels = state.parts.filter(p => p.type === 'waterwheel');
  const grinders = state.parts.filter(p => p.type === 'grinder');
  const containers = state.parts.filter(p => PARTS[p.type].getContainer);

  /* integrate particles */
  const alive = [];
  for (const q of rt.particles) {
    let vx = (q.x - q.px), vy = (q.y - q.py);

    // screw transport: constrain into the tube and push along the axis
    let inScrew = false;
    for (const s of screws) {
      const [lx, ly] = U.toLocal(s, q.x, q.y);
      if (Math.abs(lx) < 112 && Math.abs(ly) < 14) {
        inScrew = true;
        const rpm = rt.rpm['pin:' + s.id] || 0;
        if (Math.abs(rpm) >= 20) {
          let speed = U.clamp(rpm, -140, 140) * (s.props.reverse ? -1 : 1);
          const [dxw, dyw] = U.rot(1, 0, s.rot || 0);
          q.px = q.x; q.py = q.y;
          q.x += dxw * speed * dt; q.y += dyw * speed * dt;
          // pull toward tube axis
          const [nlx, nly] = U.toLocal(s, q.x, q.y);
          const [wx2, wy2] = U.toWorld(s, nlx, nly * 0.85);
          q.x = wx2; q.y = wy2;
          if (q.kind !== 'drop') rt.flags.transported = true;
        } else { q.px = q.x; q.py = q.y; } // resting inside a stopped screw
        break;
      }
      // intake scoop: near the low (pinion) end gets pulled in
      const [ex, ey] = U.toWorld(s, -104, 0);
      if (U.dist(q.x, q.y, ex, ey) < 30) {
        q.px = q.x; q.py = q.y;
        q.x += (ex - q.x) * 6 * dt; q.y += (ey - q.y) * 6 * dt;
        inScrew = true;
        break;
      }
    }

    if (!inScrew) {
      // verlet integrate
      q.px = q.x; q.py = q.y;
      q.x += vx * 0.995; q.y += vy * 0.995 + SIM.GRAV * dt * dt;
    }

    // water wheel interaction
    for (const w of wheels) {
      const d = U.dist(q.x, q.y, w.x, w.y);
      const R = PARTS.waterwheel.wheelR;
      if (d < R + q.r && d > 1) {
        const nx = (q.x - w.x) / d, ny = (q.y - w.y) / d;
        if (q.kind === 'drop') {
          // water trickles through the paddles: it slows right down (its energy
          // goes into spinning the wheel) and continues falling underneath
          rt.wheelRPM[w.id] += (75 - rt.wheelRPM[w.id]) * 2.2 * dt;
          rt.flags.wheelSpun = true;
          const dvx = (q.x - q.px) * 0.5, dvy = (q.y - q.py) * 0.55;
          q.px = q.x - dvx; q.py = q.y - dvy;
        } else {
          // solids bounce off the rim
          q.x = w.x + nx * (R + q.r);
          q.y = w.y + ny * (R + q.r);
          const rvx = (q.x - q.px) * 0.6, rvy = (q.y - q.py) * 0.6;
          q.px = q.x - rvx; q.py = q.y - rvy;
        }
      }
    }

    // grinder consumption
    let consumed = false;
    for (const gr of grinders) {
      const [lx, ly] = U.toLocal(gr, q.x, q.y);
      if (q.kind === 'leaf' && Math.abs(lx) < 14 && ly > -12 && ly < 8) {
        const rpm = Math.abs(rt.rpm['pin:' + gr.id] || 0);
        if (rpm >= 30) {
          consumed = true;
          if (!rt.flags.ground) simEvent(rt, '⚙️ The grinder is grinding!');
          rt.flags.ground = true;
          for (let i = 0; i < SIM.GROUND_DOTS; i++) {
            const [gx, gy] = U.toWorld(gr, (Math.random() - 0.5) * 16, 34 + Math.random() * 6);
            spawnSolid(rt, 'ground', gx, gy);
          }
        }
      }
    }
    if (consumed) continue;

    // collide with segments
    for (const s of segs) {
      if (s.filter && q.kind === 'drop') continue;   // liquid passes filters
      const [cx, cy] = U.closestOnSeg(q.x, q.y, s.x1, s.y1, s.x2, s.y2);
      const dx = q.x - cx, dy = q.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < q.r + 2 && d > 0.0001) {
        const nx = dx / d, ny = dy / d;
        const push = (q.r + 2 - d);
        q.x += nx * push; q.y += ny * push;
        // velocity response
        let rvx = q.x - q.px, rvy = q.y - q.py;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          rvx -= nx * vn * 1.25; rvy -= ny * vn * 1.25;   // slight bounce
          rvx *= 0.9; rvy *= 0.9;                          // friction
        }
        if (s.belt) {
          const rpm = rt.rpm['pin:' + s.part.id] || 0;
          if (Math.abs(rpm) > 1) {
            const dir = (s.part.props.reverse ? -1 : 1);
            const [bx, by] = U.rot(1, 0, s.part.rot || 0);
            const sp = U.clamp(rpm * 1.3, -160, 160) * dir;
            rvx = bx * sp * dt; rvy = by * sp * dt;
            if (q.kind !== 'drop') rt.flags.transported = true;
          }
        }
        q.px = q.x - rvx; q.py = q.y - rvy;
        if (s.filter && q.kind !== 'drop') rt.flags.filtered = true;
      }
    }

    // absorb into containers
    let absorbed = false;
    for (const c of containers) {
      const box = PARTS[c.type].getContainer(c);
      const [lx, ly] = U.toLocal(c, q.x, q.y);
      if (lx > box.x1 + 2 && lx < box.x2 - 2 && ly > box.y1 + 6 && ly < box.y2 - 2) {
        const vs = rt.vessels[c.id];
        const level = box.y2 - Math.min(1, vs.vol / box.cap) * (box.y2 - box.y1);
        if (q.kind === 'drop') {
          const tot = vs.vol + SIM.DROP_ML;
          vs.temp = (vs.temp * vs.vol + q.temp * SIM.DROP_ML) / tot;
          vs.conc = (vs.conc * vs.vol + q.conc * SIM.DROP_ML) / tot;
          vs.vol = tot;
          absorbed = true;
        } else if (ly > level - 6 || vs.vol < 5) {
          // solid settles into fluid (or the dry bottom)
          if (ly > box.y2 - 14 || ly > level - 6) {
            vs.items.push({
              kind: q.kind, extracted: 0,
              yield: q.kind === 'leaf' ? SIM.LEAF_YIELD : SIM.LEAF_YIELD / SIM.GROUND_DOTS,
              k: q.kind === 'leaf' ? SIM.LEAF_K : SIM.GROUND_K,
              rx: Math.random(), ry: Math.random(),
            });
            absorbed = true;
          }
        }
        break;
      }
    }
    if (absorbed) continue;

    // out of world
    if (q.y > SIM.WORLD_H + 40 || q.x < -60 || q.x > SIM.WORLD_W + 60) {
      if (q.kind === 'drop') rt.lostDrops++;
      continue;
    }
    alive.push(q);
  }
  rt.particles = alive;

  // cheap solid-solid separation so leaves pile up rather than stack
  const solids = rt.particles.filter(q => q.kind !== 'drop');
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy, min = a.r + b.r;
      if (d2 < min * min && d2 > 0.001) {
        const d = Math.sqrt(d2), ov = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
        b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
      }
    }
  }

  /* vessels: heating, cooling, steeping, spilling, pumping */
  for (const c of containers) {
    const vs = rt.vessels[c.id];
    const box = PARTS[c.type].getContainer(c);

    // ambient cooling
    vs.temp += -(SIM.COOL_RATE) * (vs.temp - SIM.AMBIENT) * dt;

    // boiling cap + evaporation
    if (vs.temp >= 100) { vs.temp = 100; vs.vol = Math.max(0, vs.vol - 1.5 * dt); }

    // extraction (chemistry!)
    if (vs.vol > 10) {
      const tempF = U.clamp((vs.temp - 40) / 50, 0, 1.2);
      if (tempF > 0) {
        let dEx = 0;
        for (const it of vs.items) {
          const d = (it.yield - it.extracted) * it.k * tempF * dt;
          it.extracted += d; dEx += d;
        }
        if (dEx > 0) {
          vs.conc += dEx / (vs.vol / 250);
          if (!rt.flags.steeped && vs.conc > 0.02) {
            rt.flags.steeped = true;
            simEvent(rt, '🍃 Tea is steeping, extraction has begun!');
          }
        }
      }
    }

    // overflow, spill drops appear beyond the walls so they can't fall back in
    if (vs.vol > box.cap) {
      vs.vol -= SIM.DROP_ML;
      const left = Math.random() < 0.5;
      const side = left ? box.x1 - 16 : box.x2 + 16;
      const [sx, sy] = U.toWorld(c, side, box.y1 - 4);
      spawnDrop(rt, sx, sy, vs.temp, vs.conc, left ? -50 : 50, -10);
    }
  }

  // heaters
  for (const p of state.parts) {
    if (p.type !== 'heater') continue;
    const v = rt.powered[p.id];
    const vid = rt.bindings.heaters[p.id];
    if (v && vid) {
      const vs = rt.vessels[vid];
      if (vs.vol > 5) {
        vs.temp = Math.min(100, vs.temp + (p.props.watts * (v / 12)) / (SIM.HEAT_DIV * vs.vol) * dt);
        if (!rt.flags.heated && vs.temp > 40) { rt.flags.heated = true; simEvent(rt, '♨️ The water is heating up!'); }
      }
    }
  }

  // pumps
  for (const p of state.parts) {
    if (p.type !== 'pump') continue;
    const v = rt.powered[p.id];
    const vid = rt.bindings.pumps[p.id];
    const hose = state.hoses.find(h => h.pump === p.id);
    if (v && vid && hose) {
      const vs = rt.vessels[vid];
      if (vs.vol > 1) {
        const rate = p.props.flow * (v / 12);
        const moved = Math.min(rate * dt, vs.vol);
        vs.vol -= moved;
        rt.pumpAcc[p.id] += moved;
        while (rt.pumpAcc[p.id] >= SIM.DROP_ML) {
          rt.pumpAcc[p.id] -= SIM.DROP_ML;
          spawnDrop(rt, hose.tx + (Math.random() - 0.5) * 4, hose.ty, vs.temp, vs.conc, 0, 20);
        }
        if (!rt.flags.pumped) { rt.flags.pumped = true; simEvent(rt, '🌀 Pumping fluid down the hose!'); }
      }
    }
  }

  // water wheel spin-down + animation
  for (const w of wheels) {
    rt.wheelRPM[w.id] *= Math.max(0, 1 - 0.35 * dt);
    rt.ang[w.id] = (rt.ang[w.id] || 0) + (rt.wheelRPM[w.id] * U.TAU / 60) * dt;
  }
}

/* -------- discipline badges -------- */
function disciplinesUsed(rt) {
  const f = rt.flags;
  return {
    mech: f.ground || f.transported || f.wheelSpun || f.geared,
    elec: f.powered,
    chem: f.steeped || f.filtered,
  };
}

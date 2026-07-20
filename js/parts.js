'use strict';
/* ContrapTea, part registry.
   Each part definition:
     name, disc ('mech'|'elec'|'chem'), ico, w, h, desc
     props: [{key,label,type:'range'|'select'|'toggle',min,max,step,def,unit,options}]
     terminals: [{x,y,label}]        electrical connection points (local coords)
     conduct: true                   part conducts between its two terminals when "closed"
     segs(part, rt): [{x1,y1,x2,y2,filter?,belt?}]  collision segments (local coords)
     shaftIn: {x,y,r}                pinion that gears can mesh with (consumer)
     shaftOut: {x,y}                 rotation source axle (gears lock onto it)
     container: {x1,y1,x2,y2,cap}    inner fluid box (local), rim = open top
     draw(g, part, rt)               local-space rendering (origin at part centre)
*/

const GEAR_SIZES = { small: 25, medium: 40, large: 60 };
const PIN_R = 14;          // pinion radius on grinder / screw / conveyor
const MESH_TOL = 9;        // |dist - (r1+r2)| tolerance for gears to mesh
const LOCK_TOL = 13;       // gear centre within this of a shaft => locked to it

const PARTS = {};

/* ============================ helpers ============================ */

function gearRadius(part) { return GEAR_SIZES[part.props.size] || 40; }

function drawGearShape(g, r, ang, color, dark) {
  const teeth = Math.max(8, Math.round(r / 4));
  g.save();
  g.rotate(ang || 0);
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * U.TAU, a1 = ((i + 0.5) / teeth) * U.TAU;
    const rO = r + 5, rI = r - 2;
    g.arc(0, 0, rO, a0, a0 + (0.4 / teeth) * U.TAU);
    g.arc(0, 0, rI, a1, a1 + (0.4 / teeth) * U.TAU);
  }
  g.closePath();
  g.fillStyle = color; g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.55, 0, U.TAU);
  g.fillStyle = dark; g.fill();
  g.beginPath(); g.arc(0, 0, 6, 0, U.TAU);
  g.fillStyle = color; g.fill();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * U.TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
    g.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    g.lineWidth = 7; g.strokeStyle = color; g.stroke();
  }
  g.restore();
}

function drawTerminalPlate(g, x, y) {
  g.beginPath(); g.arc(x, y, 5, 0, U.TAU);
  g.fillStyle = '#c9b78f'; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = '#57492f'; g.stroke();
}

function vesselWallSegs(hw, hh, inset) {
  return [
    { x1: -hw, y1: -hh, x2: -hw, y2: hh },
    { x1: hw, y1: -hh, x2: hw, y2: hh },
    { x1: -hw, y1: hh, x2: hw, y2: hh },
  ];
}

function drawFluid(g, part, rt, box) {
  const vs = rt && rt.vessels[part.id];
  if (!vs || vs.vol <= 0) return;
  const innerH = box.y2 - box.y1;
  const lvl = Math.min(1, vs.vol / box.cap) * innerH;
  const col = U.mixColor('#7db8e8', '#7a4210', Math.min(1, vs.conc * 1.2));
  g.fillStyle = col;
  g.globalAlpha = 0.85;
  g.fillRect(box.x1, box.y2 - lvl, box.x2 - box.x1, lvl);
  g.globalAlpha = 1;
  // steeping items bobbing in the fluid
  if (vs.items.length) {
    g.fillStyle = '#3d2b12';
    for (let i = 0; i < vs.items.length; i++) {
      const it = vs.items[i];
      const bx = box.x1 + 6 + ((it.rx * (box.x2 - box.x1 - 12)));
      const by = box.y2 - 4 - it.ry * Math.max(4, lvl - 8);
      g.beginPath();
      g.ellipse(bx, by, it.kind === 'leaf' ? 5 : 2.2, it.kind === 'leaf' ? 3 : 2.2, it.rx * 3, 0, U.TAU);
      g.fill();
    }
  }
  // bubbles when near boiling
  if (vs.temp > 93 && rt) {
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 6; i++) {
      const ph = (rt.t * (0.9 + i * 0.13) + i * 1.7) % 1;
      const bx = box.x1 + 8 + ((i * 137) % (box.x2 - box.x1 - 16));
      const by = box.y2 - 3 - ph * (lvl - 6);
      if (by > box.y2 - lvl) { g.beginPath(); g.arc(bx, by, 2 + (i % 3), 0, U.TAU); g.fill(); }
    }
  }
}

function drawSteam(g, part, rt, x, y) {
  const vs = rt && rt.vessels[part.id];
  if (!vs || vs.temp < 70 || vs.vol <= 0) return;
  g.strokeStyle = 'rgba(255,255,255,' + U.clamp((vs.temp - 70) / 60, 0, 0.55) + ')';
  g.lineWidth = 3; g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const ph = rt.t * 1.5 + i * 2;
    g.beginPath();
    g.moveTo(x + i * 14 + Math.sin(ph) * 4, y);
    g.quadraticCurveTo(x + i * 14 + Math.sin(ph + 1) * 7, y - 14, x + i * 14 + Math.sin(ph + 2) * 5, y - 26);
    g.stroke();
  }
}

/* ============================ MECHANICAL ============================ */

PARTS.gear = {
  name: 'Gear', disc: 'mech', ico: '⚙️', w: 80, h: 80,
  desc: 'Meshes with neighbouring gears and pinions when their teeth touch. Speed changes by the ratio of radii, and direction flips!',
  props: [{ key: 'size', label: 'Size', type: 'select', def: 'medium', options: [
    { v: 'small', label: 'Small (fast)' }, { v: 'medium', label: 'Medium' }, { v: 'large', label: 'Large (slow, strong)' }] }],
  segs: () => [],
  draw(g, p, rt) {
    const r = gearRadius(p);
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    drawGearShape(g, r, ang, '#c98f3d', '#8a5f26');
  },
};

PARTS.motor = {
  name: 'Electric Motor', disc: 'mech', ico: '🔌', w: 74, h: 62,
  desc: 'Turns electricity into rotation. Wire it to a battery; more volts = faster spin. Place a gear on its axle (the dot in the middle).',
  props: [{ key: 'reverse', label: 'Reverse direction', type: 'toggle', def: false }],
  terminals: [{ x: -22, y: 26, label: 'a' }, { x: 22, y: 26, label: 'b' }],
  shaftOut: { x: 0, y: 0 },
  watts: 100,
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -34, -24, 68, 48, 9);
    g.fillStyle = '#5a6570'; g.fill();
    g.strokeStyle = '#39424a'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#39424a';
    for (let i = -20; i <= 20; i += 10) g.fillRect(i - 2, -24, 4, 48);
    const on = rt && rt.powered[p.id];
    g.beginPath(); g.arc(0, 0, 10, 0, U.TAU);
    g.fillStyle = on ? '#ffd24d' : '#242a2f'; g.fill();
    g.strokeStyle = '#111'; g.stroke();
    drawTerminalPlate(g, -22, 26); drawTerminalPlate(g, 22, 26);
  },
};

PARTS.spring_motor = {
  name: 'Spring Motor', disc: 'mech', ico: '🌀', w: 74, h: 68,
  desc: 'A wound-up spring: stored mechanical energy. Spins at a set speed until it winds down. No electricity needed!',
  props: [
    { key: 'rpm', label: 'Speed', type: 'range', min: 10, max: 120, step: 5, def: 60, unit: 'rpm' },
    { key: 'duration', label: 'Wind-up', type: 'range', min: 10, max: 240, step: 5, def: 90, unit: 's' },
    { key: 'reverse', label: 'Reverse direction', type: 'toggle', def: false },
  ],
  shaftOut: { x: 0, y: 0 },
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -34, -30, 68, 60, 12);
    g.fillStyle = '#8a6a3b'; g.fill();
    g.strokeStyle = '#5c4525'; g.lineWidth = 2; g.stroke();
    const left = rt ? Math.max(0, 1 - rt.t / p.props.duration) : 1;
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    g.save(); g.rotate(ang * 0.2);
    g.beginPath();
    for (let a = 0; a < U.TAU * 3; a += 0.2) {
      const rr2 = 4 + (a / (U.TAU * 3)) * 20;
      const x = Math.cos(a) * rr2, y = Math.sin(a) * rr2;
      a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = '#3a2c14'; g.lineWidth = 3; g.stroke();
    g.restore();
    g.fillStyle = '#3a2c14'; g.fillRect(-28, 24, 56, 4);
    g.fillStyle = left > 0.25 ? '#6fbf4f' : '#c25b47';
    g.fillRect(-28, 24, 56 * left, 4);
    g.beginPath(); g.arc(0, 0, 6, 0, U.TAU); g.fillStyle = '#e0c68b'; g.fill();
  },
};

PARTS.waterwheel = {
  name: 'Water Wheel', disc: 'mech', ico: '🎡', w: 120, h: 120,
  desc: 'Falling water spins it: free mechanical power! Aim a stream at the paddles, and put a gear on its axle to use the rotation.',
  props: [],
  shaftOut: { x: 0, y: 0 },
  wheelR: 55,
  segs: () => [],
  draw(g, p, rt) {
    const R = 55;
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    g.save(); g.rotate(ang);
    g.beginPath(); g.arc(0, 0, R, 0, U.TAU);
    g.strokeStyle = '#7a5a30'; g.lineWidth = 7; g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * U.TAU;
      g.save(); g.rotate(a);
      g.fillStyle = '#9c7440';
      g.fillRect(R - 16, -3, 22, 6);
      g.fillRect(R - 4, -14, 6, 28);
      g.restore();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      g.strokeStyle = '#7a5a30'; g.lineWidth = 4; g.stroke();
    }
    g.restore();
    g.beginPath(); g.arc(0, 0, 8, 0, U.TAU); g.fillStyle = '#57492f'; g.fill();
  },
};

PARTS.grinder = {
  name: 'Leaf Grinder', disc: 'mech', ico: '🌪', w: 104, h: 116,
  desc: 'A burr mill: drop whole tea leaves in the top. When its pinion (side dot) spins fast enough (≥30 rpm), it grinds them into fine grounds, which brew much faster!',
  props: [],
  shaftIn: { x: 58, y: 0, r: PIN_R },
  segs(p, rt) {
    const s = [
      { x1: -50, y1: -55, x2: -14, y2: -6 },
      { x1: 50, y1: -55, x2: 14, y2: -6 },
      { x1: -14, y1: -6, x2: -14, y2: 26 },
      { x1: 14, y1: -6, x2: 14, y2: 26 },
    ];
    const spinning = rt && Math.abs(rt.rpm['pin:' + p.id] || 0) >= 30;
    if (!spinning) s.push({ x1: -14, y1: 6, x2: 14, y2: 6 });   // rollers block the throat
    return s;
  },
  draw(g, p, rt) {
    g.fillStyle = '#8f8578';
    g.beginPath();
    g.moveTo(-50, -55); g.lineTo(-14, -6); g.lineTo(-14, 30); g.lineTo(-22, 30);
    g.lineTo(-22, -2); g.lineTo(-58, -50); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(50, -55); g.lineTo(14, -6); g.lineTo(14, 30); g.lineTo(22, 30);
    g.lineTo(22, -2); g.lineTo(58, -50); g.closePath(); g.fill();
    g.strokeStyle = '#5f574c'; g.lineWidth = 2;
    g.strokeRect(-22, -2, 44, 32);
    // rollers
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    for (const sx of [-8, 8]) {
      g.save(); g.translate(sx, 8); g.rotate(sx > 0 ? -ang : ang);
      g.beginPath(); g.arc(0, 0, 7.5, 0, U.TAU);
      g.fillStyle = '#6b6156'; g.fill();
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.moveTo(0, -7); g.lineTo(0, 7);
      g.strokeStyle = '#4a443c'; g.lineWidth = 2; g.stroke();
      g.restore();
    }
    // pinion
    g.save(); g.translate(58, 0);
    drawGearShape(g, PIN_R, ang, '#c98f3d', '#8a5f26');
    g.restore();
  },
};

PARTS.screw = {
  name: 'Archimedes Screw', disc: 'mech', ico: '🔩', w: 240, h: 40,
  desc: 'A rotating screw inside a tube lifts leaves, grounds (and even water) along its length. Drive its pinion at the intake end (≥20 rpm). Rotate the whole part to set the incline.',
  props: [{ key: 'reverse', label: 'Reverse direction', type: 'toggle', def: false }],
  shaftIn: { x: -122, y: 0, r: PIN_R },
  tube: { len: 110, halfW: 15 },
  segs: () => [
    { x1: -110, y1: -15, x2: 110, y2: -15 },
    { x1: -110, y1: 15, x2: 110, y2: 15 },
  ],
  draw(g, p, rt) {
    g.fillStyle = 'rgba(140,150,160,.35)';
    g.fillRect(-110, -15, 220, 30);
    g.strokeStyle = '#8c96a0'; g.lineWidth = 3;
    g.strokeRect(-110, -15, 220, 30);
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    g.strokeStyle = '#c9d2da'; g.lineWidth = 2.5;
    g.beginPath();
    for (let x = -108; x <= 108; x += 2) {
      const y = Math.sin(x * 0.18 + ang) * 11;
      x === -108 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = '#98a2ac'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-110, 0); g.lineTo(110, 0); g.stroke();
    g.save(); g.translate(-122, 0);
    drawGearShape(g, PIN_R, ang, '#c98f3d', '#8a5f26');
    g.restore();
  },
};

PARTS.conveyor = {
  name: 'Conveyor Belt', disc: 'mech', ico: '➡️', w: 190, h: 34,
  desc: 'A shaft-driven belt that carries leaves and grounds sideways. Drive the pinion at its left end; reverse with a gear ratio or the toggle.',
  props: [{ key: 'reverse', label: 'Reverse direction', type: 'toggle', def: false }],
  shaftIn: { x: -101, y: 0, r: PIN_R },
  segs: () => [{ x1: -88, y1: -12, x2: 88, y2: -12, belt: true }],
  draw(g, p, rt) {
    U.rr(g, -88, -12, 176, 24, 12);
    g.fillStyle = '#4a443c'; g.fill();
    g.strokeStyle = '#2e2a25'; g.lineWidth = 2; g.stroke();
    const ang = rt ? (rt.ang[p.id] || 0) : 0;
    const rpm = rt ? (rt.rpm['pin:' + p.id] || 0) : 0;
    const off = (ang * 12) % 20;
    g.fillStyle = '#6b6156';
    for (let x = -88 + ((off % 20) + 20) % 20; x < 88; x += 20) g.fillRect(x, -12, 3, 24);
    for (const sx of [-76, 76]) {
      g.beginPath(); g.arc(sx, 0, 8, 0, U.TAU); g.fillStyle = '#8c8478'; g.fill();
    }
    g.save(); g.translate(-101, 0);
    drawGearShape(g, PIN_R, ang, '#c98f3d', '#8a5f26');
    g.restore();
    if (Math.abs(rpm) > 1) {
      g.fillStyle = '#ffd24d';
      const dir = (rpm * (p.props.reverse ? -1 : 1)) > 0 ? 1 : -1;
      g.beginPath();
      g.moveTo(dir * 60, -18); g.lineTo(dir * 68, -22); g.lineTo(dir * 60, -26);
      g.fill();
    }
  },
};

PARTS.chute = {
  name: 'Chute', disc: 'mech', ico: '📐', w: 170, h: 14,
  desc: 'A simple ramp. Rotate it to guide falling leaves and water where you want them. Statics: the humble hero of engineering.',
  props: [{ key: 'length', label: 'Length', type: 'range', min: 80, max: 260, step: 10, def: 160, unit: 'px' }],
  segs: p => [{ x1: -p.props.length / 2, y1: 0, x2: p.props.length / 2, y2: 0 }],
  draw(g, p) {
    const L = p.props.length / 2;
    g.fillStyle = '#9c7440';
    g.fillRect(-L, 0, L * 2, 7);
    g.fillStyle = '#7a5a30';
    g.fillRect(-L, 5, L * 2, 3);
  },
};

PARTS.funnel = {
  name: 'Funnel', disc: 'mech', ico: '🔻', w: 104, h: 82,
  desc: 'Catches a wide stream and narrows it to a point. Great above grinders, screws and teapots.',
  props: [],
  segs: () => [
    { x1: -50, y1: -40, x2: -12, y2: 35 },
    { x1: 50, y1: -40, x2: 12, y2: 35 },
  ],
  draw(g) {
    g.fillStyle = 'rgba(160,170,180,.4)';
    g.beginPath();
    g.moveTo(-50, -40); g.lineTo(-12, 35); g.lineTo(12, 35); g.lineTo(50, -40);
    g.closePath(); g.fill();
    g.strokeStyle = '#8c96a0'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-50, -40); g.lineTo(-12, 35); g.moveTo(50, -40); g.lineTo(12, 35);
    g.stroke();
  },
};

/* ============================ ELECTRICAL ============================ */

PARTS.battery = {
  name: 'Battery', disc: 'elec', ico: '🔋', w: 80, h: 58,
  desc: 'The power source. Loads run when wired between + and −. Higher voltage = hotter heaters, faster motors and pumps, but drains the charge faster.',
  props: [
    { key: 'voltage', label: 'Voltage', type: 'select', def: '12', options: [
      { v: '6', label: '6 V (gentle)' }, { v: '12', label: '12 V' }, { v: '24', label: '24 V (fierce)' }] },
    { key: 'capacity', label: 'Charge', type: 'range', min: 50, max: 400, step: 25, def: 250, unit: 'kJ' },
  ],
  terminals: [{ x: -25, y: -29, label: '+' }, { x: 25, y: -29, label: '−' }],
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -37, -24, 74, 48, 8);
    g.fillStyle = '#3f6b52'; g.fill();
    g.strokeStyle = '#2a4a37'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#e8e0cf'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center';
    g.fillText(p.props.voltage + 'V', 0, 6);
    g.fillStyle = '#cfe3d6'; g.font = 'bold 13px sans-serif';
    g.fillText('+', -25, -10); g.fillText('−', 25, -10);
    drawTerminalPlate(g, -25, -29); drawTerminalPlate(g, 25, -29);
    const q = rt ? U.clamp((rt.charge[p.id] || 0) / (p.props.capacity * 1000), 0, 1) : 1;
    g.fillStyle = '#20362a'; g.fillRect(-30, 13, 60, 6);
    g.fillStyle = q > 0.25 ? '#7ddc5a' : '#e05545'; g.fillRect(-30, 13, 60 * q, 6);
  },
};

PARTS.switch = {
  name: 'Switch', disc: 'elec', ico: '🎚', w: 56, h: 36,
  desc: 'A simple on/off switch, wired in series. You can flip it by clicking it while the machine runs, manual control!',
  props: [{ key: 'on', label: 'Starts ON', type: 'toggle', def: true }],
  terminals: [{ x: -24, y: 0, label: 'a' }, { x: 24, y: 0, label: 'b' }],
  conduct: true,
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -26, -15, 52, 30, 7);
    g.fillStyle = '#5c5142'; g.fill();
    g.strokeStyle = '#3d352c'; g.lineWidth = 2; g.stroke();
    const on = rt ? rt.switchState[p.id] : p.props.on;
    g.strokeStyle = on ? '#ffd24d' : '#8a7d68'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-18, 0);
    on ? g.lineTo(18, 0) : g.lineTo(12, -13);
    g.stroke();
    drawTerminalPlate(g, -24, 0); drawTerminalPlate(g, 24, 0);
  },
};

PARTS.timer = {
  name: 'Timer', disc: 'elec', ico: '⏱', w: 64, h: 48,
  desc: 'Automation! Conducts only between its ON and OFF times: perfect for sequencing: fill, then boil, then pour, then steep…',
  props: [
    { key: 'ton', label: 'ON at', type: 'range', min: 0, max: 290, step: 5, def: 0, unit: 's' },
    { key: 'toff', label: 'OFF at', type: 'range', min: 5, max: 300, step: 5, def: 45, unit: 's' },
  ],
  terminals: [{ x: -28, y: 0, label: 'a' }, { x: 28, y: 0, label: 'b' }],
  conduct: true,
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -30, -22, 60, 44, 8);
    g.fillStyle = '#4a5560'; g.fill();
    g.strokeStyle = '#333c44'; g.lineWidth = 2; g.stroke();
    const active = rt && rt.t >= p.props.ton && rt.t < p.props.toff;
    g.beginPath(); g.arc(0, 0, 13, 0, U.TAU);
    g.fillStyle = active ? '#ffd24d' : '#28303a'; g.fill();
    g.strokeStyle = '#111'; g.stroke();
    g.strokeStyle = active ? '#333' : '#8a97a3'; g.lineWidth = 2;
    const a = rt ? (rt.t / 60) * U.TAU - Math.PI / 2 : -Math.PI / 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); g.stroke();
    g.fillStyle = '#cdd6de'; g.font = '9px sans-serif'; g.textAlign = 'center';
    g.fillText(p.props.ton + '→' + p.props.toff + 's', 0, 20);
    drawTerminalPlate(g, -28, 0); drawTerminalPlate(g, 28, 0);
  },
};

PARTS.thermostat = {
  name: 'Thermostat', disc: 'elec', ico: '🌡', w: 60, h: 42,
  desc: 'Feedback control: place it inside a vessel. It conducts while the water is below its setpoint, then clicks off, so your kettle stops at just the right temperature.',
  props: [{ key: 'setpoint', label: 'Setpoint', type: 'range', min: 40, max: 100, step: 1, def: 92, unit: '°C' }],
  terminals: [{ x: -26, y: -14, label: 'a' }, { x: 26, y: -14, label: 'b' }],
  conduct: true,
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -28, -19, 56, 30, 7);
    g.fillStyle = '#7a4a52'; g.fill();
    g.strokeStyle = '#54333a'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#f0d9dc'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
    g.fillText(p.props.setpoint + '°', 0, -2);
    // probe
    g.strokeStyle = '#c9646f'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 11); g.lineTo(0, 22); g.stroke();
    const closed = rt ? rt.switchState[p.id] : true;
    g.beginPath(); g.arc(0, 24, 4, 0, U.TAU);
    g.fillStyle = closed ? '#ffd24d' : '#54333a'; g.fill();
    drawTerminalPlate(g, -26, -14); drawTerminalPlate(g, 26, -14);
  },
};

PARTS.heater = {
  name: 'Heating Element', disc: 'elec', ico: '♨️', w: 66, h: 26,
  desc: 'An immersion heater: place it inside a vessel and power it. Joule heating: more watts and volts boil faster, but small volumes heat quickest.',
  props: [{ key: 'watts', label: 'Power', type: 'range', min: 300, max: 3000, step: 100, def: 1200, unit: 'W' }],
  terminals: [{ x: -22, y: -12, label: 'a' }, { x: 22, y: -12, label: 'b' }],
  segs: () => [],
  draw(g, p, rt) {
    const on = rt && rt.powered[p.id];
    g.strokeStyle = on ? '#ff7940' : '#8a7d68';
    if (on) { g.shadowColor = '#ff7940'; g.shadowBlur = 10; }
    g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-28, 8);
    for (let x = -28; x <= 28; x += 7) g.lineTo(x, x % 14 === 0 ? 2 : 12);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = '#57492f'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-22, -10); g.lineTo(-25, 6); g.moveTo(22, -10); g.lineTo(25, 6); g.stroke();
    drawTerminalPlate(g, -22, -12); drawTerminalPlate(g, 22, -12);
  },
};

PARTS.pump = {
  name: 'Electric Pump', disc: 'elec', ico: '🌀', w: 62, h: 54,
  desc: 'Sucks fluid from the vessel it sits in (or next to) and pushes it along its hose. Drag from the outlet (top dot) to aim the hose. Flow scales with voltage.',
  props: [{ key: 'flow', label: 'Flow', type: 'range', min: 10, max: 60, step: 5, def: 35, unit: 'ml/s' }],
  terminals: [{ x: -20, y: -8, label: 'a' }, { x: 20, y: -8, label: 'b' }],
  outlet: { x: 0, y: -27 },
  inlet: { x: 0, y: 30 },
  segs: () => [],
  draw(g, p, rt) {
    const on = rt && rt.powered[p.id];
    U.rr(g, -24, -18, 48, 42, 9);
    g.fillStyle = '#3f6478'; g.fill();
    g.strokeStyle = '#2a4553'; g.lineWidth = 2; g.stroke();
    g.save();
    g.translate(0, 3);
    if (rt) g.rotate((rt.ang[p.id] || 0));
    g.strokeStyle = on ? '#bde3f5' : '#6d8fa3';
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * U.TAU;
      g.beginPath(); g.arc(Math.cos(a) * 5, Math.sin(a) * 5, 7, a, a + 2.4); g.stroke();
    }
    g.restore();
    // outlet stub + inlet
    g.fillStyle = '#2a4553';
    g.fillRect(-5, -30, 10, 14);
    g.fillRect(-5, 22, 10, 10);
    g.beginPath(); g.arc(0, -27, 5.5, 0, U.TAU);
    g.fillStyle = on ? '#8fd8ff' : '#88a8b8'; g.fill();
    g.strokeStyle = '#1e3340'; g.stroke();
    drawTerminalPlate(g, -20, -8); drawTerminalPlate(g, 20, -8);
  },
};

PARTS.gate = {
  name: 'Solenoid Gate', disc: 'elec', ico: '🚧', w: 30, h: 74,
  desc: 'A powered barrier that blocks leaves, grounds and water. Wired: open only when powered. Unwired: use the toggle. Combine with a timer for controlled release!',
  props: [{ key: 'open', label: 'Open (when unwired)', type: 'toggle', def: false }],
  terminals: [{ x: -11, y: -35, label: 'a' }, { x: 11, y: -35, label: 'b' }],
  segs(p, rt) {
    const open = rt ? rt.gateOpen[p.id] : p.props.open;
    return open ? [] : [{ x1: 0, y1: -24, x2: 0, y2: 32 }];
  },
  draw(g, p, rt) {
    const open = rt ? rt.gateOpen[p.id] : p.props.open;
    U.rr(g, -13, -34, 26, 14, 4);
    g.fillStyle = '#7a6a45'; g.fill();
    g.strokeStyle = '#4f4227'; g.lineWidth = 2; g.stroke();
    g.fillStyle = open ? 'rgba(200,190,160,.35)' : '#c9b78f';
    const h = open ? 14 : 56;
    g.fillRect(-3.5, -20, 7, h);
    g.strokeStyle = '#57492f'; g.strokeRect(-3.5, -20, 7, h);
    drawTerminalPlate(g, -11, -35); drawTerminalPlate(g, 11, -35);
  },
};

/* ============================ CHEMICAL / PROCESS ============================ */

PARTS.tap = {
  name: 'Water Tap', disc: 'chem', ico: '🚰', w: 74, h: 60,
  desc: 'Pours cold water (20 °C). Unwired it runs the whole time; wire it up (solenoid valve) to switch it electrically, through a timer, say.',
  props: [{ key: 'flow', label: 'Flow', type: 'range', min: 10, max: 60, step: 2, def: 26, unit: 'ml/s' }],
  terminals: [{ x: -20, y: -26, label: 'a' }, { x: 20, y: -26, label: 'b' }],
  spout: { x: 0, y: 30 },
  segs: () => [],
  draw(g, p, rt) {
    g.fillStyle = '#8c96a0';
    g.fillRect(-34, -14, 52, 14);
    g.fillRect(-8, -14, 16, 38);
    g.beginPath(); g.arc(-34, -7, 7, 0, U.TAU); g.fill();
    // handle
    g.save(); g.translate(0, -18);
    g.strokeStyle = '#c94f4f'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-12, -5); g.lineTo(12, -5); g.stroke();
    g.fillStyle = '#c94f4f';
    g.beginPath(); g.arc(0, -5, 4.5, 0, U.TAU); g.fill();
    g.restore();
    g.fillStyle = '#6d7780';
    g.fillRect(-8, 22, 16, 6);
    const on = rt && rt.tapOn[p.id];
    if (on) {
      g.fillStyle = 'rgba(125,184,232,.8)';
      g.fillRect(-4, 28, 8, 10);
    }
    drawTerminalPlate(g, -20, -26); drawTerminalPlate(g, 20, -26);
  },
};

PARTS.caddy = {
  name: 'Tea Caddy', disc: 'chem', ico: '🍃', w: 84, h: 74,
  desc: 'Holds whole tea leaves and drips them out of the bottom while the machine runs. Grind them for a faster, stronger brew, or steep them whole for subtlety.',
  props: [
    { key: 'count', label: 'Leaves', type: 'range', min: 2, max: 20, step: 1, def: 8, unit: '' },
    { key: 'rate', label: 'Drop every', type: 'range', min: 0.5, max: 4, step: 0.25, def: 1.25, unit: 's' },
  ],
  dropAt: { x: 0, y: 42 },
  segs: () => [],
  draw(g, p, rt) {
    U.rr(g, -32, -34, 64, 62, 8);
    g.fillStyle = '#4f7a52'; g.fill();
    g.strokeStyle = '#35543a'; g.lineWidth = 2; g.stroke();
    U.rr(g, -32, -34, 64, 16, 8);
    g.fillStyle = '#c9a856'; g.fill();
    g.fillStyle = '#e8e0cf'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
    g.fillText('TEA', 0, 2);
    const left = rt ? (rt.caddyLeft[p.id] ?? p.props.count) : p.props.count;
    g.fillText('🍃 ' + left, 0, 18);
    g.fillStyle = '#35543a'; g.fillRect(-7, 28, 14, 10);
  },
};

PARTS.vessel = {
  name: 'Kettle / Pot', disc: 'chem', ico: '🫕', w: 148, h: 116,
  desc: 'An open vessel: catches water and leaves, mixes and steeps them. Heat it with a heating element; empty it with a pump. Thermal mass: big volumes heat slowly!',
  props: [{ key: 'cap', label: 'Capacity', type: 'range', min: 300, max: 1200, step: 50, def: 600, unit: 'ml' }],
  container: { x1: -62, y1: -55, x2: 62, y2: 47, get cap() { return 600; } },
  getContainer(p) { return { x1: -62, y1: -55, x2: 62, y2: 47, cap: p.props.cap }; },
  segs: () => vesselWallSegs(70, 55, 8),
  draw(g, p, rt) {
    drawFluid(g, p, rt, this.getContainer(p));
    g.strokeStyle = '#b8b0a4'; g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-70, -55); g.lineTo(-70, 51); g.lineTo(70, 51); g.lineTo(70, -55);
    g.stroke();
    g.strokeStyle = '#7d766c'; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-70, -55); g.lineTo(-70, 51); g.lineTo(70, 51); g.lineTo(70, -55);
    g.stroke();
    drawSteam(g, p, rt, 0, -60);
    // live readout
    const vs = rt && rt.vessels[p.id];
    if (vs && vs.vol > 1) {
      g.fillStyle = 'rgba(20,16,12,.65)';
      U.rr(g, -44, 58, 88, 18, 6); g.fill();
      g.fillStyle = '#f3e9d8'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
      g.fillText(`${Math.round(vs.temp)}°  ${Math.round(vs.vol)}ml  ${Math.round(vs.conc * 100)}%`, 0, 71);
    }
  },
};

PARTS.filter = {
  name: 'Filter Mesh', disc: 'chem', ico: '🕸', w: 100, h: 14,
  desc: 'Separation! Liquid drips straight through; leaves and grounds are caught on top. Put one over your cup: nobody likes bits in their tea.',
  props: [],
  segs: () => [{ x1: -45, y1: 0, x2: 45, y2: 0, filter: true }],
  draw(g) {
    g.strokeStyle = '#c9b78f'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-48, 0); g.lineTo(48, 0); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = -44; x <= 44; x += 8) { g.moveTo(x, -4); g.lineTo(x + 4, 4); g.moveTo(x + 4, -4); g.lineTo(x, 4); }
    g.stroke();
  },
};

PARTS.cup = {
  name: 'The Cup', disc: 'chem', ico: '☕', w: 96, h: 88,
  desc: 'The goal! Fill it with ~250 ml of 70–90 °C tea at 40–70 % strength. Serve when you\'re proud of it.',
  props: [],
  unique: true,
  container: { x1: -37, y1: -40, x2: 37, y2: 34, cap: 300 },
  getContainer() { return { x1: -37, y1: -40, x2: 37, y2: 34, cap: 300 }; },
  segs: () => vesselWallSegs(45, 40, 8),
  draw(g, p, rt) {
    drawFluid(g, p, rt, this.getContainer());
    g.strokeStyle = '#e8e0cf'; g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-45, -40); g.lineTo(-45, 36); g.lineTo(45, 36); g.lineTo(45, -40);
    g.stroke();
    g.strokeStyle = '#b3a68e'; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-45, -40); g.lineTo(-45, 36); g.lineTo(45, 36); g.lineTo(45, -40);
    g.stroke();
    // handle
    g.strokeStyle = '#e8e0cf'; g.lineWidth = 7;
    g.beginPath(); g.arc(50, -2, 16, -Math.PI / 2, Math.PI / 2); g.stroke();
    drawSteam(g, p, rt, 0, -46);
    g.fillStyle = '#c9a856'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center';
    g.fillText('★ THE CUP ★', 0, 52);
  },
};

/* ============================ world-space helpers ============================ */

function partDef(part) { return PARTS[part.type]; }

function worldSegs(part, rt) {
  const def = partDef(part);
  const out = [];
  for (const s of def.segs(part, rt)) {
    const [x1, y1] = U.toWorld(part, s.x1, s.y1);
    const [x2, y2] = U.toWorld(part, s.x2, s.y2);
    out.push({ x1, y1, x2, y2, filter: !!s.filter, belt: !!s.belt, part });
  }
  return out;
}

function worldTerminals(part) {
  const def = partDef(part);
  if (!def.terminals) return [];
  return def.terminals.map((t, i) => {
    const [x, y] = U.toWorld(part, t.x, t.y);
    return { x, y, idx: i, part, label: t.label };
  });
}

function makePart(type, x, y) {
  const def = PARTS[type];
  const props = {};
  for (const pr of (def.props || [])) props[pr.key] = pr.def;
  return { id: U.uid(), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rot: 0, props };
}

const PALETTE_ORDER = {
  mech: ['gear', 'motor', 'spring_motor', 'waterwheel', 'grinder', 'screw', 'conveyor', 'chute', 'funnel'],
  elec: ['battery', 'switch', 'timer', 'thermostat', 'heater', 'pump', 'gate'],
  chem: ['tap', 'caddy', 'vessel', 'filter', 'cup'],
};

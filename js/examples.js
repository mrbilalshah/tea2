'use strict';
/* ContrapTea, loadable example machines.
   These are just ordinary saved states: everything here can be built by hand. */

function _exPart(id, type, x, y, rot, props) {
  const p = makePart(type, x, y);
  p.id = id; p.rot = rot || 0;
  Object.assign(p.props, props || {});
  return p;
}
function _wire(a, ai, b, bi) { return { id: U.uid(), a: [a, ai], b: [b, bi] }; }

const EXAMPLES = {
  starter: {
    name: 'Starter Brewery',
    blurb: 'Electrical + chemical: a timed tap fills the kettle, a thermostat-controlled heater boils it, pumps move the water through a teapot of whole leaves and pour through a filter. Watch the timers sequence it!',
    build() {
      const parts = [
        _exPart('ex_tap', 'tap', 250, 80, 0, { flow: 24 }),
        _exPart('ex_ket', 'vessel', 250, 260, 0, { cap: 600 }),
        _exPart('ex_htr', 'heater', 250, 295, 0, { watts: 1200 }),
        _exPart('ex_thr', 'thermostat', 215, 270, 0, { setpoint: 92 }),
        _exPart('ex_bat', 'battery', 700, 80, 0, { voltage: '12', capacity: 250 }),
        _exPart('ex_tm0', 'timer', 450, 60, 0, { ton: 0, toff: 25 }),
        _exPart('ex_tm1', 'timer', 450, 140, 0, { ton: 70, toff: 92 }),
        _exPart('ex_tm2', 'timer', 450, 220, 0, { ton: 130, toff: 152 }),
        _exPart('ex_pm1', 'pump', 340, 300, 0, { flow: 35 }),
        _exPart('ex_cad', 'caddy', 620, 60, 0, { count: 10, rate: 1.25 }),
        _exPart('ex_pot', 'vessel', 620, 280, 0, { cap: 600 }),
        _exPart('ex_pm2', 'pump', 712, 320, 0, { flow: 35 }),
        _exPart('ex_fil', 'filter', 1000, 560, 0, {}),
        _exPart('ex_cup', 'cup', 1000, 660, 0, {}),
      ];
      const wires = [
        _wire('ex_bat', 0, 'ex_tm0', 0), _wire('ex_tm0', 1, 'ex_tap', 0), _wire('ex_tap', 1, 'ex_bat', 1),
        _wire('ex_bat', 0, 'ex_thr', 0), _wire('ex_thr', 1, 'ex_htr', 0), _wire('ex_htr', 1, 'ex_bat', 1),
        _wire('ex_bat', 0, 'ex_tm1', 0), _wire('ex_tm1', 1, 'ex_pm1', 0), _wire('ex_pm1', 1, 'ex_bat', 1),
        _wire('ex_bat', 0, 'ex_tm2', 0), _wire('ex_tm2', 1, 'ex_pm2', 0), _wire('ex_pm2', 1, 'ex_bat', 1),
      ];
      const hoses = [
        { id: U.uid(), pump: 'ex_pm1', tx: 620, ty: 180 },
        { id: U.uid(), pump: 'ex_pm2', tx: 1000, ty: 470 },
      ];
      return { parts, wires, hoses };
    },
  },

  grand: {
    name: 'Grand Tea Engine',
    blurb: 'All three disciplines! A motor-driven gear train grinds the leaves, an Archimedes screw (on a spring motor) hauls the grounds uphill, a water wheel spins in the tap stream, and the electrics sequence the whole brew.',
    build() {
      const parts = [
        // --- leaf line: caddy -> funnel -> grinder -> chute -> funnel -> screw -> teapot
        _exPart('gx_cad', 'caddy', 150, 120, 0, { count: 8, rate: 1 }),
        _exPart('gx_fn1', 'funnel', 150, 215, 0, {}),
        _exPart('gx_grn', 'grinder', 150, 330, 0, {}),
        _exPart('gx_g2', 'gear', 247, 330, 0, { size: 'small' }),
        _exPart('gx_g1', 'gear', 332, 330, 0, { size: 'large' }),
        _exPart('gx_mot', 'motor', 332, 330, 0, {}),
        _exPart('gx_cht', 'chute', 175, 410, 20, { length: 120 }),
        _exPart('gx_fn2', 'funnel', 215, 480, 0, {}),
        _exPart('gx_scw', 'screw', 300, 505, -35, { reverse: true }),
        _exPart('gx_spr', 'spring_motor', 200, 631, 0, { rpm: 30, duration: 240 }),
        _exPart('gx_g4', 'gear', 200, 631, 0, { size: 'medium' }),
        _exPart('gx_pot', 'vessel', 445, 520, 0, { cap: 600 }),
        // --- water line: tap -> water wheel -> kettle (heater + thermostat) -> pump -> teapot
        _exPart('gx_tap', 'tap', 700, 80, 0, { flow: 22 }),
        _exPart('gx_whl', 'waterwheel', 700, 225, 0, {}),
        _exPart('gx_ket', 'vessel', 700, 390, 0, { cap: 600 }),
        _exPart('gx_htr', 'heater', 700, 420, 0, { watts: 1500 }),
        _exPart('gx_thr', 'thermostat', 665, 400, 0, { setpoint: 95 }),
        _exPart('gx_pm1', 'pump', 785, 425, 0, { flow: 35 }),
        // --- serve line: pump -> filter -> cup
        _exPart('gx_pm2', 'pump', 520, 450, 0, { flow: 35 }),
        _exPart('gx_fil', 'filter', 1000, 560, 0, {}),
        _exPart('gx_cup', 'cup', 1000, 655, 0, {}),
        // --- electrics
        _exPart('gx_bat', 'battery', 1000, 100, 0, { voltage: '24', capacity: 400 }),
        _exPart('gx_tm0', 'timer', 870, 60, 0, { ton: 0, toff: 30 }),
        _exPart('gx_tm1', 'timer', 870, 140, 0, { ton: 45, toff: 65 }),
        _exPart('gx_tm2', 'timer', 870, 220, 0, { ton: 110, toff: 130 }),
      ];
      const wires = [
        _wire('gx_bat', 0, 'gx_tm0', 0), _wire('gx_tm0', 1, 'gx_tap', 0), _wire('gx_tap', 1, 'gx_bat', 1),
        _wire('gx_bat', 0, 'gx_thr', 0), _wire('gx_thr', 1, 'gx_htr', 0), _wire('gx_htr', 1, 'gx_bat', 1),
        _wire('gx_bat', 0, 'gx_tm1', 0), _wire('gx_tm1', 1, 'gx_pm1', 0), _wire('gx_pm1', 1, 'gx_bat', 1),
        _wire('gx_bat', 0, 'gx_tm2', 0), _wire('gx_tm2', 1, 'gx_pm2', 0), _wire('gx_pm2', 1, 'gx_bat', 1),
        _wire('gx_bat', 0, 'gx_mot', 0), _wire('gx_mot', 1, 'gx_bat', 1),
      ];
      const hoses = [
        { id: U.uid(), pump: 'gx_pm1', tx: 445, ty: 430 },
        { id: U.uid(), pump: 'gx_pm2', tx: 1000, ty: 480 },
      ];
      return { parts, wires, hoses };
    },
  },
};

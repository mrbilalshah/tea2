# ContrapTea 🫖 — Design Document

*Build your own tea machine.*

## Vision

A creative 2D physics sandbox where the player builds a **unique contraption that makes a
cup of tea**, using real (but playful) concepts from **mechanical**, **electrical** and
**chemical** engineering. There is no single solution: the player is given a workshop, a
box of parts and a cup — how the tea gets made is up to them.

Inspired by Heath Robinson contraptions and games like *The Incredible Machine*, but
**sandbox-first**: the goal is a machine that is *yours*, not a puzzle with an answer.

## Design pillars

1. **Creativity over puzzles** — free placement, free wiring, many valid machines.
2. **Real concepts, forgiving numbers** — gear ratios, P = V·I heating, extraction
   kinetics all behave believably, but tuned to be fun rather than exact.
3. **Watchability** — hitting RUN should be a show: spinning gears, falling leaves,
   steam, pouring tea.
4. **Always succeed, always improvable** — any machine that gets liquid in the cup gets
   scored; the score and tips invite iteration ("grind finer", "insulate", "steep less").

## Core loop

**BUILD** (place parts, rotate, tune properties, connect wires & hoses)
→ **RUN** (deterministic simulation from t=0; watch it operate)
→ **SERVE** (score the cup: temperature, strength, volume + engineering badges)
→ tweak and run again. Machines auto-save locally and can be exported as share codes.

## The three disciplines

### Mechanical engineering
| Part | Concept |
|---|---|
| Gear (3 sizes) | Gear meshing & ratios — speed multiplies by r₁/r₂, direction flips |
| Electric motor | Electromechanical power; speed scales with voltage |
| Spring motor | Stored mechanical energy — fixed rpm for a limited wind-up time |
| Water wheel | Falling water → rotation (and a way to earn mechanical power for free) |
| Grinder | Needs enough shaft rpm; turns whole leaves into fine grounds |
| Archimedes screw | Rotating screw transports solids up an incline |
| Conveyor belt | Shaft-driven horizontal transport |
| Chute / Funnel | Statics: gravity feeds and flow guiding |

### Electrical engineering
| Part | Concept |
|---|---|
| Battery | Voltage source (6/12/24 V) with finite charge — loads drain it |
| Wires | Circuits: a load runs only when connected to + and − |
| Switch | Manual control (clickable while running) |
| Timer | Sequencing/automation — closes the circuit between t₁ and t₂ |
| Thermostat | Feedback control — opens the circuit when its vessel passes a setpoint |
| Heating element | Joule heating — power scales with voltage, heats the vessel it sits in |
| Electric pump | Moves fluid through a hose; flow scales with voltage |
| Solenoid gate/valve | Powered barrier that blocks or releases solids and liquids |

### Chemical (process) engineering
| Part / mechanic | Concept |
|---|---|
| Steeping | Extraction kinetics: rate ∝ temperature and surface area (ground ≫ whole leaf), first-order approach to full extraction |
| Concentration | Strength = extracted tea / volume; dilution on mixing is mass-balanced |
| Filter | Separation: liquid passes, solids retained |
| Vessels | Batch processing, mixing (temperature & concentration mass balance), overflow |
| Heating/cooling | Thermal mass (bigger volume heats slower), ambient losses, evaporation at boil |

## Simulation model (plausible & playful)

- World: fixed 1600×1000 logical canvas, scaled to fit; grid-snapped free placement,
  15° rotation steps.
- **Particles** (verlet integration, gravity, segment collisions): whole leaves, ground
  tea, water droplets. Droplets carry volume, temperature and concentration.
- **Vessels** hold continuous fluid (volume, temperature, concentration) — droplets merge
  in, pumps draw out, overflow spills.
- **Mechanical network**: motors/springs/wheels are speed sources; gears mesh when their
  pitch circles touch; speeds propagate with ratio −r₁/r₂ to grinder/screw/conveyor pinions.
- **Electrical network**: graph reachability from battery + and − through wires and closed
  conductors (switch/timer/thermostat). Loads are parallel; switches compose in series.
- Heating: dT/dt = P / (1.05·V_ml) (playfully fast water heating), capped at 100 °C with
  evaporation; ambient cooling −0.004·(T−20)/s.
- Extraction: per leaf/ground item, d(extracted) = (yield − extracted)·k·f(T)·dt with
  k_ground ≈ 4.5× k_leaf; concentration normalised to a 250 ml cup.

## Scoring — "Serve the tea!"

| Axis | Ideal | Notes |
|---|---|---|
| Temperature | 70–90 °C | too cold = sad, boiling = scalding |
| Strength | 40–70 % | weak ↔ stewed |
| Volume | ≥ 220 ml | a proper cupful |
| Bits in cup | 0 | leaves/grounds in the cup cost points — use a filter! |

Weighted score → 1–5 stars with a title ("A Proper Brew!") plus **engineering badges**
for each discipline the machine genuinely used, and targeted tips generated from the
weakest axis so every run suggests the next experiment.

## UX

- Left palette grouped and colour-coded by discipline; click to place, drag to move,
  R to rotate, Delete to remove.
- Inspector panel for the selected part (rotation, properties like voltage, wattage,
  flow, timer windows, thermostat setpoint...).
- Drag between terminals to wire; drag from a pump outlet to aim its hose.
- Run controls: RUN / STOP, 1×/2×/4× speed, SERVE.
- Live vessel readouts (temp/volume/strength) and a cup gauge with ideal bands.
- Engineer's Handbook (help modal) explaining each discipline's concepts.
- Two loadable example machines: **Starter Brewery** (electrical + chemical) and the
  **Grand Tea Engine** (all three disciplines, incl. grinder, screw and water wheel).
- Autosave to localStorage; export/import compact share codes.

## Tech

Static web app — plain HTML/CSS/JS (classic scripts, no build step, no dependencies),
single `<canvas>` renderer. Open `index.html` directly or host anywhere static
(GitHub Pages ready).

```
index.html      css/style.css
js/util.js      maths helpers
js/parts.js     part registry: geometry, terminals, shafts, rendering
js/sim.js       runtime simulation: particles, circuits, gears, vessels, chemistry
js/score.js     cup scoring, badges, tips
js/examples.js  example machines
js/ui.js        palette, inspector, wiring, save/share, modals
js/main.js      game loop & mode management
```

## Roadmap (post-v1 ideas)

Milk & sugar chemistry, kettle whistle & sounds, tea-order challenges (builder's brew vs
delicate green), belt/pulley pairs, PID kettle minigame, share-code gallery.

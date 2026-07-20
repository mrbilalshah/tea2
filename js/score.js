'use strict';
/* ContrapTea, cup scoring, badges and tips */

const IDEAL = {
  tempLo: 70, tempHi: 90,
  strLo: 40, strHi: 70,
  volFull: 220,
};

function axisScores(cupVs) {
  const vol = cupVs.vol;
  const temp = cupVs.temp;
  const str = cupVs.conc * 100;
  const bits = cupVs.items.length;

  let volScore = vol >= IDEAL.volFull ? 100 : U.clamp((vol - 30) / (IDEAL.volFull - 30), 0, 1) * 100;

  let tempScore;
  if (temp >= IDEAL.tempLo && temp <= IDEAL.tempHi) tempScore = 100;
  else if (temp < IDEAL.tempLo) tempScore = Math.max(0, 100 - (IDEAL.tempLo - temp) * 3);
  else tempScore = Math.max(0, 100 - (temp - IDEAL.tempHi) * 5);

  let strScore;
  if (str >= IDEAL.strLo && str <= IDEAL.strHi) strScore = 100;
  else if (str < IDEAL.strLo) strScore = U.clamp(str / IDEAL.strLo, 0, 1) * 100;
  else strScore = Math.max(0, 100 - (str - IDEAL.strHi) * 1.6);

  if (vol < 30) tempScore = strScore = 0;   // an empty cup has no qualities

  return { vol, temp, str, bits, volScore, tempScore, strScore };
}

function scoreCup(rt) {
  const cupId = rt.bindings.cupId;
  const cupVs = cupId ? rt.vessels[cupId] : null;
  if (!cupVs) return null;

  const a = axisScores(cupVs);
  let overall = a.volScore * 0.3 + a.tempScore * 0.35 + a.strScore * 0.35;
  overall = Math.max(0, overall - Math.min(25, a.bits * 5));

  let stars = U.clamp(Math.round(overall / 20), 0, 5);
  if (a.vol > 50 && stars === 0) stars = 1;

  const titles = [
    'An Empty Gesture', 'A Builder\'s Nightmare', 'A Bit Dodgy',
    'A Decent Brew', 'A Lovely Cuppa', 'A PROPER BREW!',
  ];

  return { ...a, overall, stars, title: titles[stars], tips: makeTips(a), disc: disciplinesUsed(rt) };
}

function makeTips(a) {
  const tips = [];
  if (a.vol < 30) {
    tips.push('☕ The cup is basically empty! Get water flowing: tap → kettle → pump with a hose aimed over the cup.');
    return tips;
  }
  if (a.volScore < 80) tips.push(`💧 Only ${Math.round(a.vol)} ml made it to the cup; pump for longer (widen the timer window) or lose less water on the way.`);
  if (a.temp < IDEAL.tempLo) tips.push(`🥶 Served at ${Math.round(a.temp)}°C, lukewarm! More heater watts or voltage, a hotter thermostat setpoint, or serve sooner after pouring (heat is lost every second).`);
  if (a.temp > IDEAL.tempHi) tips.push(`🔥 ${Math.round(a.temp)}°C is scalding! Lower the thermostat setpoint or let it stand a moment before serving.`);
  if (a.str < IDEAL.strLo) tips.push(`😴 ${Math.round(a.str)}% strength is weak. Grind the leaves (ground tea extracts ~4× faster), steep hotter or longer, or add more leaves.`);
  if (a.str > IDEAL.strHi) tips.push(`🥴 ${Math.round(a.str)}% strength: stewed! Fewer leaves, a shorter steep, or more water to dilute.`);
  if (a.bits > 0) tips.push(`🍃 ${a.bits} bit${a.bits > 1 ? 's' : ''} of leaf in the cup; pour through a Filter Mesh to keep them out.`);
  if (!tips.length) tips.push('🏆 Perfection. Now make it more ridiculous: can a water wheel power the grinder?');
  return tips;
}

'use strict';
/* CAMPAIGN TRAIL map: 50 states (no DC), tiers, party colour, borders. Pure data, no I/O.
   Borders: the standard land-border list of the 48 contiguous states (rivers count, Four Corners diagonals AZ-CO and NM-UT do not, water-only
   boundaries such as MI-MN do not). Air links so AK and HI are playable: AK-WA, AK-HI, HI-CA (listed in `air`, also present in `adj`).
   Every state lists its neighbours itself (both directions written out), so the tests can check symmetry. Codes are alphabetical = map order. */
const TIERS = { safe: { g100: 104 }, lean: { g100: 110 }, swing: { g100: 130 } };
const SWING = 'PA GA AZ WI MI NV NC'.split(' ');
const LEAN = 'NH MN NJ VA NM ME CO NY IL OR DE CT RI FL TX OH IA AK'.split(' ');
const R = 'AL AK AR FL ID IN IA KS KY LA MS MO MT NE ND OH OK SC SD TN TX UT WV WY'.split(' ');   // 2024 presidential result, non-swing
// code: [name, neighbours]
const RAW = {
  AL: ['Alabama', 'FL GA MS TN'], AK: ['Alaska', 'HI WA'], AZ: ['Arizona', 'CA NV NM UT'], AR: ['Arkansas', 'LA MO MS OK TN TX'],
  CA: ['California', 'AZ HI NV OR'], CO: ['Colorado', 'KS NE NM OK UT WY'], CT: ['Connecticut', 'MA NY RI'], DE: ['Delaware', 'MD NJ PA'],
  FL: ['Florida', 'AL GA'], GA: ['Georgia', 'AL FL NC SC TN'], HI: ['Hawaii', 'AK CA'], ID: ['Idaho', 'MT NV OR UT WA WY'],
  IL: ['Illinois', 'IA IN KY MO WI'], IN: ['Indiana', 'IL KY MI OH'], IA: ['Iowa', 'IL MN MO NE SD WI'], KS: ['Kansas', 'CO MO NE OK'],
  KY: ['Kentucky', 'IL IN MO OH TN VA WV'], LA: ['Louisiana', 'AR MS TX'], ME: ['Maine', 'NH'], MD: ['Maryland', 'DE PA VA WV'],
  MA: ['Massachusetts', 'CT NH NY RI VT'], MI: ['Michigan', 'IN OH WI'], MN: ['Minnesota', 'IA ND SD WI'], MS: ['Mississippi', 'AL AR LA TN'],
  MO: ['Missouri', 'AR IL IA KS KY NE OK TN'], MT: ['Montana', 'ID ND SD WY'], NE: ['Nebraska', 'CO IA KS MO SD WY'], NV: ['Nevada', 'AZ CA ID OR UT'],
  NH: ['New Hampshire', 'MA ME VT'], NJ: ['New Jersey', 'DE NY PA'], NM: ['New Mexico', 'AZ CO OK TX'], NY: ['New York', 'CT MA NJ PA VT'],
  NC: ['North Carolina', 'GA SC TN VA'], ND: ['North Dakota', 'MN MT SD'], OH: ['Ohio', 'IN KY MI PA WV'], OK: ['Oklahoma', 'AR CO KS MO NM TX'],
  OR: ['Oregon', 'CA ID NV WA'], PA: ['Pennsylvania', 'DE MD NJ NY OH WV'], RI: ['Rhode Island', 'CT MA'], SC: ['South Carolina', 'GA NC'],
  SD: ['South Dakota', 'IA MN MT ND NE WY'], TN: ['Tennessee', 'AL AR GA KY MO MS NC VA'], TX: ['Texas', 'AR LA NM OK'], UT: ['Utah', 'AZ CO ID NV WY'],
  VT: ['Vermont', 'MA NH NY'], VA: ['Virginia', 'KY MD NC TN WV'], WA: ['Washington', 'AK ID OR'], WV: ['West Virginia', 'KY MD OH PA VA'],
  WI: ['Wisconsin', 'IL IA MI MN'], WY: ['Wyoming', 'CO ID MT NE SD UT'],
};
const states = {};
for (const code of Object.keys(RAW).sort()) {
  const tier = SWING.includes(code) ? 'swing' : LEAN.includes(code) ? 'lean' : 'safe';
  const party = tier === 'swing' ? 'S' : R.includes(code) ? 'R' : 'D';
  states[code] = { name: RAW[code][0], tier, party, adj: RAW[code][1].split(' ') };
}
const air = [['AK', 'WA'], ['AK', 'HI'], ['CA', 'HI']];
module.exports = { states, codes: Object.keys(states), air, tiers: TIERS };

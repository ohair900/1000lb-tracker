// Unit tests for 1000lb Club Tracker core functions
// Run with: node tests.js

const LBS_PER_KG = 2.205;
const E1RM_DIVISOR = 30;

const WILKS = {
  male:   { a: -216.0475144, b: 16.2606339, c: -0.002388645, d: -0.00113732, e: 7.01863e-06, f: -1.291e-08 },
  female: { a: 594.31747775582, b: -27.23842536447, c: 0.82112226871, d: -0.00930733913, e: 4.731582e-05, f: -9.054e-08 }
};
const DOTS = {
  male:   { a: -307.75076, b: 24.0900756, c: -0.1918759221, d: 0.0007391293, e: -0.000001093 },
  female: { a: -57.96288, b: 13.6175032, c: -0.1126655495, d: 0.0005158568, e: -0.0000010706 }
};

// --- Functions under test (copied from index.html) ---
function calcE1RM(w, r) { return r === 1 ? w : w * (1 + r / E1RM_DIVISOR); }

function lbsToKg(v) { return v / LBS_PER_KG; }

function calcWilks(totalKg, bwKg, gender) {
  if (!gender || !totalKg || !bwKg) return null;
  const c = WILKS[gender];
  const d = c.a + c.b*bwKg + c.c*bwKg**2 + c.d*bwKg**3 + c.e*bwKg**4 + c.f*bwKg**5;
  return d <= 0 ? null : totalKg * 500 / d;
}

function calcDOTS(totalKg, bwKg, gender) {
  if (!gender || !totalKg || !bwKg) return null;
  const c = DOTS[gender];
  const d = c.a + c.b*bwKg + c.c*bwKg**2 + c.d*bwKg**3 + c.e*bwKg**4;
  return d <= 0 ? null : totalKg * 500 / d;
}

function roundToPlate(weight, unit) {
  const increment = unit === 'kg' ? 2.5 : 5;
  return Math.round(weight / increment) * increment;
}

function calcPlatesPerSide(totalWeight, unit) {
  const barWeight = unit === 'kg' ? 20 : 45;
  if (totalWeight <= barWeight) return null;
  let remaining = (totalWeight - barWeight) / 2;
  const plates = unit === 'kg'
    ? [25, 20, 15, 10, 5, 2.5, 1.25]
    : [45, 35, 25, 10, 5, 2.5];
  const result = [];
  for (const plate of plates) {
    while (remaining >= plate - 0.01) {
      result.push(plate);
      remaining -= plate;
    }
  }
  return result;
}

function displayWeight(val, unit) {
  if (unit === 'kg') return Math.round(val / LBS_PER_KG * 10) / 10;
  return Math.round(val * 10) / 10;
}

// --- Test runner ---
let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function assertClose(actual, expected, tolerance, msg) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg} (got ${actual}, expected ${expected})`); }
}

function test(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// --- Tests ---
test('calcE1RM', () => {
  assert(calcE1RM(300, 1) === 300, '1 rep returns weight itself');
  assertClose(calcE1RM(225, 5), 225 * (1 + 5/30), 0.01, '225x5');
  assertClose(calcE1RM(315, 3), 315 * (1 + 3/30), 0.01, '315x3');
  assertClose(calcE1RM(135, 10), 135 * (1 + 10/30), 0.01, '135x10');
  assert(calcE1RM(0, 5) === 0, '0 weight returns 0');
});

test('lbsToKg', () => {
  assertClose(lbsToKg(225), 225 / 2.205, 0.01, '225 lbs to kg');
  assertClose(lbsToKg(0), 0, 0.01, '0 lbs to kg');
  assertClose(lbsToKg(1000), 1000 / 2.205, 0.01, '1000 lbs to kg');
});

test('calcWilks', () => {
  assert(calcWilks(null, 80, 'male') === null, 'null total returns null');
  assert(calcWilks(400, null, 'male') === null, 'null bw returns null');
  assert(calcWilks(400, 80, null) === null, 'null gender returns null');
  const w = calcWilks(400, 80, 'male');
  assert(w !== null && w > 0, 'valid male Wilks is positive');
  assertClose(w, 300, 80, 'male 400kg@80kg Wilks in reasonable range');
  const wf = calcWilks(300, 60, 'female');
  assert(wf !== null && wf > 0, 'valid female Wilks is positive');
});

test('calcDOTS', () => {
  assert(calcDOTS(null, 80, 'male') === null, 'null total returns null');
  const d = calcDOTS(400, 80, 'male');
  assert(d !== null && d > 0, 'valid male DOTS is positive');
  assertClose(d, 350, 100, 'male 400kg@80kg DOTS in reasonable range');
});

test('roundToPlate (lbs)', () => {
  assert(roundToPlate(227, 'lbs') === 225, '227 rounds to 225');
  assert(roundToPlate(228, 'lbs') === 230, '228 rounds to 230');
  assert(roundToPlate(135, 'lbs') === 135, '135 stays 135');
  assert(roundToPlate(0, 'lbs') === 0, '0 stays 0');
});

test('roundToPlate (kg)', () => {
  assert(roundToPlate(101, 'kg') === 100, '101 rounds to 100');
  assert(roundToPlate(102, 'kg') === 102.5, '102 rounds to 102.5');
});

test('calcPlatesPerSide (lbs)', () => {
  assert(calcPlatesPerSide(45, 'lbs') === null, 'bar only returns null');
  assert(calcPlatesPerSide(30, 'lbs') === null, 'less than bar returns null');
  const p135 = calcPlatesPerSide(135, 'lbs');
  assert(p135 && p135.length === 1 && p135[0] === 45, '135 = 1x45 per side');
  const p225 = calcPlatesPerSide(225, 'lbs');
  assert(p225 && p225.length === 2 && p225[0] === 45 && p225[1] === 45, '225 = 2x45 per side');
  const p315 = calcPlatesPerSide(315, 'lbs');
  assert(p315 && p315.length === 3 && p315.every(p => p === 45), '315 = 3x45 per side');
  const p185 = calcPlatesPerSide(185, 'lbs');
  assert(p185 && p185[0] === 45 && p185[1] === 25, '185 = 45 + 25 per side');
  const p145 = calcPlatesPerSide(145, 'lbs');
  assert(p145 && p145[0] === 45 && p145[1] === 5, '145 = 45 + 5 per side');
});

test('calcPlatesPerSide (kg)', () => {
  assert(calcPlatesPerSide(20, 'kg') === null, 'bar only returns null');
  const p60 = calcPlatesPerSide(60, 'kg');
  assert(p60 && p60.length === 1 && p60[0] === 20, '60kg = 1x20 per side');
  const p100 = calcPlatesPerSide(100, 'kg');
  assert(p100 && p100.length === 2 && p100[0] === 25 && p100[1] === 15, '100kg = 25 + 15 per side');
});

test('displayWeight', () => {
  assert(displayWeight(225, 'lbs') === 225, '225 lbs stays 225');
  assertClose(displayWeight(225, 'kg'), 102, 1, '225 lbs displayed in kg ~ 102');
  assert(displayWeight(0, 'lbs') === 0, '0 lbs stays 0');
});

// --- Results ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

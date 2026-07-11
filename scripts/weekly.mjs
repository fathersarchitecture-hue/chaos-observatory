// scripts/weekly.mjs
// CHAOS OBSERVATORY — 주간 성좌 생성 + 원장 기록
// L1·L2: 성좌 문법 (신호 × 위상다양성) / L3: 지움의 문법 (성격이 뚜렷한 것부터 지우고 남는 6개)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DRAWS_PATH  = "data/draws.json";
const LEDGER_PATH = "ledger.json";
const NUMS = Array.from({ length: 45 }, (_, i) => i + 1);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zscore(obj) {
  const vals = Object.values(obj);
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
  const out = {};
  for (const k in obj) out[k] = (obj[k] - m) / sd;
  return out;
}

function computeStates(draws) {
  const wm = draws.slice(-9);
  const wg = draws.slice(-27);
  const mom = {}, gap = {};
  for (const n of NUMS) {
    mom[n] = wm.reduce((a, d, i) => a + (d.includes(n) ? i + 1 : 0), 0);
    let last = -1;
    wg.forEach((d, i) => { if (d.includes(n)) last = i; });
    gap[n] = last >= 0 ? wg.length - last : wg.length + 1;
  }
  const zm = zscore(mom), zg = zscore(gap);
  const sig = {}, phase = {};
  for (const n of NUMS) { sig[n] = Math.max(zm[n], zg[n]); phase[n] = zm[n] - zg[n]; }
  return { sig, phase };
}

function filterFails(c) {
  let f = 0;
  const odd = c.filter(n => n % 2).length;
  if (odd < 2 || odd > 4) f++;
  const s = c.reduce((a, b) => a + b, 0);
  if (s < 100 || s > 175) f++;
  for (let i = 0; i < 5; i++) if (c[i+1] - c[i] === 1) { f++; break; }
  const dec = {}, end = {};
  c.forEach(n => {
    const d = Math.floor((n-1)/10); dec[d] = (dec[d]||0) + 1;
    end[n%10] = (end[n%10]||0) + 1;
  });
  if (Math.max(...Object.values(dec)) >= 3) f++;
  if (Math.max(...Object.values(end)) >= 3) f++;
  if (c.filter(n => n <= 22).length < 2 || c.filter(n => n <= 22).length > 4) f++;
  return f;
}

function isIconic(c) {
  let run = 1;
  for (let i = 0; i < 5; i++) { run = c[i+1]-c[i]===1 ? run+1 : 1; if (run>=3) return true; }
  for (const k of [3,5,7]) if (c.every(n => n%k===0)) return true;
  const diffs = new Set(); for (let i=0;i<5;i++) diffs.add(c[i+1]-c[i]);
  return diffs.size === 1;
}

function inNML(c) {
  return filterFails(c) >= 2 &&
    c.filter(n => n<=31).length <= 4 &&
    c.filter(n => n<=12).length <= 2 &&
    c.filter(n => n>=32).length <= 3 &&
    !isIconic(c);
}

function zonePenalty(c) {
  const bd = c.filter(n => n<=31).length;
  const sm = c.filter(n => n<=12).length;
  const hi = c.filter(n => n>=32).length;
  let p = Math.max(0,bd-4)*3 + Math.max(0,sm-2)*3 + Math.max(0,hi-3)*3;
  const f = filterFails(c);
  if (f===0) p+=4; else if (f===1) p+=1.5;
  if (isIconic(c)) p+=6;
  const s = c.reduce((a,b)=>a+b,0);
  p += Math.max(0,115-s)*0.05 + Math.max(0,s-185)*0.05;
  return p;
}

function softPick(cands, scores, T, rng) {
  const mx = Math.max(...scores);
  const w = scores.map(s => Math.exp((s-mx)/T));
  const tot = w.reduce((a,b)=>a+b,0);
  let r = rng()*tot;
  for (let i=0;i<cands.length;i++) { r-=w[i]; if (r<=0) return cands[i]; }
  return cands[cands.length-1];
}

// ── 성좌 문법: 신호 × 위상다양성 ──
function genLine(sig, phase, banned, penalty, rng, T=1.1) {
  const avail = NUMS.filter(n => !banned.has(n));
  const base = n => sig[n] - (penalty[n]||0);
  const sel = [softPick(avail, avail.map(base), T, rng)];
  while (sel.length < 6) {
    const cands = avail.filter(n => !sel.includes(n));
    const sc = cands.map(n =>
      sig[n] * sel.reduce((a,s) => a + Math.abs(phase[n]-phase[s]),0)/sel.length - (penalty[n]||0)
    );
    sel.push(softPick(cands, sc, T, rng));
  }
  return sel.sort((a,b)=>a-b);
}

// ── 지움의 문법: 성격(신호 극단성 + 최근 사용)이 큰 것부터 지우고 남는 6개 ──
function genErasure(sig, banned, penalty, rng, T=0.9) {
  let alive = NUMS.filter(n => !banned.has(n));
  while (alive.length > 6) {
    const sc = alive.map(n => sig[n] + (penalty[n]||0)); // 성격 클수록 먼저 지워짐
    const pick = softPick(alive, sc, T, rng);
    alive = alive.filter(n => n !== pick);
  }
  return alive.sort((a,b)=>a-b);
}

function generateWeekly(round, drawsNums, history) {
  const rng = mulberry32(round);
  const { sig, phase } = computeStates(drawsNums);
  const past = [...history].sort((a,b) => b.round - a.round);
  const banned = new Set(past[0] ? past[0].lines.flat() : []);
  const penalty = {};
  past.slice(1,3).forEach((h,i) => {
    const w = 4.0 * Math.pow(0.6, i);
    h.lines.flat().forEach(n => { penalty[n] = (penalty[n]||0) + w; });
  });

  const lines = [];

  // L1, L2 — 성좌 문법
  for (let li = 0; li < 2; li++) {
    const pen = { ...penalty };
    lines.flat().forEach(n => { pen[n] = (pen[n]||0) + 2.5; });
    let pool = [];
    for (let i=0;i<250;i++) pool.push(genLine(sig, phase, banned, pen, rng));
    let ok = pool.filter(c => inNML(c) && lines.every(p => c.filter(n=>p.includes(n)).length<=1));
    if (!ok.length) ok = pool.filter(c => inNML(c) && lines.every(p => c.filter(n=>p.includes(n)).length<=2));
    if (!ok.length) ok = pool.filter(c => inNML(c));
    if (!ok.length) ok = pool;
    ok.sort((a,b) => zonePenalty(a)-zonePenalty(b));
    lines.push(ok[0]);
  }

  // L3 — 지움의 문법 (뭇별에서 남는 것)
  {
    const pen = { ...penalty };
    lines.flat().forEach(n => { pen[n] = (pen[n]||0) + 2.5; }); // L1·L2 소속은 성격 가산 → 먼저 지워짐
    let pool = [];
    for (let i=0;i<150;i++) pool.push(genErasure(sig, banned, pen, rng));
    let ok = pool.filter(c => inNML(c) && lines.every(p => c.filter(n=>p.includes(n)).length<=1));
    if (!ok.length) ok = pool.filter(c => inNML(c));
    if (!ok.length) ok = pool;
    // 가장 무성격한(신호 합이 낮은) 생존 조합 선택
    ok.sort((a,b) =>
      a.reduce((s,n)=>s+sig[n],0) - b.reduce((s,n)=>s+sig[n],0)
    );
    lines.push(ok[0]);
  }

  return {
    round,
    lines,
    grammars: ["constellation","constellation","erasure"],
    kpis: lines.map(c => ({
      sum: c.reduce((a,b)=>a+b,0),
      odd: c.filter(n=>n%2).length,
      filterFails: filterFails(c),
      nml: inNML(c),
    }))
  };
}

function main() {
  const db = JSON.parse(readFileSync(DRAWS_PATH, "utf8"));
  const ledger = existsSync(LEDGER_PATH)
    ? JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
    : { entries: [] };

  const targetRound = db.latest + 1;

  if (ledger.entries.some(e => e.round === targetRound)) {
    console.log(`round ${targetRound} already in ledger — unchanged`);
    return;
  }

  const entry = generateWeekly(targetRound, db.draws.map(d => d.numbers), ledger.entries);
  entry.generatedAt = new Date().toISOString();
  entry.engineVersion = "v8-erasure";

  ledger.entries.push(entry);
  ledger.entries = ledger.entries.slice(-8);
  ledger.updatedAt = new Date().toISOString();

  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`round ${targetRound} → ledger`);
  entry.lines.forEach((l,i) =>
    console.log(`  L${i+1}(${entry.grammars[i]}): [${l}]  sum=${entry.kpis[i].sum} nml=${entry.kpis[i].nml}`)
  );
}

main();

// scripts/fetch-draws.mjs
// CHAOS OBSERVATORY — data pipeline
// 동행복권 공식 API에서 신규 회차를 증분 수집해 data/draws.json에 적재한다.
// - 최초 실행(bootstrap): 1회부터 최신까지 전체 수집 (~4분)
// - 이후 실행: 마지막 회차 다음부터만 수집, 신규 없으면 무변경 종료
// - Node 20+ (내장 fetch 사용, 의존성 없음)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const API = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";
const PATH = "data/draws.json";
const DELAY_MS = 150; // polite rate limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRound(no) {
  const res = await fetch(API + no, {
    headers: { "User-Agent": "chaos-observatory/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ round ${no}`);
  const j = await res.json();
  if (j.returnValue !== "success") return null; // 미추첨 회차 → 수집 종료 신호
  return {
    round: j.drwNo,
    date: j.drwNoDate,
    numbers: [j.drwtNo1, j.drwtNo2, j.drwtNo3, j.drwtNo4, j.drwtNo5, j.drwtNo6].sort(
      (a, b) => a - b
    ),
    bonus: j.bnusNo,
    firstWinners: j.firstPrzwnerCo,
    firstPrizeEach: j.firstWinamnt,
    totalSales: j.totSellamnt,
  };
}

function validate(draws) {
  for (const d of draws) {
    const u = new Set(d.numbers);
    if (u.size !== 6 || d.numbers.some((n) => n < 1 || n > 45))
      throw new Error(`corrupt numbers @ round ${d.round}`);
    if (d.bonus < 1 || d.bonus > 45 || u.has(d.bonus))
      throw new Error(`corrupt bonus @ round ${d.round}`);
  }
  for (let i = 1; i < draws.length; i++)
    if (draws[i].round !== draws[i - 1].round + 1)
      throw new Error(`round gap at ${draws[i].round}`);
}

async function main() {
  let db = { updated: null, latest: 0, draws: [] };
  if (existsSync(PATH)) db = JSON.parse(readFileSync(PATH, "utf8"));

  let no = db.latest + 1;
  let added = 0;
  for (;;) {
    const row = await fetchRound(no);
    if (!row) break;
    db.draws.push(row);
    db.latest = row.round;
    added++;
    if (added % 100 === 0) console.log(`  ...round ${row.round}`);
    no++;
    await sleep(DELAY_MS);
  }

  if (added === 0) {
    console.log("no new draws — ledger unchanged");
    return;
  }

  db.draws.sort((a, b) => a.round - b.round);
  validate(db.draws);
  db.updated = new Date().toISOString();

  mkdirSync("data", { recursive: true });
  writeFileSync(PATH, JSON.stringify(db) + "\n");
  console.log(`+${added} draws → latest round ${db.latest}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

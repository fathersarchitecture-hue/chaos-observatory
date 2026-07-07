// scripts/fetch-draws.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const BASE_URL = "https://www.dhlottery.co.kr/lt645/result";
const PATH = "data/draws.json";

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

async function fetchRound(page, no) {
  // URL에 drwNo 쿼리 파라미터로 회차 지정 시도
  await page.goto(`${BASE_URL}?drwNo=${no}`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // 당첨번호 6개: div.result-ball.num-1n ~ num-6n
  const numbers = [];
  for (let i = 1; i <= 6; i++) {
    const n = await page.$eval(
      `div.result-ball.num-${i}n`,
      (el) => parseInt(el.textContent.trim(), 10)
    ).catch(() => null);
    if (n === null) return null;
    numbers.push(n);
  }

  // 보너스번호: div.result-ball.num-bn
  const bonus = await page.$eval(
    "div.result-ball.num-bn",
    (el) => parseInt(el.textContent.trim(), 10)
  ).catch(() => null);
  if (bonus === null) return null;

  // 추첨일
  const dateText = await page.$eval(
    "div.inner-tit",
    (el) => el.textContent.trim()
  ).catch(() => "");
  const dateMatch = dateText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : null;

  // 1등 당첨자 수 / 1인당 당첨금
  let firstWinners = null, firstPrizeEach = null;
  try {
    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs.map((tr) => tr.textContent.replace(/\s+/g, " ").trim())
    );
    const first = rows.find((r) => r.includes("1등"));
    if (first) {
      const nums = first.match(/[\d,]+/g) || [];
      if (nums.length >= 2) {
        firstWinners = parseInt(nums[nums.length - 2].replace(/,/g, ""), 10);
        firstPrizeEach = parseInt(nums[nums.length - 1].replace(/,/g, ""), 10);
      }
    }
  } catch (e) { /* ignore */ }

  return { round: no, date, numbers: numbers.sort((a, b) => a - b),
    bonus, firstWinners, firstPrizeEach, totalSales: null };
}

async function main() {
  let db = { updated: null, latest: 0, draws: [] };
  if (existsSync(PATH)) db = JSON.parse(readFileSync(PATH, "utf8"));

  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  let added = 0;
  let no = db.latest + 1;
  let misses = 0;

  while (misses < 2) {
    const row = await fetchRound(page, no).catch(() => null);
    if (!row) { misses++; no++; continue; }
    misses = 0;
    db.draws.push(row);
    db.latest = no;
    added++;
    if (added % 50 === 0) console.log(`  ...round ${no}`);
    no++;
    await page.waitForTimeout(300);
  }

  await browser.close();

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

main().catch((e) => { console.error(e.message); process.exit(1); });

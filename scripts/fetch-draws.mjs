// scripts/fetch-draws.mjs
// CHAOS OBSERVATORY — data pipeline (Playwright 버전)
// 동행복권 JSON API는 WAF(JS 챌린지)에 막혀 순수 fetch로는 접근 불가하므로
// headless 브라우저로 실제 결과 페이지(gameResult.do)를 읽어 파싱한다.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const MAIN_URL = "https://www.dhlottery.co.kr/common.do?method=main";
const RESULT_URL = (no) =>
  `https://www.dhlottery.co.kr/gameResult.do?method=byWin&drwNo=${no}`;
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

async function main() {
  let db = { updated: null, latest: 0, draws: [] };
  if (existsSync(PATH)) db = JSON.parse(readFileSync(PATH, "utf8"));

  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(MAIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  const latestAvailable = await page.$eval("#lottoDrwNo", (el) =>
    parseInt(el.textContent.trim(), 10)
  );
  console.log(`latest available round on site: ${latestAvailable}`);

  let added = 0;
  for (let no = db.latest + 1; no <= latestAvailable; no++) {
    await page.goto(RESULT_URL(no), { waitUntil: "domcontentloaded", timeout: 30000 });

    const numbers = await page.$$eval(
      "div.num.win span",
      (els) => els.map((el) => parseInt(el.textContent.trim(), 10))
    );
    const bonus = await page.$eval("div.num.bonus span", (el) =>
      parseInt(el.textContent.trim(), 10)
    );
    const dateText = await page.$eval("p.desc", (el) => el.textContent.trim());
    const dateMatch = dateText.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
      : null;

    let firstWinners = null;
    let firstPrizeEach = null;
    try {
      const rowText = await page.$eval("table.tbl_data tbody tr", (tr) =>
        tr.textContent.replace(/\s+/g, " ").trim()
      );
      const nums = rowText.match(/[\d,]+/g) || [];
      if (nums.length >= 2) {
        firstPrizeEach = parseInt(nums[nums.length - 1].replace(/,/g, ""), 10);
        firstWinners = parseInt(nums[nums.length - 2].replace(/,/g, ""), 10);
      }
    } catch (e) {
      /* 통계 파싱 실패는 무시 */
    }

    if (!numbers || numbers.length !== 6 || !Number.isFinite(bonus)) {
      console.log(`  round ${no}: parse failed, stopping`);
      break;
    }

    db.draws.push({
      round: no,
      date,
      numbers: numbers.sort((a, b) => a - b),
      bonus,
      firstWinners,
      firstPrizeEach,
      totalSales: null,
    });
    db.latest = no;
    added++;
    if (added % 50 === 0) console.log(`  ...round ${no}`);
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

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

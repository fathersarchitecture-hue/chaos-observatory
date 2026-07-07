// scripts/fetch-draws.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

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

  let added = 0;
  let no = db.latest + 1;
  let consecutiveMisses = 0;

  while (consecutiveMisses < 2) {
    let numbers, bonus, dateText;
    try {
      await page.goto(RESULT_URL(no), { waitUntil: "networkidle", timeout: 30000 });
      numbers = await page.$$eval("div.num.win span", (els) =>
        els.map((el) => parseInt(el.textContent.trim(), 10))
      );
      bonus = await page.$eval("div.num.bonus span", (el) =>
        parseInt(el.textContent.trim(), 10)
      );
      dateText = await page.$eval("p.desc", (el) => el.textContent.trim()).catch(() => "");
    } catch (e) {
      console.log(`  round ${no}: ${e.message.split("\n")[0]}`);
      numbers = [];
    }

    if (!numbers || numbers.length !== 6 || !Number.isFinite(bonus)) {
      consecutiveMisses++;
      no++;
      continue;
    }
    consecutiveMisses = 0;

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
      /* ignore */
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
    no++;
    await page.waitForTimeout(250);
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

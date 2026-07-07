// scripts/fetch-draws.mjs
// CHAOS OBSERVATORY — 주간 증분 수집 (Playwright, 드롭다운 조작)
// data/draws.json 의 latest 다음 회차부터 최신까지만 수집한다.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const PATH = "data/draws.json";

async function main() {
  const db = JSON.parse(readFileSync(PATH, "utf8"));
  const startRound = db.latest + 1;
  console.log(`current latest: ${db.latest} — fetching from ${startRound}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto("https://www.dhlottery.co.kr/lt645/result", {
    waitUntil: "networkidle", timeout: 30000,
  });

  // 최신 회차 확인 (드롭다운 첫 번째 옵션)
  const latestOnSite = await page.$eval(
    "select option:first-child, .round-select option:first-child",
    el => parseInt(el.textContent.replace(/[^0-9]/g, ""), 10)
  ).catch(async () => {
    // fallback: 페이지 타이틀에서 회차 추출
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/제\s*(\d+)\s*회/);
    return m ? parseInt(m[1], 10) : db.latest;
  });

  console.log(`latest on site: ${latestOnSite}`);
  if (latestOnSite <= db.latest) {
    console.log("no new draws — ledger unchanged");
    await browser.close(); return;
  }

  let added = 0;
  for (let no = startRound; no <= latestOnSite; no++) {
    // 드롭다운에서 회차 선택
    await page.goto("https://www.dhlottery.co.kr/lt645/result", {
      waitUntil: "networkidle", timeout: 30000,
    });

    // 현재 페이지에 표시된 회차 확인
    const currentRound = await page.evaluate(() => {
      const t = document.body.innerText;
      const m = t.match(/제\s*(\d+)\s*회\s*추첨\s*결과/);
      return m ? parseInt(m[1], 10) : null;
    });

    // 원하는 회차가 아니면 드롭다운으로 선택
    if (currentRound !== no) {
      const selected = await page.evaluate((targetRound) => {
        const selects = document.querySelectorAll("select");
        for (const sel of selects) {
          for (const opt of sel.options) {
            if (opt.textContent.includes(String(targetRound))) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }, no);

      if (!selected) { console.log(`round ${no}: not in dropdown`); break; }
      await page.waitForTimeout(1500);
    }

    // 번호 파싱
    const numbers = [];
    for (let i = 1; i <= 6; i++) {
      const n = await page.$eval(`div.result-ball.num-${i}n`,
        el => parseInt(el.textContent.trim(), 10)).catch(() => null);
      if (!n) break;
      numbers.push(n);
    }
    const bonus = await page.$eval("div.result-ball.num-bn",
      el => parseInt(el.textContent.trim(), 10)).catch(() => null);

    if (numbers.length !== 6 || !bonus) {
      console.log(`round ${no}: parse failed`); break;
    }

    let firstWinners = null, firstPrizeEach = null;
    try {
      const rows = await page.$$eval("table tbody tr", trs =>
        trs.map(tr => tr.textContent.replace(/\s+/g, " ").trim()));
      const first = rows.find(r => r.includes("1등"));
      if (first) {
        const nums = first.match(/[\d,]+/g) || [];
        if (nums.length >= 2) {
          firstWinners = parseInt(nums[nums.length-2].replace(/,/g,""),10);
          firstPrizeEach = parseInt(nums[nums.length-1].replace(/,/g,""),10);
        }
      }
    } catch(e) {}

    db.draws.push({ round: no, date: null,
      numbers: numbers.sort((a,b)=>a-b), bonus,
      firstWinners, firstPrizeEach, totalSales: null });
    db.latest = no;
    added++;
    console.log(`+round ${no}: ${numbers.join(",")} +${bonus}`);
  }

  await browser.close();

  if (added === 0) { console.log("no new draws"); return; }

  db.draws.sort((a,b) => a.round - b.round);
  db.updated = new Date().toISOString();
  writeFileSync(PATH, JSON.stringify(db) + "\n");
  console.log(`+${added} draws → latest ${db.latest}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

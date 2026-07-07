// scripts/fetch-draws.mjs — DIAGNOSTIC MODE
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const RESULT_URL = (no) =>
  `https://www.dhlottery.co.kr/gameResult.do?method=byWin&drwNo=${no}`;
const PATH = "data/draws.json";

async function main() {
  let db = { updated: null, latest: 0, draws: [] };
  if (existsSync(PATH)) db = JSON.parse(readFileSync(PATH, "utf8"));

  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const probeRound = db.latest + 1;
  console.log(`=== PROBE: round ${probeRound} ===`);
  await page.goto(RESULT_URL(probeRound), { waitUntil: "networkidle", timeout: 30000 });

  const title = await page.title();
  console.log(`PAGE TITLE: ${title}`);

  const bodyText = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " ").trim()
  );
  console.log(`BODY TEXT (first 500 chars): ${bodyText.slice(0, 500)}`);

  const allClasses = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[class]"))
      .map((el) => el.className)
      .filter((c) => /num|win|bonus|ball/i.test(c))
      .slice(0, 30)
  );
  console.log(`RELEVANT CLASSES FOUND: ${JSON.stringify(allClasses)}`);

  await browser.close();
  console.log("=== PROBE COMPLETE — no data written ===");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

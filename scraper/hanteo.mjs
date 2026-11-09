// 한터차트 공개 페이지에서 판매량을 읽는 공통 함수 모음 (scrape.mjs, watch.mjs가 같이 쓴다)
// - 실시간 음반차트(/album/real): 오늘 0시부터 지금까지 판매량. 버전별 행으로 나뉘어 있어 합산한다.
// - 일간 음반차트(/album/daily): 어제 확정 판매량(버전 합산된 앨범 단위 1행).
//   날짜를 지정한 과거 페이지(/daily/YYYY-MM-DD)는 순위만 보이고 판매량이 없다.
// robots.txt: 일반 페이지는 허용, /api/ 는 금지 → 렌더된 페이지만 읽고 /api/ 를 직접 호출하지 않는다.

import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const TARGET = { artist: "리센느", album: "PULSE", release: "2026-11-03" };
export const BASE = "https://www.hanteochart.com/ko/charts/album";
export const OUT = path.resolve("data/sales.json");
const MAX_MORE = 4; // "더보기" 최대 클릭 수 (20행씩, 최대 100위)

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

export const toNum = s => Number(String(s).replace(/[^\d.]/g, "")) || 0;
// "집계 기준 (KST) : 2026.11.06 15:35" → { date: "2026-11-06", time: "15:35" }
export const parseStamp = s => {
  const m = s?.match(/(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}:\d{2}))?/);
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] || null } : null;
};
export const isTarget = r =>
  r.artist === TARGET.artist &&
  (r.title === TARGET.album || r.title.startsWith(TARGET.album + ":") || r.title.startsWith(TARGET.album + ","));

export async function launch() {
  const exe = BROWSERS.find(p => existsSync(p));
  if (!exe) throw new Error("Chrome/Edge를 찾지 못했습니다. CHROME_PATH 환경변수로 경로를 지정하세요.");
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ locale: "ko-KR" });
  return { browser, page };
}

export async function readChart(page, url) {
  // ?_= 를 붙여 중간 캐시(CDN)에 남은 옛 페이지 대신 최신 페이지를 받는다 (해외 서버에서 2~3분 늦은 페이지가 오는 문제)
  await page.goto(`${url}?_=${Date.now()}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".chart-item.rank-data", { timeout: 20000 });
  for (let i = 0; i < MAX_MORE; i++) {
    const before = await page.locator(".chart-item.rank-data").count();
    const btn = page.locator(".see-more-btn").first();
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click();
    await page.waitForFunction(n => document.querySelectorAll(".chart-item.rank-data").length > n, before, { timeout: 8000 }).catch(() => {});
    if ((await page.locator(".chart-item.rank-data").count()) === before) break;
  }
  return page.evaluate(() => {
    const stamp = [...document.querySelectorAll("*")]
      .find(e => e.children.length === 0 && /집계 기준/.test(e.textContent))?.textContent || "";
    const rows = [...document.querySelectorAll(".chart-item.rank-data")].map(it => ({
      title: it.querySelector(".center .top")?.textContent.trim() || "",
      artist: it.querySelector(".center pre")?.textContent.trim() || "",
      sales: it.querySelector(".stat-container .left")?.textContent.trim() || "0",
    }));
    return { stamp, rows };
  });
}

export async function loadData() {
  return existsSync(OUT)
    ? JSON.parse(await readFile(OUT, "utf8"))
    : { artist: TARGET.artist, album: TARGET.album, release: TARGET.release, days: {} };
}

// 임시 파일에 쓴 뒤 바꿔치기 → 페이지가 반쯤 쓰인 파일을 읽는 일이 없게
export async function saveData(data) {
  data.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, OUT);
}

// 일간 차트 → 어제 확정치. 그날 실시간 스냅샷의 버전별 기록은 남긴다.
export async function updateDaily(page, data) {
  const daily = await readChart(page, `${BASE}/daily`);
  const st = parseStamp(daily.stamp);
  const rows = daily.rows.filter(isTarget);
  if (!st || st.date < TARGET.release || !rows.length) return { date: st?.date, sales: null };
  const sales = rows.reduce((s, r) => s + toNum(r.sales), 0);
  // 이미 확정된 날을 다른 숫자로 덮어쓰지 않는다.
  // (한터 일간 차트는 숫자가 먼저 다음 날 것으로 바뀌고 날짜 표시는 늦게 바뀌는 순간이 있다)
  const cur = data.days[st.date];
  // 날짜 표시만 먼저 바뀌고 숫자는 전날 확정치 그대로인 순간이 있다(11/9 오전: Day6에 Day5 숫자 47,482가 들어감).
  // 전날 확정치와 똑같은 숫자는 아직 갱신 전으로 보고 무시한다.
  const prevDate = Object.keys(data.days).filter(d => d < st.date).sort().at(-1);
  const prev = prevDate && data.days[prevDate];
  if (prev?.final && prev.sales === sales) return { date: st.date, sales: null, skipped: `전날 확정치(${sales})와 같음 → 일간 차트 갱신 전, 무시` };
  // 예전에 그 오류로 잘못 확정된 날(전날과 같은 숫자)은 새 숫자로 바로잡는다
  const wrongFinal = cur?.final && prev?.final && cur.sales === prev.sales;
  if (cur?.final && cur.sales !== sales && !wrongFinal) return { date: st.date, sales: null, skipped: `확정치 ${cur.sales}와 다름(${sales}) → 무시` };
  data.days[st.date] = { ...(cur || {}), sales, final: true, source: "hanteo-daily", rows: rows.length };
  return { date: st.date, sales };
}

// 실시간 차트 → 오늘 진행 중인 판매량(버전별 포함). 이미 확정된 날은 건드리지 않는다.
export async function updateReal(page, data) {
  const real = await readChart(page, `${BASE}/real`);
  const st = parseStamp(real.stamp);
  const rows = real.rows.filter(isTarget);
  if (!st || st.date < TARGET.release) return { date: st?.date, sales: null, rows: 0 };
  if (data.days[st.date]?.final) return { date: st.date, sales: data.days[st.date].sales, rows: rows.length, skipped: true };
  // 이미 저장된 시각보다 이른 페이지(캐시된 옛 페이지)면 무시한다 — 숫자가 거꾸로 가는 것 방지
  const prevAsOf = data.days[st.date]?.asOf;
  if (prevAsOf && st.time && `${st.date} ${st.time}` < prevAsOf) {
    return { date: st.date, time: st.time, sales: null, rows: rows.length, skipped: `옛 페이지(${st.time} < ${prevAsOf.slice(11)}) → 무시` };
  }
  const sales = rows.reduce((s, r) => s + toNum(r.sales), 0);
  // 자정 직후 한터 실시간 차트는 날짜만 먼저 바뀌고 숫자는 전날 것이 잠깐 남아 있다.
  // 새 날짜인데 판매량이 전날 마지막 기록과 똑같으면 아직 초기화 전이다.
  // 이때는 전날 숫자를 오늘 것으로 옮기지 않고, 오늘 칸만 0장(placeholder)으로 만들어 화면이 새 Day로 넘어가게 한다.
  if (!data.days[st.date] || data.days[st.date].placeholder) {
    const prevDate = Object.keys(data.days).filter(d => d < st.date).sort().at(-1);
    const prev = prevDate && data.days[prevDate];
    if (prev && !prev.final && prev.sales === sales) {
      data.days[st.date] = { sales: 0, final: false, placeholder: true, source: "hanteo-real", asOf: `${st.date} ${st.time}`, versions: [] };
      return { date: st.date, time: st.time, sales: 0, rows: rows.length, skipped: "전날 숫자 그대로(초기화 대기) → 오늘 0장으로 표시" };
    }
  }
  data.days[st.date] = {
    sales, final: false, source: "hanteo-real", asOf: `${st.date} ${st.time}`,
    versions: rows.map(r => ({ title: r.title, sales: toNum(r.sales) })),
  };
  return { date: st.date, time: st.time, sales, rows: rows.length };
}

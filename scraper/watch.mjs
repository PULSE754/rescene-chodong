// 계속 켜 두는 감시 모드: 1분마다 한터 실시간 차트를 읽어 data/sales.json을 갱신한다.
// - 브라우저는 한 번만 띄우고 페이지만 다시 읽는다 (가볍게)
// - 일간 확정치는 시작할 때 + 날짜가 바뀐 뒤 한 번씩만 읽는다
// - 실패하면 간격을 2배씩 늘려(최대 10분) 한터에 부담을 주지 않고, 성공하면 1분으로 돌아온다
// - 초동 기간(발매일부터 7일)이 끝나고 마지막 날 확정치까지 받으면 스스로 종료한다
// 사용: node scraper/watch.mjs        (중지: Ctrl+C)
//       INTERVAL_SEC=60 으로 간격 조정 가능
import { TARGET, launch, loadData, saveData, updateDaily, updateReal } from "./hanteo.mjs";
import { loadPublishConfig, putFile } from "./publish.mjs";

// GitHub Pages 올리기: 설정(publish.config.json + 토큰)이 있을 때만, PUBLISH_MIN분(기본 10분)마다 데이터 파일만 올린다
// (GitHub Pages는 사이트 재빌드를 한 시간에 10번 정도로 제한하므로 10분 간격)
const PUBLISH_MS = (Number(process.env.PUBLISH_MIN) || 10) * 60 * 1000;
let lastPublish = 0;
async function maybePublish(force = false) {
  if (!force && Date.now() - lastPublish < PUBLISH_MS) return;
  const cfg = await loadPublishConfig();
  if (!cfg) return;
  try {
    const s = await putFile(cfg, "data/sales.json", "data: 판매량 갱신");
    lastPublish = Date.now();
    console.log(`[${now()}] GitHub 업로드: ${s === "same" ? "변경 없음" : "완료"}`);
  } catch (e) {
    console.error(`[${now()}] GitHub 업로드 실패: ${e.message.split("\n")[0]}`);
  }
}

const BASE_MS = (Number(process.env.INTERVAL_SEC) || 60) * 1000;
const MAX_MS = 10 * 60 * 1000;
// 날짜 계산은 시간대 영향을 받지 않게 UTC 자정 기준으로만 한다 (발매일 + 6일 = 초동 마지막 날)
const lastDay = new Date(Date.parse(TARGET.release) + 6 * 864e5).toISOString().slice(0, 10);
const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const now = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\n중지 요청 받음 — 이번 회차가 끝나면 종료합니다."); });

let { browser, page } = await launch();
let wait = BASE_MS, dailyCheckedFor = null;
console.log(`[${now()}] 감시 시작: ${TARGET.artist} ${TARGET.album} · ${BASE_MS / 1000}초 간격 · 초동 마지막 날 ${lastDay}`);

while (!stop) {
  try {
    const data = await loadData();
    const today = kstDate();

    // 일간 확정치: 날짜가 바뀌었으면 (어제 확정치가 올라왔을 수 있으니) 다시 확인
    if (dailyCheckedFor !== today) {
      const d = await updateDaily(page, data);
      // 일간 차트에 '어제' 날짜가 올라온 뒤에만 이 날짜는 확인 끝으로 표시
      const y = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
      if (d.date === y) dailyCheckedFor = today;
      console.log(`[${now()}] 일간 ${d.date}: ${d.sales ?? "-"}${d.date === y ? "" : " (어제 확정치 대기 중)"}`);
    }

    const r = await updateReal(page, data);
    await saveData(data);
    const total = Object.values(data.days).reduce((s, v) => s + v.sales, 0);
    console.log(`[${now()}] 실시간 ${r.date} ${r.time ?? ""} · 오늘 ${r.sales?.toLocaleString() ?? "-"} · 누적 ${total.toLocaleString()}${r.rows ? "" : " · 경고: 대상 앨범 없음"}`);

    // 초동 끝: 마지막 날 확정치까지 저장됐으면 마지막으로 한 번 올리고 종료
    if (data.days[lastDay]?.final) {
      await maybePublish(true);
      console.log(`[${now()}] 초동 기간 집계 완료 — 감시를 종료합니다.`);
      break;
    }
    await maybePublish();
    wait = BASE_MS;
  } catch (e) {
    wait = Math.min(wait * 2, MAX_MS);
    console.error(`[${now()}] 실패: ${e.message.split("\n")[0]} → ${Math.round(wait / 1000)}초 뒤 재시도`);
    // 브라우저가 죽었을 수 있으니 새로 띄운다
    try { await browser.close(); } catch {}
    try { ({ browser, page } = await launch()); } catch {}
  }
  for (let t = 0; t < wait && !stop; t += 1000) await sleep(1000);
}

await browser.close().catch(() => {});

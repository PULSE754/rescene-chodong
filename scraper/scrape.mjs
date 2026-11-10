// 한 번만 실행: 일간(어제 확정치) + 실시간(오늘) 판매량을 읽어 data/sales.json 갱신
// 사용: node scraper/scrape.mjs
import { launch, loadData, saveData, updateDaily, updateReal } from "./hanteo.mjs";

const { browser, page } = await launch();
try {
  const data = await loadData();
  const d = await updateDaily(page, data);
  const r = await updateReal(page, data);
  await saveData(data);
  console.log(`일간 ${d.date}: ${d.sales ?? "-"}`);
  console.log(`실시간 ${r.date} ${r.time ?? ""}: ${r.rows}행 → ${r.sales ?? "-"}`);
  if (!r.rows) console.warn("경고: 실시간 차트 100위 안에서 대상 앨범을 찾지 못했습니다.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// GitHub Actions에서 돌리는 감시 모드 (PC를 켜 둘 필요 없음)
// - 1분마다 한터를 읽어 data/sales.json을 'data' 브랜치에 저장하고, 바뀌었으면 사이트 배포(deploy 워크플로)를 호출한다
//   → deploy가 data 브랜치 파일을 끼워 넣어 배포하므로 사이트에 1~2분 안에 반영된다 (Actions 배포라 시간당 10회 제한 없음)
// - 'main' 브랜치의 data/sales.json도 15분마다 같이 갱신한다 (API를 못 쓸 때 사이트가 읽는 예비 파일)
// - 한 번 실행에 최대 RUN_MINUTES분 동안 돈다. 워크플로가 30분마다 다음 실행을 예약해 두므로 끊기지 않고 이어진다
// - 초동 마지막 날 확정치를 받으면 종료한다
// 필요한 환경변수: GITHUB_TOKEN, GITHUB_REPOSITORY(owner/repo) — Actions가 자동으로 넣어 준다
import { TARGET, launch, loadData, saveData, updateDaily, updateReal } from "./hanteo.mjs";

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || "").split("/");
const TOKEN = process.env.GITHUB_TOKEN;
if (!OWNER || !REPO || !TOKEN) { console.error("GITHUB_TOKEN / GITHUB_REPOSITORY 가 없습니다."); process.exit(1); }

const DATA_BRANCH = "data";
const FILE = "data/sales.json";
const BASE_MS = (Number(process.env.INTERVAL_SEC) || 60) * 1000;
const MAX_MS = 10 * 60 * 1000;
const RUN_MS = (Number(process.env.RUN_MINUTES) || 330) * 60 * 1000;
const MAIN_EVERY_MS = (Number(process.env.MAIN_EVERY_MIN) || 15) * 60 * 1000;
const started = Date.now();

const lastDay = new Date(Date.parse(TARGET.release) + 6 * 864e5).toISOString().slice(0, 10);
const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19) + " KST";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── GitHub API ─────────────────────────────────────────────
async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rescene-chodong-tracker",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 150)}`);
  return res.json();
}
const contentsPath = (branch) => `/contents/${FILE}?ref=${branch}`;

async function ensureDataBranch() {
  if (await gh("GET", `/branches/${DATA_BRANCH}`)) return;
  const main = await gh("GET", "/git/ref/heads/main");
  await gh("POST", "/git/refs", { ref: `refs/heads/${DATA_BRANCH}`, sha: main.object.sha });
  console.log(`[${now()}] '${DATA_BRANCH}' 브랜치를 만들었습니다.`);
}

// 브랜치의 sales.json을 읽어 { data, sha } 반환
async function readRemote(branch) {
  const f = await gh("GET", contentsPath(branch));
  if (!f) return { data: null, sha: null };
  return { data: JSON.parse(Buffer.from(f.content, "base64").toString("utf8")), sha: f.sha };
}

const shas = {};
async function writeRemote(branch, data, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
  for (let attempt = 0; attempt < 2; attempt++) {
    if (shas[branch] === undefined) shas[branch] = (await gh("GET", contentsPath(branch)))?.sha ?? null;
    try {
      const r = await gh("PUT", `/contents/${FILE}`, { message, content, branch, ...(shas[branch] ? { sha: shas[branch] } : {}) });
      shas[branch] = r.content.sha;
      return;
    } catch (e) {
      // 다른 곳(예: PC 감시)이 먼저 고쳐서 sha가 달라졌으면 새 sha로 한 번 더
      if (/→ (409|422)/.test(e.message) && attempt === 0) { shas[branch] = undefined; continue; }
      throw e;
    }
  }
}

// 사이트 배포 호출. deploy 워크플로가 아직 없거나 권한(actions: write)이 없으면 경고만 남기고 넘어간다
let dispatchWarned = false;
async function dispatchDeploy() {
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/deploy.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rescene-chodong-tracker",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!res.ok && !dispatchWarned) { dispatchWarned = true; console.error(`[${now()}] 배포 호출 실패 ${res.status} (deploy 워크플로/권한 확인)`); }
  } catch (e) {
    if (!dispatchWarned) { dispatchWarned = true; console.error(`[${now()}] 배포 호출 실패: ${e.message}`); }
  }
}

// ── 메인 루프 ─────────────────────────────────────────────
await ensureDataBranch();
// 시작할 때 data 브랜치(없으면 main)의 최신 기록을 받아 로컬 파일로 저장 → hanteo.mjs 함수들이 그대로 이어서 쓴다
{
  const fromData = await readRemote(DATA_BRANCH);
  const start = fromData.data || (await readRemote("main")).data;
  if (start) await saveData(start);
}

let { browser, page } = await launch();
let wait = BASE_MS, dailyCheckedFor = null, lastSig = null, lastMain = 0;
const sig = d => JSON.stringify({ ...d, updatedAt: undefined });
console.log(`[${now()}] 클라우드 감시 시작: ${TARGET.artist} ${TARGET.album} · ${BASE_MS / 1000}초 간격 · 초동 마지막 날 ${lastDay}`);

while (Date.now() - started < RUN_MS) {
  try {
    const data = await loadData();
    if (data.days[lastDay]?.final) { console.log(`[${now()}] 초동 집계가 이미 끝났습니다 — 종료.`); break; }
    const today = kstDate();

    if (dailyCheckedFor !== today) {
      const d = await updateDaily(page, data);
      const y = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
      if (d.date === y) dailyCheckedFor = today;
      console.log(`[${now()}] 일간 ${d.date}: ${d.sales ?? "-"}${d.skipped ? " · " + d.skipped : ""}${d.date === y ? "" : " (어제 확정치 대기 중)"}`);
    }

    const r = await updateReal(page, data);
    await saveData(data);
    const total = Object.values(data.days).reduce((s, v) => s + v.sales, 0);
    console.log(`[${now()}] 실시간 ${r.date} ${r.time ?? ""} · 오늘 ${r.sales?.toLocaleString() ?? "-"} · 누적 ${total.toLocaleString()}${r.rows ? "" : " · 경고: 대상 앨범 없음"}`);

    // 바뀐 게 있을 때만 data 브랜치에 저장하고, 사이트 배포(deploy 워크플로)를 호출해 1~2분 안에 반영
    const s = sig(data);
    if (s !== lastSig) {
      await writeRemote(DATA_BRANCH, data, `data: ${r.date} ${r.time ?? ""}`.trim());
      lastSig = s;
      await dispatchDeploy();
    }
    // main 예비 파일은 15분마다 (Pages 재빌드 제한 때문에 자주 올리지 않는다)
    const done = !!data.days[lastDay]?.final;
    if (done || Date.now() - lastMain >= MAIN_EVERY_MS) {
      await writeRemote("main", data, "data: 판매량 갱신");
      lastMain = Date.now();
      console.log(`[${now()}] main 예비 파일 갱신`);
    }
    if (done) { console.log(`[${now()}] 초동 기간 집계 완료 — 종료.`); break; }
    wait = BASE_MS;
  } catch (e) {
    wait = Math.min(wait * 2, MAX_MS);
    console.error(`[${now()}] 실패: ${e.message.split("\n")[0]} → ${Math.round(wait / 1000)}초 뒤 재시도`);
    try { await browser.close(); } catch {}
    try { ({ browser, page } = await launch()); } catch {}
  }
  await sleep(wait);
}

await browser.close().catch(() => {});
console.log(`[${now()}] 이번 실행 끝 (다음 예약 실행이 이어서 감시합니다).`);

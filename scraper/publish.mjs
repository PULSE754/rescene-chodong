// GitHub 저장소에 사이트 파일을 올린다 (Git 설치 없이 GitHub REST API 사용)
// - 설정: publish.config.json  { "owner": "깃허브아이디", "repo": "저장소이름", "branch": "main" }
// - 토큰: .github-token 파일(한 줄) 또는 환경변수 GITHUB_TOKEN
//         fine-grained 토큰, 이 저장소 하나만 · Contents: Read and write 권한
// - 올리는 파일은 아래 SITE_FILES 목록뿐이다 (스크래퍼 코드·토큰은 절대 올리지 않음)
// 사용: node scraper/publish.mjs          → 사이트 전체(3개 파일) 올리기
//       node scraper/publish.mjs data     → 데이터 파일만 올리기
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const SITE_FILES = ["index.html", "hero-anim.webp", "og.jpg","data/sales.json",
  ...["pulse", "lipbomb", "dearest", "glowup", "scenedrome", "rescene"].map(n => `covers/${n}.jpg`)];
const API = "https://api.github.com";

export async function loadPublishConfig() {
  if (!existsSync("publish.config.json")) return null;
  const cfg = JSON.parse(await readFile("publish.config.json", "utf8"));
  const token = process.env.GITHUB_TOKEN || (existsSync(".github-token") ? (await readFile(".github-token", "utf8")).trim() : "");
  if (!cfg.owner || !cfg.repo || !token) return null;
  return { ...cfg, branch: cfg.branch || "main", token };
}

async function gh(cfg, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rescene-chodong-tracker",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// 파일 하나 올리기: 내용이 같으면 건너뛰고(불필요한 사이트 재빌드 방지), 다르면 덮어쓴다
export async function putFile(cfg, rel, message) {
  const buf = await readFile(path.resolve(rel));
  const content = buf.toString("base64");
  const url = `/repos/${cfg.owner}/${cfg.repo}/contents/${rel.split("/").map(encodeURIComponent).join("/")}`;
  const cur = await gh(cfg, "GET", `${url}?ref=${cfg.branch}`);
  if (cur && cur.content && cur.content.replace(/\n/g, "") === content) return "same";
  await gh(cfg, "PUT", url, { message, content, branch: cfg.branch, ...(cur ? { sha: cur.sha } : {}) });
  return cur ? "updated" : "created";
}

export async function publish(files = SITE_FILES, message = "update") {
  const cfg = await loadPublishConfig();
  if (!cfg) throw new Error("publish.config.json 또는 토큰(.github-token)이 없습니다.");
  const out = {};
  for (const f of files) out[f] = await putFile(cfg, f, `${message}: ${f}`);
  return { url: `https://${cfg.owner}.github.io/${cfg.repo}/`, out };
}

// 직접 실행했을 때만 동작
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scraper/publish.mjs")) {
  const onlyData = process.argv[2] === "data";
  try {
    const r = await publish(onlyData ? ["data/sales.json"] : SITE_FILES, onlyData ? "data" : "site");
    for (const [f, s] of Object.entries(r.out)) console.log(`${f}: ${s}`);
    console.log(`사이트 주소: ${r.url}  (반영까지 1~2분)`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

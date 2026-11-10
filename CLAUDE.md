# 리센느 초동 트래커

RESCENE 앨범의 한터차트 초동(발매일부터 7일) 판매량을 보여주는 비공식 팬 사이트.
- 공개 주소: https://pulse754.github.io/rescene-chodong/ (GitHub Pages, 계정 PULSE754, 저장소 rescene-chodong)
- 사용자는 한국어로 대화한다. 답변도 한국어로, 짧고 쉽게.

## 파일 구조
- `index.html`: 사이트 전체(HTML·CSS·JS 한 파일). 앨범 목록은 `const ALBUMS`, 그래프는 `trendChart()`
- `data/sales.json`: 한터 판매량(스크래퍼가 자동 갱신). 손으로 고치지 않는다
- `og.jpg`: 링크 공유 미리보기 이미지(1200×630)
- `scraper/hanteo.mjs`: 한터 읽기 공통 함수. 대상 앨범은 `TARGET`
- `scraper/cloud.mjs` + `.github/workflows/hanteo.yml`: **기본 수집 방식.** GitHub Actions가 1분마다 한터를 읽어 `data` 브랜치의 `data/sales.json`에 저장(바뀔 때만)하고, 그때마다 `deploy` 워크플로를 호출한다. `main`의 `data/sales.json`은 15분마다 예비로 갱신. 실행 하나가 약 5시간 반 돌고, 30분마다 예약된 다음 실행이 이어받는다. 초동 마지막 날 확정치를 받으면 종료
- `.github/workflows/deploy.yml`: **Pages는 "GitHub Actions" 방식으로 배포**(설정 변경함). main push 또는 hanteo의 호출 때 실행되고, `data` 브랜치의 최신 sales.json을 끼워 넣어 배포(약 30초). Actions 배포라 시간당 10회 빌드 제한이 없다. `scraper`·`.github`·`package*.json`은 사이트에 안 올라간다
  - 결과: 한터 기준 시각 → 사이트 표시까지 약 1분 (2026-11-07 확인)
  - 사이트(`fetchSales()`)는 같은 사이트의 `data/sales.json?t=`만 읽는다. GitHub API(IP당 시간당 60회 한도로 막힘), raw 주소(5분 캐시, `?t=` 안 먹음), jsDelivr(purge 해도 갱신 안 됨)는 시험해 보고 버렸다
  - 한터 페이지는 해외 서버에서 2~3분 늦은 캐시가 올 수 있어 `readChart()`가 주소에 `?_=시각`을 붙이고, 저장된 시각보다 이른 페이지는 무시한다
  - 실행 상태 확인: 인증 API로 `commits?sha=data` (비인증 API는 IP 한도에 걸리기 쉬움)
  - 초동이 끝나면 GitHub Actions 탭 → hanteo → "Disable workflow"로 꺼 두라고 안내한다
  - 업로드용 토큰에는 Workflows·Actions 권한이 없다. 워크플로 파일 수정, 실행 취소·재시작은 Claude in Chrome으로 GitHub 웹에서 한다(파일은 `/upload/main/.github/workflows` 페이지에 업로드). `scraper/*.mjs`를 고치면 업로드 후 hanteo 실행을 취소·재시작해야 반영된다. 이미 대기 중이던 예약 실행은 **예약된 시점의 옛 코드**로 돌기 때문에, 업로드 이후에 생긴 실행이 돌 때까지 취소해야 한다
  - 자정 뒤 한터가 초기화되기 전(아침까지 전날 숫자가 그대로 보임)에는 새 날을 0장(`placeholder`)으로 만들어 화면을 새 Day로 넘긴다(사용자 요청)
- `scraper/watch.mjs`: 예전 PC 감시 모드(PC를 켜 둬야 함). 이제 예비용
- `scraper/publish.mjs`: GitHub 업로드. `SITE_FILES`에 있는 파일만 올라간다. 스크래퍼 코드(`scraper/hanteo.mjs`, `scraper/cloud.mjs`, `package*.json`)도 Actions용으로 저장소에 올라가 있다(공개 OK, 사용자 동의함). 이 파일들을 고치면 따로 업로드한다
- `.github-token`: 업로드 토큰. 절대 업로드·출력하지 않는다

## 자주 하는 작업

### 업로드
- 수정이 끝나면 **따로 묻지 말고 바로 GitHub에 업로드**한다(사용자가 정한 규칙)
- 바꾼 파일만 올린다:
  `node --input-type=module -e "import { publish } from './scraper/publish.mjs'; console.log(JSON.stringify(await publish(['index.html'], '메시지')));"`
- `node scraper/publish.mjs data`는 sales.json만 올린다
- 새 파일을 사이트에 추가하면 `SITE_FILES`에도 넣는다
- 반영까지 1~2분 걸린다고 안내한다

### 화면 수정 확인
- 미리보기 서버: `.claude/launch.json`의 `mockup`(http://localhost:5180). 파일을 직접 열면(file://) sales.json을 못 읽어 옛 숫자가 나오니 반드시 서버로 확인
- PC(1280px)와 휴대폰(375px) 두 크기 모두 확인

## 구글 검색 등록
- `index.html` `<head>`의 `google-site-verification` 메타 태그는 Search Console 소유 확인용이다. **절대 지우거나 바꾸지 않는다**(지우면 인증이 풀림)

- 네이버 서치어드바이저는 하위 주소를 못 받아 `https://pulse754.github.io`(호스트)로 등록했다. 이를 위해 저장소 `PULSE754/pulse754.github.io`를 만들고 `index.html`(원본: `root-site/index.html`)에 `naver-site-verification` 태그와 트래커로 넘어가는 이동을 넣었다. **이 태그도 지우지 않는다.** 업로드 토큰은 이 저장소 권한이 없어 수정은 Chrome으로 한다
- 새 공개 저장소 만들기 버튼은 자동 보호 기능이 막으므로 사용자에게 직접 누르게 한다

## 사이트 이름 (검색 키워드용)
- 탭 제목·화면 제목·공유 카드 제목: "리센느 초동 · 실시간 앨범 판매량 트래커" (구글 검색용으로 "리센느", "초동", "판매량"을 앞쪽에 둔다)

## 디자인 규칙
- 검정 바탕 + 청록 강조색(`--accent` #93f1f7), Chivo 글꼴. **보라색 금지**
- 모바일 우선, PC는 최대 820px
- 판매량은 1장 단위까지 정확히(예: 412,158장), 집계 기준은 "집계 기준 (KST) YYYY.MM.DD HH:MM"
- 버전별 팝업: Standard 맨 위 → ABC 순 → QR 맨 아래, 판매가 없는 버전도 0장으로 표시
- 누적 그래프: PULSE 청록 실선, 비교 앨범(lip bomb) 분홍 점선(두 선 굵기 같게, 얇게), 점마다 누적 숫자(오늘만 크게), 요일 글자 없음
- 주말 색: 토요일 파랑(#6aa8ff), 일요일 빨강(#ff6b75). 일별 표의 (토)/(일), 그래프 D 라벨에 적용
- 사용자가 지운 기능은 다시 넣지 않는다: 예상 최종 초동, 다음 목표까지 남은 수량, 일평균 카드, 직전 누적 칸, 직전 대비 %, 걸그룹 비교, 상단 멜론 순위 띠(매시간 수동 갱신이 번거로워서 삭제)

## 데이터 원칙
- 확인되지 않은 숫자를 실제 기록처럼 넣지 않는다. 예시값을 써야 하면 사용자에게 먼저 알린다
- 한터 실시간 차트는 100위까지만 보이므로, 100위 밖 버전은 0으로 표시된다(오류 아님)
- 한터 지난 날짜 페이지에는 순위만 있고 판매량이 없다
- 확정된 날(final)은 다른 숫자로 덮어쓰지 않는다. 자정·오전 10시 전후로 한터 날짜와 숫자가 어긋나는 순간이 있다. 일간 차트가 새 날짜에 전날 확정치를 보이면 무시하고, 그 오류로 전날과 같은 숫자로 확정된 날은 자동으로 바로잡는다(11/9 Day6이 47,482로 잘못 들어갔다가 2,965로 수정됨)

## 다음 앨범 준비
`scraper/hanteo.mjs`의 `TARGET`(아티스트·앨범명·발매일)과 `index.html`의 `ALBUMS`(새 앨범 추가, 직전 앨범 일별 판매량)를 바꾼다.
발매 전에 사용자에게 앨범명, 발매일, 커버, 직전 앨범 일별 판매량을 받는다.

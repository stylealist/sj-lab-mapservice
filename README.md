# SJ 시설물 관리 — 지도 프론트엔드 (sj-lab-mapservice)

> 현장조사로 수집한 시설물을 **지도와 목록에서 함께 조회**하고, 보수가 필요한 시설물의 **내업(사무실 처리) 기록을 등록·관리**하는 지도 서비스입니다.
> **빌드 도구·패키지 매니저 없는 순수 정적 SPA**(`package.json` 없음)로, OpenLayers를 직접 다뤄 구현했습니다.

| | |
|---|---|
| **데모** | https://sj-lab.co.kr/map/ (로그인 화면의 **체험용 계정 버튼**으로 바로 입장) |
| **스택** | HTML5 · CSS3 · JavaScript(ES 모듈) · OpenLayers(벤더링) · hls.js · VWorld 배경지도 |
| **연동** | API Gateway(`/map/**`) → `mapservice-rest` → PostgreSQL/PostGIS |

---

## 1. 화면과 기능

| 기능 | 설명 |
|---|---|
| **시설물 조회** | 시·도 → 시·군·구 → 읍·면·동 연쇄 필터, 목록·지도 동시 표출(약 2,500건), 이름·기관 검색 |
| **핀 묶음(클러스터링)** | 겹치는 핀을 개수 배지로 묶고, 깊게 확대하면 같은 자리 시설물이 저절로 흩어짐. 토글로 끌 수 있음 |
| **보수·내업 필터** | 전체 / 보수 필요 / 보수 불필요 + 내업 상태(처리 대기·미완료·접수·처리중·완료·보류) |
| **상세 팝업** | 속성 표시, **현장 사진·음성·영상 재생**(백엔드 중계), 헤더 드래그로 이동, 본문↔내업 영역 크기 조절 |
| **내업 기록** | 처리 상태·담당·일정·비용 입력, 처리 전/후 사진 업로드(리사이즈 후 전송), **PDF 보고서** 다운로드 |
| **공공데이터 레이어** | 편의점·버스정류장·CCTV(실시간 영상)·약국·병원·관공서 — 화면 영역 단위 조회 |
| **부가 도구** | 거리·면적 측정, 로드뷰, 지도 캡처, 배경지도 전환 |
| **SSO 로그인** | 토큰이 없으면 공유 로그인 페이지로 리다이렉트, 헤더에 접속자·로그아웃·허브 이동 |

---

## 2. 면접에서 봐주셨으면 하는 부분

### ① 빌드 도구 없이 유지 가능한 구조 만들기

번들러가 없고 인라인 `onclick` 핸들러가 남아 있는 레거시 구조라, **모듈 간 실제 통합 지점을 `window` 전역으로 명시**하고 그 규칙을 문서화했습니다. `map.js`가 하위 모듈을 모아 `window.*`에 등록하는 **배럴/브리지** 역할을 하고, 초기화 순서와 중복 실행 가드는 `app.js`가 관리합니다. 새 기능을 붙이는 사람이 어디에 무엇을 등록해야 하는지 `docs/map-architecture.md`에 규격으로 남겼습니다.

### ② 200MB 전국 응답 → 화면 영역 조회

공공데이터 레이어를 전국 단위로 받던 구조에서 버스정류장 85MB·병원 61MB가 나와 최초 표출이 수십 초 걸렸습니다. 백엔드에 `bbox`·`limit`을 추가하면서, 프론트는 **화면보다 가로·세로 50% 넓은 영역을 미리 받아 두고 그 안에서 움직이는 동안은 재요청하지 않도록**(`wfsFetchState`) 했습니다.

### ③ 클러스터링 — 배지 숫자와 목록 건수를 항상 일치시키기

OpenLayers `ol.source.Cluster`를 **원본 소스 위에 씌우고 레이어의 소스·스타일만 교체**해, `getFeatureById()`·목록 연동 같은 기존 경로를 건드리지 않았습니다.

핵심은 **필터를 `geometryFunction`에서 적용**한 것입니다. 스타일 단계에서만 거르면 배지 숫자가 필터 결과와 어긋나기 때문에, 필터 탈락 피처는 애초에 묶음에서 제외합니다.

```js
// 필터를 통과한 피처만 묶음에 들어간다 → 배지 숫자 = 목록 건수
function facilityClusterGeometry(feature) {
  if (!matchesFacilityRepairFilter(...)) return null;
  if (!matchesFacilityOfficeFilter(...)) return null;
  return feature.getGeometry();
}
```

검증: 전체 248/248 · 보수 필요 1/1 · 처리 대기 0/0 · 보수 불필요 247/247 — 모든 필터에서 일치.

### ④ "확대해도 안 풀리는 묶음" 해결

한 건물에 여러 시설물이 있으면 **좌표가 완전히 같아** 최대 배율에서도 묶음이 풀리지 않아 선택할 수 없었습니다.

- 깊게 확대하면(배율 18 이상) 아직 묶여 있는 무리를 **중심 둘레로 흩어 놓고 묶음 배지는 숨깁니다** — 확대하니 저절로 풀린 것처럼 보이게
- 처음에는 "좌표가 완전히 같을 때만" 펼쳤는데, **몇 미터 간격이라 계속 묶이는 무리**가 여전히 안 풀렸습니다. 조건을 "이 배율인데도 묶여 있으면 전부"로 바꿔 해결했습니다
- 구성이 그대로면 다시 그리지 않아(키 비교) 지도를 움직여도 깜빡이지 않습니다

### ⑤ zIndex로는 안 되던 레이어 순서 — declutter 렌더 파이프라인

시설물 핀이 공공데이터 아이콘에 가려져 zIndex를 1500까지 올렸는데도 그대로였습니다. 원인은 OpenLayers 렌더러가 **declutter 레이어의 심볼을 모든 레이어를 그린 뒤 따로 그리기** 때문이었습니다.

```js
for (...) { layer.render(frameState); if ("getDeclutter" in layer) declutterLayers.push(layer); }
for (let i = declutterLayers.length - 1; i >= 0; --i) declutterLayers[i].renderDeclutter(frameState);
```

해결: 시설물 레이어도 declutter에 참여시키되 모든 스타일을 **`declutterMode: "obstacle"`**(항상 그리되 다른 심볼이 피해 감)로 지정. 시설물은 하나도 숨지 않고 겹치던 아이콘 쪽이 밀려납니다. 더해서 레이어가 추가·제거될 때마다 시설물 zIndex를 다시 계산해 **항상 최상단을 유지**합니다.

### ⑥ 캐시 때문에 헤더가 깨진 사고 → 규칙화

로컬·운영 모두 `Cache-Control` 없이 `Last-Modified`만 내려주다 보니, 새 HTML과 **옛 CSS**가 섞여 헤더가 깨졌습니다. `index.html`이 참조하는 CSS/JS에 `?v=YYYYMMDD`를 붙이는 규칙을 `CLAUDE.md`·문서에 못 박았습니다.

### ⑦ 업로드 전 클라이언트 리사이즈

내업 사진은 바로 올리지 않고 **긴 변 1600px·JPEG 품질 0.8로 줄인 뒤** 전송합니다(원본이 더 작으면 그대로). PNG·WebP를 JPEG로 바꾸면 확장자까지 맞추고, 투명 영역은 흰 바탕으로 처리합니다. 업로드 실패는 기록 저장과 분리해 **부분 실패를 알림으로 안내**합니다.

---

## 3. 구조

```
index.html                      # 단일 페이지(지도/소개/연락처)
css/
  layouts/main.css
  components/header.css         # 헤더·허브 링크·접속자·로그아웃
  components/layer-panel.css    # 좌측 패널(시설물 목록·필터·내업)
  components/map-controls.css
js/
  auth-gate.js                  # SSO 로그인 게이트(head 최상단)
  app.js                        # 초기화 순서·중복 실행 가드
  modules/ui.js                 # 페이지 전환, 패널·헤더 토글, 로고 동작
  modules/map/
    map.js                      # 배럴/브리지 — 하위 모듈을 window.* 에 등록
    map-core.js                 # 지도 생성·배경지도
    map-facility.js             # 시설물 레이어·목록·필터·클러스터·팝업·내업
    map-wfs.js / map-wms.js     # 공공데이터 레이어
    map-events.js               # 클릭·호버 핸들러 등록기
    map-measure.js / map-roadview.js / map-tools.js
  utils/openlayers/ · utils/hls/  # 벤더링 라이브러리
docs/                           # 설계 문서
```

---

## 4. 실행

ES 모듈을 쓰므로 `file://`로 열면 CORS 오류가 납니다. **4000 포트**로 띄워야 게이트웨이 CORS를 통과합니다.

```bash
python -m http.server 4000     # 또는 npx serve . -l 4000
```

API는 게이트웨이(8100)를 거치므로 백엔드 스택이 함께 떠 있어야 합니다. 총괄 저장소(`mapservice-rest`)의 `scripts/local-stack.ps1`이 Eureka → 백엔드 → 로그인 서버 → 게이트웨이 → 이 사이트를 한 번에 띄웁니다.

빌드·린트·테스트 스크립트는 없습니다. 검증은 브라우저에서 직접 하며, 이 프로젝트에서는 **헤드리스 Chrome + CDP로 클러스터 개수·필터 일치·레이어 순서를 자동 확인**하며 작업했습니다.

### 디버그 진입점

```javascript
window.getMap()                          // OpenLayers Map (window.mapInstance는 undefined — 알려진 이슈)
window.mapTools.flyTo([127.0, 37.5], 15)
window.MapEventManager.debugHandlers()
```

---

## 5. 개발 시 규칙 (직접 겪은 함정들)

- 인라인 HTML이나 다른 모듈에서 호출할 함수는 **`map.js`에서 `window.*`에 등록** — 빠뜨리면 `ReferenceError`
- `.nav-btn` 클래스는 `ui.js`가 **페이지 전환 버튼으로 바인딩**합니다. 허브 링크·로그아웃 같은 요소에 붙이지 마세요
- 로고 클릭은 **현재 디렉터리 기준으로 사이트를 다시 불러옵니다**. `origin + "/map"` 같은 절대 경로를 하드코딩하면 로컬에서 404
- `index.html`이 참조하는 CSS/JS를 고치면 **`?v=` 갱신**
- 시설물 아이콘의 기준은 DB(`map.facility_icon`)입니다. 파일 안 `FALLBACK_FACILITY_ICON_TYPES`는 API 실패 시 대체값
- 초기화 가드(`appInitialized` 등) 제거 금지 — 이벤트·레이어가 중복 등록됩니다

---

## 6. 문서

| 문서 | 내용 |
|---|---|
| `docs/map-architecture.md` | 모듈별 역할, 시설물 레이어 규격(아이콘·zIndex·declutter·클러스터·펼치기), 팝업·내업 레이아웃 |
| `docs/ui-conventions.md` | SPA 페이지 전환, 레이어 패널 탭, 시설물 탭·필터·배지 컨벤션, 헤더 규칙 |
| `docs/external-services.md` | VWorld·백엔드·GeoServer·카카오맵 등 외부 연동 |
| `CLAUDE.md` | 작업 규칙 |

전체 시스템 구조·API 계약은 총괄 저장소 `mapservice-rest`의 `docs/system-architecture.md`에 있습니다.

---

## 7. 배포

Jenkins가 저장소 파일을 웹서버 노드의 `/home/kuber-volume/sj-lab-webserver/html/map`으로 복사하고 nginx가 서빙합니다(빌드 단계 없음).

> 이 폴더는 허브 사이트 디렉터리의 **하위**라, 허브 배포가 상위를 비우면 지도가 통째로 지워집니다. 실제로 겪었고 원인·조치는 총괄 저장소의 `docs/deploy-static-sites.md`에 정리했습니다.

## 8. 현재 한계

- 로그인 게이트는 **화면 접근만** 막습니다(백엔드 API는 토큰을 강제하지 않음)
- 정적 자원이 gzip·캐시 헤더 없이 서빙되고 있어(첫 로드 약 2.1MB) nginx 설정 개선이 다음 과제입니다
- 모바일 레이아웃은 팝업 위주로만 대응돼 있습니다

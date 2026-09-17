# 지도 모듈 아키텍처 (`js/modules/map/`)

- **map-core.js** — OpenLayers `Map`/`View` 생성. VWorld XYZ 타일(`xdworld.vworld.kr`)로 일반지도/위성/하이브리드 오버레이 구성, 서울 중심(`[127.0, 37.5]`)으로 초기화.
- **map-events.js** — `MapEventManager`: id 기반으로 move/click 등 지도 이벤트 리스너를 등록하고 중복 등록을 막는 중앙 레지스트리. 모듈이 재초기화될 수 있어 이 가드가 필요함.
- **map-layers.js** — 배경지도 전환(`switchLayer`), 오버레이 토글.
- **map-wfs.js** (2,200줄, 최대 파일) — 편의점/버스정류장/CCTV/약국/병원/관공서 등 POI를 자체 백엔드 API로부터 WFS 방식으로 조회·표시. `getApiUrl()`이 `location.hostname`에 따라 `http://localhost:8100`(개발)과 `https://api.sj-lab.co.kr`(운영)을 전환함 — 새 WFS 레이어를 추가할 때 이 패턴을 그대로 따라야 함.
- **map-wms.js** — `geoserver.sj-lab.co.kr`의 GeoServer WMS 레이어(현재 편의점 WMS 1종).
- **map-measure.js** (1,339줄) — 거리/면적/반경/각도 측정 도구와 측정 결과 팝업.
- **map-roadview.js** — 로드뷰(카카오맵 스트리트뷰) 기능. `window.KAKAO_APP_KEY`(index.html 인라인 스크립트에서 설정)를 사용하며, `html/loadview/load-view.html`을 별도 창/iframe으로 띄움.
- **map-area-selector.js** (698줄) — 지도 영역 선택 → 캡처 기능. `html/fabric/fabric-editor.html`(Fabric.js 기반 편집기, 별도 페이지)로 연결됨.
- **map-facility.js** — QField 시설물 레이어 및 관리 모듈. 시도/시군구/읍면동 행정구역 연쇄 검색에 따른 시설물 목록·지도 표출, 피처 선택 시 지도 이동 및 `ol.Overlay` 팝업 상세정보 표시.
- **map-tools.js** — 콘솔 디버깅용 `window.mapTools` (flyTo, setZoom, resetMap 등).
- **map-popup-drag.js** — 지도 팝업 헤더 드래그 이동 공용 함수 `bindOverlayHeaderDrag(overlay, header, { ignoreSelector })`. 시설물 팝업(`map-facility.js`), WFS 레이어 팝업(`showWfsPopup`, 편의점·약국·병원·관공서·버스·CCTV 공통), WMS 팝업(`showWmsPopup`)이 모두 이 함수를 씁니다. 오버레이 좌표는 대상 지점에 고정한 채 **offset만** 바꾸므로 옮긴 뒤에도 지도를 움직이면 팝업이 따라갑니다. WFS·WMS 팝업은 클릭할 때마다 요소와 오버레이를 새로 만들므로 **만들 때마다 다시 호출**해야 하고(요소를 지우면 리스너도 함께 사라짐), 닫기 버튼은 `ignoreSelector`로 제외해야 드래그로 오인되지 않습니다. 새 지도 팝업을 추가할 때도 헤더 드래그는 이 함수로 붙일 것(복사해서 새로 만들지 말 것).

`html/` 아래 페이지들은 `index.html`의 SPA 라우팅(페이지 전환)에 포함되지 않는 **독립 팝업 페이지**입니다 — `map-roadview.js`/`map-area-selector.js`가 별도 창으로 여는 방식이므로, 관련 기능을 고칠 때는 두 파일과 그 팝업 HTML을 함께 봐야 합니다.

## 반드시 지킬 것

- `MapEventManager.register*Handler(id, handler)`(`map-events.js`)는 **동일 `id` + 동일 이벤트 타입이 이미 등록돼 있으면 조용히 무시(`return`)**합니다. 새 핸들러를 등록했는데 안 먹히면 가장 먼저 `id` 충돌을 의심할 것. `id`는 `map-wfs.js`의 `` `wfs-move-${layerName}` `` 처럼 `<모듈>-<이벤트>-<대상>` 형태로 매번 고유하게 지을 것.
- 벡터/타일 레이어의 `zIndex`는 `map-wfs.js`의 WFS 벡터 레이어, `map-wms.js`의 WMS 레이어 모두 `1000`을 쓰고 있습니다. 새 레이어를 추가할 때 이 값과 겹쳐도 되는지, 위/아래에 와야 하는지 기존 레이어들과 순서를 맞출 것.
- WFS 레이어는 `getMaxFeaturesByZoom()` + `spatialSampling()`으로 줌 레벨별 최대 표시 개수를 제한하는 성능 가드가 걸려 있습니다. 새 WFS 레이어를 추가하거나 기존 로직을 고칠 때 이 제한을 우회해서 전체 피처를 조건 없이 렌더링하지 말 것 — 대량 데이터에서 렌더링이 급격히 느려짐.
- 레이어 생성 옵션(`updateWhileAnimating: false`, `updateWhileInteracting: false`, `declutter: true` 등)은 성능을 위해 의도적으로 설정된 값입니다. 임의로 `true`로 바꾸지 말 것.
- POI 아이콘 스타일은 `size`/`imgSize` `[32, 32]`, `anchor: [0.5, 1.0]`(하단 중앙 앵커)로 통일돼 있습니다. 새 POI 아이콘을 추가할 때 이 컨벤션을 맞출 것 — 앵커가 다르면 다른 레이어 아이콘과 위치 정렬이 어긋남.
- `map-wfs.js`의 새 엔드포인트는 반드시 `getApiUrl()`을 통해서만 URL을 만들 것 (dev/prod 자동 전환). 절대 URL 하드코딩 금지.
- **WFS 데이터는 화면에 보이는 영역만 서버에서 받아옵니다.** 예전에는 레이어를 켤 때마다 전국 데이터를 통째로(버스정류장 약 85MB) 받아 브라우저에서 잘라 썼고, 그래서 최초 표출에 수십 초가 걸렸습니다. 지금은 백엔드가 `bbox`(EPSG:3857 `minX,minY,maxX,maxY`)와 `limit`을 지원하므로 `fetchWfsFeaturesForExtent()`가 화면보다 가로·세로 **50% 넓은 영역**(`bufferExtent`)만 요청합니다.
  - `wfsFetchState[layerName]`이 `{ extent, zoom, complete }`로 "어디까지 받아왔는지"를 들고 있고, `needsServerFetch()`가 ① 아직 안 받음 ② 화면이 받아둔 영역 밖 ③ 상한에 걸린 영역인데 줌인함 — 이 세 경우에만 서버를 다시 부릅니다. 버퍼 안에서 움직이는 동안은 요청이 나가지 않으므로, 이동할 때마다 요청이 나간다면 이 판정을 먼저 볼 것.
  - 받아온 피처는 `mergeFeaturesIntoCache()`가 **피처 id 기준 중복 제거**로 `wfsDataCache`에 합칩니다. 캐시를 직접 `push`하지 말 것(같은 피처가 여러 번 들어가 개수 표시가 틀어짐).
  - 화면에 그리는 일은 `renderLayerFromCache()` 한 곳에서만 합니다(뷰포트 필터 → `getMaxFeaturesByZoom()` 상한 → `spatialSampling()`). 레이어를 켤 때와 지도를 움직일 때 모두 이 함수를 씁니다.
  - `filterRawPointFeaturesByExtent()` + `scheduleBackgroundFeatureCaching()`은 **`bbox`를 모르는 예전 백엔드에 붙었을 때의 안전장치**로만 남아 있습니다(요청한 상한보다 훨씬 많이 오면 예전 방식대로 화면 안쪽만 먼저 파싱). 정상 경로에서는 타지 않으므로, 이 두 함수가 자주 불린다면 백엔드 버전을 의심할 것.
- **`readFeatures()`에 넘기는 `featureProjection`은 반드시 `vectorSource.getProjection()`(= `null`)을 유지할 것.** OpenLayers 7.4.0에서 `ol.source.Vector`의 `getProjection()`은 `null`을 반환하고, `featureProjection`이 `null`이면 `readFeatures()`가 좌표를 **변환하지 않고 그대로** 사용합니다. 백엔드 응답 좌표가 이미 뷰 좌표계(EPSG:3857)이므로 이 동작에 의존하고 있습니다(옵션의 `dataProjection: "EPSG:4326"`은 실질적으로 무시됨). 여기에 `map.getView().getProjection()` 같은 실제 투영을 넘기면 미터 좌표를 경위도로 간주해 변환해버려 피처가 지도 밖으로 밀려나 **레이어가 아예 표시되지 않음**. 같은 이유로 원본 좌표 기반 뷰포트 필터링도 4326이 아니라 **뷰 좌표계 extent**로 비교해야 함.
- **시설물 레이어 (`map-facility.js`) 규격**:
  - `zIndex`: `1010` (기존 WFS/WMS 레이어 1000 위에 배치하여 가시성 확보).
  - **아이콘**: PNG 파일이 아니라 `buildFacilityIconUrl()`이 만드는 **SVG data URI 핀**(원본 24×32, `anchor [0.5, 1.0]`)을 사용합니다. 시설물명(`fclt_nm`)에 포함된 키워드로 종류를 판별해 글리프를 고르고, `repair_required_yn === 'Y'`면 핀 색을 경고색으로 바꿉니다. 글리프 안의 문자열 `COLOR`는 핀 색으로 치환되므로 색을 직접 적지 말 것. 종류·색·선택 상태 조합은 `facilityStyleCache`에 캐시되므로(피처 2천여 건) 스타일 함수 안에서 `new ol.style.Style`을 새로 만들지 말 것.
  - **아이콘 설정의 기준은 DB**(`qfield.facility_icon`)입니다. `loadFacilityIconConfig()`가 초기화 때 `GET /map/qfield/facility-icons`로 불러와 `facilityIconTypes`·`facilityDefaultIcon`을 교체하고 캐시를 비웁니다. **아이콘을 추가·변경할 때는 이 파일이 아니라 DB 행을 수정할 것**(생성·초기데이터 스크립트: `mapservice-rest/db/qfield_facility_icon.sql`). 파일 안의 `FALLBACK_FACILITY_ICON_TYPES`는 API 실패·빈 응답일 때만 쓰는 대체값이므로, DB에 종류를 추가했다고 해서 여기에 같이 넣지 말 것(둘이 어긋나면 어느 쪽이 보이는지 헷갈림).
  - 레이어 옵션: `updateWhileAnimating: false`, `updateWhileInteracting: false`, `declutter: false` (목록 건수와 지도 표출 건수 일치를 위해 비활성화).
  - **상세 팝업**: 헤더는 지도 핀과 같은 규칙으로 채웁니다(`renderFacilityPopupHeader()`) — 같은 SVG 아이콘 + 시설물명 + 종류·보수필요·상태 배지. 헤더에서 보여주는 `fclt_nm`·`facility_condition`·`repair_required_yn`은 `HEADER_FIELD_KEYS`로 본문 목록에서 제외하되 `DETAIL_FIELD_CONFIG`에는 남겨 둘 것(빼면 "그 밖의 항목" 목록으로 다시 새어 나옴). 배지 색은 핀 색과 맞춰 종류=파랑(`badge-type`), 보수 필요=주황(`badge-repair`)을 씁니다.
    - **보수 필요 여부는 항상 표시**합니다 — `repair_required_yn`이 `Y`면 헤더에 `보수 필요`(주황), 그 밖(`N`·빈 값)이면 `보수 불필요`(초록, `badge-no-repair`). 본문 "보수 필요 여부" 행도 같은 용어(`FACILITY_VALUE_MAPS.repair`: Y=보수 필요, N=보수 불필요)이고, 설정의 `emptyValue: "N"` 때문에 빈 값이 `-`가 아니라 `보수 불필요`로 나옵니다. 목록 필터(`matchesFacilityRepairFilter`)와 같은 기준이므로 한쪽만 바꾸지 말 것. 앱 ValueMap 원문은 Y=정비요청, N=양호입니다.
  - **선택 시 지도 가운데로 이동**: `selectFacility(totalId, zoomIn)`은 지도에서 핀을 클릭하든 목록에서 고르든 **선택한 시설물을 지도 가운데로 옮깁니다.** `zoomIn`은 목록에서 골랐을 때만 `true`(최소 줌 16까지 확대)이고, 지도에서 직접 클릭하면 배율은 그대로 둡니다.
    - 가운데의 기준은 `#map` 요소가 아니라 **화면에 실제로 보이는 지도 영역**입니다(`getFacilityViewCenter()`). `#map`은 화면 전체 너비인데 좌측 `.layer-panel`(320px)이 그 위에 겹쳐 떠 있고, 세로로는 60px 헤더 아래에서 시작해 하단 60px가 화면 밖으로 넘칩니다. view center를 시설물 좌표로 그대로 두면 왼쪽으로 160px·아래로 30px 치우쳐 보입니다.
    - 패널이 가리는 폭과 화면 안에 보이는 범위를 **클릭할 때마다 다시 재므로** 패널을 접거나 창 크기가 바뀌어도 맞습니다. 헤더·패널·`#map` 레이아웃을 바꾸면 이 함수 결과가 달라지니 함께 확인할 것.
    - 확대까지 하는 경우 **이동 후 해상도**(`view.getResolutionForZoom(targetZoom)`)로 계산해야 정확히 가운데에 옵니다.
    - 팝업이 핀 오른쪽에 들어갈 자리가 없으면(패널을 연 채 창 너비가 약 1,250px 미만) `panIntoView`가 팝업이 다 보이도록 지도를 그만큼만 밉니다. 이때는 핀이 가운데에서 왼쪽으로 조금 비켜납니다 — 팝업이 잘리지 않게 하려는 의도된 동작입니다.
  - **팝업 위치·표시 시점**: 팝업은 **지도 이동과 상세 로딩이 모두 끝난 뒤 최종 위치에서 한 번에** 나타납니다. `showFacilityDetail()`이 `is-positioning`(`visibility: hidden`) 상태로 자리만 잡고, `revealFacilityPopup()`이 가운데 이동 종료 → 높이 기준 세로 가운데 오프셋 → `panIntoView` 보정 이동 종료 순으로 기다린 뒤 숨김을 풉니다.
    - 오버레이 `autoPan`은 **끕니다**. 켜 두면 `setPosition` 직후 `selectFacility`의 이동 애니메이션과 겹쳐, 팝업이 핀 아래에 보였다가 자리를 옮기는 문제가 있었습니다.
    - 숨길 때 `display: none`을 쓰지 말 것 — 높이를 잴 수 없어 세로 가운데·`panIntoView` 계산이 틀어집니다.
    - `facilityPopupRevealToken`으로 대기 중인 표시를 무효화합니다(다른 시설물 선택·닫기). 응답이 `FACILITY_POPUP_SLOW_REVEAL_MS`(1.2초)보다 늦으면 "불러오는 중" 상태로 먼저 보여주고, 내용이 채워지면 위치만 다시 맞춥니다.
  - 이벤트 ID:
    - 클릭: `MapEventManager.registerClickHandler('facility-click-layer', handler)` (기존 `wfs-general-click`과 충돌하지 않도록 시설물 레이어 피처만 필터링 처리).
    - 호버 커서: `MapEventManager.registerPointerMoveHandler('facility-pointer-move', handler)` (자체 `isFacilityHovered` 상태를 두어 시설물 피처를 벗어날 때 `cursor = ""`로 즉시 복원하여 커서 고착 방지).
  - 요청 순서 경쟁 방지: `loadFacilities`, `loadFacilitySggList`, `loadFacilityEmdList`는 `AbortController` 및 요청 순번(`facilityRequestSeq` 등)을 두어 이전 요청을 취소하고 최신 응답만 UI에 반영(취소된 `AbortError`는 오류 UI를 띄우지 않음).
  - API 목록 (모두 `getApiUrl()`을 통해 호출):
    - `GET /map/admin-area/sido`: 시도 목록 및 extent
    - `GET /map/admin-area/sgg?sidoCd={sidoCd}`: 시군구 목록 및 extent
    - `GET /map/admin-area/emd?sggCd={sggCd}`: 읍면동 목록 및 extent
    - `GET /map/qfield/facilities`: 시설물 GeoJSON FeatureCollection (`sidoCd`, `sggCd`, `emdCd` 파라미터 지원)
    - `GET /map/qfield/facilities/{totalId}`: 시설물 상세 GeoJSON Feature (모든 상세 속성 및 sido_nm, sgg_nm, emd_nm 포함)


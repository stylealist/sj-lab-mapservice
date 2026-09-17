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

`html/` 아래 페이지들은 `index.html`의 SPA 라우팅(페이지 전환)에 포함되지 않는 **독립 팝업 페이지**입니다 — `map-roadview.js`/`map-area-selector.js`가 별도 창으로 여는 방식이므로, 관련 기능을 고칠 때는 두 파일과 그 팝업 HTML을 함께 봐야 합니다.

## 반드시 지킬 것

- `MapEventManager.register*Handler(id, handler)`(`map-events.js`)는 **동일 `id` + 동일 이벤트 타입이 이미 등록돼 있으면 조용히 무시(`return`)**합니다. 새 핸들러를 등록했는데 안 먹히면 가장 먼저 `id` 충돌을 의심할 것. `id`는 `map-wfs.js`의 `` `wfs-move-${layerName}` `` 처럼 `<모듈>-<이벤트>-<대상>` 형태로 매번 고유하게 지을 것.
- 벡터/타일 레이어의 `zIndex`는 `map-wfs.js`의 WFS 벡터 레이어, `map-wms.js`의 WMS 레이어 모두 `1000`을 쓰고 있습니다. 새 레이어를 추가할 때 이 값과 겹쳐도 되는지, 위/아래에 와야 하는지 기존 레이어들과 순서를 맞출 것.
- WFS 레이어는 **화면 안에 들어오는 피처를 개수 제한 없이 모두 표출**합니다(2026-09-17 결정). 예전의 줌 레벨별 최대 개수(`getMaxFeaturesByZoom()`)와 공간 샘플링(`spatialSampling()`)은 제거했으므로 다시 넣지 말 것 — 일부 피처가 빠져 보이는 원인이었습니다. 대신 광역 줌에서 피처가 많으면 렌더링이 무거워질 수 있으니, 성능 문제가 생기면 개수를 자르기 전에 사용자와 먼저 상의할 것.
- 레이어 생성 옵션(`updateWhileAnimating: false`, `updateWhileInteracting: false`, `declutter: true` 등)은 성능을 위해 의도적으로 설정된 값입니다. 임의로 `true`로 바꾸지 말 것.
- POI 아이콘 스타일은 `size`/`imgSize` `[32, 32]`, `anchor: [0.5, 1.0]`(하단 중앙 앵커)로 통일돼 있습니다. 새 POI 아이콘을 추가할 때 이 컨벤션을 맞출 것 — 앵커가 다르면 다른 레이어 아이콘과 위치 정렬이 어긋남.
- `map-wfs.js`의 새 엔드포인트는 반드시 `getApiUrl()`을 통해서만 URL을 만들 것 (dev/prod 자동 전환). 절대 URL 하드코딩 금지.
- **WFS 데이터는 백엔드에서 영역을 자르지 않고 전체를 한 번에 받아옵니다**(2026-09-17 결정). 한때 백엔드 `bbox`·`limit`으로 화면 영역만 받았지만, 서버 상한·샘플링 때문에 피처가 다 나오지 않아 되돌렸습니다. 요청 URL에 `bbox`/`limit` 파라미터를 다시 붙이지 말 것.
  - `loadWfsData()`는 레이어를 **처음 켤 때만** `fetchAllWfsFeatures()`로 전체 데이터를 받고(`wfsDataLoaded[layerName] = true`), 이후 켜기·이동·줌은 서버를 부르지 않고 캐시로만 그립니다. 받아오는 중에 버튼을 다시 누르면 `wfsLoadPromises[layerName]`의 같은 요청을 기다리므로 요청이 중복으로 나가지 않습니다.
  - 응답이 수십 MB(버스정류장 약 85MB)라 한 번에 `readFeatures()`하면 메인 스레드가 수 초간 멈춥니다. 그래서 `filterRawPointFeaturesByExtent()`로 **화면 안쪽 피처만 먼저 파싱해 바로 그리고**, 나머지는 `scheduleBackgroundFeatureCaching()`이 1,000개씩 idle 시간에 파싱한 뒤 완료 콜백(`renderLayerForCurrentView()`)으로 현재 화면을 다시 그립니다.
  - 받아온 피처는 `mergeFeaturesIntoCache()`가 **피처 id 기준 중복 제거**로 `wfsDataCache`에 합칩니다. 캐시를 직접 `push`하지 말 것(같은 피처가 여러 번 들어가 개수 표시가 틀어짐).
  - 화면에 그리는 일은 `renderLayerFromCache()` 한 곳에서만 합니다(뷰포트 필터만 하고 개수 제한 없음). 레이어를 켤 때, 지도를 움직일 때, 백그라운드 파싱이 끝났을 때 모두 이 함수를 씁니다.
  - 레이어 옵션 `declutter: true`는 그대로라서 **아이콘이 서로 겹치는 자리에서는 OpenLayers가 일부를 숨깁니다**(데이터는 벡터 소스에 모두 들어가 있음). 겹친 것까지 전부 그려야 한다면 시설물 레이어처럼 `declutter: false`로 바꾸는 것을 검토할 것.
- **`readFeatures()`에 넘기는 `featureProjection`은 반드시 `vectorSource.getProjection()`(= `null`)을 유지할 것.** OpenLayers 7.4.0에서 `ol.source.Vector`의 `getProjection()`은 `null`을 반환하고, `featureProjection`이 `null`이면 `readFeatures()`가 좌표를 **변환하지 않고 그대로** 사용합니다. 백엔드 응답 좌표가 이미 뷰 좌표계(EPSG:3857)이므로 이 동작에 의존하고 있습니다(옵션의 `dataProjection: "EPSG:4326"`은 실질적으로 무시됨). 여기에 `map.getView().getProjection()` 같은 실제 투영을 넘기면 미터 좌표를 경위도로 간주해 변환해버려 피처가 지도 밖으로 밀려나 **레이어가 아예 표시되지 않음**. 같은 이유로 원본 좌표 기반 뷰포트 필터링도 4326이 아니라 **뷰 좌표계 extent**로 비교해야 함.
- **시설물 레이어 (`map-facility.js`) 규격**:
  - `zIndex`: `1010` (기존 WFS/WMS 레이어 1000 위에 배치하여 가시성 확보).
  - **아이콘**: PNG 파일이 아니라 `buildFacilityIconUrl()`이 만드는 **SVG data URI 핀**(원본 24×32, `anchor [0.5, 1.0]`)을 사용합니다. 시설물명(`fclt_nm`)에 포함된 키워드로 종류를 판별해 글리프를 고르고, `repair_required_yn === 'Y'`면 핀 색을 경고색으로 바꿉니다. 글리프 안의 문자열 `COLOR`는 핀 색으로 치환되므로 색을 직접 적지 말 것. 종류·색·선택 상태 조합은 `facilityStyleCache`에 캐시되므로(피처 2천여 건) 스타일 함수 안에서 `new ol.style.Style`을 새로 만들지 말 것.
  - **아이콘 설정의 기준은 DB**(`qfield.facility_icon`)입니다. `loadFacilityIconConfig()`가 초기화 때 `GET /map/qfield/facility-icons`로 불러와 `facilityIconTypes`·`facilityDefaultIcon`을 교체하고 캐시를 비웁니다. **아이콘을 추가·변경할 때는 이 파일이 아니라 DB 행을 수정할 것**(생성·초기데이터 스크립트: `mapservice-rest/db/qfield_facility_icon.sql`). 파일 안의 `FALLBACK_FACILITY_ICON_TYPES`는 API 실패·빈 응답일 때만 쓰는 대체값이므로, DB에 종류를 추가했다고 해서 여기에 같이 넣지 말 것(둘이 어긋나면 어느 쪽이 보이는지 헷갈림).
  - 레이어 옵션: `updateWhileAnimating: false`, `updateWhileInteracting: false`, `declutter: false` (목록 건수와 지도 표출 건수 일치를 위해 비활성화).
  - **상세 팝업**: 헤더는 지도 핀과 같은 규칙으로 채웁니다(`renderFacilityPopupHeader()`) — 같은 SVG 아이콘 + 시설물명 + 종류·보수필요·상태 배지. 헤더에서 보여주는 `fclt_nm`·`facility_condition`·`repair_required_yn`은 `HEADER_FIELD_KEYS`로 본문 목록에서 제외하되 `DETAIL_FIELD_CONFIG`에는 남겨 둘 것(빼면 "그 밖의 항목" 목록으로 다시 새어 나옴). 배지 색은 핀 색과 맞춰 종류=파랑(`badge-type`), 보수 필요=주황(`badge-repair`)을 씁니다.
  - **팝업 위치**: 오버레이는 `autoPan`을 켜고, **상세 내용을 그린 뒤 `setPosition(coordinate)`을 한 번 더 호출**해야 합니다. 처음 위치를 잡는 시점에는 "불러오는 중" 상태라 팝업 높이가 작아, autoPan이 실제 높이를 모른 채 계산해 헤더가 화면 위로 잘립니다.
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


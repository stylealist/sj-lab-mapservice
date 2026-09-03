# 지도 모듈 아키텍처 (`js/modules/map/`)

- **map-core.js** — OpenLayers `Map`/`View` 생성. VWorld XYZ 타일(`xdworld.vworld.kr`)로 일반지도/위성/하이브리드 오버레이 구성, 서울 중심(`[127.0, 37.5]`)으로 초기화.
- **map-events.js** — `MapEventManager`: id 기반으로 move/click 등 지도 이벤트 리스너를 등록하고 중복 등록을 막는 중앙 레지스트리. 모듈이 재초기화될 수 있어 이 가드가 필요함.
- **map-layers.js** — 배경지도 전환(`switchLayer`), 오버레이 토글.
- **map-wfs.js** (2,200줄, 최대 파일) — 편의점/버스정류장/CCTV/약국/병원/관공서 등 POI를 자체 백엔드 API로부터 WFS 방식으로 조회·표시. `getApiUrl()`이 `location.hostname`에 따라 `http://localhost:8100`(개발)과 `https://api.sj-lab.co.kr`(운영)을 전환함 — 새 WFS 레이어를 추가할 때 이 패턴을 그대로 따라야 함.
- **map-wms.js** — `geoserver.sj-lab.co.kr`의 GeoServer WMS 레이어(현재 편의점 WMS 1종).
- **map-measure.js** (1,339줄) — 거리/면적/반경/각도 측정 도구와 측정 결과 팝업.
- **map-roadview.js** — 로드뷰(카카오맵 스트리트뷰) 기능. `window.KAKAO_APP_KEY`(index.html 인라인 스크립트에서 설정)를 사용하며, `html/loadview/load-view.html`을 별도 창/iframe으로 띄움.
- **map-area-selector.js** (698줄) — 지도 영역 선택 → 캡처 기능. `html/fabric/fabric-editor.html`(Fabric.js 기반 편집기, 별도 페이지)로 연결됨.
- **map-tools.js** — 콘솔 디버깅용 `window.mapTools` (flyTo, setZoom, resetMap 등).

`html/` 아래 페이지들은 `index.html`의 SPA 라우팅(페이지 전환)에 포함되지 않는 **독립 팝업 페이지**입니다 — `map-roadview.js`/`map-area-selector.js`가 별도 창으로 여는 방식이므로, 관련 기능을 고칠 때는 두 파일과 그 팝업 HTML을 함께 봐야 합니다.

## 반드시 지킬 것

- `MapEventManager.register*Handler(id, handler)`(`map-events.js`)는 **동일 `id` + 동일 이벤트 타입이 이미 등록돼 있으면 조용히 무시(`return`)**합니다. 새 핸들러를 등록했는데 안 먹히면 가장 먼저 `id` 충돌을 의심할 것. `id`는 `map-wfs.js`의 `` `wfs-move-${layerName}` `` 처럼 `<모듈>-<이벤트>-<대상>` 형태로 매번 고유하게 지을 것.
- 벡터/타일 레이어의 `zIndex`는 `map-wfs.js`의 WFS 벡터 레이어, `map-wms.js`의 WMS 레이어 모두 `1000`을 쓰고 있습니다. 새 레이어를 추가할 때 이 값과 겹쳐도 되는지, 위/아래에 와야 하는지 기존 레이어들과 순서를 맞출 것.
- WFS 레이어는 `getMaxFeaturesByZoom()` + `spatialSampling()`으로 줌 레벨별 최대 표시 개수를 제한하는 성능 가드가 걸려 있습니다. 새 WFS 레이어를 추가하거나 기존 로직을 고칠 때 이 제한을 우회해서 전체 피처를 조건 없이 렌더링하지 말 것 — 대량 데이터에서 렌더링이 급격히 느려짐.
- 레이어 생성 옵션(`updateWhileAnimating: false`, `updateWhileInteracting: false`, `declutter: true` 등)은 성능을 위해 의도적으로 설정된 값입니다. 임의로 `true`로 바꾸지 말 것.
- POI 아이콘 스타일은 `size`/`imgSize` `[32, 32]`, `anchor: [0.5, 1.0]`(하단 중앙 앵커)로 통일돼 있습니다. 새 POI 아이콘을 추가할 때 이 컨벤션을 맞출 것 — 앵커가 다르면 다른 레이어 아이콘과 위치 정렬이 어긋남.
- `map-wfs.js`의 새 엔드포인트는 반드시 `getApiUrl()`을 통해서만 URL을 만들 것 (dev/prod 자동 전환). 절대 URL 하드코딩 금지.
- `loadWfsData()`는 최초 로드 시 서버 응답 전체를 한 번에 `readFeatures()`하지 않고, 원본 GeoJSON 좌표로 뷰포트 내 피처만 먼저 골라(`filterRawPointFeaturesByExtent`) 빠르게 화면에 표시한 뒤, 나머지는 `scheduleBackgroundFeatureCaching()`으로 청크 단위(`requestIdleCallback`)로 백그라운드 파싱해 `wfsDataCache`를 채웁니다. 새 WFS 레이어를 추가하거나 로딩 로직을 고칠 때도 이 패턴(초기 표시는 빠르게, 전체 파싱은 메인 스레드를 막지 않게)을 유지할 것 — 대량 데이터에서 최초 로딩 체감 속도에 직결됨.
- **`readFeatures()`에 넘기는 `featureProjection`은 반드시 `vectorSource.getProjection()`(= `null`)을 유지할 것.** OpenLayers 7.4.0에서 `ol.source.Vector`의 `getProjection()`은 `null`을 반환하고, `featureProjection`이 `null`이면 `readFeatures()`가 좌표를 **변환하지 않고 그대로** 사용합니다. 백엔드 응답 좌표가 이미 뷰 좌표계(EPSG:3857)이므로 이 동작에 의존하고 있습니다(옵션의 `dataProjection: "EPSG:4326"`은 실질적으로 무시됨). 여기에 `map.getView().getProjection()` 같은 실제 투영을 넘기면 미터 좌표를 경위도로 간주해 변환해버려 피처가 지도 밖으로 밀려나 **레이어가 아예 표시되지 않음**. 같은 이유로 원본 좌표 기반 뷰포트 필터링도 4326이 아니라 **뷰 좌표계 extent**로 비교해야 함.

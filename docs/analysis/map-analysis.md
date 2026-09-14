# 지도 모듈 분석 보고서

- 분석 대상: `js/modules/map/*.js`, `js/app.js`, `js/modules/ui.js`(지도 연동 부분), `index.html`, `CLAUDE.md`, `docs/map-architecture.md`
- 방식: 코드만 읽고 분석함(읽기 전용). 브라우저에서 실행해 확인하지 않았으므로, 런타임 동작에 대한 서술은 코드를 근거로 한 추론임.
- 같은 내용의 구조화 데이터: [`map-analysis.json`](./map-analysis.json)
- 근거는 모두 `파일:줄` 형식으로 붙임.

---

## (a) 파일별 역할과 줄 수

| id | 파일 | 줄 수 | 역할 |
|---|---|---:|---|
| index-html | `index.html` | 560 | SPA 진입 HTML. `#map`(index.html:177), 사이드 탭 `.cadastral-control`(index.html:192), 인라인 onclick 3개, `ol.js`/`hls.js` 전역 스크립트(index.html:552-553), `js/app.js` 모듈(index.html:555), `window.KAKAO_APP_KEY`(index.html:557) |
| app | `js/app.js` | 45 | 최상위 초기화 순서와 `window.appInitialized` 가드 |
| ui | `js/modules/ui.js` | 703 | 페이지 전환, 레이어 패널, 사이드 탭 서브메뉴. 지도 기능은 `window.*`로 호출 |
| helpers | `js/utils/helpers.js` | 63 | 범용 유틸. app.js가 import하지만 사용하지 않음(app.js:10) |
| map | `js/modules/map/map.js` | 125 | 배럴/브리지. `initializeMapWithModules()`(map.js:44)를 정의하고 `window.*` 31개를 등록(map.js:91-123) |
| map-core | `js/modules/map/map-core.js` | 157 | `ol.Map`/`ol.View` 생성(map-core.js:47), VWorld XYZ 레이어 3개, `getMap()`(map-core.js:149) |
| map-events | `js/modules/map/map-events.js` | 269 | `MapEventManager`(map-events.js:8). 같은 id와 같은 이벤트 타입이 이미 있으면 등록하지 않음(map-events.js:15-24 등) |
| map-layers | `js/modules/map/map-layers.js` | 46 | `switchLayer`(map-layers.js:5), `toggleOverlay`(map-layers.js:19) |
| map-tools | `js/modules/map/map-tools.js` | 86 | 디버깅용 `mapTools`(map-tools.js:6-81) |
| map-measure | `js/modules/map/map-measure.js` | 1339 | 거리/면적/반경/각도 측정(map-measure.js:256, 655, 761, 415), 측정 레이어(map-measure.js:66), 측정 팝업(map-measure.js:1008) |
| map-roadview | `js/modules/map/map-roadview.js` | 490 | 카카오 로드뷰 피커(map-roadview.js:312)와 전체 화면 iframe(map-roadview.js:22) |
| map-wfs | `js/modules/map/map-wfs.js` | 2227 | 자사 백엔드 기반 POI 벡터 레이어 6종(map-wfs.js:24-121). 로딩, 캐시, 팝업, HLS CCTV 담당 |
| map-wms | `js/modules/map/map-wms.js` | 383 | GeoServer WMS 편의점 레이어 1종(map-wms.js:10-18) |
| map-area-selector | `js/modules/map/map-area-selector.js` | 698 | 영역 선택, 캡처, Fabric 편집기 새 창 열기 |
| load-view | `html/loadview/load-view.html` | 267 | 로드뷰 팝업 페이지(iframe으로 삽입됨) |
| fabric-editor | `html/fabric/fabric-editor.html` | 4007 | Fabric.js 편집기 팝업 페이지 |

> 참고: 대상 목록에는 없지만 `js/modules/map/map-core.test.js`(214줄, `node:test` 기반)가 저장소에 있음. (i) 참고.

---

## (b) map.js가 등록하는 `window.*` 목록 (31개, map.js:91-123)

| # | 전역 이름 | 원본 모듈 | 원본 함수/값 | 근거 |
|---:|---|---|---|---|
| 1 | `mapInstance` | map-core | `getMap()` 반환값. 모듈 평가 시점에 호출되므로 **undefined** | map.js:91 |
| 2 | `MapEventManager` | map-events | `MapEventManager` | map.js:92 |
| 3 | `mapTools` | map-tools | `mapTools` | map.js:93 |
| 4 | `switchLayer` | map-layers | `switchLayer` | map.js:94 |
| 5 | `toggleOverlay` | map-layers | `toggleOverlay` | map.js:95 |
| 6 | `measureDistance` | map-measure | `measureDistance` | map.js:96 |
| 7 | `measureArea` | map-measure | `measureArea` | map.js:97 |
| 8 | `measureRadius` | map-measure | `measureRadius` | map.js:98 |
| 9 | `measureAngle` | map-measure | `measureAngle` | map.js:99 |
| 10 | `clearMeasurements` | map-measure | `clearMeasurements` | map.js:100 |
| 11 | `createMeasurePopup` | map-measure | `createMeasurePopup` | map.js:101 |
| 12 | `closeMeasurePopup` | map-measure | `closeMeasurePopup` | map.js:102 |
| 13 | `deleteMeasure` | map-measure | `deleteMeasure` | map.js:103 |
| 14 | `drawRoadView` | map-roadview | `drawRoadView` | map.js:104 |
| 15 | `enableRoadviewPicker` | map-roadview | `enableRoadviewPicker` | map.js:105 |
| 16 | `disableRoadviewPicker` | map-roadview | `disableRoadviewPicker` | map.js:106 |
| 17 | `toggleRoadviewBtn` | map-roadview | `toggleRoadviewBtn` | map.js:107 |
| 18 | `toggleWfsLayer` | map-wfs | `toggleWfsLayer` | map.js:108 |
| 19 | `toggleWmsLayer` | map-wms | `toggleWmsLayer` | map.js:109 |
| 20 | `toggleConvenienceStore` | map-wfs | `toggleConvenienceStore` | map.js:110 |
| 21 | `togglePharmacy` | map-wfs | `togglePharmacy` | map.js:111 |
| 22 | `toggleHospital` | map-wfs | `toggleHospital` | map.js:112 |
| 23 | `clearAllWfsLayers` | map-wfs | `clearAllWfsLayers` | map.js:113 |
| 24 | `queryWfsFeaturesAt` | map-wfs | `queryWfsFeaturesAt` | map.js:114 |
| 25 | `getWfsLayerInfo` | map-wfs | `getWfsLayerInfo` | map.js:115 |
| 26 | `displayWfsFeatureInfo` | map-wfs | `displayWfsFeatureInfo` | map.js:116 |
| 27 | `showWfsPopup` | map-wfs | `showWfsPopup` | map.js:117 |
| 28 | `closeWfsPopup` | map-wfs | `closeWfsPopup` | map.js:118 |
| 29 | `showWmsPopup` | map-wms | `showWmsPopup` | map.js:119 |
| 30 | `closeWmsPopup` | map-wms | `closeWmsPopup` | map.js:120 |
| 31 | `testPharmacyHospitalApis` | map-wfs | 자기 자신을 다시 대입(no-op). 실제 등록은 map-wfs.js:2197 | map.js:123 |

### map.js 밖에서 모듈이 직접 등록하는 전역(참고)

위 31개 중 대부분(#2~#30)은 각 모듈이 **스스로도 똑같이 등록**함(map-events.js:267, map-tools.js:84, map-layers.js:41-42, map-measure.js:1320-1327, map-roadview.js:478-481, map-wfs.js:2163-2175, map-wms.js:379-381). 아래 전역은 **map.js에는 없고** 모듈에서만 등록됨.

| 전역 | 등록 위치 |
|---|---|
| `getMap` | map-core.js:155 |
| `baseLayers`, `overlayLayers`, `measureLayers` (데이터) | map-core.js:91-95 |
| `getCurrentLayer`, `getAllLayers` | map-layers.js:43-44 |
| `toggleBusStop`, `toggleCctv`, `toggleGovernmentOffice` | map-wfs.js:2165-2169 |
| `showParkingInfo`, `showRestroomInfo`, `showWifiInfo`, `showAtmInfo`, `showBusInfo`, `showSubwayInfo`, `showTrafficInfo`, `showCctvInfo`, `showNearbyConvenienceStores`, `showConvenienceStoreSearch`, `showConvenienceStoreFilter`, `showConvenienceStoreInfo`, `testWfsUrl` | map-wfs.js:2178-2196 |
| `wfsLayers`, `wfsActive`, `wfsDataCache`, `wfsVectorSources`, `wfsDataLoaded`, `wfsLayersInitialized` (데이터) | map-wfs.js:596-604 |
| `wmsLayers`, `wmsActive` (데이터) | map-wms.js:141-142 |
| `startAreaSelection`, `stopAreaSelection`, `clearAreaSelection`, `openFabricEditor`, `initializeAreaSelector`, `startMapEdit`, `closeEditPopup` | map-area-selector.js:684-690 |
| `toggleTransportSubmenu`, `toggleAmenitiesSubmenu`, `toggleConvenienceSubmenu` | ui.js:353, 375, 385 (`initializeLayerPanel()` 실행 중에 등록) |
| `hideLoading` | ui.js:696 |

---

## (c) js/app.js 초기화 순서와 가드 플래그

| 순서 | 단계 | 근거 | 지연 |
|---:|---|---|---|
| 1 | 모듈 평가: import 순서대로 각 모듈의 최상위 `window.*` 등록이 실행됨 (map-core → map-events → map-layers → map-tools → map-measure → map-roadview → map-wfs → map-wms → map.js → ui → map-area-selector) | app.js:2-10, map.js:2-41, map.js:91 | 0 |
| 2 | `DOMContentLoaded` 리스너 실행 | app.js:13 | 0 |
| 3 | `window.appInitialized`가 true면 return | app.js:17 | 0 |
| 4 | `initializeMapWithModules()` | app.js:22 | 0 |
| 4-1 | `mapModulesInitialized` 또는 `mapInitializationInProgress`가 true면 `getMap()`을 반환하고 종료 | map.js:48, 54 | 0 |
| 4-2 | `mapInitializationInProgress = true` | map.js:60 | 0 |
| 4-3 | `initializeMap()`: 레이어, 뷰, `setupMapEventListeners()`, `window.baseLayers/overlayLayers/measureLayers` | map.js:63, map-core.js:8-98 | 0 |
| 4-4 | `initializeMeasureTools()` | map.js:66 | 0 |
| 4-5 | `initializeWfsLayers()`: 로컬 `wfsInitialized`와 `window.wfsLayersInitialized` 가드 | map.js:69, map-wfs.js:310, 316 | 0 |
| 4-6 | `initializeWmsLayers()` (가드 없음) | map.js:72 | 0 |
| 4-7 | `mapModulesInitialized = true`, `mapInitializationInProgress = false` | map.js:75-76 | 0 |
| 5 | `initializeNavigation()` | app.js:23 | 0 |
| 6 | `initializeLayerPanel()`: 이 안에서 `loadviewBtn.onclick = null`(ui.js:340) 실행 | app.js:24 | 0 |
| 7 | `initializeHeaderToggle()` | app.js:25 | 0 |
| 8 | `window.appInitialized = true` | app.js:33 | 0 |
| 9 | 첫 `postrender` 후 500ms 뒤 `.loaded` 클래스 추가, `window.hideLoading()` 호출 (그 안에서 300ms 뒤 숨김) | map-core.js:118-145, ui.js:688-693 | 500 (+300) |
| 10 | `MapEventManager.debugHandlers()` | map.js:81-85 | 1000 |
| 11 | `initializeAreaSelector()` | app.js:28-30 | 1000 |

**가드 플래그**

| 플래그 | 검사 | 설정 | 해제 |
|---|---|---|---|
| `window.appInitialized` | app.js:17 | app.js:33 | 없음 |
| `window.mapModulesInitialized` | map.js:48 | map.js:75 | 없음 |
| `window.mapInitializationInProgress` | map.js:54 | map.js:60 | map.js:76 |
| `wfsInitialized` (모듈 로컬) | map-wfs.js:310 | map-wfs.js:603 | 없음 |
| `window.wfsLayersInitialized` | map-wfs.js:316 | map-wfs.js:604 | 없음 |

유의할 점:
- `appInitialized`는 초기화가 **끝난 뒤에야** 설정됨(app.js:33). 따라서 이 플래그는 "진행 중" 상태를 막지 못함.
- `mapInitializationInProgress`는 try/finally로 감싸져 있지 않음. 중간에 예외가 나면 true로 남음(map.js:60-76).
- `initializeWmsLayers()`와 `initializeAreaSelector()`에는 자체 중복 가드가 없음.

---

## (d) MapEventManager에 등록되는 핸들러 id

### 실제로 등록되는 핸들러 (10개)

| id | 모듈 | 이벤트 타입 | 등록 메서드 | 근거 |
|---|---|---|---|---|
| `wfs-move-convenience_store` | map-wfs | moveend | registerMoveHandler | map-wfs.js:446-447 (`` `wfs-move-${layerName}` ``, WFS_CONFIG 키마다 반복 map-wfs.js:331) |
| `wfs-move-bus_stop` | map-wfs | moveend | registerMoveHandler | map-wfs.js:447 |
| `wfs-move-cctv` | map-wfs | moveend | registerMoveHandler | map-wfs.js:447 |
| `wfs-move-pharmacy` | map-wfs | moveend | registerMoveHandler | map-wfs.js:447 |
| `wfs-move-hospital` | map-wfs | moveend | registerMoveHandler | map-wfs.js:447 |
| `wfs-move-government_office` | map-wfs | moveend | registerMoveHandler | map-wfs.js:447 |
| `wfs-general-click` | map-wfs | click | registerClickHandler | map-wfs.js:537 |
| `wfs-pointer-move` | map-wfs | pointermove | registerPointerMoveHandler | map-wfs.js:560-561 |
| `wms-single-click` | map-wms | singleclick | registerSingleClickHandler | map-wms.js:69-70 |
| `wms-pointer-move` | map-wms | pointermove | registerPointerMoveHandler | map-wms.js:114-115 |

### 코드에는 있지만 호출되지 않는 등록 (dead code, JSON의 `eventHandlers`에서는 제외)

`registerMeasureEventListeners()`(map-measure.js:6-39)를 호출하는 곳이 없음.

| id | 이벤트 타입 | 근거 |
|---|---|---|
| `measure-contextmenu` | contextmenu | map-measure.js:9 |
| `measure-pointermove` | pointermove | map-measure.js:15 |
| `measure-click` | click | map-measure.js:20 |
| `measure-angle-finish` | click | map-measure.js:23 |
| `measure-radius-finish` | click | map-measure.js:26 |
| `measure-pre-move` | pointermove | map-measure.js:30 |
| `measure-completed-cancel` | contextmenu | map-measure.js:36 |

### MapEventManager를 거치지 않는 직접 리스너 (참고)

| 모듈 | 대상/이벤트 | 근거 |
|---|---|---|
| map-core | map `pointermove` (좌표 표시) | map-core.js:103 |
| map-core | map `postrender` (once) | map-core.js:118 |
| map-core | DOM `contextmenu` (#map, .map-container) | map-core.js:77, 84 |
| map-wfs | view `change:resolution` ×6 (레이어마다) | map-wfs.js:430 |
| map-measure | map `click`/`pointermove`/`contextmenu`, `drawstart`/`drawend`, document `keydown` | map-measure.js:333, 336, 347, 352, 406-407, 545-549, 646-650, 704-707, 752-753, 858-868, 991-992, 1000-1002 |
| map-roadview | map `moveend`, view `change:resolution` (unByKey로 해제) | map-roadview.js:418-420, 443-450 |
| map-roadview | document `keydown` (ESC) | map-roadview.js:130, 380 |
| map-area-selector | map `click`, `pointermove` (해제 코드 없음) | map-area-selector.js:674, 677 |

---

## (e) 레이어 목록

| 이름 | 타입 | 생성 모듈 | 소스 URL 패턴 | zIndex | 기본 visible | 근거 |
|---|---|---|---|---|---|---|
| `common_map` (일반 지도) | XYZ (ol.layer.Tile) | map-core | `https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png` | 미지정 | true | map-core.js:11-20 |
| 위성 영상 (`name` 속성 없음, 키 `satellite`) | XYZ | map-core | `https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg` | 미지정 | false | map-core.js:21-29 |
| `hybrid_overlay` | XYZ (overlay) | map-core | `https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png` | 미지정 | false | map-core.js:34-43 |
| `measureLayer` | Vector | map-measure | 없음 | 미지정 | 미지정 | map-measure.js:65-90 |
| `convenience_store` | WFS (ol.layer.Vector + fetch GeoJSON) | map-wfs | `getApiUrl("/map/convenience-store")` | 1000 | false | map-wfs.js:26, 414-422 |
| `bus_stop` | WFS | map-wfs | `getApiUrl("/map/busStop-info")` | 1000 | false | map-wfs.js:42, 414-422 |
| `cctv` | WFS | map-wfs | `getApiUrl("/map/cctv-info")` | 1000 | false | map-wfs.js:58, 414-422 |
| `pharmacy` | WFS | map-wfs | `getApiUrl("/map/pharmacy-info")` | 1000 | false | map-wfs.js:74, 414-422 |
| `hospital` | WFS | map-wfs | `getApiUrl("/map/hospital-info")` | 1000 | false | map-wfs.js:90, 414-422 |
| `government_office` | WFS | map-wfs | `getApiUrl("/map/governmentOffice-info")` | 1000 | false | map-wfs.js:106, 414-422 |
| `ne:convenience_store` | WMS (ol.layer.Tile + TileWMS) | map-wms | `https://geoserver.sj-lab.co.kr/geoserver/ne/wms` | 1000 (`setZIndex`) | false | map-wms.js:12-13, 29-55 |
| `tempRectangle` (동적 생성) | Vector | map-area-selector | 없음 | 999 | 미지정 | map-area-selector.js:232-237 |
| `selectionRectangle` (동적 생성) | Vector | map-area-selector | 없음 | 1000 | 미지정 | map-area-selector.js:293-298 |

- `getApiUrl()`: hostname이 `localhost` 또는 `127.0.0.1`이면 `http://localhost:8100`, 아니면 `https://api.sj-lab.co.kr`을 사용함(map-wfs.js:14-21).
- WMS 파라미터는 `TILED: true`, `BUFFER: 50`, `FEATURE_COUNT: 10`(map-wms.js:37-39)로 문서와 일치함.
- WFS 레이어 옵션은 `updateWhileAnimating/Interacting: false`, `declutter: true`(map-wfs.js:419-421)이고, 아이콘은 `anchor [0.5, 1.0]`, `size/imgSize [32, 32]`(map-wfs.js:375-384)로 문서와 일치함.
- "미지정"은 코드에서 해당 옵션을 넘기지 않았다는 뜻이며, 이때는 OpenLayers 기본값이 적용됨. JSON에서는 `null`로 표기함.

---

## (f) 모듈 간 의존관계

### import

```
index.html ──<script type=module>──▶ app
app ──▶ map, ui, map-area-selector, helpers(미사용)
map ──▶ map-core, map-events, map-layers, map-tools, map-measure, map-roadview, map-wfs, map-wms
map-events, map-tools, map-roadview, map-area-selector ──▶ map-core
map-measure, map-wfs, map-wms ──▶ map-core, map-events
```
근거: app.js:2-10, map.js:2-41, map-events.js:2, map-tools.js:2, map-measure.js:2-3, map-roadview.js:2, map-wfs.js:2-3, map-wms.js:2-3, map-area-selector.js:2. `ui.js`는 import가 하나도 없음.

### window 전역을 거치는 호출

| from → to | 전역 | 근거 |
|---|---|---|
| map-core → ui | `window.hideLoading()` | map-core.js:141-142 → ui.js:696 |
| map-layers → map-core | `window.baseLayers`, `window.overlayLayers` | map-layers.js:7-35 → map-core.js:91-92 |
| map-measure → map-core | `window.measureLayers` | map-measure.js:93-94 → map-core.js:95 |
| map-wfs → map-wms | `window.wmsLayers`, `window.wmsActive`, `window.toggleWmsLayer` | map-wfs.js:853-857(외 910, 967, 1032, 1100, 1168) → map-wms.js:141-142, 379 |
| ui → map-core | `window.mapInstance.updateSize()` | ui.js:101-108, 155 |
| ui → map-layers | `switchLayer`, `toggleOverlay` | ui.js:253, 261, 647-656 |
| ui → map-measure | `clearMeasurements`, `measureRadius/Area/Distance/Angle` | ui.js:310-311, 599-618 |
| ui → map-roadview | `enableRoadviewPicker`, `disableRoadviewPicker`, `drawRoadView` | ui.js:344-347, 623-625 |
| ui → map-wfs | `toggleConvenienceStore`, `toggleBusStop`, `toggleCctv`, `togglePharmacy`, `toggleHospital`, `toggleGovernmentOffice`, `show*Info` | ui.js:397-584 |
| ui → map-area-selector | `startMapEdit` | ui.js:368-369 |
| ui, map-roadview → index.html | `window.KAKAO_APP_KEY` | ui.js:342, 624 / map-roadview.js:57, 200, 317 → index.html:557 |
| map-wfs → hls.js(벤더) | `window.Hls` | map-wfs.js:1718-1739, index.html:553 |
| index.html → map-roadview / ui | 인라인 onclick | (g) 참고 |

### 팝업

| from → to | 방식 | 근거 |
|---|---|---|
| map-roadview → load-view | `<iframe src="html/loadview/load-view.html?...">` | map-roadview.js:104-121 |
| map-area-selector → fabric-editor | `window.open(...)` 후 `editorWindow.loadMapAreaImage()` 호출 | map-area-selector.js:614-641 |

---

## (g) 인라인 onclick이 호출하는 전역 함수와 등록 여부

### index.html

| 함수 | 위치 | 등록 여부 | 등록 위치 | 비고 |
|---|---|---|---|---|
| `toggleRoadviewBtn` | index.html:200 | ✅ | map-roadview.js:481, map.js:107 | `initializeLayerPanel()`이 `onclick = null`로 지움(ui.js:340). 초기화 이후에는 인라인 핸들러가 동작하지 않음 |
| `toggleAmenitiesSubmenu` | index.html:208 | ✅ | ui.js:375 | map.js에는 없음. `initializeLayerPanel()`이 실행되기 전에 누르면 ReferenceError 가능 |
| `toggleTransportSubmenu` | index.html:216 | ✅ | ui.js:353 | 위와 같음 |

### JS가 만드는 HTML 속의 인라인 onclick

| 함수 | 위치 | 등록 여부 | 등록 위치 |
|---|---|---|---|
| `closeWmsPopup` | map-wms.js:197 | ✅ | map-wms.js:381, map.js:120 |
| `closeWfsPopup` | map-wfs.js:1339, 1438, 1528, 1617, 1655, 1680 | ✅ | map-wfs.js:2175, map.js:118 |
| `closeMeasurePopup` | map-measure.js:1034 | ✅ | map-measure.js:1326, map.js:102 |
| `deleteMeasure` | map-measure.js:1040 | ✅ | map-measure.js:1327, map.js:103 |
| `closeEditPopup` | map-area-selector.js:337 | ✅ | map-area-selector.js:690 |
| `clearAreaSelection` | map-area-selector.js:342 | ✅ | map-area-selector.js:686 |
| `openFabricEditor` | map-area-selector.js:343 | ✅ | map-area-selector.js:687 |

어디에도 등록되지 않은 인라인 전역 함수는 발견되지 않음. 다만 `window.toggleCadastralLayer`는 ui.js:319에서 조건부로 참조되는데, 할당하는 코드가 없음.

---

## (h) 팝업 페이지 연결

| 페이지 | 여는 모듈 | 전달 방식 | 받는 쪽 |
|---|---|---|---|
| `html/loadview/load-view.html` | map-roadview (`drawRoadView`, map-roadview.js:22) | 쿼리스트링 `lat`, `lng`, `radius`, `zoom`, `appkey`(map-roadview.js:105-114). `#roadviewPanel` 전체 화면 컨테이너(z-index 3000, map-roadview.js:69-78) 안의 iframe | `URLSearchParams`로 `lat`/`lng`/`appkey` 읽기(load-view.html:93-98), `zoom` 읽기(load-view.html:193). `radius`를 읽는 코드는 없음 |
| `html/fabric/fabric-editor.html` | map-area-selector (`openFabricEditorWithImage`, map-area-selector.js:602) | `window.open(..., "fabric-editor", ...)`(map-area-selector.js:614-618) 후 300ms 간격으로 최대 15회 폴링. `editorWindow.showLoadingMessage()`, `editorWindow.loadMapAreaImage(dataURL)` 호출(map-area-selector.js:621-651) | `window.loadMapAreaImage`(fabric-editor.html:3552, 3997), `window.showLoadingMessage`(fabric-editor.html:3893, 4001) |

진입 경로:
- 로드뷰: 사이드 탭 `#loadviewBtn` 클릭 → `enableRoadviewPicker()`(ui.js:341-349) → 카카오 오버레이 클릭 → `getNearestPanoId` → `window.drawRoadView()`(map-roadview.js:354-370)
- 지도 캡처: `#mapEditBtn` 클릭 → `startMapEdit()`(ui.js:363-371) → 두 번 클릭해 영역 선택(map-area-selector.js:149-171) → 확인 팝업 → `openFabricEditor()` → `captureMapArea()`(map-area-selector.js:491)

---

## (i) 발견한 위험과 불일치

| 심각도 | 제목 | 내용 | 근거 |
|---|---|---|---|
| **high** | `window.mapInstance`가 항상 undefined | map.js:91과 map-core.js:154가 `initializeMap()` 호출 **전**인 모듈 평가 시점에 할당하고, 이후 다시 할당하는 코드가 없음. 그래서 ui.js의 `updateSize()`가 전혀 실행되지 않음(헤더 토글, 페이지 전환 시 캔버스 크기 미갱신 가능). CLAUDE.md의 디버그 진입점도 동작하지 않음. 코드만 보고 판단했으며 런타임 확인은 하지 않음 | map.js:91, map-core.js:154, ui.js:101-108, 155 |
| medium | WFS 캐시 경로에서 줌별 최대 개수 제한이 빠짐 | 캐시가 있을 때 벡터 소스가 비어 있으면 `wfsDataCache` 전체를 필터 없이 추가함. 다음 `moveend`가 올 때까지 `getMaxFeaturesByZoom`/`spatialSampling` 가드가 적용되지 않아 docs 규칙과 어긋남 | map-wfs.js:638-660 |
| medium | 로드뷰 버튼 onclick 무력화와 이중 리스너 | 인라인 `toggleRoadviewBtn`이 제거되고, active 클래스 토글과 피커 토글 리스너 2개가 따로 붙음. ESC로 피커를 끄면 버튼 active 상태가 맞지 않게 됨 | index.html:200, ui.js:328-349, map-roadview.js:375-377 |
| medium | zIndex 충돌 또는 미지정 | WFS, WMS, 영역 선택 사각형이 모두 1000이라 추가 순서에 따라 겹침 순서가 정해짐. 측정 레이어는 zIndex가 없어 POI 아래에 그려질 수 있음 | map-wfs.js:422, map-wms.js:55, map-area-selector.js:295, map-measure.js:66 |
| medium | 영역 선택 초기화에 중복 가드 없음 | `map.on`으로 직접 등록하고, 가드 바깥의 setTimeout에서 호출됨. `window.initializeAreaSelector`로 다시 호출하면 리스너가 중복됨 | map-area-selector.js:669-677, 688, app.js:28-30 |
| medium | 배경지도 버튼이 hybrid를 toggle로 처리 | 일반/위성 버튼을 누를 때마다 `toggleOverlay("hybrid")`로 상태를 뒤집음. 초기 상태에서 '일반'을 누르면 hybrid가 켜짐 | ui.js:652-657, map-layers.js:19-23 |
| medium | 측정 모듈 MapEventManager 등록 코드가 dead code | 등록/해제 함수를 호출하는 곳이 없고, 참조하는 식별자가 모듈 스코프에 없어 호출하면 ReferenceError. 실제 측정 도구는 `map.on/un`을 직접 써서 중복 방지 레지스트리를 우회함 | map-measure.js:6-50, 265, 519, 584, 599, 920 |
| low | map.js 브리지 규칙 밖의 전역 등록 | (b) 하단 표의 전역들은 map.js에 없음. ui.js가 그중 일부(`toggleBusStop` 등)를 window로 호출하므로 모듈이 스스로 등록하는 데 의존함 | map-wfs.js:2165-2196, ui.js:441-547 |
| low | `testPharmacyHospitalApis` 자기 재대입 | 아무 효과 없는 대입 | map.js:123 |
| low | `window.toggleCadastralLayer` 미정의 | 존재를 확인하고 호출하므로 오류는 없지만 동작하지 않는 코드 | ui.js:319-320 |
| low | 존재하지 않는 WMS 레이어를 검사하는 분기 | WMS_CONFIG에는 convenience_store만 있음 | map-wfs.js:910, 967, 1032, 1100, 1168, map-wms.js:10-18 |
| low | WMS 커서 판정 부정확 | URL 생성 여부로 pointer를 결정해서 WMS가 켜져 있으면 커서가 항상 pointer. WFS 커서 핸들러와 서로 덮어씀 | map-wms.js:114-136, map-wfs.js:586-589 |
| low | debugHandlers가 설정되지 않는 값을 참조 | `view._zoomHandlers`, `window.registeredZoomHandlers`를 할당하는 코드가 없음 | map-events.js:259-260 |
| low (확인불가) | GeoJSON format 생성 옵션과 readFeatures 인자 불일치 | format 생성 시에는 뷰 투영을 넘기고(map-wfs.js:339), readFeatures에는 `null`을 넘김(map-wfs.js:703). `null`이 format 기본값을 덮어쓰는지는 OpenLayers 내부 동작이라 저장소 코드만으로 확인할 수 없음. 문서는 무변환 동작에 의존한다고 명시함 | map-wfs.js:336-342, 700-703, 746-749 |
| low | `mapInitializationInProgress`가 true로 고착될 수 있음 | try/finally가 없음 | map.js:60-76 |
| low | 카카오 앱 키 하드코딩 중복 | index.html과 load-view.html 폴백에 같은 키가 있음. 외부 URL(VWorld/GeoServer/Kakao SDK)은 문서화된 패턴임. WFS는 6개 모두 `getApiUrl()`을 거치므로 **하드코딩 위반은 없음** | index.html:557, load-view.html:98, map-wfs.js:26-106 |
| low | load-view.html이 `radius`를 사용하지 않음 | 보내기만 하고 받는 쪽에서 읽지 않음 | map-roadview.js:108, load-view.html:93-98 |
| low | 팝업 innerHTML에 서버 값이 이스케이프 없이 들어감 | WMS 팝업에서 확인함. WFS 팝업 템플릿 전체는 상세히 검토하지 않음 | map-wms.js:202-213 |
| low | app.js 미사용 import | `hideLoading`, `makeAjaxRequest`, `utils` | app.js:6, 10 |
| low | 문서와 저장소 불일치(테스트) | CLAUDE.md는 테스트가 없다고 하지만 `node:test` 파일이 있음 | js/modules/map/map-core.test.js:1-9 |
| low (확인불가) | 로고 클릭 시 `/map`으로 이동 | 정적 서버에 해당 경로가 있는지 코드로는 확인할 수 없음 | ui.js:283-291 |

### 문서와 일치함을 확인한 항목
- MapEventManager는 같은 id와 같은 타입이면 조용히 무시함(map-events.js:15-24).
- WFS 최초 로드는 뷰포트 사전 필터링 → 초기 파싱 → `requestIdleCallback` 청크 캐싱 순서로 동작함(map-wfs.js:709-784, 263-303).
- `readFeatures`의 `featureProjection`에는 `vectorSource.getProjection()`을 사용함(map-wfs.js:703).
- 서브메뉴 3개가 `CADASTRAL_SUBMENUS`에 등록되어 있음(ui.js:163-166).
- 페이지 3종은 `data-page`, `id="xxx-page"`, `.page` 규칙이 모두 맞음(index.html:158-160, 175, 499, 524).

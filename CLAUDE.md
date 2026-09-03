# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

VWorld 지도 API와 OpenLayers를 사용하는 순수 정적 웹 프론트엔드(SPA)입니다. 빌드 도구, 패키지 매니저, 번들러가 전혀 없습니다 (`package.json` 없음). OpenLayers(`js/utils/openlayers/ol.js`)와 `hls.js`도 npm이 아니라 저장소에 직접 벤더링되어 있습니다.

## 실행 / 개발 명령

빌드·린트·테스트 스크립트가 없습니다. 로컬 정적 서버로 띄우고 브라우저에서 바로 확인하는 것이 유일한 개발 루프입니다 (ES 모듈 `import`를 쓰므로 `file://`로 열면 CORS 오류가 납니다):

```bash
python -m http.server 8000
# 또는
npx serve .
```

브라우저 콘솔에서 즉시 확인 가능한 디버그 진입점 (`js/modules/map/map.js`가 전역에 노출):

```javascript
window.mapInstance   // OpenLayers Map 인스턴스
window.mapTools.flyTo([127.0, 37.5], 15)
window.MapEventManager.debugHandlers()
```

## 아키텍처

### 모듈 통합 방식 — window 전역 객체가 진짜 API 경계

번들러가 없고 `index.html`의 `onclick="toggleRoadviewBtn()"` 같은 인라인 핸들러가 다수 존재하기 때문에, ES 모듈 간 실제 통합 지점은 `import`가 아니라 **`window` 전역 객체**입니다. `js/modules/map/map.js`는 각 하위 모듈(`map-core`, `map-events`, `map-layers`, `map-tools`, `map-measure`, `map-roadview`, `map-wfs`, `map-wms`)을 import한 뒤 그 함수 대부분을 `window.*`에 재할당하는 "배럴/브리지" 파일입니다. 새 지도 기능을 추가해 인라인 HTML이나 다른 모듈에서 호출해야 한다면, 반드시 이 패턴을 따라 `map.js`에서 `window`에 등록해야 합니다.

`js/app.js`가 최상위 초기화 순서를 담당합니다: `initializeMapWithModules()` → `initializeNavigation()` → `initializeLayerPanel()` → `initializeHeaderToggle()` → (1초 뒤 `setTimeout`) `initializeAreaSelector()`. `window.appInitialized` / `window.mapModulesInitialized` / `window.mapInitializationInProgress` 플래그로 중복 초기화를 막고 있으므로, 초기화 로직을 건드릴 때는 이 가드들을 유지해야 합니다.

## 반드시 지킬 것

- 인라인 HTML(`onclick=...`)이나 다른 모듈에서 호출해야 하는 새 함수는 `js/modules/map/map.js`에서 `window.*`에 등록할 것. 등록을 빠뜨리면 모듈 안에서만 동작하고 인라인 핸들러에서는 `ReferenceError`가 남.
- `window.appInitialized` / `window.mapModulesInitialized` / `window.mapInitializationInProgress` 가드를 제거·우회하지 말 것 — `DOMContentLoaded`가 중복 발생하거나 모듈이 재호출되면 이벤트 리스너·레이어가 중복 등록됨.
- 존재하지 않는 빌드/린트/테스트 명령을 만들어내지 말 것. 변경 검증은 정적 서버(`python -m http.server`)로 띄운 뒤 브라우저에서 직접 확인.

## 참고

역할별 상세 내용은 아래 파일에 분리되어 있습니다. 관련 작업 시 해당 파일을 먼저 확인하세요.

- @docs/map-architecture.md — 지도 모듈(`js/modules/map/`) 파일별 역할, WFS/WMS 설정, 팝업 페이지 연결
- @docs/ui-conventions.md — SPA 페이지 전환, 레이어 패널 탭 구조, CSS 구성
- @docs/external-services.md — VWorld/자사 백엔드/GeoServer/카카오맵 등 외부 연동 목록

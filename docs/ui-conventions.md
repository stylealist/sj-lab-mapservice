# UI / 레이아웃

- `index.html`은 SPA 형태로 `.page` 3개(지도/소개/연락처)를 갖고, `js/modules/ui.js`가 `data-page` 버튼 클릭에 따라 `.active` 클래스로 전환합니다. 지도 페이지 안에서도 우측 레이어 패널(`layer-panel.css`)이 탭(길찾기/레이어/검색/즐겨찾기/측정/그리기/내보내기) 구조인데, 실제 동작이 구현된 것은 지도·측정·레이어 관련 일부이고 나머지는 정적 마크업만 있는 상태이니 새 기능을 넣을 때 기존 탭 중 어디에 실제 로직이 연결돼 있는지 먼저 확인하세요.
- `css/`는 `layouts/`(전역 레이아웃)와 `components/`(header, layer-panel, map-controls)로만 나뉘어 있고, `index.html` 안에도 CCTV 팝업·지도편집 탭용 `<style>` 블록이 인라인으로 남아 있습니다.
- `js/utils/helpers.js`는 AJAX 요청 래퍼와 좌표 변환/거리 계산 등 범용 유틸을 제공합니다.

## 반드시 지킬 것

- 새 SPA 페이지를 추가할 때는 `js/modules/ui.js`의 `navigateToPage()`가 인식하는 3요소(네비 버튼의 `data-page="xxx"`, 대상 div의 `id="xxx-page"`, 버튼/div에 각각 `.nav-btn`/`.page` 클래스)를 정확히 맞출 것 — 하나라도 어긋나면 `getElementById(pageName + "-page")`가 `null`을 반환해 페이지 전환이 조용히 실패함.
- 지도 컨테이너의 크기나 표시 여부가 바뀌는 모든 UI 동작(헤더 토글, 페이지 전환 등)은 반드시 `window.mapInstance.updateSize()`를 호출해야 합니다(`initializeHeaderToggle`, `navigateToPage`에서 이미 이렇게 함). 빠뜨리면 OpenLayers 캔버스가 실제 컨테이너 크기를 못 따라가 지도가 잘리거나 빈 영역이 생김.
- 레이어 패널 탭은 `.tab-btn[data-tab]` ↔ `.tab-pane`이 `switchTab()`으로 짝지어 전환됩니다. 새 탭을 추가할 때 이 `data-tab` 값과 대상 `.tab-pane`의 짝을 맞출 것.

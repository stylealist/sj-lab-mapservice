# UI / 레이아웃

- `index.html`은 SPA 형태로 `.page` 3개(지도/소개/연락처)를 갖고, `js/modules/ui.js`가 `data-page` 버튼 클릭에 따라 `.active` 클래스로 전환합니다. 지도 페이지 안에서도 우측 레이어 패널(`layer-panel.css`)이 탭(길찾기/레이어/검색/즐겨찾기/측정/그리기/내보내기) 구조인데, 실제 동작이 구현된 것은 지도·측정·레이어 관련 일부이고 나머지는 정적 마크업만 있는 상태이니 새 기능을 넣을 때 기존 탭 중 어디에 실제 로직이 연결돼 있는지 먼저 확인하세요.
- `css/`는 `layouts/`(전역 레이아웃)와 `components/`(header, layer-panel, map-controls)로만 나뉘어 있고, `index.html` 안에도 CCTV 팝업·지도편집 탭용 `<style>` 블록이 인라인으로 남아 있습니다.
- `js/utils/helpers.js`는 AJAX 요청 래퍼와 좌표 변환/거리 계산 등 범용 유틸을 제공합니다.
- **탭 아이콘(favicon)**: `images/favicon.svg` 하나를 `index.html`과 독립 팝업 페이지(`html/loadview/load-view.html`, `html/fabric/fabric-editor.html`, 상대 경로 `../../images/favicon.svg`)가 함께 씁니다. 헤더 로고 배지(`.logo-mark`, `header.css`)와 같은 모양(파란 그라데이션 둥근 사각형 + 흰색 로고 글리프)을 SVG로 옮긴 것이므로, **로고 글리프나 배지 색을 바꾸면 이 파일도 같은 작업에서 고칠 것**. favicon은 `currentColor`를 상속받지 못하므로 색은 파일 안에 직접 적습니다. 새 HTML 페이지를 추가하면 `<link rel="icon">`도 넣을 것.

## 반드시 지킬 것

- 새 SPA 페이지를 추가할 때는 `js/modules/ui.js`의 `navigateToPage()`가 인식하는 3요소(네비 버튼의 `data-page="xxx"`, 대상 div의 `id="xxx-page"`, 버튼/div에 각각 `.nav-btn`/`.page` 클래스)를 정확히 맞출 것 — 하나라도 어긋나면 `getElementById(pageName + "-page")`가 `null`을 반환해 페이지 전환이 조용히 실패함.
- 지도 컨테이너의 크기나 표시 여부가 바뀌는 모든 UI 동작(헤더 토글, 페이지 전환 등)은 반드시 `window.mapInstance.updateSize()`를 호출해야 합니다(`initializeHeaderToggle`, `navigateToPage`에서 이미 이렇게 함). 빠뜨리면 OpenLayers 캔버스가 실제 컨테이너 크기를 못 따라가 지도가 잘리거나 빈 영역이 생김.
- 레이어 패널 탭은 `.tab-btn[data-tab]` ↔ `.tab-pane`이 `switchTab()`으로 짝지어 전환됩니다. 새 탭을 추가할 때 이 `data-tab` 값과 대상 `.tab-pane`의 짝을 맞출 것.
- **시설물 탭 및 행정구역 연쇄 select 컨벤션**:
  - 시설물 탭(`.tab-pane#facility-tab`)은 기본 활성화(`active`) 탭으로 제공되며, `#panelTitle`의 기본값은 "시설물"입니다.
  - 상단 행정구역 연쇄 select(시도 → 시군구 → 읍면동)는 각각 `전체` 옵션을 포함하며, 상위 select가 변경되면 하위 select를 초기화(비활성화)하고 가장 구체적인 행정구역 코드(또는 전체)로 시설물 목록과 지도를 재조회합니다. 구역 선택 시 해당 구역 extent(패딩 포함)로 지도를 이동(fit)합니다.
  - 대량 피처(약 2,474건) 렌더링 시 `DocumentFragment`를 사용하고 XSS 방지를 위해 텍스트는 `textContent`로 삽입합니다.
  - **목록 항목 구조**: `아이콘(30px) | 이름 + 소속 | 배지` 3단 그리드(`.facility-item`). 아이콘은 지도 핀과 같은 SVG를 `buildFacilityIconUrl()`로 만들어 쓰고, 소속(`.facility-sub`)은 `inst_nm · daddr`입니다 — 같은 이름이 반복되므로 이 줄이 실질적인 구분 기준이니 빼지 말 것.
  - **검색**: `#facilityKeyword` 입력은 서버를 다시 부르지 않고 `renderFacilityList()`가 이름·소속 부분일치로 걸러 다시 그립니다(원본은 `facilityListItems`에 보관). 행정구역 select 변경만 서버를 재조회합니다. 검색어는 **목록에만** 적용되고 지도 핀은 그대로입니다.
  - **보수 필요 여부 필터**: 검색창 아래 세그먼트 버튼(`#facilityRepairFilter`, `전체`(기본) / `보수 필요` / `보수 불필요`). 상태는 `facilityRepairFilter`(`"all"`·`"repair"`·`"noRepair"`)이고 판정은 `matchesFacilityRepairFilter()` 하나로 목록과 지도가 공유합니다.
    - `보수 필요` = `repair_required_yn === 'Y'`, `보수 불필요` = **Y가 아닌 전부**(`N`·빈 값). 실데이터 대부분이 빈 값이라 `N`만 고르면 결과가 0건이 되니 판정을 바꾸지 말 것.
    - 검색어와 달리 **지도 핀에도 적용**합니다 — `facilityStyleFunction()`이 맞지 않는 핀에 `null`을 반환(클릭·호버 대상에서도 빠짐)하고, 필터를 바꾸면 `facilitySource.changed()`로 다시 그립니다. 열려 있던 팝업의 시설물이 필터에서 빠지면 팝업을 닫습니다.
    - 버튼 옆 건수는 **검색어까지 반영한** 기준입니다(어느 쪽에 결과가 있는지 보이도록). 행정구역을 바꿔 재조회해도 선택한 필터는 유지됩니다.
    - 버튼 칸은 `grid-template-columns: auto auto auto`로 글자 길이만큼 나눕니다. 같은 너비(`1fr`)로 바꾸면 전국 조회 시 "보수 불필요 2,473"이 넘칩니다.
  - **내업 상태(보수 필요 시설물만)**: 내업은 웹에서 작성하며 보수 필요(`repair_required_yn='Y'`) 시설물만 대상입니다. 상태는 `미완료`(`PENDING`, 내업 기록 없음) / `접수`(`RECEIVED`) / `처리중`(`IN_PROGRESS`) / `완료`(`DONE`) / `보류`(`HOLD`) 다섯 가지이고, 최신 기록의 `work_status`가 현재 상태입니다. 판정은 `resolveOfficeWorkStatus(needsRepair, status)` 하나로 통일합니다(보수 불필요면 `""` = 내업 대상 아님, 보수 필요인데 값이 없으면 `PENDING`). `PENDING`은 저장값이 아니라 표시값이므로 작성 폼 선택지에 넣지 말 것.
  - **내업 상태 필터**: 보수 필요 필터에서 `보수 필요`를 골랐을 때만 보이는 한 줄 select(`#facilityOfficeFilterRow` > `#facilityOfficeSelect`, `전체`(기본) / `미완료` / `접수` / `처리중` / `완료` / `보류`, 항목 뒤에 건수). 6개 세그먼트를 늘 띄우면 패널이 복잡해 select로 둡니다. 보수 필요를 벗어나면 `syncFacilityOfficeFilterVisibility()`가 줄을 숨기고 필터를 `전체`로 되돌립니다. 상태는 `facilityOfficeFilter`(`"all"` 또는 상태 코드)이며, `전체`가 아니면 보수 필요 시설물 중 그 상태만 남습니다. 보수 필요 필터와 AND 조건으로 목록과 지도 핀에 함께 적용되고, `matchesFacilityOfficeFilter(needsRepair, status)`로 판정하며 열려 있던 팝업의 시설물이 필터에서 빠지면 팝업을 닫습니다.
  - **내업 배지 및 상세 팝업 섹션**:
    - 목록 항목: 보수 필요 시설물은 보수필요 배지 옆에 `내업 <상태>` 배지를 항상 표시합니다(완료=`.badge-office-done`, 나머지=`.status-badge-*`, 미완료=`.status-badge-pending` 붉은 계열).
    - 상세 팝업 헤더: 같은 `내업 <상태>` 배지를 붙이고, 완료일 때만 `내업 완료 · 완료일 · 담당자`로 표시합니다.
    - 상세 팝업 내업 섹션: 본문 스크롤과 상관없이 보이도록 팝업 **하단 고정 영역**(`#facilityOfficeFooter`, 레이아웃은 `docs/map-architecture.md` 참고)에 들어가며 **보수 필요 시설물에만** 생깁니다(백엔드도 그 외 시설물의 작성은 400). 이 영역에는 최신 1건 요약과 과거 이력 아코디언, `+ 내업 작성`·`수정`·`삭제` 버튼만 있고, 작성·수정 폼은 **넓은 화면이면 상세 팝업 오른쪽에 붙는 칸**, 좁은 화면이면 **상세 본문 자리**(상단 `← 상세로`)에 열립니다(판정·규칙은 `docs/map-architecture.md`의 "내업 작성·수정 칸"). 입력 중인 값이나 새로 고른 사진이 있을 때 다른 시설물을 고르거나 팝업·폼을 닫으면 "작성 중인 내업 내용이 사라집니다. 닫을까요?"로 확인하고, 바뀐 값이 없으면 바로 닫습니다. 저장에 성공하면 폼 칸이 닫힙니다. 폼 검증(상태 필수, 완료 상태 시 완료일 필수, 비용 숫자 형식)을 통과해야 저장됩니다. 저장·수정·삭제 뒤에는 내업 목록을 다시 불러와 최신 항목의 상태(0건이면 `PENDING`)로 목록 배지와 지도 핀을 동기화합니다. API 오류는 응답의 `message`를 폼에 보여줍니다.
    - 본문과 내업 영역 사이의 가로 손잡이(리사이저)를 끌거나 방향키로 내업 영역 높이를 조절할 수 있고, 조절한 높이는 팝업을 다시 열어도 유지됩니다(규칙은 `docs/map-architecture.md` 참고).
  - **내업 처리 전·후 사진(파일 업로드)**: 작성·수정 폼에는 사진 경로 텍스트 입력이 없고, 종류별(`BEFORE`/`AFTER`) 파일 선택(여러 장) + 썸네일 + 삭제 버튼 칸(`.facility-office-photo-field`)이 있습니다.
    - 제한은 **종류별 최대 5장**(`OFFICE_PHOTO_MAX_COUNT`), 장당 10MB, jpg·png·webp만입니다. 형식·장수 초과는 서버를 부르지 않고 폼 오류 문구로 알립니다.
    - 고른 파일은 바로 올리지 않고 `resizeOfficePhoto()`가 **긴 변 1600px·JPEG 품질 0.8**로 줄여(원본이 더 작으면 형식 그대로) 대기 목록에 둡니다. PNG·WEBP를 JPEG로 바꾸면 파일명 확장자도 `.jpg`로 바꿉니다(투명 영역은 흰 바탕).
    - **새 기록은 저장(POST)으로 `work_id`를 받은 뒤** 대기 사진을 순서대로 업로드하며 진행 표시(`#facilityOfficeFormProgress`)를 띄웁니다. 일부가 실패하면 기록은 저장된 상태로 두고 섹션 상단 알림(`#facilityOfficeNotice`, `showFacilityOfficeNotice()`)에 실패한 파일과 사유를 보여줍니다. 수정 시에도 PUT 뒤에 같은 방식으로 추가분을 올립니다.
    - 수정 폼은 저장된 사진을 불러와 보여주고, 저장된 사진의 × 는 확인 후 **즉시** DELETE 합니다(저장 버튼과 무관). 사진을 지운 뒤 같은 시설물에서 폼을 닫으면 카드 목록을 다시 불러옵니다(다른 시설물로 넘어가며 닫힐 때는 새 팝업에 옛 목록이 그려지지 않도록 부르지 않음).
    - 읽기 전용 카드는 저장된 사진을 썸네일로 보여주고 누르면 원본을 새 창으로 엽니다. 목록 조회는 최신 카드는 바로, 이전 이력은 아코디언을 펼칠 때 카드마다 한 번만 합니다. 사진 조회가 실패해도 기록 표시는 그대로 둡니다.
    - 예전 텍스트 경로 컬럼(`before_photo`/`after_photo`)은 과거 기록에 한해 기존처럼 링크로 보여주고, 수정(PUT, 전체 갱신) 때는 원래 값을 그대로 다시 보내 지워지지 않게 합니다.
  - **건수 표시**: 패널 제목 옆 `#panelCount`는 조회된 전체 건수, 검색 영역의 `#facilityCount`는 현재 화면에 보이는 건수입니다.
  - **기본 시·도**: 화면을 처음 열면 `DEFAULT_SIDO_CD`(현재 `"11"` 서울특별시)가 선택됩니다. `applyDefaultSido()`가 select 값을 바꾼 뒤 `change` 이벤트를 직접 발생시켜 사용자가 고른 것과 같은 경로(구역 extent로 지도 이동 → 시군구 목록 → 시설물 재조회)를 타므로, **초기화에서 `loadFacilities({})`를 따로 부르지 말 것** — 전체 조회 후 다시 시·도 조회로 요청이 두 번 나갑니다. 시도 목록 조회가 실패하거나 기본 코드가 목록에 없을 때만 전체 조회로 넘어갑니다.
  - 상태 표시(로딩 중, 빈 결과, 오류)는 인라인 `style="display:none"` 대신 CSS 클래스(`.facility-state-message.hidden`)로 제어합니다.
- 지도 우측 사이드 탭(`.cadastral-control`)의 서브메뉴(`.cadastral-submenu`)는 모두 같은 컨테이너 안에서 `position: absolute`로 겹쳐 있습니다. **`top` 값을 CSS나 인라인 스타일로 하드코딩하지 말 것** — `js/modules/ui.js`의 `toggleCadastralSubmenu()`가 트리거 버튼의 `offsetTop`에 맞춰 위치를 계산하고, 다른 서브메뉴는 닫아 영역이 겹치지 않게 합니다. 서브메뉴를 새로 추가할 때는 `CADASTRAL_SUBMENUS` 배열에 `{ buttonId, submenuId }` 짝을 등록하고 토글도 이 함수를 통할 것 — 빠뜨리면 다른 서브메뉴와 같은 위치에 열려 서로 가려집니다.

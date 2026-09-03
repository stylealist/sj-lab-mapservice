// UI 관련 모듈

// 헤더 토글 기능 초기화
function initializeHeaderToggle() {
  const header = document.getElementById("header");
  const headerToggleBtn = document.getElementById("headerToggleBtn");
  const mainContent = document.querySelector(".main-content");
  const app = document.getElementById("app");

  if (header && headerToggleBtn) {
    headerToggleBtn.addEventListener("click", function () {
      const isHidden = header.classList.contains("header-hidden");
      header.classList.toggle("header-hidden");

      // 메인 컨텐츠도 함께 이동 (헤더 높이만큼)
      if (mainContent) {
        const headerHeight = header.offsetHeight;
        if (!isHidden) {
          // 헤더가 숨겨지는 경우
          mainContent.style.transform = `translateY(-${headerHeight}px)`;
          // 메인 컨텐츠 높이를 늘려서 아래쪽 빈 공간을 완전히 채움
          mainContent.style.height = `calc(100vh + ${headerHeight}px)`;
          mainContent.style.minHeight = `calc(100vh + ${headerHeight}px)`;
          // 앱 컨테이너 높이도 조정
          if (app) {
            app.style.height = `calc(100vh + ${headerHeight}px)`;
          }
        } else {
          // 헤더가 나타나는 경우
          mainContent.style.transform = "translateY(0)";
          // 메인 컨텐츠 높이를 원래대로 복원
          mainContent.style.height = "100vh";
          mainContent.style.minHeight = "100vh";
          // 앱 컨테이너 높이도 원래대로 복원
          if (app) {
            app.style.height = "100vh";
          }
        }
      }

      // 지도 컨테이너도 부드럽게 애니메이션
      const mapContainer = document.querySelector(".map-container");
      if (mapContainer) {
        const headerHeight = header.offsetHeight;
        if (!isHidden) {
          // 헤더가 숨겨지는 경우
          mapContainer.style.height = `calc(100vh + ${headerHeight}px)`;
        } else {
          // 헤더가 나타나는 경우
          mapContainer.style.height = "100vh";
        }
      }

      // 지도 내부 요소들도 부드럽게 애니메이션
      const map = document.getElementById("map");
      if (map) {
        const headerHeight = header.offsetHeight;
        if (!isHidden) {
          // 헤더가 숨겨지는 경우
          map.style.height = `calc(100vh + ${headerHeight}px)`;
        } else {
          // 헤더가 나타나는 경우
          map.style.height = "100vh";
        }
      }

      // 애니메이션 완료 후 아이콘 변경
      setTimeout(() => {
        const toggleIcon = headerToggleBtn.querySelector(".toggle-icon");
        if (toggleIcon) {
          if (!isHidden) {
            // 헤더가 숨겨진 경우
            // 아래쪽 화살표로 변경
            toggleIcon.innerHTML = `
              <path
                d="M5 8L10 13L15 8"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            `;
          } else {
            // 헤더가 나타난 경우
            // 위쪽 화살표로 변경
            toggleIcon.innerHTML = `
              <path
                d="M5 12L10 7L15 12"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            `;
          }
        }
      }, 400); // 애니메이션 완료 후 아이콘 변경

      // 지도가 있는 경우 리사이즈 (애니메이션 중간에 한 번, 완료 후 한 번)
      setTimeout(() => {
        if (window.mapInstance) {
          window.mapInstance.updateSize();
        }
      }, 200); // 애니메이션 중간에 리사이즈

      setTimeout(() => {
        if (window.mapInstance) {
          window.mapInstance.updateSize();
        }
      }, 400); // 애니메이션 완료 후 최종 리사이즈
    });
  }
}

// 네비게이션 초기화
function initializeNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn");
  const pages = document.querySelectorAll(".page");

  navButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const targetPage = this.getAttribute("data-page");
      navigateToPage(targetPage, navButtons, pages);
    });
  });
}

// 페이지 네비게이션
function navigateToPage(pageName, navButtons, pages) {
  // 모든 페이지 숨기기
  pages.forEach((page) => {
    page.classList.remove("active");
  });

  // 모든 네비게이션 버튼 비활성화
  navButtons.forEach((btn) => {
    btn.classList.remove("active");
  });

  // 타겟 페이지 보이기
  const targetPage = document.getElementById(pageName + "-page");
  if (targetPage) {
    targetPage.classList.add("active");
  }

  // 클릭된 버튼 활성화
  const activeButton = document.querySelector(`[data-page="${pageName}"]`);
  if (activeButton) {
    activeButton.classList.add("active");
  }

  // 지도 페이지인 경우 맵 리사이즈
  if (pageName === "map") {
    setTimeout(() => {
      if (window.mapInstance) {
        window.mapInstance.updateSize();
      }
    }, 100);
  }
}

// 사이드 탭(.cadastral-control)의 서브메뉴 목록 - 트리거 버튼과 서브메뉴 짝
const CADASTRAL_SUBMENUS = [
  { buttonId: "cadastralBtn", submenuId: "cadastralSubmenu" },
  { buttonId: "wfsAmenitiesBtn", submenuId: "amenitiesSubmenu" },
  { buttonId: "wfsTransportBtn", submenuId: "transportSubmenu" },
];

// 지정한 서브메뉴를 제외한 나머지 서브메뉴를 닫음 (서브메뉴끼리 영역이 겹치는 것을 방지)
// 표시 상태만 되돌리고 측정 초기화 같은 기능 단위 동작은 건드리지 않음
function closeOtherCadastralSubmenus(currentSubmenuId) {
  CADASTRAL_SUBMENUS.forEach(({ buttonId, submenuId }) => {
    if (submenuId === currentSubmenuId) return;

    const submenu = document.getElementById(submenuId);
    const button = document.getElementById(buttonId);

    if (submenu) submenu.classList.remove("show");
    if (button) button.classList.remove("active");
  });
}

// 서브메뉴를 트리거 버튼과 같은 높이에 맞춤
// .cadastral-control이 offsetParent이므로 버튼의 offsetTop을 그대로 쓰면 정렬됨
// (버튼 순서·개수가 바뀌어도 자동으로 맞으므로 top 값을 하드코딩하지 말 것)
function positionCadastralSubmenu(button, submenu) {
  submenu.style.top = `${button.offsetTop}px`;

  // 지도 영역 아래로 넘쳐 잘리는 경우 위로 끌어올림
  const mapContainer = document.querySelector(".map-container");
  if (!mapContainer) return;

  const overflow =
    submenu.getBoundingClientRect().bottom -
    (mapContainer.getBoundingClientRect().bottom - 10);

  if (overflow > 0) {
    submenu.style.top = `${Math.max(button.offsetTop - overflow, 0)}px`;
  }
}

// 사이드 탭 서브메뉴 토글 (열려 있던 다른 서브메뉴는 닫고, 트리거 버튼 옆에 정렬)
// 반환값: 토글 후 서브메뉴가 열린 상태인지 여부
function toggleCadastralSubmenu(buttonId, submenuId) {
  const button = document.getElementById(buttonId);
  const submenu = document.getElementById(submenuId);

  if (!button || !submenu) return false;

  const willShow = !submenu.classList.contains("show");

  closeOtherCadastralSubmenus(submenuId);

  button.classList.toggle("active", willShow);
  submenu.classList.toggle("show", willShow);

  // 위치 계산은 서브메뉴가 화면에 표시된 뒤에 해야 크기를 잴 수 있음
  if (willShow) {
    positionCadastralSubmenu(button, submenu);
  }

  return willShow;
}

// 레이어 패널 초기화
function initializeLayerPanel() {
  const layerPanel = document.getElementById("layerPanel");
  const panelToggle = document.getElementById("panelToggle");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const backgroundRadios = document.querySelectorAll(
    'input[name="background"]'
  );
  const overlayCheckboxes = document.querySelectorAll('input[name="overlay"]');

  // 패널 토글 기능
  panelToggle.addEventListener("click", function () {
    layerPanel.classList.toggle("collapsed");
  });

  // 내부 탭 기능
  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      switchTab(targetTab, tabButtons, tabPanes);
    });
  });

  // 배경지도 라디오 버튼 이벤트
  backgroundRadios.forEach((radio) => {
    radio.addEventListener("change", function () {
      if (this.checked) {
        window.switchLayer(this.value);
      }
    });
  });

  // 오버레이 체크박스 이벤트
  overlayCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      window.toggleOverlay(this.value);
    });
  });

  // 카테고리 토글 기능
  const categoryHeaders = document.querySelectorAll(".category-header");
  categoryHeaders.forEach((header) => {
    header.addEventListener("click", function () {
      const category = this.getAttribute("data-category");
      const layerList = document.getElementById(category + "-layers");

      // 헤더 토글 상태 변경
      this.classList.toggle("collapsed");

      // 레이어 리스트 토글
      if (layerList) {
        layerList.classList.toggle("collapsed");
      }
    });
  });

  // 홈 이동 함수
  function goToMap() {
    const homeUrl = window.location.origin + "/map";
    window.location.href = homeUrl;
  }

  // 로고 클릭 이벤트
  const logoHome = document.getElementById("logoHome");
  if (logoHome) {
    logoHome.addEventListener("click", goToMap);
  }

  // 지적 기능 버튼 이벤트
  const cadastralBtn = document.getElementById("cadastralBtn");

  if (cadastralBtn) {
    cadastralBtn.addEventListener("click", function () {
      // 버튼 활성화 상태와 서브메뉴 표시를 함께 토글 (다른 서브메뉴는 닫힘)
      const isActive = toggleCadastralSubmenu(
        "cadastralBtn",
        "cadastralSubmenu"
      );

      // 지적 기능 비활성화 시 측정 초기화
      console.log("지적 기능:", isActive ? "활성화" : "비활성화");

      if (!isActive) {
        // 지적 기능이 비활성화되면 측정 초기화
        if (window.clearMeasurements) {
          window.clearMeasurements();
        }
        // 모든 서브메뉴 버튼 비활성화
        const submenuBtns = document.querySelectorAll(".submenu-btn");
        submenuBtns.forEach((btn) => btn.classList.remove("active"));
      }

      // 여기에 실제 지적 레이어 토글 로직을 추가할 수 있습니다
      if (window.toggleCadastralLayer) {
        window.toggleCadastralLayer(isActive);
      }
    });
  }
  // 로드뷰 버튼 이벤트
  const loadviewBtn = document.getElementById("loadviewBtn");

  if (loadviewBtn) {
    loadviewBtn.addEventListener("click", function () {
      // 버튼 활성화/비활성화 토글
      this.classList.toggle("active");
    });
  }

  // 로드뷰 메인 버튼
  const roadviewBtn =
    document.getElementById("roadviewBtn") ||
    document.getElementById("loadviewBtn");
  if (roadviewBtn) {
    // 인라인 onclick이 있을 수 있으니 제거하고 통일
    roadviewBtn.onclick = null;
    roadviewBtn.addEventListener("click", function () {
      const appkey = window.KAKAO_APP_KEY || undefined;
      // 의도: 버튼은 로드뷰 가능영역 토글 → 영역 클릭 시 전체 화면 로드뷰 실행
      if (window.enableRoadviewPicker && !window.roadviewPickerActive) {
        window.enableRoadviewPicker({ appkey });
      } else if (window.disableRoadviewPicker) {
        window.disableRoadviewPicker();
      }
    });
  }

  // 교통 서브메뉴 토글 함수
  window.toggleTransportSubmenu = function () {
    const isShown = toggleCadastralSubmenu(
      "wfsTransportBtn",
      "transportSubmenu"
    );

    console.log("교통 서브메뉴:", isShown ? "표시" : "숨김");
  };

  // 지도편집 버튼 이벤트
  const mapEditBtn = document.getElementById("mapEditBtn");
  if (mapEditBtn) {
    mapEditBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      // 지도 영역 선택 시작
      if (window.startMapEdit) {
        window.startMapEdit();
      }
    });
  }

  // 편의시설 서브메뉴 토글 함수
  window.toggleAmenitiesSubmenu = function () {
    const isShown = toggleCadastralSubmenu(
      "wfsAmenitiesBtn",
      "amenitiesSubmenu"
    );

    console.log("편의시설 서브메뉴:", isShown ? "표시" : "숨김");
  };

  // 편의점 서브메뉴 토글 함수
  window.toggleConvenienceSubmenu = function () {
    const convenienceBtn = document.getElementById("wfsConvenienceBtn");
    const convenienceSubmenu = document.getElementById("convenienceSubmenu");

    if (convenienceBtn && convenienceSubmenu) {
      // 버튼 활성화/비활성화 토글
      convenienceBtn.classList.toggle("active");

      // 서브메뉴 토글
      convenienceSubmenu.classList.toggle("show");

      // 편의점 레이어 토글
      if (window.toggleConvenienceStore) {
        window.toggleConvenienceStore();
      }

      console.log(
        "편의점 서브메뉴:",
        convenienceSubmenu.classList.contains("show") ? "표시" : "숨김"
      );
    }
  };

  // 지적 서브메뉴 버튼 이벤트
  const submenuBtns = document.querySelectorAll(".submenu-btn");
  submenuBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const cadastralType = this.getAttribute("data-cadastral");
      const convenienceType = this.getAttribute("data-convenience");
      const amenitiesType = this.getAttribute("data-amenities");
      const transportType = this.getAttribute("data-transport");

      // 측정 도구는 하나만 활성화되도록 처리
      if (cadastralType) {
        // 측정 도구 버튼들만 비활성화
        submenuBtns.forEach((b) => {
          if (b.getAttribute("data-cadastral")) {
            b.classList.remove("active");
          }
        });
        this.classList.add("active");
      } else {
        // 레이어 버튼들은 독립적으로 토글되므로 active 상태 변경하지 않음
        // 토글 함수의 결과에 따라 active 상태가 결정됨
      }

      // 교통 서브메뉴 버튼 처리
      if (transportType) {
        console.log("교통 기능 선택:", transportType);

        // 각 기능별 교통 도구 활성화
        switch (transportType) {
          case "bus":
            console.log("버스 기능 활성화");
            // 버스정류장 WFS 토글
            let isActive = false;
            if (window.toggleBusStop) {
              isActive = window.toggleBusStop();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!isActive);
            break;
          case "subway":
            console.log("지하철 기능 활성화");
            // 지하철 WFS 토글 (향후 구현 시)
            if (window.showSubwayInfo) {
              window.showSubwayInfo();
            }
            break;
          case "traffic":
            console.log("교통정보 기능 활성화");
            // 교통정보 WFS 토글 (향후 구현 시)
            if (window.showTrafficInfo) {
              window.showTrafficInfo();
            }
            break;
          case "cctv":
            console.log("CCTV 기능 활성화");
            // CCTV WFS 토글
            let cctvActive = false;
            if (window.toggleCctv) {
              cctvActive = window.toggleCctv();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!cctvActive);
            break;
        }
        return;
      }

      // 편의시설 서브메뉴 버튼 처리
      if (amenitiesType) {
        console.log("편의시설 기능 선택:", amenitiesType);

        // 각 기능별 편의시설 도구 활성화
        switch (amenitiesType) {
          case "nearbyConvenience": {
            // 편의점 WFS 토글
            let isActive = false;
            if (window.toggleConvenienceStore) {
              isActive = window.toggleConvenienceStore();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!isActive);
            break;
          }
          case "parking":
            console.log("주차장 기능 활성화");
            // 주차장 WFS 토글 (향후 구현 시)
            if (window.showParkingInfo) {
              window.showParkingInfo();
            }
            break;
          case "restroom":
            console.log("화장실 기능 활성화");
            // 화장실 WFS 토글 (향후 구현 시)
            if (window.showRestroomInfo) {
              window.showRestroomInfo();
            }
            break;
          case "wifi":
            console.log("WiFi 기능 활성화");
            // WiFi WFS 토글 (향후 구현 시)
            if (window.showWifiInfo) {
              window.showWifiInfo();
            }
            break;
        }
        return;
      }

      // 약국/병원 서브메뉴 버튼 처리
      const amenityType = this.getAttribute("data-amenity");
      if (amenityType) {
        console.log("편의시설 기능 선택:", amenityType);

        // 각 기능별 편의시설 도구 활성화
        switch (amenityType) {
          case "pharmacy": {
            // 약국 WFS 토글
            let isActive = false;
            if (window.togglePharmacy) {
              isActive = window.togglePharmacy();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!isActive);
            break;
          }
          case "hospital": {
            // 병원 WFS 토글
            let isActive = false;
            if (window.toggleHospital) {
              isActive = window.toggleHospital();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!isActive);
            break;
          }
          case "government_office": {
            // 관공서 WFS 토글
            let isActive = false;
            if (window.toggleGovernmentOffice) {
              isActive = window.toggleGovernmentOffice();
            }
            // 토글 결과에 따라 active 정확히 반영
            this.classList.toggle("active", !!isActive);
            break;
          }
        }
        return;
      }

      // 편의점 서브메뉴 버튼 처리
      if (convenienceType) {
        console.log("편의점 기능 선택:", convenienceType);

        // 각 기능별 편의점 도구 활성화
        switch (convenienceType) {
          case "nearby":
            console.log("주변 편의점 기능 활성화");
            if (window.showNearbyConvenienceStores) {
              window.showNearbyConvenienceStores();
            }
            break;
          case "search":
            console.log("편의점 검색 기능 활성화");
            if (window.showConvenienceStoreSearch) {
              window.showConvenienceStoreSearch();
            }
            break;
          case "filter":
            console.log("편의점 필터 기능 활성화");
            if (window.showConvenienceStoreFilter) {
              window.showConvenienceStoreFilter();
            }
            break;
          case "info":
            console.log("편의점 정보 기능 활성화");
            if (window.showConvenienceStoreInfo) {
              window.showConvenienceStoreInfo();
            }
            break;
        }
        return;
      }

      // 지적 서브메뉴 버튼 처리
      if (cadastralType) {
        console.log("지적 기능 선택:", cadastralType);

        // 각 기능별 측정 도구 활성화
        switch (cadastralType) {
          case "radius":
            console.log("반경 기능 활성화");
            if (window.measureRadius) {
              window.measureRadius();
            }
            break;
          case "area":
            console.log("면적 기능 활성화");
            if (window.measureArea) {
              window.measureArea();
            }
            break;
          case "distance":
            console.log("거리 기능 활성화");
            if (window.measureDistance) {
              window.measureDistance();
            }
            break;
          case "angle":
            console.log("각도 기능 활성화");
            if (window.measureAngle) {
              window.measureAngle();
            }
            break;
          case "roadview":
            console.log("로드뷰 실행");
            if (window.drawRoadView) {
              const appkey = window.KAKAO_APP_KEY || undefined;
              window.drawRoadView("roadviewPanel", { appkey, radius: 300 });
            }
            break;
        }
      }
    });
  });

  // 우측 상단 배경지도 선택 버튼 이벤트
  const mapTypeButtons = document.querySelectorAll(".map-type-btn");

  mapTypeButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const mapType = this.getAttribute("data-type");

      // 모든 버튼 비활성화
      mapTypeButtons.forEach((btn) => btn.classList.remove("active"));

      // 선택된 버튼 활성화
      this.classList.add("active");

      // 맵 레이어 전환
      if (window.switchLayer) {
        window.switchLayer(mapType);
      }

      // 위성 지도 선택 시 하이브리드도 함께 켜기
      if (mapType === "satellite" && window.toggleOverlay) {
        window.toggleOverlay("hybrid");
      } else if (mapType === "common" && window.toggleOverlay) {
        // 일반 지도 선택 시 하이브리드 끄기
        window.toggleOverlay("hybrid");
      }
    });
  });
}

// 탭 전환
function switchTab(tabName, tabButtons, tabPanes) {
  // 모든 탭 버튼 비활성화
  tabButtons.forEach((btn) => {
    btn.classList.remove("active");
  });

  // 모든 탭 패널 숨기기
  tabPanes.forEach((pane) => {
    pane.classList.remove("active");
  });

  // 선택된 탭 활성화
  const activeTabButton = document.querySelector(`[data-tab="${tabName}"]`);
  const activeTabPane = document.getElementById(`${tabName}-tab`);

  if (activeTabButton) {
    activeTabButton.classList.add("active");
  }

  if (activeTabPane) {
    activeTabPane.classList.add("active");
  }
}

// 로딩 숨기기
function hideLoading() {
  const loading = document.getElementById("loading");
  setTimeout(() => {
    loading.classList.add("hidden");
  }, 300); // 1초에서 0.3초로 단축
}

// 전역 객체에 hideLoading 함수 추가
window.hideLoading = hideLoading;

export {
  initializeNavigation,
  initializeLayerPanel,
  hideLoading,
  initializeHeaderToggle,
};

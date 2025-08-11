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

// 레이어 패널 초기화
function initializeLayerPanel() {
  const layerPanel = document.getElementById("layerPanel");
  const panelToggle = document.getElementById("panelToggle");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const fixedTabs = document.querySelectorAll(".fixed-tab");
  const backgroundRadios = document.querySelectorAll(
    'input[name="background"]'
  );
  const overlayCheckboxes = document.querySelectorAll('input[name="overlay"]');

  // 패널 토글 기능
  panelToggle.addEventListener("click", function () {
    layerPanel.classList.toggle("collapsed");
  });

  // 고정 탭 기능
  fixedTabs.forEach((button) => {
    button.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");

      // 고정 탭 활성화
      fixedTabs.forEach((tab) => tab.classList.remove("active"));
      this.classList.add("active");

      // 패널이 접혀있으면 펼치기
      if (layerPanel.classList.contains("collapsed")) {
        layerPanel.classList.remove("collapsed");
      }

      // 패널 제목 업데이트
      const panelTitle = document.getElementById("panelTitle");
      const tabLabels = {
        route: "길찾기",
        layers: "레이어",
        search: "검색",
        bookmark: "즐겨찾기",
        measure: "측정",
        draw: "그리기",
        export: "내보내기",
      };
      if (panelTitle && tabLabels[targetTab]) {
        panelTitle.textContent = tabLabels[targetTab];
      }

      // 내부 탭 전환
      switchTab(targetTab, tabButtons, tabPanes);
    });
  });

  // 내부 탭 기능
  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      switchTab(targetTab, tabButtons, tabPanes);
    });
  });

  // 초기 활성 고정 탭에 맞춰 패널 초기 상태 동기화
  const initialActiveFixed = document.querySelector(".fixed-tab.active");
  let initialTab = initialActiveFixed
    ? initialActiveFixed.getAttribute("data-tab")
    : "route";

  const panelTitle = document.getElementById("panelTitle");
  const tabLabels = {
    route: "길찾기",
    layers: "레이어",
    search: "검색",
    bookmark: "즐겨찾기",
    measure: "측정",
    draw: "그리기",
    export: "내보내기",
  };
  if (panelTitle && tabLabels[initialTab]) {
    panelTitle.textContent = tabLabels[initialTab];
  }
  switchTab(initialTab, tabButtons, tabPanes);

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
  function goToHome() {
    const homeUrl = window.location.origin;
    window.location.href = homeUrl;
  }

  // 홈 이동 함수
  function goToMap() {
    const homeUrl = window.location.origin + "/map";
    window.location.href = homeUrl;
  }

  // 홈 버튼 이벤트
  const homeBtn = document.getElementById("homeBtn");
  if (homeBtn) {
    homeBtn.addEventListener("click", goToHome);
  }

  // 로고 클릭 이벤트
  const logoHome = document.getElementById("logoHome");
  if (logoHome) {
    logoHome.addEventListener("click", goToMap);
  }

  // 지적 기능 버튼 이벤트
  const cadastralBtn = document.getElementById("cadastralBtn");
  const cadastralSubmenu = document.getElementById("cadastralSubmenu");

  if (cadastralBtn) {
    cadastralBtn.addEventListener("click", function () {
      // 버튼 활성화/비활성화 토글
      this.classList.toggle("active");

      // 서브메뉴 토글
      if (cadastralSubmenu) {
        cadastralSubmenu.classList.toggle("show");
      }

      // 지적 기능 비활성화 시 측정 초기화
      const isActive = this.classList.contains("active");
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

  // 지적 서브메뉴 버튼 이벤트
  const submenuBtns = document.querySelectorAll(".submenu-btn");
  submenuBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const cadastralType = this.getAttribute("data-cadastral");

      // 모든 서브메뉴 버튼 비활성화
      submenuBtns.forEach((b) => b.classList.remove("active"));

      // 클릭된 버튼 활성화
      this.classList.add("active");

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
  }, 1000);
}

// 전역 객체에 hideLoading 함수 추가
window.hideLoading = hideLoading;

export {
  initializeNavigation,
  initializeLayerPanel,
  hideLoading,
  initializeHeaderToggle,
};

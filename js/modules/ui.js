// UI 관련 모듈

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
    // 현재 URL에서 /map을 제거한 URL로 이동
    const currentUrl = window.location.href;
    const homeUrl = currentUrl.replace(/\/map.*$/, "");
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
    logoHome.addEventListener("click", goToHome);
  }

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

export { initializeNavigation, initializeLayerPanel, hideLoading };

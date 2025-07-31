// 전역 변수
let map;
let baseLayers = {};
let currentLayer = "common";

// DOM 요소들
const loading = document.getElementById("loading");
const coordinatesElement = document.getElementById("coordinates");
const zoomLevelElement = document.getElementById("zoom-level");
const navButtons = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");

// 레이어 패널 관련 요소들
const layerPanel = document.getElementById("layerPanel");
const panelToggle = document.getElementById("panelToggle");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");
const backgroundRadios = document.querySelectorAll('input[name="background"]');

// 앱 초기화
document.addEventListener("DOMContentLoaded", function () {
  initializeMap();
  initializeNavigation();
  initializeLayerPanel();
  hideLoading();
});

// 맵 초기화
function initializeMap() {
  // VWorld 배경지도 레이어들 생성
  baseLayers = {
    common: new ol.layer.Tile({
      title: "일반 지도",
      visible: true,
      type: "base",
      name: "common_map",
      source: new ol.source.XYZ({
        url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png",
        crossOrigin: "anonymous",
      }),
    }),
    satellite: new ol.layer.Tile({
      title: "위성 영상",
      visible: false,
      type: "base",
      source: new ol.source.XYZ({
        url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg",
        crossOrigin: "anonymous",
      }),
    }),
    hybrid: new ol.layer.Tile({
      title: "하이브리드",
      visible: false,
      type: "base",
      source: new ol.source.XYZ({
        url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png",
        crossOrigin: "anonymous",
      }),
    }),
  };

  // 맵 생성
  map = new ol.Map({
    target: "map",
    layers: Object.values(baseLayers),
    view: new ol.View({
      center: ol.proj.fromLonLat([127.0, 37.5]), // 서울 중심
      zoom: 10,
      maxZoom: 19,
      minZoom: 7,
    }),
    controls: [
      new ol.control.Zoom(),
      new ol.control.Attribution({
        collapsible: false,
      }),
    ],
    interactions: [
      new ol.interaction.DragPan(),
      new ol.interaction.DoubleClickZoom(),
      new ol.interaction.MouseWheelZoom(),
    ],
  });

  // 맵 이벤트 리스너 등록
  setupMapEventListeners();
}

// 맵 이벤트 리스너 설정
function setupMapEventListeners() {
  // 포인터 이동 이벤트 (선택적)
  map.on("pointermove", function (evt) {
    const coordinate = evt.coordinate;
    const lonLat = ol.proj.toLonLat(coordinate);
    // coordinatesElement가 존재할 때만 업데이트
    if (coordinatesElement) {
      coordinatesElement.textContent = `경도: ${lonLat[0].toFixed(
        6
      )}, 위도: ${lonLat[1].toFixed(6)}`;
    }
  });

  // 줌 레벨 변경 이벤트 (선택적)
  map.getView().on("change:resolution", function () {
    const zoom = Math.round(map.getView().getZoom());
    // zoomLevelElement가 존재할 때만 업데이트
    if (zoomLevelElement) {
      zoomLevelElement.textContent = zoom;
    }
  });

  // 맵 로드 완료 이벤트
  map.once("postrender", function () {
    console.log("맵 로드 완료");
  });
}

// 네비게이션 초기화
function initializeNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const targetPage = this.getAttribute("data-page");
      navigateToPage(targetPage);
    });
  });
}

// 페이지 네비게이션
function navigateToPage(pageName) {
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
      if (map) {
        map.updateSize();
      }
    }, 100);
  }
}

// 레이어 패널 초기화
function initializeLayerPanel() {
  // 패널 토글 기능
  panelToggle.addEventListener("click", function () {
    layerPanel.classList.toggle("collapsed");
  });

  // 탭 기능
  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  // 배경지도 라디오 버튼 이벤트
  backgroundRadios.forEach((radio) => {
    radio.addEventListener("change", function () {
      if (this.checked) {
        switchLayer(this.value);
      }
    });
  });
}

// 탭 전환
function switchTab(tabName) {
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

// 레이어 전환
function switchLayer(layerType) {
  // 모든 레이어 비활성화
  Object.values(baseLayers).forEach((layer) => {
    layer.setVisible(false);
  });

  // 선택된 레이어 활성화
  if (baseLayers[layerType]) {
    baseLayers[layerType].setVisible(true);
    currentLayer = layerType;
  }
}

// 로딩 숨기기
function hideLoading() {
  setTimeout(() => {
    loading.classList.add("hidden");
  }, 1000);
}

// AJAX 요청 함수 (향후 확장용)
function makeAjaxRequest(url, options = {}) {
  return fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    ...options,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .catch((error) => {
      console.error("AJAX 요청 실패:", error);
      throw error;
    });
}

// 유틸리티 함수들
const utils = {
  // 좌표 변환
  transformCoordinates: function (coordinate, fromProjection, toProjection) {
    return ol.proj.transform(coordinate, fromProjection, toProjection);
  },

  // 거리 계산 (미터)
  calculateDistance: function (coord1, coord2) {
    const point1 = new ol.geom.Point(coord1);
    const point2 = new ol.geom.Point(coord2);
    return point1.getCoordinates()[0] - point2.getCoordinates()[0];
  },

  // 포맷팅 함수들
  formatCoordinate: function (coordinate) {
    return `${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)}`;
  },

  formatDistance: function (meters) {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters / 1000).toFixed(2)}km`;
    }
  },
};

// 맵 도구 함수들
const mapTools = {
  // 현재 뷰포트 정보 가져오기
  getViewportInfo: function () {
    const view = map.getView();
    const extent = view.calculateExtent(map.getSize());
    const center = view.getCenter();
    const zoom = view.getZoom();

    return {
      center: ol.proj.toLonLat(center),
      zoom: zoom,
      extent: ol.proj.transformExtent(extent, "EPSG:3857", "EPSG:4326"),
    };
  },

  // 특정 좌표로 이동
  flyTo: function (coordinate, zoom = 15) {
    const transformedCoord = ol.proj.fromLonLat(coordinate);
    const view = map.getView();

    view.animate({
      center: transformedCoord,
      zoom: zoom,
      duration: 1000,
    });
  },

  // 줌 레벨 설정
  setZoom: function (zoom) {
    const view = map.getView();
    view.animate({
      zoom: zoom,
      duration: 500,
    });
  },

  // 맵 리셋
  resetMap: function () {
    const view = map.getView();
    view.animate({
      center: ol.proj.fromLonLat([127.0, 37.5]),
      zoom: 10,
      duration: 1000,
    });
  },
};

// 전역 객체에 유틸리티 함수들 추가
window.mapUtils = utils;
window.mapTools = mapTools;
window.mapInstance = map;

// 개발자 도구용 디버그 정보
console.log("SJ Lab Map Service 초기화 완료");
console.log("사용 가능한 도구들:", {
  mapUtils: "좌표 변환, 거리 계산 등의 유틸리티 함수",
  mapTools: "맵 조작 도구들",
  mapInstance: "OpenLayers 맵 인스턴스",
});

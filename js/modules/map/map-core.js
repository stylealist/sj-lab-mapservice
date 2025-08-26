// 맵 코어 모듈

// 맵 핵심 모듈 - 초기화 및 기본 기능
let map;
let currentLayer = "common";

// 맵 초기화
function initializeMap() {
  // VWorld 배경지도 레이어들 생성
  const baseLayers = {
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
  };

  // 오버레이 레이어들 생성
  const overlayLayers = {
    hybrid: new ol.layer.Tile({
      title: "하이브리드 오버레이",
      visible: false,
      type: "overlay",
      name: "hybrid_overlay",
      source: new ol.source.XYZ({
        url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png",
        crossOrigin: "anonymous",
      }),
    }),
  };

  // 맵 생성
  map = new ol.Map({
    target: "map",
    layers: [...Object.values(baseLayers), ...Object.values(overlayLayers)],
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

  // 지도에서 우클릭 시 브라우저 컨텍스트 메뉴 방지
  const mapElement = document.getElementById("map");
  const mapContainer = document.querySelector(".map-container");

  if (mapElement) {
    mapElement.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  if (mapContainer) {
    mapContainer.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  // 전역 변수로 레이어들 저장
  window.baseLayers = baseLayers;
  window.overlayLayers = overlayLayers;

  // 측정 레이어를 위한 빈 배열 생성 (map-measure.js에서 추가됨)
  window.measureLayers = [];

  return map;
}

// 맵 이벤트 리스너 설정
function setupMapEventListeners() {
  // 포인터 이동 이벤트 (선택적) - 좌표 표시용
  map.on("pointermove", function (evt) {
    const coordinate = evt.coordinate;
    const lonLat = ol.proj.toLonLat(coordinate);
    // coordinatesElement가 존재할 때만 업데이트
    if (window.coordinatesElement) {
      window.coordinatesElement.textContent = `경도: ${lonLat[0].toFixed(
        6
      )}, 위도: ${lonLat[1].toFixed(6)}`;
    }
  });

  // 줌 레벨 변경 이벤트는 WFS 모듈에서 처리하므로 제거
  // UI 업데이트는 WFS 줌 핸들러에서 함께 처리됨

  // 맵 로드 완료 이벤트
  map.once("postrender", function () {
    console.log("맵 로드 완료");
    // 맵 로드 완료 후 로딩 숨기기
    setTimeout(() => {
      // 맵 컨테이너를 보이게 함
      const mapContainer = document.querySelector(".map-container");
      if (mapContainer) {
        mapContainer.classList.add("loaded");
      }

      // 헤더를 보이게 함
      const header = document.getElementById("header");
      if (header) {
        header.classList.add("loaded");
      }

      // 메인 컨텐츠를 보이게 함
      const mainContent = document.querySelector(".main-content");
      if (mainContent) {
        mainContent.classList.add("loaded");
      }

      // 로딩 숨기기
      if (window.hideLoading) {
        window.hideLoading();
      }
    }, 500); // 맵 렌더링 완료 후 0.5초 대기
  });
}

// 맵 인스턴스 반환
function getMap() {
  return map;
}

// 전역 객체에 맵 인스턴스 추가
window.mapInstance = map;
window.getMap = getMap;

export { initializeMap, getMap };

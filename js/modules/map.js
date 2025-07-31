// 맵 관련 모듈
let map;
let baseLayers = {};
let overlayLayers = {};
let currentLayer = "common";

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
  };

  // 오버레이 레이어들 생성
  overlayLayers = {
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
}

// 맵 이벤트 리스너 설정
function setupMapEventListeners() {
  // 포인터 이동 이벤트 (선택적)
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

  // 줌 레벨 변경 이벤트 (선택적)
  map.getView().on("change:resolution", function () {
    const zoom = Math.round(map.getView().getZoom());
    // zoomLevelElement가 존재할 때만 업데이트
    if (window.zoomLevelElement) {
      window.zoomLevelElement.textContent = zoom;
    }
  });

  // 맵 로드 완료 이벤트
  map.once("postrender", function () {
    console.log("맵 로드 완료");
  });
}

// 레이어 전환
function switchLayer(layerType) {
  // 모든 배경 레이어 비활성화
  Object.values(baseLayers).forEach((layer) => {
    layer.setVisible(false);
  });

  // 선택된 배경 레이어 활성화
  if (baseLayers[layerType]) {
    baseLayers[layerType].setVisible(true);
    currentLayer = layerType;
  }
}

// 오버레이 레이어 토글
function toggleOverlay(overlayType) {
  if (overlayLayers[overlayType]) {
    const isVisible = overlayLayers[overlayType].getVisible();
    overlayLayers[overlayType].setVisible(!isVisible);
  }
}

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

// 전역 객체에 맵 관련 함수들 추가
window.mapInstance = map;
window.mapTools = mapTools;
window.switchLayer = switchLayer;
window.toggleOverlay = toggleOverlay;

export { initializeMap, mapTools, switchLayer, toggleOverlay };

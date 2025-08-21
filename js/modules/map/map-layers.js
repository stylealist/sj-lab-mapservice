// 맵 레이어 관리 모듈
let currentLayer = "common";

// 레이어 전환
function switchLayer(layerType) {
  // 모든 배경 레이어 비활성화
  Object.values(window.baseLayers).forEach((layer) => {
    layer.setVisible(false);
  });

  // 선택된 배경 레이어 활성화
  if (window.baseLayers[layerType]) {
    window.baseLayers[layerType].setVisible(true);
    currentLayer = layerType;
  }
}

// 오버레이 레이어 토글
function toggleOverlay(overlayType) {
  if (window.overlayLayers[overlayType]) {
    const isVisible = window.overlayLayers[overlayType].getVisible();
    window.overlayLayers[overlayType].setVisible(!isVisible);
  }
}

// 현재 활성화된 레이어 가져오기
function getCurrentLayer() {
  return currentLayer;
}

// 모든 레이어 정보 가져오기
function getAllLayers() {
  return {
    baseLayers: window.baseLayers,
    overlayLayers: window.overlayLayers,
    currentLayer: currentLayer
  };
}

// 전역 객체에 레이어 함수들 추가
window.switchLayer = switchLayer;
window.toggleOverlay = toggleOverlay;
window.getCurrentLayer = getCurrentLayer;
window.getAllLayers = getAllLayers;

export { switchLayer, toggleOverlay, getCurrentLayer, getAllLayers };

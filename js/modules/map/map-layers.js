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

// 오버레이 레이어 토글 (지금 상태를 뒤집는다)
function toggleOverlay(overlayType) {
  if (window.overlayLayers[overlayType]) {
    const isVisible = window.overlayLayers[overlayType].getVisible();
    window.overlayLayers[overlayType].setVisible(!isVisible);
  }
}

/**
 * 오버레이 레이어를 원하는 상태로 맞춘다(뒤집는 게 아니라 값을 정해 준다).
 * 배경지도 버튼처럼 "이 지도면 켜짐, 저 지도면 꺼짐"이 정해져 있는 곳에서는 toggleOverlay 를 쓰지 말 것 —
 * 같은 버튼을 두 번 누르면 하이브리드가 켜졌다 꺼졌다 한다(2026-09-28 실제 발생).
 */
function setOverlayVisible(overlayType, visible) {
  const layer = window.overlayLayers && window.overlayLayers[overlayType];
  if (!layer) return;
  layer.setVisible(Boolean(visible));
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
window.setOverlayVisible = setOverlayVisible;
window.getCurrentLayer = getCurrentLayer;
window.getAllLayers = getAllLayers;

export { switchLayer, toggleOverlay, setOverlayVisible, getCurrentLayer, getAllLayers };

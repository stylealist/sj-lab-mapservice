// 맵 메인 모듈 - 모든 맵 관련 모듈을 통합 관리
import { initializeMap, getMap } from "./map-core.js";
import { MapEventManager } from "./map-events.js";
import { switchLayer, toggleOverlay } from "./map-layers.js";
import { mapTools } from "./map-tools.js";
import {
  initializeMeasureTools,
  measureDistance,
  measureArea,
  measureRadius,
  measureAngle,
  clearMeasurements,
  createMeasurePopup,
  closeMeasurePopup,
  deleteMeasure,
} from "./map-measure.js";
import {
  drawRoadView,
  enableRoadviewPicker,
  disableRoadviewPicker,
  toggleRoadviewBtn,
} from "./map-roadview.js";
import {
  initializeWfsLayers,
  toggleWfsLayer,
  toggleConvenienceStore,
  clearAllWfsLayers,
  queryWfsFeaturesAt,
  getWfsLayerInfo,
  displayWfsFeatureInfo,
  showWfsPopup,
  closeWfsPopup,
} from "./map-wfs.js";
import {
  initializeWmsLayers,
  toggleWmsLayer,
  showWmsPopup,
  closeWmsPopup,
} from "./map-wms.js";

// 맵 초기화 함수 - 모든 모듈을 초기화
function initializeMapWithModules() {
  // 맵 핵심 초기화
  const map = initializeMap();

  // 측정 도구 초기화
  initializeMeasureTools();

  // WFS 레이어 초기화
  initializeWfsLayers();

  // WMS 레이어 초기화
  initializeWmsLayers();

  console.log("모든 맵 모듈이 초기화되었습니다.");

  return map;
}

// 전역 객체에 모든 함수들 추가
window.mapInstance = getMap();
window.MapEventManager = MapEventManager;
window.mapTools = mapTools;
window.switchLayer = switchLayer;
window.toggleOverlay = toggleOverlay;
window.measureDistance = measureDistance;
window.measureArea = measureArea;
window.measureRadius = measureRadius;
window.measureAngle = measureAngle;
window.clearMeasurements = clearMeasurements;
window.createMeasurePopup = createMeasurePopup;
window.closeMeasurePopup = closeMeasurePopup;
window.deleteMeasure = deleteMeasure;
window.drawRoadView = drawRoadView;
window.enableRoadviewPicker = enableRoadviewPicker;
window.disableRoadviewPicker = disableRoadviewPicker;
window.toggleRoadviewBtn = toggleRoadviewBtn;
window.toggleWfsLayer = toggleWfsLayer;
window.toggleWmsLayer = toggleWmsLayer;
window.toggleConvenienceStore = toggleConvenienceStore;
window.clearAllWfsLayers = clearAllWfsLayers;
window.queryWfsFeaturesAt = queryWfsFeaturesAt;
window.getWfsLayerInfo = getWfsLayerInfo;
window.displayWfsFeatureInfo = displayWfsFeatureInfo;
window.showWfsPopup = showWfsPopup;
window.closeWfsPopup = closeWfsPopup;
window.showWmsPopup = showWmsPopup;
window.closeWmsPopup = closeWmsPopup;

export { initializeMapWithModules, mapTools, switchLayer, toggleOverlay };

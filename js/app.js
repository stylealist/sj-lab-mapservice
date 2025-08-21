// 메인 애플리케이션 파일
import { initializeMapWithModules } from "./modules/map/map.js";
import {
  initializeNavigation,
  initializeLayerPanel,
  hideLoading,
  initializeHeaderToggle,
} from "./modules/ui.js";
import { makeAjaxRequest, utils } from "./utils/helpers.js";

// 앱 초기화
document.addEventListener("DOMContentLoaded", function () {
  initializeMapWithModules();
  initializeNavigation();
  initializeLayerPanel();
  initializeHeaderToggle();
  // hideLoading() 제거 - 맵 로드 완료 후 자동으로 호출됨
});

// 개발자 도구용 디버그 정보
console.log("SJ Map Platform 초기화 완료");
console.log("사용 가능한 도구들:", {
  mapUtils: "좌표 변환, 거리 계산 등의 유틸리티 함수",
  mapTools: "맵 조작 도구들",
  mapInstance: "OpenLayers 맵 인스턴스",
});

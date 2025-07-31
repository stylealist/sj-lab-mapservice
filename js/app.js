// 메인 애플리케이션 파일
import { initializeMap } from "./modules/map.js";
import {
  initializeNavigation,
  initializeLayerPanel,
  hideLoading,
} from "./modules/ui.js";
import { makeAjaxRequest, utils } from "./utils/helpers.js";

// 앱 초기화
document.addEventListener("DOMContentLoaded", function () {
  initializeMap();
  initializeNavigation();
  initializeLayerPanel();
  hideLoading();
});

// 개발자 도구용 디버그 정보
console.log("SJ Lab Map Service 초기화 완료");
console.log("사용 가능한 도구들:", {
  mapUtils: "좌표 변환, 거리 계산 등의 유틸리티 함수",
  mapTools: "맵 조작 도구들",
  mapInstance: "OpenLayers 맵 인스턴스",
});

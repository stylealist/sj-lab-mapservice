// 맵 WMS 레이어 모듈
import { getMap } from "./map-core.js";

// WMS 관련 변수들
let wmsLayers = {};
let wmsActive = {};

// WMS 서비스 설정
const WMS_CONFIG = {
  convenience_store: {
    url: "https://geoserver.sj-lab.co.kr/geoserver/ne/wms",
    layerName: "ne:convenience_store",
    name: "편의점 (WMS)",
    format: "image/png",
    version: "1.1.0",
  },
};

// WMS 레이어 초기화
function initializeWmsLayers() {
  const map = getMap();

  // 각 WMS 서비스에 대한 레이어 생성
  Object.keys(WMS_CONFIG).forEach((layerName) => {
    const config = WMS_CONFIG[layerName];

    // WMS 타일 소스 생성 (성능 최적화)
    const wmsSource = new ol.source.TileWMS({
      url: config.url,
      params: {
        LAYERS: config.layerName,
        FORMAT: config.format,
        VERSION: config.version,
        TRANSPARENT: true,
        // 성능 최적화 파라미터
        TILED: true,
        BUFFER: 50, // 타일 버퍼링
        FEATURE_COUNT: 10, // 클릭 시 최대 피처 수 제한
      },
      serverType: "geoserver",
      crossOrigin: "anonymous",
    });

    // WMS 타일 레이어 생성 (성능 최적화)
    const wmsLayer = new ol.layer.Tile({
      source: wmsSource,
      visible: false, // 초기에는 비활성화
      // 성능 최적화 옵션
      updateWhileAnimating: false, // 애니메이션 중 업데이트 비활성화
      updateWhileInteracting: false, // 상호작용 중 업데이트 비활성화
      preload: 1, // 미리 로드할 타일 수 (최소화)
      useInterimTilesOnError: false, // 오류 시 임시 타일 사용 안함
    });
    wmsLayer.setZIndex(1000);

    // 맵에 레이어 추가
    map.addLayer(wmsLayer);

    // 레이어 저장
    wmsLayers[layerName] = wmsLayer;
    wmsActive[layerName] = false;

    console.log(`WMS 레이어 생성됨: ${config.name}`);
  });

  // WMS 피처 정보 요청을 위한 클릭 이벤트 (성능 최적화)
  let clickTimeout = null;
  map.on("singleclick", function (evt) {
    // 연속 클릭 방지 (디바운싱)
    if (clickTimeout) {
      clearTimeout(clickTimeout);
    }

    clickTimeout = setTimeout(() => {
      if (!wmsActive.convenience_store) return;

      const viewResolution = map.getView().getResolution();
      const url = wmsLayers.convenience_store
        .getSource()
        .getFeatureInfoUrl(evt.coordinate, viewResolution, "EPSG:3857", {
          INFO_FORMAT: "application/json",
          FEATURE_COUNT: 1, // 최소 피처 수로 제한
          QUERY_LAYERS: WMS_CONFIG.convenience_store.layerName,
          // 성능 최적화 파라미터
          BUFFER: 5, // 클릭 반경 최소화
          EXCEPTIONS: "XML", // 예외 처리 최소화
        });

      if (url) {
        fetch(url)
          .then((response) => {
            if (!response.ok) throw new Error("Network response was not ok");
            return response.json();
          })
          .then((data) => {
            if (data.features && data.features.length > 0) {
              const feature = data.features[0];
              showWmsPopup(evt.coordinate, feature);
            }
          })
          .catch((error) => {
            console.error("WMS 피처 정보 요청 실패:", error);
          });
      }
    }, 100); // 100ms 디바운싱
  });

  // WMS 마우스 오버 이벤트 (커서 변경)
  map.on("pointermove", function (evt) {
    if (wmsActive.convenience_store) {
      const viewResolution = map.getView().getResolution();
      const url = wmsLayers.convenience_store
        .getSource()
        .getFeatureInfoUrl(evt.coordinate, viewResolution, "EPSG:3857", {
          INFO_FORMAT: "application/json",
          FEATURE_COUNT: 1,
          QUERY_LAYERS: WMS_CONFIG.convenience_store.layerName,
          BUFFER: 5,
        });

      if (url) {
        // WMS 피처가 있는 경우 포인터 커서로 변경
        map.getTargetElement().style.cursor = "pointer";
      } else {
        // WMS 피처가 없는 경우 기본 커서로 변경
        map.getTargetElement().style.cursor = "";
      }
    }
  });

  // 전역 변수로 저장
  window.wmsLayers = wmsLayers;
  window.wmsActive = wmsActive;
}

// WMS 레이어 토글 (성능 최적화)
function toggleWmsLayer(layerName) {
  if (!wmsLayers[layerName]) {
    console.error(`WMS 레이어를 찾을 수 없습니다: ${layerName}`);
    return;
  }

  const layer = wmsLayers[layerName];
  const isVisible = layer.getVisible();

  // 레이어 가시성 토글
  layer.setVisible(!isVisible);
  wmsActive[layerName] = !isVisible;

  // 성능 최적화: 레이어 활성화 시 새로고침
  if (!isVisible) {
    // 레이어 활성화 시 소스 새로고침
    const source = layer.getSource();
    if (source && source.refresh) {
      source.refresh();
    }
  }

  console.log(`WMS 레이어 ${layerName} ${!isVisible ? "활성화" : "비활성화"}`);

  return !isVisible;
}

// WMS 팝업 표시
function showWmsPopup(coordinate, feature) {
  const map = getMap();
  const properties = feature.properties;

  // 기존 팝업 제거
  const existingPopup = document.getElementById("wms-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // 팝업 요소 생성
  const popup = document.createElement("div");
  popup.id = "wms-popup";
  popup.className = "wms-popup";

  let content = `
    <div class="wms-popup-header">
      <div class="wms-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        편의점 정보
      </div>
      <button class="wms-popup-close" onclick="closeWmsPopup()">×</button>
    </div>
    <div class="wms-popup-content">
      <div class="wms-info-item">
        <span class="wms-info-label">상호명</span>
        <span class="wms-info-value">${
          properties.fclty_nm || "정보 없음"
        }</span>
      </div>
      <div class="wms-info-item">
        <span class="wms-info-label">주소</span>
        <span class="wms-info-value">${properties.adres || "정보 없음"}</span>
      </div>
      <div class="wms-info-item">
        <span class="wms-info-label">도로명주소</span>
        <span class="wms-info-value">${
          properties.rn_adres || "정보 없음"
        }</span>
      </div>
    </div>
  `;
  popup.innerHTML = content;

  // 팝업 스타일 적용
  popup.style.cssText = `
    position: absolute;
    background: white;
    border: none;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 0;
    min-width: 300px;
    max-width: 400px;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    z-index: 2000;
    transform: translate(-50%, -100%);
    margin-top: -8px;
    overflow: hidden;
  `;

  // 헤더 스타일 (사이트 헤더와 동일한 색상)
  const header = popup.querySelector(".wms-popup-header");
  if (header) {
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: linear-gradient(135deg, rgb(30, 41, 59) 0%, rgb(51, 65, 85) 50%, rgb(71, 85, 105) 100%);
      color: white;
      margin: 0;
      font-weight: 600;
      font-size: 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;
  }

  // 타이틀 스타일
  const title = popup.querySelector(".wms-popup-title");
  if (title) {
    title.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
    `;
  }

  // 닫기 버튼 스타일
  const closeBtn = popup.querySelector(".wms-popup-close");
  if (closeBtn) {
    closeBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      cursor: pointer;
      padding: 4px 8px;
      font-size: 18px;
      font-weight: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s ease;
      min-width: 24px;
      height: 24px;
    `;
  }

  // 닫기 버튼 호버 효과
  closeBtn.addEventListener("mouseenter", function () {
    this.style.background = "rgba(255, 255, 255, 0.2)";
  });

  closeBtn.addEventListener("mouseleave", function () {
    this.style.background = "rgba(255, 255, 255, 0.1)";
  });

  // 콘텐츠 스타일
  const content_el = popup.querySelector(".wms-popup-content");
  if (content_el) {
    content_el.style.cssText = `
      padding: 16px;
      background: white;
    `;
  }

  // 정보 아이템 스타일
  const infoItems = popup.querySelectorAll(".wms-info-item");
  infoItems.forEach((item, index) => {
    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: ${index === infoItems.length - 1 ? "0" : "12px"};
      padding: 8px 0;
      border-bottom: ${
        index === infoItems.length - 1 ? "none" : "1px solid #e2e8f0"
      };
    `;
  });

  // 라벨 스타일
  const labels = popup.querySelectorAll(".wms-info-label");
  labels.forEach((label) => {
    label.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      flex-shrink: 0;
      width: 80px;
      margin-right: 12px;
    `;
  });

  // 값 스타일
  const values = popup.querySelectorAll(".wms-info-value");
  values.forEach((value) => {
    value.style.cssText = `
      font-size: 13px;
      font-weight: 500;
      color: #334155;
      line-height: 1.4;
      word-break: break-word;
      flex: 1;
      text-align: right;
    `;
  });

  // 오버레이 생성
  const overlay = new ol.Overlay({
    element: popup,
    positioning: "bottom-center",
    stopEvent: true,
    offset: [0, -10],
  });

  overlay.setPosition(coordinate);
  map.addOverlay(overlay);

  // 전역에서 접근 가능하도록 저장
  window.currentWmsOverlay = overlay;

  console.log("WMS 팝업 표시:", properties);
}

// WMS 팝업 닫기
function closeWmsPopup() {
  if (window.currentWmsOverlay) {
    const map = getMap();
    map.removeOverlay(window.currentWmsOverlay);
    window.currentWmsOverlay = null;
  }

  const popup = document.getElementById("wms-popup");
  if (popup) {
    popup.remove();
  }
}

// 전역 객체에 WMS 함수들 추가
window.toggleWmsLayer = toggleWmsLayer;
window.showWmsPopup = showWmsPopup;
window.closeWmsPopup = closeWmsPopup;

export { initializeWmsLayers, toggleWmsLayer, showWmsPopup, closeWmsPopup };

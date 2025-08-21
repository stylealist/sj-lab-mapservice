// 맵 WFS 레이어 모듈
import { getMap } from "./map-core.js";

// WFS 관련 변수들
let wfsLayers = {};
let wfsActive = {};

// WFS 서비스 설정
const WFS_CONFIG = {
  convenience_store: {
    url: "https://geoserver.sj-lab.co.kr/geoserver/ne/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ne%3Aconvenience_store&maxFeatures=100000&outputFormat=application%2Fjson",
    name: "편의점",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/convenienceStore.png",
        scale: 0.8,
        anchor: [0.5, 0.5],
      }),
    },
  },
};

// WFS 레이어 초기화
function initializeWfsLayers() {
  const map = getMap();

  // 각 WFS 서비스에 대한 레이어 생성
  Object.keys(WFS_CONFIG).forEach((layerName) => {
    const config = WFS_CONFIG[layerName];

    // 벡터 소스 생성
    const vectorSource = new ol.source.Vector({
      url: config.url,
      format: new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: map.getView().getProjection(),
      }),
      strategy: ol.loadingstrategy.bbox, // 현재 화면 영역의 데이터만 로드
      wrapX: false, // 경계선을 넘어가지 않도록 설정
    });

    // 데이터 로드 시작 이벤트
    vectorSource.on("featuresloadstart", function () {
      console.log(`${config.name} 데이터 로드 시작...`);
      showLoadingMessage(`${config.name} 데이터 로딩 중...`);
      updateLoadingProgress(10);
    });

    // 데이터 로드 진행 이벤트
    vectorSource.on("featuresloadprogress", function (event) {
      if (event.loaded && event.total) {
        const percent = Math.min((event.loaded / event.total) * 100, 90);
        updateLoadingProgress(percent);
        showLoadingMessage(
          `${config.name} 데이터 로딩 중... ${Math.round(percent)}%`
        );
      }
    });

    // 데이터 로드 완료 이벤트 추가
    vectorSource.on("featuresloadend", function () {
      console.log(
        `${config.name} 데이터 로드 완료:`,
        vectorSource.getFeatures().length,
        "개 피처"
      );
      updateLoadingProgress(100);
      setTimeout(() => {
        hideLoadingMessage();
      }, 500);

      // 피처가 0개인 경우 URL을 직접 테스트
      if (vectorSource.getFeatures().length === 0) {
        console.warn(
          `${config.name} 피처가 0개입니다. URL을 확인해주세요:`,
          config.url
        );
        testWfsUrl(config.url);
      }
    });

    vectorSource.on("featuresloaderror", function (error) {
      console.error(`${config.name} 데이터 로드 실패:`, error);
      hideLoadingMessage();
    });

    // 클러스터 소스 생성
    const clusterSource = new ol.source.Cluster({
      distance: 40, // 클러스터링 거리를 늘려서 성능 향상
      source: vectorSource,
    });

    // 클러스터 스타일 함수
    const clusterStyle = function (feature) {
      const size = feature.get("features").length;
      if (size === 1) {
        // 단일 피처인 경우 원본 스타일 사용
        return new ol.style.Style(config.style);
      } else {
        // 클러스터인 경우 원형 스타일 사용
        const radius = Math.min(Math.max(size * 2 + 8, 12), 40); // 최소 12, 최대 40
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: radius,
            fill: new ol.style.Fill({
              color: size > 100 ? "#ff4444" : size > 50 ? "#ff6b35" : "#ff8c42", // 크기에 따라 색상 변경
            }),
            stroke: new ol.style.Stroke({
              color: "#ffffff",
              width: 2,
            }),
          }),
          text: new ol.style.Text({
            text: size > 999 ? (size / 1000).toFixed(1) + "k" : size.toString(), // 1000개 이상이면 k 단위로 표시
            fill: new ol.style.Fill({
              color: "#ffffff",
            }),
            font: size > 999 ? "bold 12px Arial" : "bold 14px Arial",
          }),
        });
      }
    };

    // 클러스터 레이어 생성
    const clusterLayer = new ol.layer.Vector({
      source: clusterSource,
      style: clusterStyle,
      visible: false, // 초기에는 비활성화
    });
    clusterLayer.setZIndex(1000);

    // 맵에 레이어 추가
    map.addLayer(clusterLayer);

    // 레이어 저장
    wfsLayers[layerName] = clusterLayer;
    wfsActive[layerName] = false;

    console.log(`WFS 클러스터 레이어 생성됨: ${config.name}`);
  });

  // 맵 클릭 이벤트 추가 (WFS 피처 정보 표시 및 클러스터 확대)
  map.on("click", function (evt) {
    const feature = map.forEachFeatureAtPixel(evt.pixel, function (feature) {
      return feature;
    });

    if (feature) {
      // 클러스터인지 확인
      const features = feature.get("features");
      if (features && features.length > 1) {
        // 클러스터인 경우 확대
        const extent = new ol.source.Vector({
          features: features,
        }).getExtent();
        map.getView().fit(extent, {
          duration: 500,
          padding: [50, 50, 50, 50],
        });
        return;
      }
    }

    // 일반 피처 정보 표시
    displayWfsFeatureInfo(evt);
  });

  // 마우스 오버 이벤트 추가 (커서 변경)
  map.on("pointermove", function (evt) {
    const pixel = map.getEventPixel(evt.originalEvent);
    const hit = map.hasFeatureAtPixel(pixel);

    // 활성화된 WFS 레이어에 피처가 있는지 확인
    let hasWfsFeature = false;
    if (hit) {
      map.forEachFeatureAtPixel(pixel, function (feature, layer) {
        // WFS 레이어인지 확인
        Object.values(wfsLayers).forEach((wfsLayer) => {
          if (layer === wfsLayer && wfsLayer.getVisible()) {
            hasWfsFeature = true;
          }
        });
      });
    }

    // 커서 스타일 변경
    map.getTargetElement().style.cursor = hasWfsFeature ? "pointer" : "";
  });

  // 전역 변수로 저장
  window.wfsLayers = wfsLayers;
  window.wfsActive = wfsActive;
}

// WFS 레이어 토글
function toggleWfsLayer(layerName) {
  if (!wfsLayers[layerName]) {
    console.error(`WFS 레이어를 찾을 수 없습니다: ${layerName}`);
    return;
  }

  const layer = wfsLayers[layerName];
  const isVisible = layer.getVisible();

  // 레이어 가시성 토글
  layer.setVisible(!isVisible);
  wfsActive[layerName] = !isVisible;

  console.log(`WFS 레이어 ${layerName} ${!isVisible ? "활성화" : "비활성화"}`);
  console.log(`레이어 소스 피처 수:`, layer.getSource().getFeatures().length);

  return !isVisible;
}

// 편의점 레이어 토글 (UI에서 사용) - WMS 전용
function toggleConvenienceStore() {
  // WMS 레이어가 있으면 WMS 사용
  if (window.wmsLayers && window.wmsLayers.convenience_store) {
    const isActive = window.toggleWmsLayer("convenience_store");

    // WFS 레이어가 활성화되어 있다면 비활성화
    if (wfsLayers.convenience_store && wfsActive.convenience_store) {
      toggleWfsLayer("convenience_store");
    }

    // 버튼 상태 업데이트
    const button = document.getElementById("wfsConvenienceBtn");
    if (button) {
      if (isActive) {
        button.classList.add("active");
        button.title = "편의점 레이어 끄기 (WMS)";
      } else {
        button.classList.remove("active");
        button.title = "편의점 레이어 켜기 (WMS)";
      }
    }

    return isActive;
  } else {
    // WMS가 없으면 오류 메시지
    console.error(
      "WMS 레이어를 찾을 수 없습니다. WMS 모듈이 초기화되었는지 확인하세요."
    );
    alert(
      "WMS 레이어를 사용할 수 없습니다. WMS 모듈이 초기화되었는지 확인하세요."
    );
    return false;
  }
}

// 모든 WFS 레이어 끄기
function clearAllWfsLayers() {
  Object.keys(wfsLayers).forEach((layerName) => {
    wfsLayers[layerName].setVisible(false);
    wfsActive[layerName] = false;
  });

  // 모든 WFS 버튼 비활성화
  const buttons = document.querySelectorAll('[id^="wfs"][id$="Btn"]');
  buttons.forEach((button) => {
    button.classList.remove("active");
  });

  console.log("모든 WFS 레이어가 비활성화되었습니다.");
}

// 특정 좌표 주변의 WFS 피처 검색
function queryWfsFeaturesAt(coordinate, layerName) {
  if (!wfsLayers[layerName]) return [];

  const map = getMap();
  const layer = wfsLayers[layerName];
  const source = layer.getSource();
  const features = source.getFeaturesAtCoordinate
    ? source.getFeaturesAtCoordinate(coordinate)
    : [];

  return features;
}

// WFS 레이어 정보 가져오기
function getWfsLayerInfo(layerName) {
  if (!wfsLayers[layerName]) return null;

  const layer = wfsLayers[layerName];
  const source = layer.getSource();
  const features = source.getFeatures();

  return {
    name: WFS_CONFIG[layerName].name,
    visible: layer.getVisible(),
    featureCount: features.length,
    features: features,
  };
}

// WFS 피처 정보 표시
function displayWfsFeatureInfo(evt) {
  const map = getMap();
  const coordinate = evt.coordinate;
  let featureFound = false;

  // 활성화된 WFS 레이어에서 피처 검색
  Object.keys(wfsLayers).forEach((layerName) => {
    if (!wfsActive[layerName]) return;

    const layer = wfsLayers[layerName];
    const features = [];

    // 클릭 지점에서 피처 검색
    map.forEachFeatureAtPixel(evt.pixel, function (feature, layer_) {
      if (layer_ === layer) {
        features.push(feature);
      }
    });

    if (features.length > 0) {
      featureFound = true;
      showWfsPopup(coordinate, features[0], layerName);
    }
  });

  return featureFound;
}

// WFS 팝업 표시
function showWfsPopup(coordinate, feature, layerName) {
  const map = getMap();
  const config = WFS_CONFIG[layerName];
  const properties = feature.getProperties();

  // 기존 팝업 제거
  const existingPopup = document.getElementById("wfs-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // 팝업 요소 생성
  const popup = document.createElement("div");
  popup.id = "wfs-popup";
  popup.className = "wfs-popup";

  let content = `<div class="wfs-popup-header">
    <h4>${config.name} 정보</h4>
    <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
  </div>
  <div class="wfs-popup-content">`;

  // 편의점 정보 표시
  if (layerName === "convenience_store") {
    content += `
      <div class="wfs-info-item">
        <strong>상호명:</strong> ${properties.fclty_nm || "N/A"}
      </div>
      <div class="wfs-info-item">
        <strong>주소:</strong> ${properties.adres || "N/A"}
      </div>
      <div class="wfs-info-item">
        <strong>도로명주소:</strong> ${properties.rn_adres || "N/A"}
      </div>
    `;
  }

  content += `</div>`;
  popup.innerHTML = content;

  // 팝업 스타일 적용
  popup.style.cssText = `
    position: absolute;
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 0;
    min-width: 250px;
    max-width: 350px;
    font-family: Arial, sans-serif;
    z-index: 2000;
    transform: translate(-50%, -100%);
    margin-top: -10px;
  `;

  // 헤더 스타일
  const header = popup.querySelector(".wfs-popup-header");
  if (header) {
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: #3b82f6;
      color: white;
      border-radius: 6px 6px 0 0;
      margin: 0;
    `;
  }

  // 닫기 버튼 스타일
  const closeBtn = popup.querySelector(".wfs-popup-close");
  if (closeBtn) {
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      padding: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
  }

  // 콘텐츠 스타일
  const content_el = popup.querySelector(".wfs-popup-content");
  if (content_el) {
    content_el.style.cssText = `
      padding: 12px;
    `;
  }

  // 정보 아이템 스타일
  const infoItems = popup.querySelectorAll(".wfs-info-item");
  infoItems.forEach((item) => {
    item.style.cssText = `
      margin-bottom: 8px;
      font-size: 14px;
      line-height: 1.4;
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
  window.currentWfsOverlay = overlay;

  console.log(`WFS 팝업 표시: ${config.name}`, properties);
}

// WFS 팝업 닫기
function closeWfsPopup() {
  if (window.currentWfsOverlay) {
    const map = getMap();
    map.removeOverlay(window.currentWfsOverlay);
    window.currentWfsOverlay = null;
  }

  const popup = document.getElementById("wfs-popup");
  if (popup) {
    popup.remove();
  }
}

// 로딩 메시지 표시 함수
function showLoadingMessage(message) {
  let loadingDiv = document.getElementById("wfs-loading");
  if (!loadingDiv) {
    loadingDiv = document.createElement("div");
    loadingDiv.id = "wfs-loading";
    loadingDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 20px 30px;
      border-radius: 10px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      text-align: center;
      min-width: 200px;
    `;
    document.body.appendChild(loadingDiv);
  }
  loadingDiv.innerHTML = `
    <div style="margin-bottom: 10px;">${message}</div>
    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px;">
      <div id="wfs-progress" style="width: 0%; height: 100%; background: #ff6b35; border-radius: 2px; transition: width 0.3s;"></div>
    </div>
  `;
  loadingDiv.style.display = "block";
}

// 로딩 메시지 숨기기 함수
function hideLoadingMessage() {
  const loadingDiv = document.getElementById("wfs-loading");
  if (loadingDiv) {
    loadingDiv.style.display = "none";
  }
}

// 진행률 업데이트 함수
function updateLoadingProgress(percent) {
  const progressBar = document.getElementById("wfs-progress");
  if (progressBar) {
    progressBar.style.width = percent + "%";
  }
}

// WFS URL 테스트 함수
function testWfsUrl(url) {
  console.log("WFS URL 테스트 시작:", url);

  fetch(url)
    .then((response) => {
      console.log("WFS 응답 상태:", response.status, response.statusText);
      return response.text();
    })
    .then((data) => {
      console.log("WFS 응답 데이터 (처음 500자):", data.substring(0, 500));

      try {
        const jsonData = JSON.parse(data);
        console.log("WFS JSON 파싱 성공:", jsonData);
        if (jsonData.features) {
          console.log("피처 개수:", jsonData.features.length);
        }
      } catch (e) {
        console.error("WFS JSON 파싱 실패:", e);
      }
    })
    .catch((error) => {
      console.error("WFS URL 테스트 실패:", error);
    });
}

// 편의시설 관련 기능 함수들
function showParkingInfo() {
  console.log("주차장 기능 실행");
  alert(
    "주차장 기능이 활성화되었습니다.\n주변 주차장 정보를 확인할 수 있습니다."
  );
}

function showRestroomInfo() {
  console.log("화장실 기능 실행");
  alert(
    "화장실 기능이 활성화되었습니다.\n주변 화장실 위치를 확인할 수 있습니다."
  );
}

function showWifiInfo() {
  console.log("WiFi 기능 실행");
  alert(
    "WiFi 기능이 활성화되었습니다.\n무료 WiFi 제공 장소를 확인할 수 있습니다."
  );
}

function showAtmInfo() {
  console.log("ATM 기능 실행");
  alert("ATM 기능이 활성화되었습니다.\n주변 ATM 위치를 확인할 수 있습니다.");
}

// 편의점 관련 기능 함수들
function showNearbyConvenienceStores() {
  console.log("주변 편의점 기능 실행");
  // 현재 맵 중심점 기준으로 주변 편의점 표시
  const map = getMap();
  const center = map.getView().getCenter();

  // 반경 1km 내 편의점 표시 (예시)
  alert(
    "주변 편의점 기능이 활성화되었습니다.\n현재 위치 기준으로 주변 편의점을 표시합니다."
  );
}

function showConvenienceStoreSearch() {
  console.log("편의점 검색 기능 실행");
  // 편의점 검색 UI 표시
  alert(
    "편의점 검색 기능이 활성화되었습니다.\n편의점명으로 검색할 수 있습니다."
  );
}

function showConvenienceStoreFilter() {
  console.log("편의점 필터 기능 실행");
  // 편의점 필터 UI 표시
  alert(
    "편의점 필터 기능이 활성화되었습니다.\n편의점 종류별로 필터링할 수 있습니다."
  );
}

function showConvenienceStoreInfo() {
  console.log("편의점 정보 기능 실행");
  // 편의점 정보 UI 표시
  alert(
    "편의점 정보 기능이 활성화되었습니다.\n편의점 상세 정보를 확인할 수 있습니다."
  );
}

// 전역 객체에 WFS 함수들 추가
window.toggleWfsLayer = toggleWfsLayer;
window.toggleConvenienceStore = toggleConvenienceStore;
window.clearAllWfsLayers = clearAllWfsLayers;
window.queryWfsFeaturesAt = queryWfsFeaturesAt;
window.getWfsLayerInfo = getWfsLayerInfo;
window.displayWfsFeatureInfo = displayWfsFeatureInfo;
window.showWfsPopup = showWfsPopup;
window.closeWfsPopup = closeWfsPopup;

// 편의시설 관련 함수들 추가
window.showParkingInfo = showParkingInfo;
window.showRestroomInfo = showRestroomInfo;
window.showWifiInfo = showWifiInfo;
window.showAtmInfo = showAtmInfo;

// 편의점 관련 함수들 추가
window.showNearbyConvenienceStores = showNearbyConvenienceStores;
window.showConvenienceStoreSearch = showConvenienceStoreSearch;
window.showConvenienceStoreFilter = showConvenienceStoreFilter;
window.showConvenienceStoreInfo = showConvenienceStoreInfo;

export {
  initializeWfsLayers,
  toggleWfsLayer,
  toggleConvenienceStore,
  clearAllWfsLayers,
  queryWfsFeaturesAt,
  getWfsLayerInfo,
  displayWfsFeatureInfo,
  showWfsPopup,
  closeWfsPopup,
  showParkingInfo,
  showRestroomInfo,
  showWifiInfo,
  showAtmInfo,
  showNearbyConvenienceStores,
  showConvenienceStoreSearch,
  showConvenienceStoreFilter,
  showConvenienceStoreInfo,
};

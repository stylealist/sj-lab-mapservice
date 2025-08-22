// 맵 WFS 레이어 모듈
import { getMap } from "./map-core.js";

// WFS 관련 변수들
let wfsLayers = {};
let wfsActive = {};
let wfsDataCache = {}; // 캐시된 데이터 저장
let wfsVectorSources = {}; // 벡터 소스 저장
let wfsDataLoaded = {}; // 데이터 로드 상태 저장

// 환경별 API URL 설정
const getApiUrl = (endpoint) => {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:8100${endpoint}`;
  } else {
    return `https://api.sj-lab.co.kr${endpoint}`;
  }
};

// WFS 서비스 설정
const WFS_CONFIG = {
  convenience_store: {
    url: getApiUrl("/map/convenience-store"),
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

  if (!map || !map.getView) {
    console.error(
      "맵 인스턴스를 찾을 수 없습니다. WFS 레이어 초기화를 건너뜁니다."
    );
    return;
  }

  // 각 WFS 서비스에 대한 레이어 생성
  Object.keys(WFS_CONFIG).forEach((layerName) => {
    const config = WFS_CONFIG[layerName];

    // 벡터 소스 생성 (빈 상태로 시작)
    const vectorSource = new ol.source.Vector({
      format: new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: map.getView().getProjection(),
      }),
      wrapX: false, // 경계선을 넘어가지 않도록 설정
    });

    // 벡터 소스 저장
    wfsVectorSources[layerName] = vectorSource;
    wfsDataLoaded[layerName] = false; // 초기 로드 상태는 false

    // 클러스터 소스 생성 (줌 레벨에 따른 동적 거리 설정)
    const clusterSource = new ol.source.Cluster({
      distance: 80, // 초기 거리 설정 (더 넓게 시작하여 성능 향상)
      source: vectorSource,
    });

    // 줌 레벨에 따른 클러스터 스타일 함수
    const clusterStyle = function (feature) {
      const size = feature.get("features").length;
      const currentMap = getMap();
      const zoomLevel =
        currentMap && currentMap.getView ? currentMap.getView().getZoom() : 10;
      const clusterZoomThreshold = 12; // 클러스터 표시할 줌 레벨 임계값

      // 줌 레벨이 임계값 이하이거나 클러스터 크기가 1보다 큰 경우 클러스터 표시
      if (zoomLevel <= clusterZoomThreshold || size > 1) {
        // 클러스터 크기에 따른 반지름 계산 (텍스트 가독성을 위해 조정)
        const radius = Math.min(Math.max(size * 1.2 + 10, 14), 32);

        // 색상 그라데이션 개선
        let fillColor;
        if (size > 500) fillColor = "#dc2626"; // 매우 큰 클러스터 (빨강)
        else if (size > 200) fillColor = "#ea580c"; // 큰 클러스터 (주황)
        else if (size > 100) fillColor = "#f97316"; // 중간 클러스터 (밝은 주황)
        else if (size > 50) fillColor = "#fb923c"; // 작은 클러스터 (연한 주황)
        else fillColor = "#fdba74"; // 매우 작은 클러스터 (매우 연한 주황)

        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: radius,
            fill: new ol.style.Fill({
              color: fillColor,
            }),
            stroke: new ol.style.Stroke({
              color: "#ffffff",
              width: 1.5,
            }),
          }),
          text: new ol.style.Text({
            text: size > 999 ? Math.floor(size / 1000) + "k" : size.toString(),
            fill: new ol.style.Fill({
              color: "#000000", // 모든 텍스트를 검은색으로 통일
            }),
            font:
              size > 999
                ? "bold 13px 'Segoe UI', Arial, sans-serif"
                : "bold 14px 'Segoe UI', Arial, sans-serif",
            stroke: new ol.style.Stroke({
              color: "#ffffff", // 모든 텍스트를 흰색 테두리로 통일
              width: 1.5,
            }),
            offsetY: 0, // 수직 오프셋 제거
            textAlign: "center",
            textBaseline: "middle",
          }),
        });
      } else {
        // 줌 레벨이 높고 단일 피처인 경우 개별 아이콘 표시
        return new ol.style.Style(config.style);
      }
    };

    // 클러스터 레이어 생성
    const clusterLayer = new ol.layer.Vector({
      source: clusterSource,
      style: clusterStyle,
      visible: false, // 초기에는 비활성화
      renderBuffer: 50, // 렌더링 버퍼 증가
      updateWhileAnimating: false, // 애니메이션 중 업데이트 비활성화
      updateWhileInteracting: false, // 상호작용 중 업데이트 비활성화
    });
    clusterLayer.setZIndex(1000);

    // 줌 변경 시 스타일 및 클러스터 거리 업데이트 (디바운싱 적용)
    let zoomUpdateTimeout;
    map.getView().on("change:resolution", function () {
      if (wfsActive[layerName]) {
        // 이전 타임아웃 클리어
        if (zoomUpdateTimeout) {
          clearTimeout(zoomUpdateTimeout);
        }

        // 200ms 후에 업데이트 실행 (디바운싱)
        zoomUpdateTimeout = setTimeout(() => {
          // 클러스터 거리 재계산 (더 보수적으로 조정)
          const newDistance = (function () {
            const currentMap = getMap();
            if (!currentMap || !currentMap.getView) {
              return 80; // 기본값을 더 크게 설정
            }
            const zoomLevel = currentMap.getView().getZoom();
            if (zoomLevel <= 8) return 150; // 더 넓게
            if (zoomLevel <= 10) return 100; // 더 넓게
            if (zoomLevel <= 12) return 80; // 더 넓게
            if (zoomLevel <= 14) return 60; // 더 넓게
            return 40; // 더 넓게
          })();

          // 클러스터 소스 거리 업데이트
          clusterSource.setDistance(newDistance);

          // 레이어 스타일 업데이트
          clusterLayer.changed();
        }, 200);
      }
    });

    // 맵에 레이어 추가
    map.addLayer(clusterLayer);

    // 레이어 저장
    wfsLayers[layerName] = clusterLayer;
    wfsActive[layerName] = false;

    console.log(
      `WFS 클러스터 레이어 생성됨: ${config.name} (데이터 로드 대기 중)`
    );
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
      } else if (features && features.length === 1) {
        // 단일 피처인 경우 팝업 표시
        console.log(
          "클러스터에서 단일 피처 클릭:",
          features[0].getProperties()
        );
        displayWfsFeatureInfo(evt);
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
  window.wfsDataCache = wfsDataCache;
  window.wfsVectorSources = wfsVectorSources;
  window.wfsDataLoaded = wfsDataLoaded;
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

// WFS 데이터 로드 함수
function loadWfsData(layerName) {
  const config = WFS_CONFIG[layerName];
  const vectorSource = wfsVectorSources[layerName];

  // 이미 로드된 경우 캐시된 데이터 사용
  if (wfsDataLoaded[layerName] && wfsDataCache[layerName]) {
    console.log(
      `${config.name} 캐시된 데이터 사용: ${wfsDataCache[layerName].length} 개 피처`
    );
    vectorSource.addFeatures(wfsDataCache[layerName]);
    return Promise.resolve();
  }

  // 로딩 시작 표시
  showLoadingMessage(`${config.name} 데이터 로딩 중...`);
  updateLoadingProgress(10);

  // 점진적 로딩 진행을 위한 타이머
  let progressInterval = setInterval(() => {
    const currentProgress = parseInt(
      document.querySelector(".loading-progress")?.style.width || "10%"
    );
    if (currentProgress < 80) {
      updateLoadingProgress(currentProgress + 2);
    }
  }, 200);

  return fetch(config.url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      // 점진적 로딩 타이머 정리
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      const features = vectorSource.getFormat().readFeatures(data, {
        dataProjection: "EPSG:4326",
        featureProjection: vectorSource.getProjection(),
      });

      // 데이터를 캐시에 저장
      wfsDataCache[layerName] = features;
      wfsDataLoaded[layerName] = true;

      // 벡터 소스에 피처 추가
      vectorSource.addFeatures(features);

      console.log(
        `${config.name} 데이터 로드 완료: ${features.length} 개 피처`
      );

      // 첫 번째 피처의 속성 확인 (디버깅용)
      if (features.length > 0) {
        const firstFeature = features[0];
        console.log("첫 번째 피처 속성:", firstFeature.getProperties());
      }

      // 데이터 로드 완료 후 클러스터 거리 설정
      const clusterSource = wfsLayers[layerName].getSource();
      const map = getMap();

      if (map && map.getView) {
        const zoomLevel = map.getView().getZoom();
        let clusterDistance = 80; // 기본값을 더 크게 설정

        if (zoomLevel <= 8) clusterDistance = 150;
        else if (zoomLevel <= 10) clusterDistance = 100;
        else if (zoomLevel <= 12) clusterDistance = 80;
        else if (zoomLevel <= 14) clusterDistance = 60;
        else clusterDistance = 40;

        clusterSource.setDistance(clusterDistance);
        console.log(
          `${config.name} 클러스터 거리 설정: ${clusterDistance} (줌 레벨: ${zoomLevel})`
        );
      } else {
        console.warn(
          "맵 인스턴스를 찾을 수 없어 기본 클러스터 거리를 사용합니다."
        );
        clusterSource.setDistance(60);
      }

      // 로딩 완료 처리
      updateLoadingProgress(100);
      setTimeout(() => {
        hideLoadingMessage();
      }, 500);
    })
    .catch((error) => {
      // 점진적 로딩 타이머 정리
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      console.error(`${config.name} 데이터 로드 실패:`, error);
      hideLoadingMessage();
      throw error;
    });
}

// 편의점 레이어 토글 (UI에서 사용) - WFS 전용
function toggleConvenienceStore() {
  // WFS 레이어 사용
  if (wfsLayers.convenience_store) {
    const layer = wfsLayers.convenience_store;
    const isVisible = layer.getVisible();

    if (!isVisible) {
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("convenience_store")
        .then(() => {
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.convenience_store = true;

          // 클러스터 강제 업데이트
          const clusterSource = layer.getSource();
          clusterSource.refresh();

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.convenience_store &&
            window.wmsActive.convenience_store
          ) {
            window.toggleWmsLayer("convenience_store");
          }

          // 버튼 상태 업데이트
          const button = document.getElementById("wfsConvenienceBtn");
          if (button) {
            button.classList.add("active");
            button.title = "편의점 레이어 끄기 (WFS)";
          }
        })
        .catch((error) => {
          console.error("편의점 데이터 로드 실패:", error);
          alert("편의점 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.convenience_store = false;

      // 버튼 상태 업데이트
      const button = document.getElementById("wfsConvenienceBtn");
      if (button) {
        button.classList.remove("active");
        button.title = "편의점 레이어 켜기 (WFS)";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS 편의점 레이어를 찾을 수 없습니다.");
    alert("편의점 레이어를 사용할 수 없습니다.");
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
      console.log("클릭된 피처:", features[0].getProperties());
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

  // 디버깅: 피처 속성 확인
  console.log("WFS 팝업 - 피처 속성:", properties);
  console.log("WFS 팝업 - 레이어명:", layerName);

  // 기존 팝업 제거
  const existingPopup = document.getElementById("wfs-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // 팝업 요소 생성
  const popup = document.createElement("div");
  popup.id = "wfs-popup";
  popup.className = "wfs-popup";

  // 중첩된 데이터 구조에서 실제 값 추출
  const getPropertyValue = (properties, key) => {
    if (
      properties.features &&
      properties.features[0] &&
      properties.features[0].values_
    ) {
      return properties.features[0].values_[key] || "정보 없음";
    }
    // 기존 구조도 시도
    return properties[key] || "정보 없음";
  };

  let content = `<div class="wfs-popup-header">
    <div class="wfs-popup-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
      편의점 정보
    </div>
    <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
  </div>
  <div class="wfs-popup-content">
    <div class="wfs-info-item">
      <span class="wfs-info-label">상호명</span>
      <span class="wfs-info-value">${getPropertyValue(
        properties,
        "fclty_nm"
      )}</span>
    </div>
    <div class="wfs-info-item">
      <span class="wfs-info-label">주소</span>
      <span class="wfs-info-value">${getPropertyValue(
        properties,
        "adres"
      )}</span>
    </div>
    <div class="wfs-info-item">
      <span class="wfs-info-label">도로명주소</span>
      <span class="wfs-info-value">${getPropertyValue(
        properties,
        "rn_adres"
      )}</span>
    </div>
  </div>`;
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
  const header = popup.querySelector(".wfs-popup-header");
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
  const title = popup.querySelector(".wfs-popup-title");
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
  const closeBtn = popup.querySelector(".wfs-popup-close");
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
  const content_el = popup.querySelector(".wfs-popup-content");
  if (content_el) {
    content_el.style.cssText = `
      padding: 16px;
      background: white;
    `;
  }

  // 정보 아이템 스타일
  const infoItems = popup.querySelectorAll(".wfs-info-item");
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
  const labels = popup.querySelectorAll(".wfs-info-label");
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
  const values = popup.querySelectorAll(".wfs-info-value");
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
  loadWfsData,
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

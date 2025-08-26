// 맵 WFS 레이어 모듈
import { getMap } from "./map-core.js";
import { MapEventManager } from "./map-events.js";

// WFS 관련 변수들
let wfsLayers = {};
let wfsActive = {};
let wfsDataCache = {}; // 캐시된 데이터 저장
let wfsVectorSources = {}; // 벡터 소스 저장
let wfsDataLoaded = {}; // 데이터 로드 상태 저장
let wfsUpdating = {}; // 각 레이어별 업데이트 상태 저장

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
        scale: 1.0,
        anchor: [0.5, 1.0], // 아이콘 하단 중앙에 앵커 설정
        offset: [0, 0],
        opacity: 1.0,
        rotation: 0,
        size: [32, 32], // 아이콘 크기 명시적 설정
        imgSize: [32, 32], // 원본 이미지 크기
      }),
    },
  },
};

// WFS 레이어 초기화 상태 추적
let wfsInitialized = false;

// WFS 레이어 초기화
function initializeWfsLayers() {
  console.log("initializeWfsLayers 호출됨");

  // 이미 초기화되었는지 확인 (더 강력한 중복 방지)
  if (wfsInitialized) {
    console.log("WFS 레이어가 이미 초기화되어 있습니다.");
    return;
  }

  // 전역 초기화 상태 확인
  if (window.wfsLayersInitialized) {
    console.log("전역에서 WFS 레이어가 이미 초기화되어 있습니다.");
    return;
  }

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
    wfsUpdating[layerName] = false; // 초기 업데이트 상태는 false

    // 클러스터 소스 생성 (성능 최적화된 거리 설정)
    const clusterSource = new ol.source.Cluster({
      distance: 30, // 초기 거리를 매우 작게 설정하여 개별 아이콘 표시 강화
      source: vectorSource,
      geometryFunction: function (feature) {
        // 성능 최적화: 피처의 geometry가 유효한지 확인
        const geometry = feature.getGeometry();
        return geometry && geometry.getType() === "Point" ? geometry : null;
      },
      // 성능 최적화 추가 옵션
      wrapX: false, // 경계선을 넘어가지 않도록 설정
      minDistance: 20, // 최소 클러스터 거리 설정
      // 추가 성능 최적화 옵션
      extent: undefined, // 전체 범위 클러스터링
      maxZoom: 18, // 최대 줌 레벨 제한
    });

    // 성능 최적화된 클러스터 스타일 함수 (Canvas 이미지 기반)
    const styleCache = {};
    const clusterStyle = function (feature) {
      const size = feature.get("features").length;

      // 캐시된 스타일이 있으면 반환
      if (styleCache[size]) {
        return styleCache[size];
      }

      // 줌 레벨 확인 (성능 최적화: 맵 인스턴스 캐싱)
      const currentMap = getMap();
      const zoomLevel =
        currentMap && currentMap.getView ? currentMap.getView().getZoom() : 10;
      const clusterZoomThreshold = 15; // 클러스터 표시할 줌 레벨 임계값

      // 줌 레벨 16 이상에서는 항상 개별 아이콘 표시
      if (zoomLevel >= 16) {
        // 줌 레벨 16 이상에서는 개별 아이콘만 표시
        return new ol.style.Style(config.style);
      } else if (size > 1) {
        // 클러스터가 2개 이상일 때만 클러스터 표시
        // 클러스터 크기에 따른 캔버스 크기 계산 (더 작게 조정)
        const canvasSize = Math.min(Math.max(size * 1.2 + 20, 30), 50);
        const radius = canvasSize / 2;

        // 색상 그라데이션 (성능 최적화: 조건 단순화)
        let fillColor;
        if (size > 200) fillColor = "#dc2626"; // 빨강
        else if (size > 100) fillColor = "#ea580c"; // 주황
        else if (size > 50) fillColor = "#f97316"; // 밝은 주황
        else if (size > 20) fillColor = "#fb923c"; // 연한 주황
        else fillColor = "#fdba74"; // 매우 연한 주황

        // Canvas를 사용하여 클러스터 이미지 생성
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        // 배경 원 그리기
        context.beginPath();
        context.arc(radius, radius, radius - 1, 0, 2 * Math.PI, false);
        context.fillStyle = fillColor;
        context.fill();

        // 테두리 그리기
        context.lineWidth = 1.5;
        context.strokeStyle = "#ffffff";
        context.stroke();

        // 텍스트(클러스터 개수) 추가 (적절한 폰트 크기)
        context.fillStyle = "#000000";
        context.font =
          size > 999
            ? `bold ${Math.max(
                10,
                canvasSize / 5
              )}px 'Segoe UI', Arial, sans-serif`
            : `bold ${Math.max(
                12,
                canvasSize / 4
              )}px 'Segoe UI', Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";

        // 텍스트에 흰색 테두리 추가
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1;
        const text =
          size > 999 ? Math.floor(size / 1000) + "k" : size.toString();
        context.strokeText(text, radius, radius);
        context.fillText(text, radius, radius);

        // Canvas 이미지를 스타일로 설정
        const style = new ol.style.Style({
          image: new ol.style.Icon({
            img: canvas,
            imgSize: [canvasSize, canvasSize],
            scale: 1.0,
            anchor: [0.5, 0.5],
          }),
        });

        // 스타일 캐싱 (성능 향상)
        styleCache[size] = style;
        return style;
      } else {
        // 단일 피처인 경우 개별 아이콘 표시
        return new ol.style.Style(config.style);
      }
    };

    // 클러스터 레이어 생성 (성능 최적화 옵션 추가)
    const clusterLayer = new ol.layer.Vector({
      source: clusterSource,
      style: clusterStyle,
      visible: false, // 초기에는 비활성화
      renderBuffer: 100, // 렌더링 버퍼 증가
      updateWhileAnimating: false, // 애니메이션 중 업데이트 비활성화
      updateWhileInteracting: false, // 상호작용 중 업데이트 비활성화
      // 성능 최적화 추가 옵션
      declutter: true, // 피처 겹침 방지
      zIndex: 1000,
      // 추가 성능 최적화 옵션
      renderOrder: null, // 렌더링 순서 최적화
      extent: undefined, // 전체 범위 렌더링
      minResolution: 0, // 최소 해상도 제한 없음
      maxResolution: Infinity, // 최대 해상도 제한 없음
    });

    // 줌 레벨 변경 시 UI 업데이트만 처리 (클러스터 재조정은 moveend에서 처리)

    // 줌/이동 통합 처리 변수들
    let updateTimeout;
    let lastExtent = null;
    let lastZoomLevel = null;
    let lastDistance = null;
    let lastUpdateTime = 0;

    // 지도 줌/이동 통합 이벤트 핸들러 등록
    MapEventManager.registerMoveHandler(
      `wfs-move-${layerName}`,
      function (currentExtent) {
        // 추가적인 중복 실행 방지
        const now = Date.now();
        if (now - lastUpdateTime < 500) {
          console.log(`업데이트 쿨다운 중: ${now - lastUpdateTime}ms`);
          return;
        }

        if (wfsUpdating[layerName]) {
          console.log(
            `레이어 ${layerName}이 이미 업데이트 중이므로 건너뜁니다.`
          );
          return;
        }

        lastUpdateTime = now;
        wfsUpdating[layerName] = true;

        const currentZoom = map.getView().getZoom();
        // 줌 레벨이 변경된 경우 클러스터 거리 재조정
        if (currentZoom) {
          const newDistance = (function () {
            if (currentZoom >= 16) return 0; // 줌 레벨 16 이상에서는 클러스터링 완전 비활성화
            if (currentZoom <= 8) return 100;
            if (currentZoom <= 10) return 80;
            if (currentZoom <= 12) return 60;
            if (currentZoom <= 14) return 40;
            return 30; // 줌 레벨 15에서 매우 작은 클러스터 거리
          })();

          if (newDistance !== lastDistance) {
            console.log(
              `클러스터 거리 변경: ${lastDistance} → ${newDistance} (줌 레벨: ${currentZoom})`
            );
            clusterSource.setDistance(newDistance);
            lastDistance = newDistance;
          }

          // 스타일 캐시 클리어 (줌 레벨 변경 시)
          if (Object.keys(styleCache).length > 10) {
            Object.keys(styleCache).forEach((key) => delete styleCache[key]);
            console.log("스타일 캐시 클리어됨");
          }
        }

        // // 캐시된 데이터에서 뷰포트 기반 필터링 (줌 변경 또는 뷰포트 변경 시)
        // if (wfsDataLoaded[layerName] && wfsDataCache[layerName]) {
        //   // 기존 피처 제거
        //   vectorSource.clear();

        //   // 현재 뷰포트에 맞는 데이터만 필터링하여 추가
        //   const filteredFeatures = wfsDataCache[layerName].filter((feature) => {
        //     const geometry = feature.getGeometry();
        //     if (!geometry) return false;
        //     return geometry.intersectsExtent(currentExtent);
        //   });

        //   vectorSource.addFeatures(filteredFeatures);
        // } else {
        //   console.warn(`캐시된 데이터가 없습니다: ${layerName}`);
        // }

        // // 업데이트 상태 해제 (클러스터는 자동으로 업데이트됨)
        // wfsUpdating[layerName] = false;
      }
    );

    // 맵에 레이어 추가
    map.addLayer(clusterLayer);

    // 레이어 저장
    wfsLayers[layerName] = clusterLayer;
    wfsActive[layerName] = false;

    console.log(
      `WFS 클러스터 레이어 생성됨: ${config.name} (데이터 로드 대기 중)`
    );
  });

  // 성능 최적화된 맵 클릭 이벤트 (디바운싱 적용)
  let clickTimeout;
  MapEventManager.registerClickHandler("wfs-general-click", function (evt) {
    if (clickTimeout) {
      clearTimeout(clickTimeout);
    }

    clickTimeout = setTimeout(() => {
      const map = getMap();
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
    }, 50); // 50ms 디바운싱
  });

  // 성능 최적화된 마우스 오버 이벤트 (스로틀링 적용)
  let pointerMoveTimeout;
  let lastCursorState = null;

  MapEventManager.registerPointerMoveHandler(
    "wfs-pointer-move",
    function (evt) {
      if (pointerMoveTimeout) {
        clearTimeout(pointerMoveTimeout);
      }

      pointerMoveTimeout = setTimeout(() => {
        const map = getMap();
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

        // 커서 상태가 변경된 경우에만 업데이트 (성능 최적화)
        const newCursorState = hasWfsFeature ? "pointer" : "";
        if (newCursorState !== lastCursorState) {
          map.getTargetElement().style.cursor = newCursorState;
          lastCursorState = newCursorState;
        }
      }, 16); // 약 60fps로 제한
    }
  );

  // 전역 변수로 저장
  window.wfsLayers = wfsLayers;
  window.wfsActive = wfsActive;
  window.wfsDataCache = wfsDataCache;
  window.wfsVectorSources = wfsVectorSources;
  window.wfsDataLoaded = wfsDataLoaded;

  // 초기화 완료 플래그 설정
  wfsInitialized = true;
  window.wfsLayersInitialized = true;
  console.log("WFS 레이어 초기화 완료");
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
  const map = getMap(); // 맵 인스턴스를 먼저 가져옴

  // 이미 로드된 경우 캐시된 데이터 사용
  if (wfsDataLoaded[layerName] && wfsDataCache[layerName]) {
    console.log(
      `${config.name} 캐시된 데이터 사용: ${wfsDataCache[layerName].length} 개 피처`
    );

    // 벡터 소스가 비어있는 경우에만 피처 추가 (중복 방지)
    const currentFeatures = vectorSource.getFeatures();
    if (currentFeatures.length === 0) {
      // 모든 데이터 추가 (뷰포트 필터링 제거)
      // const currentExtent = map.getView().calculateExtent(map.getSize());
      // const filteredFeatures = wfsDataCache[layerName].filter((feature) => {
      //   const geometry = feature.getGeometry();
      //   if (!geometry) return false;
      //   return geometry.intersectsExtent(currentExtent);
      // });
      vectorSource.addFeatures(wfsDataCache[layerName]);
      console.log(
        `${config.name} 전체 데이터: ${wfsDataCache[layerName].length} 개 피처`
      );
    }

    return Promise.resolve();
  }

  // 로딩 시작 표시
  showLoadingMessage(`${config.name} 데이터 로딩 중...`);
  updateLoadingProgress(10);

  // 점진적 로딩 진행을 위한 타이머 (더 자연스러운 진행률)
  let progressInterval = setInterval(() => {
    const currentProgress = parseInt(
      document.querySelector("#wfs-progress")?.style.width || "0%"
    );

    // 서버 응답을 기다리는 동안 10%에서 70%까지 천천히 증가
    if (currentProgress < 70) {
      // 진행률이 낮을 때는 빠르게, 높을 때는 천천히 증가
      let increment = 0.5; // 기본 증가값

      // 진행률 구간별 증가값 조정 (더 명확한 구간 설정)
      if (currentProgress < 30) {
        increment = 1.2; // 서버 연결 중 (10-30%) - 더 빠르게
      } else if (currentProgress < 50) {
        increment = 1.0; // 데이터 요청 중 (30-50%) - 확실히 진행
      } else if (currentProgress < 70) {
        increment = 0.8; // 서버 응답 대기 중 (50-70%) - 적당히
      }

      // 서버 응답 시간이 길어질수록 더 천천히 증가
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > 5000) {
        // 5초 이상 걸리면 더 천천히
        increment *= 0.4;
      } else if (elapsedTime > 3000) {
        // 3초 이상 걸리면 더 천천히
        increment *= 0.6;
      } else if (elapsedTime > 2000) {
        // 2초 이상 걸리면 조금 천천히
        increment *= 0.8;
      }

      // 최소 증가값 보장 (너무 느리지 않도록)
      increment = Math.max(increment, 0.4);

      updateLoadingProgress(currentProgress + increment);

      // 디버깅용 로그 (개발 중에만 사용)
      console.log(
        `진행률: ${currentProgress.toFixed(1)}% → ${(
          currentProgress + increment
        ).toFixed(1)}% (${config.name}) - 구간: ${
          currentProgress < 30
            ? "서버 연결"
            : currentProgress < 50
            ? "데이터 요청"
            : "서버 응답 대기"
        }`
      );

      // 로딩 메시지 업데이트 (진행 상황에 따라)
      if (currentProgress < 30) {
        showLoadingMessage(`${config.name} 서버 연결 중...`);
      } else if (currentProgress < 50) {
        showLoadingMessage(`${config.name} 데이터 요청 중...`);
      } else {
        showLoadingMessage(`${config.name} 서버 응답 대기 중...`);
      }
    }
  }, 100); // 100ms마다 업데이트 (더 부드러운 진행)

  // 서버 요청 시작 시간 기록
  const startTime = Date.now();
  let isServerResponded = false;

  return fetch(config.url)
    .then((response) => {
      // 서버 응답 시작
      isServerResponded = true;
      const responseTime = Date.now() - startTime;
      console.log(`${config.name} 서버 응답 시간: ${responseTime}ms`);

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

      // 서버 응답 후 데이터 처리 시작 (70%에서 90%로 점진적 증가)
      let dataProcessInterval = setInterval(() => {
        const currentProgress = parseInt(
          document.querySelector("#wfs-progress")?.style.width || "70%"
        );

        if (currentProgress < 90) {
          updateLoadingProgress(currentProgress + 1); // 더 작은 증가값

          // 데이터 처리 단계 메시지 업데이트
          if (currentProgress < 80) {
            showLoadingMessage(`${config.name} 데이터 파싱 중...`);
          } else {
            showLoadingMessage(`${config.name} 지도에 표시 중...`);
          }
        } else {
          clearInterval(dataProcessInterval);
        }
      }, 80); // 더 빠른 업데이트로 부드러운 진행

      const features = vectorSource.getFormat().readFeatures(data, {
        dataProjection: "EPSG:4326",
        featureProjection: vectorSource.getProjection(),
      });

      // 데이터를 캐시에 저장
      wfsDataCache[layerName] = features;
      wfsDataLoaded[layerName] = true;

      // 모든 데이터 추가 (뷰포트 필터링 제거)
      // const currentExtent = map.getView().calculateExtent(map.getSize());
      // const filteredFeatures = features.filter((feature) => {
      //   const geometry = feature.getGeometry();
      //   if (!geometry) return false;
      //   return geometry.intersectsExtent(currentExtent);
      // });
      vectorSource.addFeatures(features);

      console.log(
        `${config.name} 데이터 로드 완료: ${features.length} 개 피처`
      );

      // 첫 번째 피처의 속성 확인 (디버깅용)
      if (features.length > 0) {
        const firstFeature = features[0];
        console.log("첫 번째 피처 속성:", firstFeature.getProperties());
      }

      // 데이터 로드 완료 후 클러스터 거리 설정 (성능 최적화)
      const clusterSource = wfsLayers[layerName].getSource();

      if (map && map.getView) {
        const zoomLevel = map.getView().getZoom();
        let clusterDistance = 200; // 기본값을 더 크게 설정하여 성능 향상

        if (zoomLevel >= 16)
          clusterDistance = 0; // 줌 레벨 16 이상에서는 클러스터링 완전 비활성화
        else if (zoomLevel <= 8) clusterDistance = 100; // 더 작게
        else if (zoomLevel <= 10) clusterDistance = 80; // 더 작게
        else if (zoomLevel <= 12) clusterDistance = 60; // 더 작게
        else if (zoomLevel <= 14) clusterDistance = 40; // 더 작게
        else clusterDistance = 30; // 줌 레벨 15에서 매우 작은 클러스터 거리

        // 현재 설정된 거리와 다른 경우에만 업데이트 (성능 최적화)
        const currentDistance = clusterSource.getDistance();
        if (clusterDistance !== currentDistance) {
          clusterSource.setDistance(clusterDistance);
          console.log(
            `${config.name} 클러스터 거리 설정: ${clusterDistance} (줌 레벨: ${zoomLevel})`
          );
        }
      } else {
        console.warn(
          "맵 인스턴스를 찾을 수 없어 기본 클러스터 거리를 사용합니다."
        );
        // 기본값도 현재 설정과 다른 경우에만 업데이트
        const currentDistance = clusterSource.getDistance();
        if (200 !== currentDistance) {
          clusterSource.setDistance(200); // 기본값을 더 크게 설정
        }
      }

      // 데이터 처리 완료 후 진행률을 100%로 설정
      clearInterval(dataProcessInterval);
      updateLoadingProgress(100);

      // 완료 메시지 표시
      showLoadingMessage(`${config.name} 로딩 완료!`);

      // 완료 후 잠시 대기 후 팝업 숨기기
      setTimeout(() => {
        hideLoadingMessage();
      }, 800); // 완료 메시지를 더 오래 보여줌
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

// 줌 레벨과 뷰포트 기반 데이터 필터링 함수 (현재 사용하지 않음)
/*
function filterFeaturesByZoomAndViewport(features, layerName) {
  const map = getMap();
  if (!map || !map.getView) {
    console.warn("맵 객체를 찾을 수 없습니다.");
    return features; // 맵이 없으면 전체 데이터 반환
  }

  const zoomLevel = map.getView().getZoom();
  const extent = map.getView().calculateExtent(map.getSize());

  console.log(
    `필터링 시작 - 줌레벨: ${zoomLevel}, 뷰포트: [${extent.join(
      ", "
    )}], 전체 피처: ${features.length}개`
  );

  // 뷰포트 내 피처만 필터링 (데이터 수 제한 없음)
  const viewportFeatures = features.filter((feature) => {
    const geometry = feature.getGeometry();
    if (!geometry) {
      console.warn("피처에 지오메트리가 없습니다:", feature);
      return false;
    }

    // 피처가 뷰포트 내에 있는지 확인
    const isInViewport = geometry.intersectsExtent(extent);
    return isInViewport;
  });

  console.log(`필터링 완료 - 뷰포트 내 피처: ${viewportFeatures.length}개`);

  return viewportFeatures;
}
*/

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

          // 클러스터는 자동으로 업데이트되므로 별도 refresh 불필요
          // (데이터가 이미 vectorSource에 추가되어 있음)

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
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(loadingDiv);
  }

  // 메시지만 업데이트하고 진행률 바는 유지
  const messageDiv = loadingDiv.querySelector(".loading-message");
  if (messageDiv) {
    messageDiv.textContent = message;
  } else {
    loadingDiv.innerHTML = `
      <div class="loading-message" style="margin-bottom: 10px;">${message}</div>
      <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px;">
        <div id="wfs-progress" style="width: 0%; height: 100%; background: #ff6b35; border-radius: 2px; transition: width 0.3s ease;"></div>
      </div>
    `;
  }

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
    // 진행률을 부드럽게 업데이트
    progressBar.style.transition = "width 0.3s ease";
    progressBar.style.width = Math.min(percent, 100) + "%";

    // 진행률에 따라 색상 변경 (시각적 피드백)
    if (percent < 30) {
      progressBar.style.background = "#ff6b35"; // 주황색 (서버 연결 중)
    } else if (percent < 50) {
      progressBar.style.background = "#ffa726"; // 밝은 주황색 (데이터 요청 중)
    } else if (percent < 70) {
      progressBar.style.background = "#4CAF50"; // 초록색 (서버 응답 대기 중)
    } else if (percent < 100) {
      progressBar.style.background = "#2196F3"; // 파란색 (데이터 처리 중)
    } else {
      progressBar.style.background = "#4CAF50"; // 완료 시 초록색
    }
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

// 교통 관련 기능 함수들
function showBusInfo() {
  console.log("버스 기능 실행");
  alert(
    "버스 기능이 활성화되었습니다.\n버스 정류장 및 노선 정보를 확인할 수 있습니다."
  );
}

function showSubwayInfo() {
  console.log("지하철 기능 실행");
  alert(
    "지하철 기능이 활성화되었습니다.\n지하철역 및 노선 정보를 확인할 수 있습니다."
  );
}

function showTrafficInfo() {
  console.log("교통정보 기능 실행");
  alert(
    "교통정보 기능이 활성화되었습니다.\n실시간 교통 상황을 확인할 수 있습니다."
  );
}

function showCctvInfo() {
  console.log("CCTV 기능 실행");
  alert("CCTV 기능이 활성화되었습니다.\n도로 CCTV 영상을 확인할 수 있습니다.");
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

// 교통 관련 함수들 추가
window.showBusInfo = showBusInfo;
window.showSubwayInfo = showSubwayInfo;
window.showTrafficInfo = showTrafficInfo;
window.showCctvInfo = showCctvInfo;

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
  showBusInfo,
  showSubwayInfo,
  showTrafficInfo,
  showCctvInfo,
  showNearbyConvenienceStores,
  showConvenienceStoreSearch,
  showConvenienceStoreFilter,
  showConvenienceStoreInfo,
};

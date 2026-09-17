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
// 이미 캐시에 넣은 피처 id 집합 (중복 추가 방지)
let wfsCachedFeatureIds = {};

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
  bus_stop: {
    url: getApiUrl("/map/busStop-info"),
    name: "버스정류장",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/busStop.png",
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
  cctv: {
    url: getApiUrl("/map/cctv-info"),
    name: "CCTV",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/cctv.png",
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
  pharmacy: {
    url: getApiUrl("/map/pharmacy-info"),
    name: "약국",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/pharmacy.png",
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
  hospital: {
    url: getApiUrl("/map/hospital-info"),
    name: "병원",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/hospital.png",
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
  government_office: {
    url: getApiUrl("/map/governmentOffice-info"),
    name: "관공서",
    style: {
      image: new ol.style.Icon({
        src: "images/icon/governmentOffice.png",
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

// 원본 GeoJSON 피처(파싱 전) 중 확장영역과 겹치는 Point 피처만 남기는 저비용 사전 필터
// OL Feature 객체를 만들기 전에 필터링해서 최초 로드 시 불필요한 readFeatures 비용을 줄이는 용도.
// readFeatures가 좌표를 변환하지 않고 그대로 사용하므로(아래 loadWfsData 주석 참고),
// 여기서 쓰는 extent도 원본 좌표와 같은 좌표계(=뷰 좌표계)여야 함.
const filterRawPointFeaturesByExtent = (rawFeatures, extent) => {
  return rawFeatures.filter((rawFeature) => {
    const geometry = rawFeature && rawFeature.geometry;
    // Point가 아니거나 좌표를 알 수 없는 피처는 안전하게 포함시켜 데이터 누락을 방지
    if (
      !geometry ||
      geometry.type !== "Point" ||
      !Array.isArray(geometry.coordinates)
    ) {
      return true;
    }
    const [x, y] = geometry.coordinates;
    return x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3];
  });
};

// ─────────────────────────────────────────────────────────────
// 전체 데이터 조회
//
// 서버에는 영역(bbox)·개수(limit) 조건을 넘기지 않고 레이어의 전체 데이터를 한 번만 받는다.
// 받아온 데이터는 wfsDataCache 에 보관하고, 이후 지도 이동·줌은 서버를 다시 부르지 않고
// 캐시에서 화면 영역에 들어오는 피처를 개수 제한 없이 모두 그린다.
// ─────────────────────────────────────────────────────────────

// 레이어별 진행 중인 전체 조회 Promise (켜기 버튼을 연달아 눌러도 요청이 한 번만 나가게 함)
const wfsLoadPromises = {};

// 받아온 피처를 캐시에 합친다(id 기준 중복 제거). 새로 추가된 피처 수를 돌려준다.
const mergeFeaturesIntoCache = (layerName, features) => {
  if (!wfsDataCache[layerName]) wfsDataCache[layerName] = [];
  if (!wfsCachedFeatureIds[layerName]) wfsCachedFeatureIds[layerName] = new Set();

  const knownIds = wfsCachedFeatureIds[layerName];
  let added = 0;

  features.forEach((feature) => {
    const id = feature.getId();
    // id 가 없는 피처는 중복 판정을 할 수 없으므로 그대로 넣는다(서버는 항상 id를 내려줌)
    if (id === undefined) {
      wfsDataCache[layerName].push(feature);
      added += 1;
      return;
    }
    if (knownIds.has(id)) return;
    knownIds.add(id);
    wfsDataCache[layerName].push(feature);
    added += 1;
  });

  return added;
};

// 캐시에서 현재 화면에 들어오는 피처를 모두(개수 제한 없이) 벡터 소스에 그린다
const renderLayerFromCache = (layerName, extent, zoomLevel) => {
  const vectorSource = wfsVectorSources[layerName];
  const config = WFS_CONFIG[layerName];
  if (!vectorSource || !wfsDataCache[layerName]) return;

  const viewportFeatures = wfsDataCache[layerName].filter((feature) => {
    const geometry = feature.getGeometry();
    if (!geometry) return false;
    return geometry.intersectsExtent(extent);
  });

  vectorSource.clear();
  vectorSource.addFeatures(viewportFeatures);

  console.log(
    `${config.name}: 뷰포트 내 ${viewportFeatures.length}개 모두 표출 (줌 레벨: ${zoomLevel})`
  );
};

// 지도의 현재 화면 기준으로 캐시를 다시 그린다 (백그라운드 파싱이 끝났을 때 사용)
const renderLayerForCurrentView = (layerName) => {
  const map = getMap();
  const mapSize = map && map.getSize ? map.getSize() : null;
  if (!map || !mapSize) return;
  renderLayerFromCache(
    layerName,
    map.getView().calculateExtent(mapSize),
    map.getView().getZoom()
  );
};

// 레이어의 전체 데이터를 서버에서 받아 캐시에 넣는다.
// 화면 안쪽 피처를 먼저 파싱해 바로 그리고, 나머지는 백그라운드에서 나눠 파싱한 뒤 다시 그린다
// (수십 MB 응답을 한 번에 readFeatures 하면 메인 스레드가 수 초간 멈추기 때문).
function fetchAllWfsFeatures(layerName, extent, zoomLevel) {
  const config = WFS_CONFIG[layerName];
  const vectorSource = wfsVectorSources[layerName];
  const startTime = Date.now();

  return fetch(config.url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const rawFeatures = Array.isArray(data.features) ? data.features : [];
      console.log(
        `${config.name} 전체 데이터 수신: ${rawFeatures.length}개 (${Date.now() - startTime}ms)`
      );

      const format = vectorSource.getFormat();
      // 기존 동작 유지: vectorSource.getProjection()은 null이라 readFeatures가 좌표를 변환하지 않고
      // 원본 좌표를 그대로 사용함(응답 좌표가 이미 뷰 좌표계). 여기에 실제 투영을 넘기면 좌표가 어긋나 레이어가 표시되지 않음.
      const featureProjection = vectorSource.getProjection();

      const viewportRawFeatures = filterRawPointFeaturesByExtent(rawFeatures, extent);
      const viewportFeatures = format.readFeatures(
        { type: "FeatureCollection", features: viewportRawFeatures },
        { dataProjection: "EPSG:4326", featureProjection }
      );

      mergeFeaturesIntoCache(layerName, viewportFeatures);
      wfsDataLoaded[layerName] = true;
      renderLayerFromCache(layerName, extent, zoomLevel);

      const viewportRawSet = new Set(viewportRawFeatures);
      scheduleBackgroundFeatureCaching(
        layerName,
        rawFeatures.filter((rawFeature) => !viewportRawSet.has(rawFeature)),
        format,
        featureProjection,
        () => renderLayerForCurrentView(layerName)
      );
    });
}

// 화면에 먼저 그리지 않은 나머지 원본 피처를 백그라운드에서 청크 단위로 파싱해 캐시를 채움
// (팬/줌 시 wfs-move 핸들러가 wfsDataCache를 참조하므로, 메인 스레드를 막지 않고 점진적으로 채워넣음)
function scheduleBackgroundFeatureCaching(
  layerName,
  rawFeatures,
  format,
  featureProjection,
  onComplete,
  chunkSize = 1000
) {
  if (!rawFeatures.length) {
    if (onComplete) onComplete();
    return;
  }

  const scheduleIdle =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback
      : (callback) => setTimeout(callback, 16);

  let index = 0;

  const processChunk = () => {
    const chunk = rawFeatures.slice(index, index + chunkSize);
    index += chunkSize;

    const parsedChunk = format.readFeatures(
      { type: "FeatureCollection", features: chunk },
      { dataProjection: "EPSG:4326", featureProjection }
    );

    mergeFeaturesIntoCache(layerName, parsedChunk);

    if (index < rawFeatures.length) {
      scheduleIdle(processChunk);
    } else {
      console.log(
        `${WFS_CONFIG[layerName].name}: 백그라운드 캐싱 완료 (총 ${wfsDataCache[layerName].length}개)`
      );
      if (onComplete) onComplete();
    }
  };

  scheduleIdle(processChunk);
}

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
    console.log(`WFS 레이어 초기화 중: ${layerName} (${config.name})`);

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

    // 줌 레벨에 따른 스타일 함수 (아이콘 + 텍스트)
    const zoomBasedStyle = function (feature) {
      const properties = feature.getProperties();

      // 레이어에 따라 다른 텍스트 표시
      let displayText = "";
      if (layerName === "bus_stop") {
        displayText = properties.stop_name || "정류장";
      } else if (layerName === "cctv") {
        displayText = properties.cctv_name || properties.name || "CCTV";
      } else if (layerName === "pharmacy") {
        displayText = properties.duty_name || properties.fclty_nm || "약국";
      } else if (layerName === "hospital") {
        displayText = properties.duty_name || properties.fclty_nm || "병원";
      } else if (layerName === "government_office") {
        displayText = properties.duty_name || properties.fclty_nm || "관공서";
      } else {
        displayText = properties.fclty_nm || "편의점";
      }

      // 줌 레벨에 따라 텍스트 표시 여부 결정
      const currentZoom = getMap().getView().getZoom();
      const showText = currentZoom >= 14; // 줌 레벨 14 이상에서만 텍스트 표시

      const styles = [
        new ol.style.Style({
          image: new ol.style.Icon({
            src: config.style.image.getSrc(),
            scale: 1.0,
            anchor: [0.5, 1.0],
            offset: [0, 0],
            opacity: 1.0,
            rotation: 0,
            size: [32, 32],
            imgSize: [32, 32],
          }),
        }),
      ];

      // 줌 레벨이 충분히 높으면 텍스트 추가
      if (showText && displayText) {
        styles.push(
          new ol.style.Style({
            text: new ol.style.Text({
              text: displayText,
              font: "bold 12px Arial", // 글씨 크기 증가
              fill: new ol.style.Fill({
                color: "#333333",
              }),
              stroke: new ol.style.Stroke({
                color: "#ffffff",
                width: 2,
              }),
              offsetY: 12, // 아이콘과의 거리 감소
              textAlign: "center",
              textBaseline: "top",
            }),
          })
        );
      }

      return styles;
    };

    // 벡터 레이어 생성 (클러스터 없이 개별 아이콘 표시)
    const vectorLayer = new ol.layer.Vector({
      source: vectorSource,
      style: zoomBasedStyle,
      visible: false, // 초기에는 비활성화
      renderBuffer: 100, // 렌더링 버퍼 증가
      updateWhileAnimating: false, // 애니메이션 중 업데이트 비활성화
      updateWhileInteracting: false, // 상호작용 중 업데이트 비활성화
      declutter: true, // 피처 겹침 방지
      zIndex: 1000,
      renderOrder: null, // 렌더링 순서 최적화
      extent: undefined, // 전체 범위 렌더링
      minResolution: 0, // 최소 해상도 제한 없음
      maxResolution: Infinity, // 최대 해상도 제한 없음
    });

    // 줌 레벨 변경 시 스타일 업데이트
    map.getView().on("change:resolution", function () {
      if (vectorLayer.getVisible()) {
        vectorLayer.changed(); // 레이어 강제 업데이트
      }
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

        // 줌 레벨이 변경된 경우 또는 뷰포트가 변경된 경우 필터링 적용
        if (
          currentZoom &&
          (currentZoom !== lastZoomLevel ||
            !lastExtent ||
            !ol.extent.equals(currentExtent, lastExtent))
        ) {
          lastZoomLevel = currentZoom;
          lastExtent = currentExtent;

          // 레이어를 켠 적이 없으면 여기서 데이터를 받아오지 않는다(켤 때 loadWfsData 가 받음)
          if (!wfsDataLoaded[layerName]) {
            wfsUpdating[layerName] = false;
            return;
          }

          // 전체 데이터를 이미 받아두었으므로 서버를 다시 부르지 않고 캐시로만 그린다
          renderLayerFromCache(layerName, currentExtent, currentZoom);
        }

        // 업데이트 상태 해제
        wfsUpdating[layerName] = false;
      }
    );

    // 맵에 레이어 추가
    map.addLayer(vectorLayer);

    // 레이어 저장
    wfsLayers[layerName] = vectorLayer;
    wfsActive[layerName] = false;

    console.log(`WFS 벡터 레이어 생성됨: ${config.name} (데이터 로드 대기 중)`);
    console.log(`저장된 레이어: ${layerName}`, vectorLayer);
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
        // 피처 정보 표시
        console.log("피처 클릭:", feature.getProperties());
        displayWfsFeatureInfo(evt);
      }
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
  console.log("생성된 레이어들:", Object.keys(wfsLayers));
  console.log("약국 레이어:", wfsLayers.pharmacy);
  console.log("병원 레이어:", wfsLayers.hospital);
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
// 처음 켤 때 전체 데이터를 한 번 받아오고, 그 뒤에는 캐시로 바로 그린다.
function loadWfsData(layerName) {
  const config = WFS_CONFIG[layerName];
  const vectorSource = wfsVectorSources[layerName];
  const map = getMap();

  const mapSize = map && map.getSize ? map.getSize() : null;
  if (!map || !map.getView || !mapSize) {
    console.error(`${config.name}: 맵이 준비되지 않아 데이터를 불러올 수 없습니다.`);
    return Promise.resolve();
  }

  const currentExtent = map.getView().calculateExtent(mapSize);
  const currentZoom = map.getView().getZoom();

  // 이미 전체 데이터를 받아두었으면 서버를 다시 부르지 않고 캐시로 바로 그린다
  if (wfsDataLoaded[layerName]) {
    console.log(`${config.name} 캐시 사용: ${wfsDataCache[layerName].length}개 보유`);
    renderLayerFromCache(layerName, currentExtent, currentZoom);
    return Promise.resolve();
  }

  // 이미 받아오는 중이면 같은 요청을 기다린다
  if (wfsLoadPromises[layerName]) {
    return wfsLoadPromises[layerName];
  }

  const startTime = Date.now();
  const firstLoadHint = "⚡ 처음 한 번만 전체 데이터를 불러옵니다. 다시 켤 때는 바로 표시됩니다.";

  // 점진적 로딩 진행 타이머: 실제 진행률이 아니라 "아직 작업 중"임을 알리는 용도.
  let progress = 10;
  updateLoadingProgress(progress);
  showLoadingMessage(`${config.name} 데이터를 불러오는 중...`, firstLoadHint);

  const progressInterval = setInterval(() => {
    if (progress < 75) {
      progress = Math.min(progress + 0.8, 75);
      updateLoadingProgress(progress);
    }
  }, 300);

  wfsLoadPromises[layerName] = fetchAllWfsFeatures(layerName, currentExtent, currentZoom)
    .then(() => {
      clearInterval(progressInterval);

      console.log(
        `${config.name} 표시 완료: ${vectorSource.getFeatures().length}개 (총 ${Date.now() - startTime}ms)`
      );

      updateLoadingProgress(100);
      showLoadingMessage(
        `${config.name} 데이터 로딩 완료!`,
        "이제 껐다 켜도 기다림 없이 바로 표시됩니다."
      );

      setTimeout(() => {
        hideLoadingMessage();
      }, 800);
    })
    .catch((error) => {
      clearInterval(progressInterval);
      console.error(`${config.name} 데이터 로드 실패:`, error);
      hideLoadingMessage();
      throw error;
    })
    .finally(() => {
      delete wfsLoadPromises[layerName];
    });

  return wfsLoadPromises[layerName];
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

// 버스정류장 레이어 토글 (UI에서 사용) - WFS 전용
function toggleBusStop() {
  // WFS 레이어 사용
  if (wfsLayers.bus_stop) {
    const layer = wfsLayers.bus_stop;
    const isVisible = layer.getVisible();

    if (!isVisible) {
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("bus_stop")
        .then(() => {
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.bus_stop = true;

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.bus_stop &&
            window.wmsActive.bus_stop
          ) {
            window.toggleWmsLayer("bus_stop");
          }

          // 버튼 상태 업데이트
          const button = document.querySelector('[data-transport="bus"]');
          if (button) {
            button.classList.add("active");
            button.title = "버스정류장 레이어 끄기";
          }
        })
        .catch((error) => {
          console.error("버스정류장 데이터 로드 실패:", error);
          alert("버스정류장 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.bus_stop = false;

      // 버튼 상태 업데이트
      const button = document.querySelector('[data-transport="bus"]');
      if (button) {
        button.classList.remove("active");
        button.title = "버스정류장 레이어 켜기";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS 버스정류장 레이어를 찾을 수 없습니다.");
    alert("버스정류장 레이어를 사용할 수 없습니다.");
    return false;
  }
}

// CCTV 레이어 토글 (UI에서 사용) - WFS 전용
function toggleCctv() {
  // WFS 레이어 사용
  if (wfsLayers.cctv) {
    const layer = wfsLayers.cctv;
    const isVisible = layer.getVisible();

    if (!isVisible) {
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("cctv")
        .then(() => {
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.cctv = true;

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.cctv &&
            window.wmsActive.cctv
          ) {
            window.toggleWmsLayer("cctv");
          }

          // 버튼 상태 업데이트
          const button = document.querySelector('[data-transport="cctv"]');
          if (button) {
            button.classList.add("active");
            button.title = "CCTV 레이어 끄기";
          }
        })
        .catch((error) => {
          console.error("CCTV 데이터 로드 실패:", error);
          alert("CCTV 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.cctv = false;

      // 버튼 상태 업데이트
      const button = document.querySelector('[data-transport="cctv"]');
      if (button) {
        button.classList.remove("active");
        button.title = "CCTV 레이어 켜기";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS CCTV 레이어를 찾을 수 없습니다.");
    alert("CCTV 레이어를 사용할 수 없습니다.");
    return false;
  }
}

// 약국 레이어 토글 (UI에서 사용) - WFS 전용
function togglePharmacy() {
  console.log("togglePharmacy 호출됨");
  console.log("wfsLayers.pharmacy:", wfsLayers.pharmacy);
  console.log("전체 wfsLayers:", wfsLayers);

  // WFS 레이어 사용
  if (wfsLayers.pharmacy) {
    const layer = wfsLayers.pharmacy;
    const isVisible = layer.getVisible();
    console.log("약국 레이어 현재 가시성:", isVisible);

    if (!isVisible) {
      console.log("약국 레이어 활성화 시작");
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("pharmacy")
        .then(() => {
          console.log("약국 데이터 로드 완료");
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.pharmacy = true;
          console.log("약국 레이어 가시성 설정됨:", layer.getVisible());

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.pharmacy &&
            window.wmsActive.pharmacy
          ) {
            window.toggleWmsLayer("pharmacy");
          }

          // 버튼 상태 업데이트
          const button = document.querySelector('[data-amenity="pharmacy"]');
          if (button) {
            button.classList.add("active");
            button.title = "약국 레이어 끄기";
            console.log("약국 버튼 활성화됨");
          }
        })
        .catch((error) => {
          console.error("약국 데이터 로드 실패:", error);
          alert("약국 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      console.log("약국 레이어 비활성화");
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.pharmacy = false;

      // 버튼 상태 업데이트
      const button = document.querySelector('[data-amenity="pharmacy"]');
      if (button) {
        button.classList.remove("active");
        button.title = "약국 레이어 켜기";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS 약국 레이어를 찾을 수 없습니다.");
    console.log("사용 가능한 레이어들:", Object.keys(wfsLayers));
    alert("약국 레이어를 사용할 수 없습니다.");
    return false;
  }
}

// 병원 레이어 토글 (UI에서 사용) - WFS 전용
function toggleHospital() {
  console.log("toggleHospital 호출됨");
  console.log("wfsLayers.hospital:", wfsLayers.hospital);
  console.log("전체 wfsLayers:", wfsLayers);

  // WFS 레이어 사용
  if (wfsLayers.hospital) {
    const layer = wfsLayers.hospital;
    const isVisible = layer.getVisible();
    console.log("병원 레이어 현재 가시성:", isVisible);

    if (!isVisible) {
      console.log("병원 레이어 활성화 시작");
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("hospital")
        .then(() => {
          console.log("병원 데이터 로드 완료");
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.hospital = true;
          console.log("병원 레이어 가시성 설정됨:", layer.getVisible());

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.hospital &&
            window.wmsActive.hospital
          ) {
            window.toggleWmsLayer("hospital");
          }

          // 버튼 상태 업데이트
          const button = document.querySelector('[data-amenity="hospital"]');
          if (button) {
            button.classList.add("active");
            button.title = "병원 레이어 끄기";
            console.log("병원 버튼 활성화됨");
          }
        })
        .catch((error) => {
          console.error("병원 데이터 로드 실패:", error);
          alert("병원 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      console.log("병원 레이어 비활성화");
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.hospital = false;

      // 버튼 상태 업데이트
      const button = document.querySelector('[data-amenity="hospital"]');
      if (button) {
        button.classList.remove("active");
        button.title = "병원 레이어 켜기";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS 병원 레이어를 찾을 수 없습니다.");
    console.log("사용 가능한 레이어들:", Object.keys(wfsLayers));
    alert("병원 레이어를 사용할 수 없습니다.");
    return false;
  }
}

// 관공서 레이어 토글 (UI에서 사용) - WFS 전용
function toggleGovernmentOffice() {
  console.log("toggleGovernmentOffice 호출됨");
  console.log("wfsLayers.government_office:", wfsLayers.government_office);
  console.log("전체 wfsLayers:", wfsLayers);

  // WFS 레이어 사용
  if (wfsLayers.government_office) {
    const layer = wfsLayers.government_office;
    const isVisible = layer.getVisible();
    console.log("관공서 레이어 현재 가시성:", isVisible);

    if (!isVisible) {
      console.log("관공서 레이어 활성화 시작");
      // 레이어를 활성화할 때 데이터 로드
      loadWfsData("government_office")
        .then(() => {
          console.log("관공서 데이터 로드 완료");
          // 데이터 로드 완료 후 레이어 활성화
          layer.setVisible(true);
          wfsActive.government_office = true;
          console.log("관공서 레이어 가시성 설정됨:", layer.getVisible());

          // WMS 레이어가 활성화되어 있다면 비활성화
          if (
            window.wmsLayers &&
            window.wmsLayers.government_office &&
            window.wmsActive.government_office
          ) {
            window.toggleWmsLayer("government_office");
          }

          // 버튼 상태 업데이트
          const button = document.querySelector(
            '[data-amenity="government_office"]'
          );
          if (button) {
            button.classList.add("active");
            button.title = "관공서 레이어 끄기";
            console.log("관공서 버튼 활성화됨");
          }
        })
        .catch((error) => {
          console.error("관공서 데이터 로드 실패:", error);
          alert("관공서 데이터를 불러오는데 실패했습니다.");
        });
    } else {
      console.log("관공서 레이어 비활성화");
      // 레이어를 비활성화
      layer.setVisible(false);
      wfsActive.government_office = false;

      // 버튼 상태 업데이트
      const button = document.querySelector(
        '[data-amenity="government_office"]'
      );
      if (button) {
        button.classList.remove("active");
        button.title = "관공서 레이어 켜기";
      }
    }

    return !isVisible;
  } else {
    // WFS 레이어가 없으면 오류 메시지
    console.error("WFS 관공서 레이어를 찾을 수 없습니다.");
    console.log("사용 가능한 레이어들:", Object.keys(wfsLayers));
    alert("관공서 레이어를 사용할 수 없습니다.");
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

  // 레이어에 따라 다른 팝업 내용 생성
  let content = "";

  if (layerName === "bus_stop") {
    // 버스정류장 팝업
    content = `<div class="wfs-popup-header">
      <div class="wfs-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" />
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" />
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" />
        </svg>
        버스정류장 정보
      </div>
      <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
    </div>
    <div class="wfs-popup-content">
      <div class="wfs-info-item">
        <span class="wfs-info-label">정류장명</span>
        <span class="wfs-info-value">${getPropertyValue(
          properties,
          "stop_name"
        )}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">관리도시명</span>
        <span class="wfs-info-value">${getPropertyValue(
          properties,
          "city_mgmt_name"
        )}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">도시명</span>
        <span class="wfs-info-value">${getPropertyValue(
          properties,
          "city_name"
        )}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">정보수집일</span>
        <span class="wfs-info-value">${getPropertyValue(
          properties,
          "collected_on"
        )}</span>
      </div>
    </div>`;
  } else if (layerName === "cctv") {
    // CCTV 팝업
    // 가능한 모든 URL 속성명 시도
    let cctvUrl = "";
    const possibleUrlKeys = [
      "stream_url",
      "hls_url",
      "url",
      "video_url",
      "streaming_url",
      "cctv_url",
      "live_url",
      "rtsp_url",
      "rtmp_url",
    ];

    for (const key of possibleUrlKeys) {
      const value = getPropertyValue(properties, key);
      if (
        value &&
        value !== "정보 없음" &&
        value !== "null" &&
        value.trim() !== ""
      ) {
        cctvUrl = value;

        // 현재 웹의 프로토콜에 따라 URL 프로토콜 변경
        if (window.location.protocol === "https:") {
          cctvUrl = cctvUrl.replaceAll("http:", "https:");
        }

        break;
      }
    }

    // 디버깅: 원본 URL 값 확인
    console.log("CCTV 원본 URL:", cctvUrl);
    console.log("CCTV properties:", properties);
    console.log("CCTV 모든 속성 키:", Object.keys(properties));
    console.log("CCTV 속성 값들:", Object.entries(properties));

    // URL 유효성 검사 - 실제 URL인지 확인
    const isValidUrl =
      cctvUrl &&
      (cctvUrl.startsWith("http://") ||
        cctvUrl.startsWith("https://") ||
        cctvUrl.startsWith("rtmp://") ||
        cctvUrl.startsWith("rtsp://")) &&
      !cctvUrl.includes("정보 없음") &&
      !cctvUrl.includes("null") &&
      cctvUrl.trim() !== "";

    console.log("CCTV URL 유효성:", isValidUrl);

    if (!isValidUrl) {
      cctvUrl = "";
    }
    content = `<div class="wfs-popup-header">
      <div class="wfs-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="2" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
          <path d="M12 15V18" stroke="currentColor" stroke-width="2" />
          <path d="M9 18H15" stroke="currentColor" stroke-width="2" />
        </svg>
        CCTV 정보
      </div>
      <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
    </div>
        <div class="wfs-popup-content">
      <div class="wfs-info-item">
        <span class="wfs-info-label">CCTV명</span>
        <span class="wfs-info-value">${getPropertyValue(
          properties,
          "cctv_name"
        )}</span>
      </div>
      ${
        cctvUrl
          ? `
        <div class="cctv-video-container">
          <div class="cctv-video-wrapper">
            <video id="cctv-video-${Date.now()}" controls autoplay muted style="width: 100%; height: 300px; background: #000;">
              <source src="${cctvUrl}" type="application/x-mpegURL">
              브라우저가 HLS 스트리밍을 지원하지 않습니다.
            </video>
          </div>
        </div>
      `
          : `
        <div class="wfs-info-item">
          <span class="wfs-info-value" style="color: #999; font-style: italic;">스트리밍 URL이 제공되지 않았습니다.</span>
        </div>
      `
      }
    </div>`;
  } else if (layerName === "pharmacy") {
    // 약국 팝업
    const dutyName = getPropertyValue(properties, "duty_name") || "정보 없음";
    const dutyAddr = getPropertyValue(properties, "duty_addr") || "정보 없음";
    const dutyTel = getPropertyValue(properties, "duty_tel1") || "정보 없음";

    // 요일별 운영시간 생성 (compact 형태)
    const weekdays = ["월", "화", "수", "목", "금", "토"];
    let operatingHours = "";

    // 시간 포맷팅 함수 (0900 -> 09시)
    const formatTime = (time) => {
      if (!time || time === "정보 없음") return "정보 없음";
      if (time.length === 4) {
        const hour = time.substring(0, 2);
        return `${hour}시`;
      }
      return time;
    };

    // 모든 요일의 운영시간을 수집
    const hoursData = [];
    for (let i = 1; i <= 6; i++) {
      const openTime = getPropertyValue(properties, `duty_time${i}s`);
      const closeTime = getPropertyValue(properties, `duty_time${i}c`);
      const weekday = weekdays[i - 1];

      if (
        openTime &&
        closeTime &&
        openTime !== "정보 없음" &&
        closeTime !== "정보 없음"
      ) {
        const formattedOpenTime = formatTime(openTime);
        const formattedCloseTime = formatTime(closeTime);
        hoursData.push({
          weekday,
          time: `${formattedOpenTime} ~ ${formattedCloseTime}`,
        });
      }
    }

    // 운영시간이 있으면 compact하게 표시
    if (hoursData.length > 0) {
      operatingHours = `<div class="wfs-info-item">
        <span class="wfs-info-label">운영시간</span>
        <span class="wfs-info-value" style="line-height: 1.3;">
          ${hoursData
            .map((item) => `${item.weekday}: ${item.time}`)
            .join("<br>")}
        </span>
      </div>`;
    }

    content = `<div class="wfs-popup-header">
      <div class="wfs-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        약국 정보
      </div>
      <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
    </div>
    <div class="wfs-popup-content">
      <div class="wfs-info-item">
        <span class="wfs-info-label">약국명</span>
        <span class="wfs-info-value">${dutyName}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">주소</span>
        <span class="wfs-info-value">${dutyAddr}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">전화번호</span>
        <span class="wfs-info-value">${dutyTel}</span>
      </div>
      ${operatingHours}
    </div>`;
  } else if (layerName === "hospital") {
    // 병원 팝업
    const dutyName = getPropertyValue(properties, "duty_name") || "정보 없음";
    const dutyAddr = getPropertyValue(properties, "duty_addr") || "정보 없음";
    const dutyTel = getPropertyValue(properties, "duty_tel1") || "정보 없음";
    const dutyDivName =
      getPropertyValue(properties, "duty_div_nam") || "정보 없음";

    // 응급실운영여부 변환 (1: 운영함, 2: 운영하지 않음)
    const dutyErynRaw = getPropertyValue(properties, "duty_eryn");
    let dutyEryn = "정보 없음";
    if (dutyErynRaw === "1") {
      dutyEryn = "운영함";
    } else if (dutyErynRaw === "2") {
      dutyEryn = "운영하지 않음";
    }

    // 요일별 운영시간 생성 (compact 형태)
    const weekdays = ["월", "화", "수", "목", "금", "토"];
    let operatingHours = "";

    // 시간 포맷팅 함수 (0900 -> 09시)
    const formatTime = (time) => {
      if (!time || time === "정보 없음") return "정보 없음";
      if (time.length === 4) {
        const hour = time.substring(0, 2);
        return `${hour}시`;
      }
      return time;
    };

    // 모든 요일의 운영시간을 수집
    const hoursData = [];
    for (let i = 1; i <= 6; i++) {
      const openTime = getPropertyValue(properties, `duty_time${i}s`);
      const closeTime = getPropertyValue(properties, `duty_time${i}c`);
      const weekday = weekdays[i - 1];

      if (
        openTime &&
        closeTime &&
        openTime !== "정보 없음" &&
        closeTime !== "정보 없음"
      ) {
        const formattedOpenTime = formatTime(openTime);
        const formattedCloseTime = formatTime(closeTime);
        hoursData.push({
          weekday,
          time: `${formattedOpenTime} ~ ${formattedCloseTime}`,
        });
      }
    }

    // 운영시간이 있으면 compact하게 표시
    if (hoursData.length > 0) {
      operatingHours = `<div class="wfs-info-item">
        <span class="wfs-info-label">운영시간</span>
        <span class="wfs-info-value" style="line-height: 1.3;">
          ${hoursData
            .map((item) => `${item.weekday}: ${item.time}`)
            .join("<br>")}
        </span>
      </div>`;
    }

    content = `<div class="wfs-popup-header">
      <div class="wfs-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        병원 정보
      </div>
      <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
    </div>
    <div class="wfs-popup-content">
      <div class="wfs-info-item">
        <span class="wfs-info-label">병원명</span>
        <span class="wfs-info-value">${dutyName}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">병원분류</span>
        <span class="wfs-info-value">${dutyDivName}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">주소</span>
        <span class="wfs-info-value">${dutyAddr}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">전화번호</span>
        <span class="wfs-info-value">${dutyTel}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">응급실운영여부</span>
        <span class="wfs-info-value">${dutyEryn}</span>
      </div>
      ${operatingHours}
    </div>`;
  } else if (layerName === "government_office") {
    // 관공서 팝업
    const fcltyNm = getPropertyValue(properties, "fclty_nm") || "정보 없음";
    const rnAdres = getPropertyValue(properties, "rn_adres") || "정보 없음";
    const telno = getPropertyValue(properties, "telno") || "정보 없음";

    content = `<div class="wfs-popup-header">
      <div class="wfs-popup-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        관공서 정보
      </div>
      <button class="wfs-popup-close" onclick="closeWfsPopup()">×</button>
    </div>
    <div class="wfs-popup-content">
      <div class="wfs-info-item">
        <span class="wfs-info-label">시설명</span>
        <span class="wfs-info-value">${fcltyNm}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">주소</span>
        <span class="wfs-info-value">${rnAdres}</span>
      </div>
      <div class="wfs-info-item">
        <span class="wfs-info-label">전화번호</span>
        <span class="wfs-info-value">${telno}</span>
      </div>
    </div>`;
  } else {
    // 편의점 팝업 (기본)
    content = `<div class="wfs-popup-header">
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
  }
  popup.innerHTML = content;

  // CCTV 팝업인 경우 특별한 클래스 추가
  if (layerName === "cctv") {
    popup.classList.add("cctv-popup");
  }

  // CCTV 팝업인 경우 HLS 스트리밍 초기화
  if (layerName === "cctv") {
    const videoElement = popup.querySelector("video");
    const sourceElement = videoElement?.querySelector("source");

    if (videoElement && sourceElement && sourceElement.src && window.Hls) {
      const streamUrl = sourceElement.src;

      // URL 유효성 재확인
      const isValidUrl =
        streamUrl &&
        (streamUrl.startsWith("http://") ||
          streamUrl.startsWith("https://") ||
          streamUrl.startsWith("rtmp://")) &&
        !streamUrl.includes("정보 없음") &&
        !streamUrl.includes("null") &&
        streamUrl.trim() !== "";

      if (isValidUrl) {
        const hls = new window.Hls();
        window.currentHlsInstance = hls; // 전역 변수로 저장
        hls.loadSource(streamUrl);
        hls.attachMedia(videoElement);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          console.log("CCTV HLS 스트리밍 시작");
        });
        hls.on(window.Hls.Events.ERROR, function (event, data) {
          console.error("CCTV HLS 스트리밍 오류:", data);
        });
      } else {
        console.log("유효하지 않은 CCTV 스트리밍 URL:", streamUrl);
      }
    } else if (
      videoElement &&
      sourceElement &&
      sourceElement.src &&
      videoElement.canPlayType("application/vnd.apple.mpegurl")
    ) {
      // Safari의 경우 네이티브 HLS 지원
      const streamUrl = sourceElement.src;

      // URL 유효성 재확인
      const isValidUrl =
        streamUrl &&
        (streamUrl.startsWith("http://") ||
          streamUrl.startsWith("https://") ||
          streamUrl.startsWith("rtmp://")) &&
        !streamUrl.includes("정보 없음") &&
        !streamUrl.includes("null") &&
        streamUrl.trim() !== "";

      if (isValidUrl) {
        videoElement.src = streamUrl;
        videoElement.addEventListener("loadedmetadata", function () {
          console.log("CCTV 네이티브 HLS 스트리밍 시작");
        });
      } else {
        console.log("유효하지 않은 CCTV 스트리밍 URL:", streamUrl);
      }
    }
  }

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
  // CCTV HLS 스트리밍 정리
  const videoElement = document.querySelector("#wfs-popup video");
  if (videoElement) {
    // 비디오 정지
    videoElement.pause();
    videoElement.src = "";
    videoElement.load();

    // HLS 인스턴스 정리
    if (window.currentHlsInstance) {
      window.currentHlsInstance.destroy();
      window.currentHlsInstance = null;
    }
  }

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

// 로딩 메시지 표시 함수 (hint: 메시지 아래에 작게 표시되는 보조 안내 문구, 생략 시 숨김)
function showLoadingMessage(message, hint) {
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
      max-width: 320px;
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
      <div class="loading-hint" style="margin-top: 10px; font-size: 12px; line-height: 1.4; opacity: 0.75; display: none;"></div>
    `;
  }

  // 보조 안내 문구 갱신 (없으면 숨김)
  const hintDiv = loadingDiv.querySelector(".loading-hint");
  if (hintDiv) {
    hintDiv.textContent = hint || "";
    hintDiv.style.display = hint ? "block" : "none";
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

// 약국/병원 API 테스트 함수
function testPharmacyHospitalApis() {
  console.log("약국/병원 API 테스트 시작");

  // 약국 API 테스트
  const pharmacyUrl = WFS_CONFIG.pharmacy.url;
  console.log("약국 API URL:", pharmacyUrl);
  testWfsUrl(pharmacyUrl);

  // 병원 API 테스트
  const hospitalUrl = WFS_CONFIG.hospital.url;
  console.log("병원 API URL:", hospitalUrl);
  testWfsUrl(hospitalUrl);
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
window.toggleBusStop = toggleBusStop;
window.toggleCctv = toggleCctv;
window.togglePharmacy = togglePharmacy;
window.toggleHospital = toggleHospital;
window.toggleGovernmentOffice = toggleGovernmentOffice;
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

// 테스트 함수들 추가
window.testWfsUrl = testWfsUrl;
window.testPharmacyHospitalApis = testPharmacyHospitalApis;

export {
  getApiUrl,
  initializeWfsLayers,
  toggleWfsLayer,
  toggleConvenienceStore,
  toggleBusStop,
  toggleCctv,
  togglePharmacy,
  toggleHospital,
  toggleGovernmentOffice,
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

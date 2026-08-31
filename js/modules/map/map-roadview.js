// 맵 로드뷰 모듈
import { getMap } from "./map-core.js";

// 로드뷰 관련 변수들
var road_view_location;
let roadviewPickerActive = false;
let kakaoOverlayDiv = null;
let kakaoOverlayMap = null;
let kakaoRoadviewClient = null;
let olViewListenersForKakao = [];
let isSyncingFromOL = false;
let isSyncingFromKakao = false;
let roadviewEscKeyListener = null;
let kakaoLevelOffset = 0; // 동적 보정 오프셋
let roadviewBtnActive = false; // 로드뷰 버튼 활성화 상태

/**
 * 로드뷰 태그를 추가해주는 기능
 *
 * @param tag 로드뷰를 추가 할 id값
 */
function drawRoadView(tag, options = {}) {
  console.log("=== drawRoadView 함수 시작 ===");
  console.log("tag:", tag);
  console.log("options:", options);

  try {
    console.log("drawRoadView 실행 중...");
    const map = getMap();

    // 현 지도 중심 좌표를 위경도로 변환해 저장
    const center3857 = map.getView().getCenter();
    console.log("center3857:", center3857);
    let [lon, lat] = ol.proj.toLonLat(center3857);
    console.log("변환된 좌표 - lon:", lon, "lat:", lat);
    if (
      options.coordinate &&
      Array.isArray(options.coordinate) &&
      options.coordinate.length === 2
    ) {
      // options.coordinate는 [lon, lat] (EPSG:4326) 기대
      lon = Number(options.coordinate[0]);
      lat = Number(options.coordinate[1]);
    }
    road_view_location = { lon, lat };

    // 현재 줌 레벨 가져오기
    const currentZoom = map.getView().getZoom();
    console.log("현재 줌 레벨:", currentZoom);

    // OpenLayers 줌을 카카오맵 레벨로 변환
    const kakaoLevel = olZoomToKakaoLevel(currentZoom);
    console.log("변환된 카카오 레벨:", kakaoLevel);

    const appkey =
      options.appkey ||
      (typeof window !== "undefined" ? window.KAKAO_APP_KEY : undefined);
    const radius = typeof options.radius === "number" ? options.radius : 200; // m

    // 컨테이너 탐색 또는 생성
    let container = document.getElementById(tag);
    if (!container) {
      container = document.createElement("div");
      container.id = tag;
      document.body.appendChild(container);
    }

    // 패널 스타일 구성 (전체화면)
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.background = "rgba(0,0,0,0.9)";
    container.style.border = "none";
    container.style.borderRadius = "0";
    container.style.boxShadow = "none";
    container.style.overflow = "hidden";
    container.style.zIndex = "3000";

    // 기존 내용 초기화
    container.innerHTML = "";

    // 헤더 영역
    const header = document.createElement("div");
    header.style.cssText =
      "position:absolute;top:12px;right:12px;display:flex;align-items:center;justify-content:center;padding:6px 8px;background:rgba(17,24,39,0.9);color:#fff;font-weight:600;border-radius:8px;z-index:1;";
    header.innerHTML = "";

    // 닫기 버튼
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;";
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
      roadviewBtnActive = false;
    };
    header.appendChild(closeBtn);

    // 아이프레임 영역
    const iframe = document.createElement("iframe");
    const query = new URLSearchParams({
      lat: String(lat),
      lng: String(lon),
      radius: String(radius),
      zoom: String(kakaoLevel), // 줌 레벨 추가
    });
    if (appkey) {
      query.set("appkey", String(appkey));
    }
    iframe.src = `html/loadview/load-view.html?${query.toString()}`;
    console.log("iframe src:", iframe.src);
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.allowFullscreen = true;

    container.appendChild(iframe);
    container.appendChild(header);

    // ESC로 닫기 지원
    const escCloseListener = function (event) {
      if (event.key === "Escape") {
        closeBtn.click();
      }
    };
    document.addEventListener("keydown", escCloseListener);

    // 기존 onclick 핸들러를 보존하면서 ESC 리스너 제거 추가
    const originalOnClick = closeBtn.onclick;
    closeBtn.onclick = function (e) {
      // 기존 핸들러 실행 (버튼 상태 초기화 포함)
      if (typeof originalOnClick === "function") {
        originalOnClick(e);
      }
      // ESC 리스너 제거
      document.removeEventListener("keydown", escCloseListener);
    };

    console.log("=== drawRoadView 함수 완료 ===");
  } catch (error) {
    console.error("로드뷰 표시 중 오류:", error);
    console.error("에러 상세:", error.message);
    console.error("에러 스택:", error.stack);
  }
}

// 로드뷰 버튼 토글 함수
function toggleRoadviewBtn() {
  console.log("=== toggleRoadviewBtn 함수 시작 ===");

  const loadviewBtn = document.getElementById("loadviewBtn");
  console.log("loadviewBtn 요소:", loadviewBtn);

  if (!loadviewBtn) {
    console.error("loadviewBtn을 찾을 수 없습니다!");
    return;
  }

  roadviewBtnActive = !roadviewBtnActive;
  console.log("roadviewBtnActive 상태:", roadviewBtnActive);

  if (roadviewBtnActive) {
    // 버튼 활성화
    console.log("버튼 활성화 중...");
    loadviewBtn.classList.add("active");
    console.log("active 클래스 추가됨. 현재 클래스:", loadviewBtn.className);
    // 로드뷰 실행
    drawRoadView("roadviewPanel");
  } else {
    // 버튼 비활성화
    console.log("버튼 비활성화 중...");
    loadviewBtn.classList.remove("active");
    console.log("active 클래스 제거됨. 현재 클래스:", loadviewBtn.className);
    // 로드뷰 패널 닫기
    const roadviewPanel = document.getElementById("roadviewPanel");
    if (roadviewPanel && roadviewPanel.parentNode) {
      roadviewPanel.parentNode.removeChild(roadviewPanel);
    }
  }

  console.log("=== toggleRoadviewBtn 함수 완료 ===");
}

// Kakao SDK 로더
function ensureKakaoSdkLoaded(appkey, onReady, onError) {
  try {
    if (window.kakao && window.kakao.maps) {
      if (window.kakao.maps.load) {
        window.kakao.maps.load(onReady);
      } else {
        onReady();
      }
      return;
    }
    const key =
      appkey || (typeof window !== "undefined" ? window.KAKAO_APP_KEY : "");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      key
    )}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = function () {
      if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
        window.kakao.maps.load(onReady);
      } else {
        onReady();
      }
    };
    script.onerror = function () {
      if (onError) onError(new Error("Kakao SDK load failed"));
    };
    document.head.appendChild(script);
  } catch (e) {
    if (onError) onError(e);
  }
}

const VWORLD_MIN_ZOOM = 2;
const VWORLD_MAX_ZOOM = 21;
const KAKAO_MIN_LEVEL = 1;
const KAKAO_MAX_LEVEL = 14;

// OL 줌 -> Kakao level 변환
function olZoomToKakaoLevel(vworldZoom) {
  // VWorld 줌 레벨이 0보다 작은 값이 들어올 경우를 대비해 0으로 보정합니다.
  const z = Math.max(0, Number(vworldZoom || 10));
  const vworldZoomRange = VWORLD_MAX_ZOOM - VWORLD_MIN_ZOOM; // 19
  const kakaoLevelRange = KAKAO_MAX_LEVEL - KAKAO_MIN_LEVEL; // 13

  let level;

  // 1. 줌 레벨이 VWorld의 최소/최대 범위를 벗어날 경우 고정값 반환
  if (z <= VWORLD_MIN_ZOOM) {
    level = KAKAO_MAX_LEVEL; // 카카오맵의 가장 먼 레벨(14)
  } else if (z >= VWORLD_MAX_ZOOM) {
    level = KAKAO_MIN_LEVEL; // 카카오맵의 가장 가까운 레벨(1)
  } else {
    // 2. VWorld 줌 레벨 범위를 카카오맵 레벨 범위로 선형 변환
    level = Math.round(
      KAKAO_MAX_LEVEL - ((z - VWORLD_MIN_ZOOM) * kakaoLevelRange) / vworldZoomRange
    );
  }

  // 3. 카카오맵 레벨 범위(1~14)를 벗어나지 않도록 보정
  return Math.max(KAKAO_MIN_LEVEL, Math.min(KAKAO_MAX_LEVEL, level));
}

// Kakao level -> OL 줌 변환
function kakaoLevelToOlZoom(kakaoLevel) {
  const level = Math.max(
    KAKAO_MIN_LEVEL,
    Math.min(KAKAO_MAX_LEVEL, Number(kakaoLevel || 4))
  );
  const vworldZoomRange = VWORLD_MAX_ZOOM - VWORLD_MIN_ZOOM;
  const kakaoLevelRange = KAKAO_MAX_LEVEL - KAKAO_MIN_LEVEL;
  const z =
    VWORLD_MIN_ZOOM +
    ((KAKAO_MAX_LEVEL - level) * vworldZoomRange) / kakaoLevelRange;
  return Math.max(VWORLD_MIN_ZOOM, Math.min(VWORLD_MAX_ZOOM, z));
}

function constrainOlZoom(view, zoom) {
  const minZ =
    view && typeof view.getMinZoom === "function" ? view.getMinZoom() : 7;
  const maxZ =
    view && typeof view.getMaxZoom === "function" ? view.getMaxZoom() : 19;
  return Math.max(minZ, Math.min(maxZ, zoom));
}

function syncKakaoCenterFromOL() {
  if (!kakaoOverlayMap || isSyncingFromKakao) return;
  isSyncingFromOL = true;
  const map = getMap();
  const center3857 = map.getView().getCenter();
  const [lon, lat] = ol.proj.toLonLat(center3857);
  const kCenter = kakaoOverlayMap.getCenter();
  if (
    !kCenter ||
    Math.abs(kCenter.getLat() - lat) > 1e-9 ||
    Math.abs(kCenter.getLng() - lon) > 1e-9
  ) {
    kakaoOverlayMap.setCenter(new kakao.maps.LatLng(lat, lon));
  }
  isSyncingFromOL = false;
}

function syncKakaoZoomFromOL() {
  if (!kakaoOverlayMap || isSyncingFromKakao) return;
  isSyncingFromOL = true;
  const kz = Math.max(
    KAKAO_MIN_LEVEL,
    Math.min(
      KAKAO_MAX_LEVEL,
      olZoomToKakaoLevel(getMap().getView().getZoom()) + kakaoLevelOffset
    )
  );
  if (kakaoOverlayMap.getLevel() !== kz) {
    kakaoOverlayMap.setLevel(kz);
  }
  isSyncingFromOL = false;
}

function syncKakaoMapWithOL() {
  syncKakaoCenterFromOL();
  syncKakaoZoomFromOL();
}

function enableRoadviewPicker(options = {}) {
  console.log("enableRoadviewPicker");
  if (roadviewPickerActive) return;
  const appkey =
    options.appkey ||
    (typeof window !== "undefined" ? window.KAKAO_APP_KEY : undefined);
  ensureKakaoSdkLoaded(
    appkey,
    () => {
      try {
        const map = getMap();

        // 오버레이 컨테이너 생성
        if (!kakaoOverlayDiv) {
          kakaoOverlayDiv = document.createElement("div");
          kakaoOverlayDiv.id = "kakaoCoverageOverlay";
          kakaoOverlayDiv.style.position = "absolute";
          kakaoOverlayDiv.style.inset = "0";
          kakaoOverlayDiv.style.zIndex = "1500";
          kakaoOverlayDiv.style.pointerEvents = "auto";
          // 마우스 커서를 로드뷰 아이콘으로 표시하여 선택 모드임을 강조
          kakaoOverlayDiv.style.cursor =
            "url('images/icon/icon-loadview-remove.png') 13 13, crosshair";
          const mapEl = document.getElementById("map");
          mapEl && mapEl.appendChild(kakaoOverlayDiv);
        }

        // Kakao 맵 생성 및 커버리지 오버레이 추가
        const center3857 = map.getView().getCenter();
        const [lon, lat] = ol.proj.toLonLat(center3857);
        kakaoOverlayMap = new kakao.maps.Map(kakaoOverlayDiv, {
          center: new kakao.maps.LatLng(lat, lon),
          level: olZoomToKakaoLevel(map.getView().getZoom()),
          draggable: true, // 오버레이 지도에서도 드래그 허용
          disableDoubleClick: false,
          scrollwheel: true,
          keyboardShortcuts: true,
        });
        kakaoOverlayMap.addOverlayMapTypeId(kakao.maps.MapTypeId.ROADVIEW);
        kakaoRoadviewClient = new kakao.maps.RoadviewClient();

        // 클릭 시 로드뷰 실행
        kakao.maps.event.addListener(
          kakaoOverlayMap,
          "click",
          function (mouseEvt) {
            const pos = mouseEvt.latLng;
            kakaoRoadviewClient.getNearestPanoId(pos, 100, function (panoId) {
              if (panoId) {
                if (window.drawRoadView) {
                  window.drawRoadView("roadviewPanel", {
                    coordinate: [pos.getLng(), pos.getLat()],
                    appkey,
                    radius: 300,
                    fullscreen: true,
                  });
                }
              }
            });
          }
        );

        // ESC로 종료 지원 (닫기 버튼 대신)
        roadviewEscKeyListener = function (e) {
          if (e.key === "Escape") {
            disableRoadviewPicker();
          }
        };
        document.addEventListener("keydown", roadviewEscKeyListener);

        // 오버레이 맵 조작 시 OL 맵도 동기화
        const syncFromKakaoCenter = function () {
          if (isSyncingFromOL) return;
          isSyncingFromKakao = true;
          const c = kakaoOverlayMap.getCenter();
          const olCenter = ol.proj.fromLonLat([c.getLng(), c.getLat()]);
          map.getView().setCenter(olCenter);
          isSyncingFromKakao = false;
        };
        const syncFromKakaoZoom = function () {
          if (isSyncingFromOL) return;
          isSyncingFromKakao = true;
          const kakaoLevel = kakaoOverlayMap.getLevel();
          const view = map.getView();
          const olZoom = constrainOlZoom(view, kakaoLevelToOlZoom(kakaoLevel));
          if (view.getZoom() !== olZoom) {
            view.setZoom(olZoom);
          }
          // OL 줌 제약으로 카카오 레벨과 어긋나도, 이후 패닝 시 카카오 줌이 되돌아가지 않도록 오프셋 유지
          kakaoLevelOffset =
            kakaoLevel - olZoomToKakaoLevel(view.getZoom());
          isSyncingFromKakao = false;
        };
        kakao.maps.event.addListener(
          kakaoOverlayMap,
          "center_changed",
          syncFromKakaoCenter
        );
        kakao.maps.event.addListener(
          kakaoOverlayMap,
          "zoom_changed",
          syncFromKakaoZoom
        );

        // 패닝은 중심만, 줌은 resolution 변경 시에만 동기화 (moveend에서 줌을 되돌리지 않음)
        const view = map.getView();
        const c1 = map.on("moveend", syncKakaoCenterFromOL);
        const c2 = view.on("change:resolution", syncKakaoZoomFromOL);
        olViewListenersForKakao.push(c1, c2);
        // 현재 카카오 레벨과 변환 기대값의 차이를 offset으로 저장
        kakaoLevelOffset =
          kakaoOverlayMap.getLevel() - olZoomToKakaoLevel(view.getZoom());
        syncKakaoMapWithOL();

        roadviewPickerActive = true;
        if (typeof window !== "undefined") window.roadviewPickerActive = true;
      } catch (e) {
        console.error("로드뷰 픽커 활성화 실패:", e);
      }
    },
    (err) => console.error(err)
  );
}

function disableRoadviewPicker() {
  try {
    if (!roadviewPickerActive) return;
    const map = getMap();

    // 이벤트 해제
    if (olViewListenersForKakao && olViewListenersForKakao.length) {
      olViewListenersForKakao.forEach((key) => {
        try {
          if (
            typeof ol !== "undefined" &&
            ol.Observable &&
            ol.Observable.unByKey
          ) {
            ol.Observable.unByKey(key);
          } else if (map && map.un) {
            map.un("moveend", syncKakaoCenterFromOL);
          }
        } catch {}
      });
      olViewListenersForKakao = [];
    }
    // DOM 제거
    if (kakaoOverlayDiv && kakaoOverlayDiv.parentNode) {
      kakaoOverlayDiv.parentNode.removeChild(kakaoOverlayDiv);
    }
    if (roadviewEscKeyListener) {
      document.removeEventListener("keydown", roadviewEscKeyListener);
      roadviewEscKeyListener = null;
    }
    kakaoOverlayDiv = null;
    kakaoOverlayMap = null;
    kakaoRoadviewClient = null;
    kakaoLevelOffset = 0;
    roadviewPickerActive = false;
    if (typeof window !== "undefined") window.roadviewPickerActive = false;
  } catch (e) {
    console.error("로드뷰 픽커 비활성화 실패:", e);
  }
}

// 전역 객체에 로드뷰 함수들 추가
window.drawRoadView = drawRoadView;
window.enableRoadviewPicker = enableRoadviewPicker;
window.disableRoadviewPicker = disableRoadviewPicker;
window.toggleRoadviewBtn = toggleRoadviewBtn;

export {
  drawRoadView,
  enableRoadviewPicker,
  disableRoadviewPicker,
  toggleRoadviewBtn,
  olZoomToKakaoLevel,
  kakaoLevelToOlZoom,
};

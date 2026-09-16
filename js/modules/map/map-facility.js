// QField 시설물 레이어 및 관리 모듈
import { getMap } from "./map-core.js";
import { MapEventManager } from "./map-events.js";
import { getApiUrl } from "./map-wfs.js";

// 화면을 처음 열었을 때 선택되는 기본 시·도 (11 = 서울특별시)
// 목록에 이 코드가 없으면 전체로 표시된다
const DEFAULT_SIDO_CD = "11";

// 시설물 모듈 상태
let facilityLayer = null;
let facilitySource = null;
let facilityOverlay = null;
let selectedTotalId = null;
let areaExtentMap = new Map();
let facilityModuleInitialized = false;

// 커서 호버 상태 관리 (wfs-pointer-move와의 커서 고착 방지)
let isFacilityHovered = false;

// 요청 순서 경쟁 방지 (AbortController 및 요청 순번)
let facilityAbortController = null;
let facilityRequestSeq = 0;
let sggAbortController = null;
let sggRequestSeq = 0;
let emdAbortController = null;
let emdRequestSeq = 0;

// 상세정보 필드 정의
const DETAIL_FIELD_CONFIG = [
  { key: "fclt_nm", label: "시설물명" },
  { key: "inst_nm", label: "기관명" },
  { key: "daddr", label: "도로명주소" },
  { key: "lotno_addr", label: "지번주소" },
  // 행정구역 이름은 주소로 이미 알 수 있어 팝업에서는 숨김
  // (설정에서 아예 빼면 "그 밖의 항목" 목록으로 다시 새어 나오므로 hidden 으로 둔다)
  { key: "sido_nm", label: "시도", hidden: true },
  { key: "sgg_nm", label: "시군구", hidden: true },
  { key: "emd_nm", label: "읍면동", hidden: true },
  // 점검 결과 — 값은 현장조사 앱(infra-manage-app)의 ValueMap 코드라 한글로 바꿔 보여준다
  { key: "facility_condition", label: "시설물 상태", valueMap: "condition" },
  { key: "repair_required_yn", label: "보수 필요 여부", valueMap: "repair" },
  { key: "facility_memo", label: "시설물 특이사항" },
  { key: "inspected_at", label: "점검 일시", isDateTime: true },
  { key: "project_name", label: "사업명" },
  { key: "owner", label: "소유자" },
  { key: "pic_dept_nm", label: "담당부서" },
  { key: "pic_nm", label: "담당자" },
  { key: "pic_telno", label: "전화번호" },
  { key: "pic_eml", label: "이메일" },
  // 사진 5장은 한 줄에서 넘겨 보는 갤러리로 묶는다 (photo_1 위치에 렌더, 나머지는 숨김)
  { key: "photo_1", label: "시설물 사진", isPhotoGallery: true },
  { key: "photo_2", label: "사진 2", hidden: true },
  { key: "photo_3", label: "사진 3", hidden: true },
  { key: "photo_4", label: "사진 4", hidden: true },
  { key: "photo_5", label: "사진 5", hidden: true },
  { key: "audio_memo", label: "현장 특이사항", isAudio: true },
  // 음성으로 남긴 현장 특이사항을 STT로 받아쓴 내용
  { key: "facility_memo_txt", label: "음성 변환 내용" },
  { key: "video", label: "현장 영상", isVideo: true },
  { key: "audio_memo_txt", label: "음성 메모 텍스트" },
  { key: "reg_date", label: "등록일시", isDateTime: true },
  { key: "update_at", label: "수정일시", isDateTime: true },
];

// 현장조사 앱(infra-manage-app `projectutils.cpp`)의 ValueMap 과 같은 표기
// 앱에서 선택지가 바뀌면 이 표도 함께 고칠 것
const FACILITY_VALUE_MAPS = {
  condition: {
    NORMAL: "정상",
    MINOR_DAMAGE: "경미한 파손",
    BROKEN: "파손 / 고장",
    DESTROYED: "철거됨",
  },
  repair: {
    Y: "정비요청",
    N: "양호",
  },
};

// 코드 값을 한글 표기로 바꾼다. 표에 없는 값은 원본을 그대로 보여준다.
function formatFacilityCodeValue(mapName, value) {
  const map = FACILITY_VALUE_MAPS[mapName];
  const key = String(value).trim().toUpperCase();
  return (map && map[key]) || String(value);
}

/**
 * 사진 갤러리 생성 — 사진 여러 장을 한 줄에서 넘겨 본다.
 * 사진이 한 장이면 이동 버튼과 번호를 숨긴다.
 */
function createFacilityPhotoGallery(photoUrls) {
  const gallery = document.createElement("div");
  gallery.className = "facility-gallery";

  const frame = document.createElement("div");
  frame.className = "facility-gallery-frame";

  const image = document.createElement("img");
  image.className = "facility-gallery-image";
  image.alt = "시설물 사진";
  image.loading = "lazy";
  image.src = photoUrls[0];
  frame.appendChild(image);

  // 원본 보기 (새 창)
  const openLink = document.createElement("a");
  openLink.className = "facility-gallery-open";
  openLink.href = photoUrls[0];
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.textContent = "원본";
  frame.appendChild(openLink);

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "facility-gallery-nav prev";
  prevBtn.title = "이전 사진";
  prevBtn.textContent = "‹";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "facility-gallery-nav next";
  nextBtn.title = "다음 사진";
  nextBtn.textContent = "›";

  const counter = document.createElement("span");
  counter.className = "facility-gallery-counter";

  let index = 0;
  const render = () => {
    image.src = photoUrls[index];
    openLink.href = photoUrls[index];
    counter.textContent = `${index + 1} / ${photoUrls.length}`;
  };

  prevBtn.addEventListener("click", () => {
    index = (index - 1 + photoUrls.length) % photoUrls.length;
    render();
  });
  nextBtn.addEventListener("click", () => {
    index = (index + 1) % photoUrls.length;
    render();
  });

  if (photoUrls.length > 1) {
    frame.appendChild(prevBtn);
    frame.appendChild(nextBtn);
  }

  gallery.appendChild(frame);
  if (photoUrls.length > 1) {
    gallery.appendChild(counter);
  }

  render();
  return gallery;
}

/**
 * 일시 값을 'YYYY-MM-DD HH:MM' 으로 다듬는다.
 * 백엔드가 주는 값은 타임존이 없는 로컬 시각 문자열(예: 2026-08-28T05:12:42.635018)이므로
 * Date 로 파싱하면 브라우저 타임존만큼 어긋난다. 그래서 문자열에서 그대로 잘라 쓴다.
 * 형식이 다르면 원본을 그대로 보여준다.
 */
function formatFacilityDateTime(value) {
  const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!matched) return String(value);

  const [, year, month, day, hour, minute] = matched;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 팝업 헤더(제목·배지)에서 이미 보여주는 필드 — 본문 목록에서는 중복 표시하지 않음
// DETAIL_FIELD_CONFIG 에는 남겨 둬야 "그 밖의 항목" 목록으로 다시 새어 나오지 않음
const HEADER_FIELD_KEYS = new Set(["fclt_nm"]);

// 상세 팝업에 표시하지 않는 내부 관리용 키
// 행정구역 코드는 이름(sido_nm·sgg_nm·emd_nm)으로 이미 보여주고,
// 나머지는 QField 원본 테이블 식별자라 사용자에게 의미가 없음
const INTERNAL_DETAIL_KEYS = new Set([
  "sido_cd",
  "sgg_cd",
  "emd_cd",
  "use_yn",
  "origin_id",
  "total_seq",
  "source_fid",
  "source_table",
]);

// 시설물 아이콘 규격 (SVG 핀, 원본 24x32, anchor [0.5, 1.0])
// 별도 이미지 파일 없이 data URI로 그리므로 확대해도 선명하고 색만 바꿔 재사용할 수 있음
const FACILITY_ICON_SIZE = [24, 32];
const FACILITY_ICON_COLOR = "#2563eb"; // 기본 시설물 (파랑)
const FACILITY_WARN_COLOR = "#d97706"; // 보수 필요 (주황)

// 시설물 종류별 글리프 — fclt_nm 에 아래 keywords 가 포함되면 해당 아이콘을 사용
// ※ 운영 기준은 DB(qfield.facility_icon)이며 `GET /map/qfield/facility-icons`로 불러온다.
//    아래 배열은 API 조회 실패·빈 응답일 때만 쓰는 **대체값**이므로, 아이콘을 추가·변경할 때는
//    이 파일이 아니라 DB 행을 수정할 것 (생성 스크립트: mapservice-rest/db/qfield_facility_icon.sql)
const FALLBACK_FACILITY_ICON_TYPES = [
  {
    type: "parking",
    label: "주차장",
    keywords: ["주차"],
    glyph: '<text x="12" y="16.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="COLOR">P</text>',
  },
  {
    type: "charger",
    label: "전기차 충전소",
    keywords: ["충전"],
    glyph: '<path d="M13.4 5.5 8 13.2h3.4L10.6 18.5 16 10.8h-3.4z" fill="COLOR"/>',
  },
  {
    type: "hall",
    label: "강당·강의실",
    keywords: ["강당", "강의", "회의", "세미나", "교육", "대회의"],
    glyph: '<rect x="6" y="6.5" width="12" height="8" rx="1" fill="none" stroke="COLOR" stroke-width="1.6"/><path d="M12 14.5v2.8M9 17.3h6" stroke="COLOR" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    type: "dining",
    label: "구내식당·카페",
    keywords: ["식당", "카페", "급식", "매점"],
    glyph: '<path d="M8 6.5v4a2.6 2.6 0 0 0 2.6 2.6v4.4M10.6 6.5v4M13.2 6.5v4" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linecap="round"/><path d="M16.4 6.5c1.2 0 1.8 1.4 1.8 3.2s-.6 3-1.8 3v4.8" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    type: "sports",
    label: "체육시설",
    keywords: ["테니스", "농구", "족구", "운동", "체육", "체력", "구장"],
    glyph: '<circle cx="12" cy="12" r="5.6" fill="none" stroke="COLOR" stroke-width="1.6"/><path d="M6.4 12h11.2M12 6.4v11.2" stroke="COLOR" stroke-width="1.3"/>',
  },
  {
    type: "exhibition",
    label: "전시시설",
    keywords: ["전시", "홍보관", "박물"],
    glyph: '<rect x="6" y="7" width="12" height="10" rx="1" fill="none" stroke="COLOR" stroke-width="1.6"/><path d="M7.6 15l3-3.4 2.2 2.4 2-1.8 1.6 2.8z" fill="COLOR"/>',
  },
];

// 종류를 판별하지 못한 시설물 — 기관 건물 모양 (DB 의 is_default 행이 이 값을 대신함)
const FALLBACK_FACILITY_DEFAULT = {
  type: "default",
  label: "시설물",
  glyph:
    '<path d="M6.2 17.5V9.6L12 6l5.8 3.6v7.9z" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linejoin="round"/><path d="M10.2 17.5v-3.4h3.6v3.4" fill="none" stroke="COLOR" stroke-width="1.4"/>',
};

// 실제로 사용하는 아이콘 설정 — 초기에는 대체값, DB 조회에 성공하면 그 값으로 교체됨
let facilityIconTypes = FALLBACK_FACILITY_ICON_TYPES.slice();
let facilityDefaultIcon = { ...FALLBACK_FACILITY_DEFAULT };

// 아이콘 SVG data URI 생성 (핀 배경 + 흰 원 + 종류별 글리프)
function buildFacilityIconUrl(glyph, pinColor) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">' +
    '<path d="M12 0.8C5.9 0.8 1 5.7 1 11.8c0 7.7 11 19.4 11 19.4s11-11.7 11-19.4c0-6.1-4.9-11-11-11z" fill="' +
    pinColor +
    '" stroke="#ffffff" stroke-width="1.6"/>' +
    '<circle cx="12" cy="11.9" r="8" fill="#ffffff"/>' +
    glyph.replace(/COLOR/g, pinColor) +
    "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// 같은 종류·색 조합은 스타일을 재사용 (피처 2천여 건에서 매번 아이콘을 만들지 않도록)
const facilityStyleCache = new Map();

// 시설물명으로 아이콘 설정 판별 (DB 에서 불러온 설정을 우선 사용)
function resolveFacilityIcon(facilityName) {
  const name = String(facilityName || "");
  const matched = facilityIconTypes.find(
    (iconType) =>
      Array.isArray(iconType.keywords) &&
      iconType.keywords.some((keyword) => keyword && name.includes(keyword))
  );
  return matched || facilityDefaultIcon;
}

// 아이콘 설정에서 핀 색 결정 (설정에 색이 없으면 기본 상수 사용)
function getFacilityPinColor(iconConfig, needsRepair) {
  if (needsRepair) {
    return iconConfig.warnColor || FACILITY_WARN_COLOR;
  }
  return iconConfig.pinColor || FACILITY_ICON_COLOR;
}

/**
 * 시설물 아이콘 설정을 DB(qfield.facility_icon)에서 불러온다.
 * 실패하거나 응답이 비어 있으면 내장 대체값을 그대로 쓰므로 지도는 항상 그려진다.
 */
async function loadFacilityIconConfig() {
  try {
    const response = await fetch(getApiUrl("/map/qfield/facility-icons"));
    if (!response.ok) {
      throw new Error(`아이콘 설정 조회 실패: ${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn("시설물 아이콘 설정이 비어 있어 내장 기본 아이콘을 사용합니다.");
      return;
    }

    const loadedTypes = rows
      .filter((row) => row && row.glyph)
      .map((row) => ({
        type: row.iconType,
        label: row.label || "시설물",
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        glyph: row.glyph,
        pinColor: row.pinColor,
        warnColor: row.warnColor,
        isDefault: Boolean(row.isDefault),
      }));

    if (loadedTypes.length === 0) return;

    const loadedDefault = loadedTypes.find((item) => item.isDefault);
    facilityIconTypes = loadedTypes.filter((item) => !item.isDefault);
    facilityDefaultIcon = loadedDefault || { ...FALLBACK_FACILITY_DEFAULT };

    // 설정이 바뀌었으므로 이전 아이콘 캐시를 버리고 다시 그림
    facilityStyleCache.clear();
    if (facilityLayer) {
      facilityLayer.changed();
    }

    console.log(`시설물 아이콘 설정 ${loadedTypes.length}건을 DB에서 불러왔습니다.`);
  } catch (error) {
    console.warn("시설물 아이콘 설정을 불러오지 못해 내장 기본 아이콘을 사용합니다:", error.message);
  }
}

// 팝업 헤더를 지도 아이콘과 같은 규칙으로 채움 (아이콘 + 종류·상태 배지)
function renderFacilityPopupHeader(facilityName, needsRepair, conditionText) {
  const iconEl = document.getElementById("facilityPopupIcon");
  const metaEl = document.getElementById("facilityPopupMeta");
  if (!iconEl || !metaEl) return;

  const iconConfig = resolveFacilityIcon(facilityName);
  const pinColor = getFacilityPinColor(iconConfig, needsRepair);

  // 지도 핀과 같은 SVG를 그대로 사용해 아이콘이 어긋나지 않게 함
  iconEl.innerHTML = "";
  const iconImg = document.createElement("img");
  iconImg.src = buildFacilityIconUrl(iconConfig.glyph, pinColor);
  iconImg.alt = iconConfig.label;
  iconImg.width = FACILITY_ICON_SIZE[0];
  iconImg.height = FACILITY_ICON_SIZE[1];
  iconEl.appendChild(iconImg);

  metaEl.innerHTML = "";
  const badges = [{ text: iconConfig.label, className: "badge-type" }];
  if (needsRepair) {
    badges.push({ text: "보수 필요", className: "badge-repair" });
  }
  if (conditionText) {
    badges.push({ text: conditionText, className: "badge-condition" });
  }

  badges.forEach((badge) => {
    const span = document.createElement("span");
    span.className = `facility-badge ${badge.className}`;
    span.textContent = badge.text; // XSS 방지
    metaEl.appendChild(span);
  });
}

// 종류·보수필요·선택 상태에 맞는 스타일 반환 (캐시)
function getFacilityStyle(iconConfig, needsRepair, isSelected) {
  const cacheKey = `${iconConfig.type}|${needsRepair ? "warn" : "base"}|${isSelected ? "sel" : "def"}`;
  if (facilityStyleCache.has(cacheKey)) {
    return facilityStyleCache.get(cacheKey);
  }

  const pinColor = getFacilityPinColor(iconConfig, needsRepair);
  const iconStyle = new ol.style.Style({
    image: new ol.style.Icon({
      src: buildFacilityIconUrl(iconConfig.glyph, pinColor),
      scale: isSelected ? 1.25 : 1.0,
      anchor: [0.5, 1.0],
      opacity: 1.0,
      rotation: 0,
      size: FACILITY_ICON_SIZE,
      imgSize: FACILITY_ICON_SIZE,
    }),
  });

  // 선택된 시설물은 강조 링을 아이콘 아래에 함께 그림
  const style = isSelected
    ? [
        new ol.style.Style({
          image: new ol.style.Circle({
            radius: 20,
            fill: new ol.style.Fill({ color: "rgba(59, 130, 246, 0.35)" }),
            stroke: new ol.style.Stroke({ color: "#2563eb", width: 3 }),
          }),
        }),
        iconStyle,
      ]
    : iconStyle;

  facilityStyleCache.set(cacheKey, style);
  return style;
}

// 시설물 레이어 스타일 함수
function facilityStyleFunction(feature) {
  const totalId = feature.get("total_id") || feature.getId();
  const isSelected = Boolean(selectedTotalId) && String(totalId) === String(selectedTotalId);
  const needsRepair = String(feature.get("repair_required_yn") || "").toUpperCase() === "Y";
  return getFacilityStyle(resolveFacilityIcon(feature.get("fclt_nm")), needsRepair, isSelected);
}

// 팝업 요소 생성
function createPopupElement() {
  const popup = document.createElement("div");
  popup.id = "facility-popup";
  popup.className = "facility-popup";

  popup.innerHTML = `
    <div class="facility-popup-header">
      <span class="facility-popup-icon" id="facilityPopupIcon" aria-hidden="true"></span>
      <div class="facility-popup-title" id="facilityPopupTitle">시설물 상세정보</div>
      <button class="facility-popup-close" id="facilityPopupCloseBtn" title="닫기 (ESC)">×</button>
    </div>
    <div class="facility-popup-meta" id="facilityPopupMeta"></div>
    <div class="facility-popup-body" id="facilityPopupBody">
      <div class="facility-detail-loading">상세정보를 불러오는 중...</div>
    </div>
  `;

  return popup;
}

// 구역 extent로 지도 이동
function fitMapExtent(extent) {
  const map = getMap();
  if (!map || !extent || extent.length !== 4) return;
  if (
    isNaN(extent[0]) ||
    isNaN(extent[1]) ||
    isNaN(extent[2]) ||
    isNaN(extent[3])
  ) {
    return;
  }

  // 좌측 패널 폭(320px) 감안한 패딩 적용
  map.getView().fit(extent, {
    padding: [60, 60, 60, 360],
    duration: 500,
    maxZoom: 17,
  });
}

// 시설물 모듈 초기화
function initializeFacilityModule() {
  if (facilityModuleInitialized) {
    console.log("시설물 모듈이 이미 초기화되어 있습니다.");
    return;
  }

  const map = getMap();
  if (!map) {
    console.warn("지도가 아직 준비되지 않아 시설물 모듈을 초기화할 수 없습니다.");
    return;
  }

  console.log("시설물 모듈 초기화 시작");

  // 벡터 소스 및 레이어 생성 (docs/map-architecture.md 규칙 준수: zIndex 1010, declutter: false)
  facilitySource = new ol.source.Vector();
  facilityLayer = new ol.layer.Vector({
    source: facilitySource,
    style: facilityStyleFunction,
    updateWhileAnimating: false,
    updateWhileInteracting: false,
    declutter: false,
    zIndex: 1010,
  });

  map.addLayer(facilityLayer);

  // 팝업 오버레이 생성
  const popupEl = createPopupElement();
  facilityOverlay = new ol.Overlay({
    element: popupEl,
    positioning: "bottom-center",
    stopEvent: true,
    offset: [0, -15],
    // 팝업이 시설물 위쪽으로 그려지므로 화면 가장자리에서는 헤더(아이콘·제목·배지)가 잘림
    // → 지도를 살짝 밀어 팝업 전체가 보이게 함. 왼쪽 패널(320px) 폭만큼 여유를 둠
    autoPan: {
      animation: { duration: 250 },
      margin: 20,
    },
  });
  map.addOverlay(facilityOverlay);

  // 팝업 닫기 버튼 이벤트 바인딩
  const closeBtn = popupEl.querySelector("#facilityPopupCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeFacilityPopup();
    });
  }

  // ESC 키로 팝업 닫기 이벤트 등록
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
      closeFacilityPopup();
    }
  });

  // 지도 클릭 이벤트 등록 (고유 id: facility-click-layer)
  MapEventManager.registerClickHandler("facility-click-layer", (evt) => {
    let clickedFeature = null;
    map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
      if (layer === facilityLayer) {
        clickedFeature = feature;
        return true;
      }
    });

    if (clickedFeature) {
      const totalId = clickedFeature.get("total_id") || clickedFeature.getId();
      selectFacility(totalId, false);
    }
  });

  // 포인터 커서 변경 이벤트 등록 (자체 isFacilityHovered 상태로 커서 고착 방지)
  MapEventManager.registerPointerMoveHandler("facility-pointer-move", (evt) => {
    if (evt.dragging) return;
    const map = getMap();
    if (!map) return;

    let hit = false;
    map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
      if (layer === facilityLayer) {
        hit = true;
        return true;
      }
    });

    if (hit) {
      if (!isFacilityHovered) {
        map.getTargetElement().style.cursor = "pointer";
        isFacilityHovered = true;
      }
    } else {
      if (isFacilityHovered) {
        map.getTargetElement().style.cursor = "";
        isFacilityHovered = false;
      }
    }
  });

  // 행정구역 select 요소 이벤트 바인딩
  bindAdminAreaSelects();

  // 전역 window 객체 등록
  window.loadFacilitySggList = loadFacilitySggList;
  window.loadFacilityEmdList = loadFacilityEmdList;

  // 아이콘 설정은 DB(qfield.facility_icon)에서 불러오며, 실패해도 내장 기본 아이콘으로 계속 동작함
  loadFacilityIconConfig();
  bindFacilityKeywordSearch();
  // 시도 목록을 불러온 뒤 기본 시·도(서울)를 적용하며 시설물도 함께 조회한다
  // (여기서 loadFacilities 를 따로 부르면 전체 조회 → 서울 조회로 두 번 요청하게 됨)
  loadFacilitySidoList();

  facilityModuleInitialized = true;
  console.log("시설물 모듈 초기화 완료");
}

// 행정구역 연쇄 select 바인딩
function bindAdminAreaSelects() {
  const sidoSelect = document.getElementById("facilitySidoSelect");
  const sggSelect = document.getElementById("facilitySggSelect");
  const emdSelect = document.getElementById("facilityEmdSelect");

  if (!sidoSelect || !sggSelect || !emdSelect) {
    console.warn("행정구역 select 요소를 찾을 수 없습니다.");
    return;
  }

  // 시도 변경 이벤트
  sidoSelect.addEventListener("change", () => {
    const sidoCd = sidoSelect.value;

    // 시군구, 읍면동 초기화
    sggSelect.innerHTML = '<option value="">전체</option>';
    emdSelect.innerHTML = '<option value="">전체</option>';
    sggSelect.disabled = !sidoCd;
    emdSelect.disabled = true;

    // 이전 시군구/읍면동 요청 취소
    if (sggAbortController) {
      sggAbortController.abort();
    }
    if (emdAbortController) {
      emdAbortController.abort();
    }

    if (sidoCd) {
      // 선택 구역 extent로 fit
      if (areaExtentMap.has(sidoCd)) {
        fitMapExtent(areaExtentMap.get(sidoCd));
      }
      // 시군구 목록 로드
      loadFacilitySggList(sidoCd);
      // 시설물 재조회
      loadFacilities({ sidoCd });
    } else {
      // 전체로 되돌림
      loadFacilities({});
    }
  });

  // 시군구 변경 이벤트
  sggSelect.addEventListener("change", () => {
    const sidoCd = sidoSelect.value;
    const sggCd = sggSelect.value;

    // 읍면동 초기화
    emdSelect.innerHTML = '<option value="">전체</option>';
    emdSelect.disabled = !sggCd;

    // 이전 읍면동 요청 취소
    if (emdAbortController) {
      emdAbortController.abort();
    }

    if (sggCd) {
      if (areaExtentMap.has(sggCd)) {
        fitMapExtent(areaExtentMap.get(sggCd));
      }
      loadFacilityEmdList(sggCd);
      loadFacilities({ sggCd });
    } else {
      // 시군구가 전체이면 시도로 조회 및 extent 복귀
      if (sidoCd && areaExtentMap.has(sidoCd)) {
        fitMapExtent(areaExtentMap.get(sidoCd));
      }
      loadFacilities({ sidoCd });
    }
  });

  // 읍면동 변경 이벤트
  emdSelect.addEventListener("change", () => {
    const sidoCd = sidoSelect.value;
    const sggCd = sggSelect.value;
    const emdCd = emdSelect.value;

    if (emdCd) {
      if (areaExtentMap.has(emdCd)) {
        fitMapExtent(areaExtentMap.get(emdCd));
      }
      loadFacilities({ emdCd });
    } else if (sggCd) {
      if (areaExtentMap.has(sggCd)) {
        fitMapExtent(areaExtentMap.get(sggCd));
      }
      loadFacilities({ sggCd });
    } else if (sidoCd) {
      if (areaExtentMap.has(sidoCd)) {
        fitMapExtent(areaExtentMap.get(sidoCd));
      }
      loadFacilities({ sidoCd });
    } else {
      loadFacilities({});
    }
  });
}

// 시도 목록 로드
async function loadFacilitySidoList() {
  const sidoSelect = document.getElementById("facilitySidoSelect");
  if (!sidoSelect) return;

  try {
    const url = getApiUrl("/map/admin-area/sido");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`시도 목록 조회 실패: ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      sidoSelect.innerHTML = '<option value="">전체</option>';
      data.forEach((item) => {
        if (item.extent) {
          areaExtentMap.set(String(item.code), item.extent);
        }
        const opt = document.createElement("option");
        opt.value = item.code;
        opt.textContent = item.name;
        sidoSelect.appendChild(opt);
      });
    }

    applyDefaultSido(sidoSelect);
  } catch (error) {
    console.error("시도 목록 로드 오류:", error);
    // 시도 목록을 못 받아도 시설물은 전체로 표시한다
    loadFacilities({});
  }
}

/**
 * 기본 시·도를 선택 상태로 만든다.
 * select 값을 바꾼 뒤 change 이벤트를 직접 발생시켜, 사용자가 고른 것과 같은 경로
 * (구역 extent로 지도 이동 → 시군구 목록 로드 → 시설물 재조회)를 그대로 타게 한다.
 */
function applyDefaultSido(sidoSelect) {
  const hasDefault = Array.from(sidoSelect.options).some(
    (option) => option.value === DEFAULT_SIDO_CD
  );

  if (!hasDefault) {
    // 기본 시·도가 목록에 없으면 전체로 표시
    loadFacilities({});
    return;
  }

  sidoSelect.value = DEFAULT_SIDO_CD;
  sidoSelect.dispatchEvent(new Event("change"));
}

// 시군구 목록 로드
async function loadFacilitySggList(sidoCd) {
  const sggSelect = document.getElementById("facilitySggSelect");
  if (!sggSelect) return;

  if (sggAbortController) {
    sggAbortController.abort();
  }
  sggAbortController = new AbortController();
  const signal = sggAbortController.signal;
  const currentSeq = ++sggRequestSeq;

  try {
    const url = getApiUrl(`/map/admin-area/sgg?sidoCd=${encodeURIComponent(sidoCd)}`);
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`시군구 목록 조회 실패: ${response.status}`);
    }
    const data = await response.json();
    if (signal.aborted || currentSeq !== sggRequestSeq) {
      return;
    }
    if (Array.isArray(data)) {
      sggSelect.innerHTML = '<option value="">전체</option>';
      data.forEach((item) => {
        if (item.extent) {
          areaExtentMap.set(String(item.code), item.extent);
        }
        const opt = document.createElement("option");
        opt.value = item.code;
        opt.textContent = item.name;
        sggSelect.appendChild(opt);
      });
      sggSelect.disabled = false;
    }
  } catch (error) {
    if (error.name === "AbortError" || signal.aborted || currentSeq !== sggRequestSeq) {
      return;
    }
    console.error("시군구 목록 로드 오류:", error);
  }
}

// 읍면동 목록 로드
async function loadFacilityEmdList(sggCd) {
  const emdSelect = document.getElementById("facilityEmdSelect");
  if (!emdSelect) return;

  if (emdAbortController) {
    emdAbortController.abort();
  }
  emdAbortController = new AbortController();
  const signal = emdAbortController.signal;
  const currentSeq = ++emdRequestSeq;

  try {
    const url = getApiUrl(`/map/admin-area/emd?sggCd=${encodeURIComponent(sggCd)}`);
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`읍면동 목록 조회 실패: ${response.status}`);
    }
    const data = await response.json();
    if (signal.aborted || currentSeq !== emdRequestSeq) {
      return;
    }
    if (Array.isArray(data)) {
      emdSelect.innerHTML = '<option value="">전체</option>';
      data.forEach((item) => {
        if (item.extent) {
          areaExtentMap.set(String(item.code), item.extent);
        }
        const opt = document.createElement("option");
        opt.value = item.code;
        opt.textContent = item.name;
        emdSelect.appendChild(opt);
      });
      emdSelect.disabled = false;
    }
  } catch (error) {
    if (error.name === "AbortError" || signal.aborted || currentSeq !== emdRequestSeq) {
      return;
    }
    console.error("읍면동 목록 로드 오류:", error);
  }
}

// 현재 조회된 목록 항목(검색 필터는 렌더 단계에서만 적용하므로 원본을 들고 있음)
let facilityListItems = [];
let facilityKeyword = "";

// 응답 피처에서 목록 항목 데이터만 뽑아낸다 (중복 제거)
function buildFacilityListItems(rawFeatures) {
  const seen = new Set();
  const items = [];

  rawFeatures.forEach((feat) => {
    const props = feat.properties || {};
    const totalId = props.total_id || feat.id;
    if (!totalId || seen.has(totalId)) return;
    seen.add(totalId);

    const name = props.fclt_nm || `시설물 (${totalId})`;
    // 같은 이름이 반복되므로 기관명·지사(주소)로 구분한다
    const subParts = [props.inst_nm, props.daddr].filter(
      (part) => part && String(part).trim() && String(part).trim() !== "null"
    );

    items.push({
      totalId: String(totalId),
      name,
      sub: subParts.join(" · "),
      needsRepair: String(props.repair_required_yn || "").toUpperCase() === "Y",
      condition: String(props.facility_condition || "").trim(),
      searchText: `${name} ${subParts.join(" ")}`.toLowerCase(),
    });
  });

  return items;
}

// 목록 DOM 생성 — 검색어 필터 적용, 지도와 같은 아이콘 표시
function renderFacilityList() {
  const listEl = document.getElementById("facilityList");
  const countEl = document.getElementById("facilityCount");
  const panelCountEl = document.getElementById("panelCount");
  const emptyEl = document.getElementById("facilityEmpty");
  if (!listEl) return;

  const keyword = facilityKeyword.trim().toLowerCase();
  const visibleItems = keyword
    ? facilityListItems.filter((item) => item.searchText.includes(keyword))
    : facilityListItems;

  if (countEl) countEl.textContent = visibleItems.length.toLocaleString();
  if (panelCountEl) panelCountEl.textContent = facilityListItems.length.toLocaleString();

  // 검색 결과가 없을 때만 빈 상태를 보여준다 (조회 자체가 0건인 경우는 loadFacilities 가 처리)
  if (emptyEl && facilityListItems.length > 0) {
    emptyEl.classList.toggle("hidden", visibleItems.length > 0);
  }

  const fragment = document.createDocumentFragment();

  visibleItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = "facility-item";
    li.setAttribute("data-total-id", item.totalId);
    if (selectedTotalId && String(selectedTotalId) === item.totalId) {
      li.classList.add("selected");
    }

    // 지도 핀과 같은 아이콘 (종류·보수필요 색 규칙 공유)
    const iconConfig = resolveFacilityIcon(item.name);
    const iconWrap = document.createElement("span");
    iconWrap.className = "facility-item-icon";
    const iconImg = document.createElement("img");
    iconImg.src = buildFacilityIconUrl(
      iconConfig.glyph,
      getFacilityPinColor(iconConfig, item.needsRepair)
    );
    iconImg.alt = iconConfig.label;
    iconWrap.appendChild(iconImg);
    li.appendChild(iconWrap);

    const body = document.createElement("div");
    body.className = "facility-item-body";

    const nameSpan = document.createElement("span");
    nameSpan.className = "facility-name";
    nameSpan.textContent = item.name; // XSS 방지
    body.appendChild(nameSpan);

    if (item.sub) {
      const subSpan = document.createElement("span");
      subSpan.className = "facility-sub";
      subSpan.textContent = item.sub;
      subSpan.title = item.sub;
      body.appendChild(subSpan);
    }
    li.appendChild(body);

    // 보수필요 / 상태 뱃지
    if (item.needsRepair) {
      const badge = document.createElement("span");
      badge.className = "facility-badge badge-repair";
      badge.textContent = "보수필요";
      li.appendChild(badge);
    } else if (item.condition) {
      const badge = document.createElement("span");
      badge.className = "facility-badge badge-condition";
      badge.textContent = item.condition;
      li.appendChild(badge);
    }

    li.addEventListener("click", () => {
      selectFacility(item.totalId, true);
    });

    fragment.appendChild(li);
  });

  listEl.innerHTML = "";
  listEl.appendChild(fragment);
}

// 검색 입력 바인딩 (입력할 때마다 목록만 다시 그림 — 서버 재조회 없음)
function bindFacilityKeywordSearch() {
  const inputEl = document.getElementById("facilityKeyword");
  const clearEl = document.getElementById("facilityKeywordClear");
  if (!inputEl) return;

  const applyKeyword = (value) => {
    facilityKeyword = value;
    if (clearEl) clearEl.classList.toggle("hidden", !value);
    renderFacilityList();
  };

  inputEl.addEventListener("input", () => applyKeyword(inputEl.value));
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      inputEl.value = "";
      applyKeyword("");
    }
  });

  if (clearEl) {
    clearEl.addEventListener("click", () => {
      inputEl.value = "";
      inputEl.focus();
      applyKeyword("");
    });
  }
}

// 시설물 목록 및 지도 데이터 로드
async function loadFacilities(filter = {}) {
  const countEl = document.getElementById("facilityCount");
  const listEl = document.getElementById("facilityList");
  const loadingEl = document.getElementById("facilityLoading");
  const emptyEl = document.getElementById("facilityEmpty");
  const errorEl = document.getElementById("facilityError");

  // 이전 요청 취소 및 새 순번 발급
  if (facilityAbortController) {
    facilityAbortController.abort();
  }
  facilityAbortController = new AbortController();
  const signal = facilityAbortController.signal;
  const currentSeq = ++facilityRequestSeq;

  // 이전 선택 및 팝업 닫기
  closeFacilityPopup();

  // 상태 표시: 로딩 중
  if (loadingEl) loadingEl.classList.remove("hidden");
  if (emptyEl) emptyEl.classList.add("hidden");
  if (errorEl) errorEl.classList.add("hidden");
  if (listEl) listEl.innerHTML = "";

  // 가장 구체적인 코드로 쿼리 스트링 구성
  let queryString = "";
  if (filter.emdCd) {
    queryString = `?emdCd=${encodeURIComponent(filter.emdCd)}`;
  } else if (filter.sggCd) {
    queryString = `?sggCd=${encodeURIComponent(filter.sggCd)}`;
  } else if (filter.sidoCd) {
    queryString = `?sidoCd=${encodeURIComponent(filter.sidoCd)}`;
  }

  const url = getApiUrl(`/map/qfield/facilities${queryString}`);

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`시설물 조회 실패: ${response.status}`);
    }

    const geojsonData = await response.json();

    // 최신 요청인지 확인
    if (signal.aborted || currentSeq !== facilityRequestSeq) {
      return;
    }

    const rawFeatures = geojsonData.features || [];

    // 로딩 숨김
    if (loadingEl) loadingEl.classList.add("hidden");

    if (rawFeatures.length === 0) {
      facilityListItems = [];
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (countEl) countEl.textContent = "0";
      const panelCountEl = document.getElementById("panelCount");
      if (panelCountEl) panelCountEl.textContent = "0";
      if (facilitySource) facilitySource.clear();
      return;
    }

    // 1) 목록 렌더링 (검색어가 있으면 걸러서 표시)
    facilityListItems = buildFacilityListItems(rawFeatures);
    renderFacilityList();

    // 2) 지도 표출: 목록 렌더링 후 같은 응답 데이터로 벡터 레이어 채우기
    // docs/map-architecture.md 규칙: featureProjection에 vectorSource.getProjection()(= null) 전달
    if (facilitySource) {
      facilitySource.clear();
      const geojsonFormat = new ol.format.GeoJSON();
      const olFeatures = geojsonFormat.readFeatures(geojsonData, {
        featureProjection: facilitySource.getProjection(),
      });

      olFeatures.forEach((feat) => {
        const tid = feat.get("total_id") || feat.getId();
        if (tid) {
          feat.setId(String(tid));
        }
      });

      facilitySource.addFeatures(olFeatures);
    }
  } catch (error) {
    // 취소된 요청은 오류 UI를 띄우지 않고 조용히 무시
    if (error.name === "AbortError" || signal.aborted || currentSeq !== facilityRequestSeq) {
      return;
    }
    console.error("시설물 데이터 로드 오류:", error);
    if (loadingEl) loadingEl.classList.add("hidden");
    if (errorEl) errorEl.classList.remove("hidden");
    if (countEl) countEl.textContent = "0";
    if (facilitySource) facilitySource.clear();
    if (listEl) listEl.innerHTML = "";
  }
}

/**
 * 팝업 전체가 지도 화면 안에 들어오도록 보정한다.
 *
 * 주의할 점 두 가지 때문에 setPosition 재호출이 아니라 panIntoView 를 쓴다.
 *  1) 같은 좌표로 setPosition 을 다시 호출하면 값이 바뀌지 않아 autoPan 이 아예 실행되지 않는다.
 *  2) 지도 이동 애니메이션이 끝나기 전에 보정하면 애니메이션이 팝업을 다시 화면 밖으로 밀어낸다.
 * 그래서 애니메이션이 끝난 뒤(최대 약 1.5초 대기) 한 번 보정한다.
 */
function ensureFacilityPopupVisible() {
  const map = getMap();
  if (!map || !facilityOverlay) return;

  const deadline = Date.now() + 1500;

  const run = () => {
    if (!facilityOverlay || facilityOverlay.getPosition() === undefined) return;

    if (map.getView().getAnimating() && Date.now() < deadline) {
      requestAnimationFrame(run);
      return;
    }

    facilityOverlay.panIntoView({ margin: 24, animation: { duration: 200 } });
  };

  requestAnimationFrame(run);
}

/**
 * 선택된 목록 항목이 보이도록 목록 컨테이너만 스크롤한다.
 * element.scrollIntoView() 는 목록뿐 아니라 상위 문서까지 함께 스크롤해서,
 * 지도에서 핀을 클릭하면 화면 전체가 위로 밀려 헤더 아래가 잘리는 문제가 있었다.
 * 그래서 컨테이너 기준으로 필요한 만큼만 직접 스크롤한다.
 */
function scrollFacilityItemIntoView(item) {
  const container = document.querySelector(".facility-list-container");
  if (!container || !item) return;

  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const margin = 8; // 위아래로 살짝 여유

  let delta = 0;
  if (itemRect.top < containerRect.top) {
    delta = itemRect.top - containerRect.top - margin;
  } else if (itemRect.bottom > containerRect.bottom) {
    delta = itemRect.bottom - containerRect.bottom + margin;
  }

  if (delta !== 0) {
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }
}

// 시설물 선택 (목록 또는 지도에서 호출)
function selectFacility(totalId, animate = true) {
  if (!totalId) return;
  selectedTotalId = String(totalId);

  // 1) 목록 하이라이트 및 스크롤
  const items = document.querySelectorAll(".facility-item");
  items.forEach((item) => {
    if (item.getAttribute("data-total-id") === selectedTotalId) {
      item.classList.add("selected");
      scrollFacilityItemIntoView(item);
    } else {
      item.classList.remove("selected");
    }
  });

  // 2) 지도 하이라이트 갱신
  if (facilitySource) {
    facilitySource.changed();
  }

  // 3) 피처 위치 확인 및 지도 이동
  let targetCoord = null;
  if (facilitySource) {
    const feature =
      facilitySource.getFeatureById(selectedTotalId) ||
      facilitySource.getFeatures().find((f) => {
        const fid = f.get("total_id") || f.getId();
        return String(fid) === selectedTotalId;
      });

    if (feature && feature.getGeometry()) {
      const geom = feature.getGeometry();
      if (geom.getType() === "Point") {
        targetCoord = geom.getCoordinates();
      } else {
        targetCoord = ol.extent.getCenter(geom.getExtent());
      }
    }
  }

  const map = getMap();
  if (map && targetCoord) {
    if (animate) {
      const currentZoom = map.getView().getZoom();
      map.getView().animate({
        center: targetCoord,
        zoom: Math.max(currentZoom, 16),
        duration: 400,
      });
    }
    showFacilityDetail(selectedTotalId, targetCoord);
  } else if (targetCoord) {
    showFacilityDetail(selectedTotalId, targetCoord);
  }
}

// 시설물 상세정보 조회 및 팝업 표시
async function showFacilityDetail(totalId, coordinate) {
  const popupEl = document.getElementById("facility-popup");
  const titleEl = document.getElementById("facilityPopupTitle");
  const bodyEl = document.getElementById("facilityPopupBody");

  if (!popupEl || !facilityOverlay) return;

  // 오버레이 위치 지정
  if (coordinate) {
    facilityOverlay.setPosition(coordinate);
  }

  // 상세 응답을 기다리는 동안에도 목록에 이미 있는 값으로 헤더를 먼저 채움
  const loadedFeature = facilitySource ? facilitySource.getFeatureById(totalId) : null;
  const loadedName = loadedFeature ? loadedFeature.get("fclt_nm") : "";
  const loadedNeedsRepair =
    String(loadedFeature ? loadedFeature.get("repair_required_yn") : "").toUpperCase() === "Y";

  if (titleEl) titleEl.textContent = loadedName || "시설물 상세정보";
  renderFacilityPopupHeader(loadedName, loadedNeedsRepair, "");
  if (bodyEl) {
    bodyEl.innerHTML = '<div class="facility-detail-loading">상세정보를 불러오는 중...</div>';
  }

  try {
    const url = getApiUrl(`/map/qfield/facilities/${encodeURIComponent(totalId)}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`상세정보 조회 실패: ${response.status}`);
    }

    const featureData = await response.json();
    const properties = featureData.properties || {};

    // 팝업 타이틀과 헤더 배지 (지도 아이콘과 같은 종류·색 규칙)
    if (titleEl) {
      titleEl.textContent = properties.fclt_nm || "시설물 상세정보";
    }
    // 상태 값은 본문에 행으로 나오므로 헤더에는 종류와 보수 필요 배지만 둔다
    renderFacilityPopupHeader(
      properties.fclt_nm,
      String(properties.repair_required_yn || "").toUpperCase() === "Y",
      ""
    );

    if (!bodyEl) return;
    bodyEl.innerHTML = "";

    const detailList = document.createElement("div");
    detailList.className = "facility-detail-list";

    // 정의된 필드 렌더링 (값이 비어 있는 필드는 숨김, XSS 방지 처리)
    DETAIL_FIELD_CONFIG.forEach((cfg) => {
      if (cfg.hidden) return; // 숨김 처리된 필드
      if (HEADER_FIELD_KEYS.has(cfg.key)) return; // 헤더에서 이미 표시

      // 사진 갤러리는 photo_1 이 비어 있어도 다른 장이 있으면 표시해야 하므로 별도 판정
      const val = cfg.isPhotoGallery
        ? ["photo_1", "photo_2", "photo_3", "photo_4", "photo_5"].find(
            (photoKey) =>
              properties[photoKey] &&
              String(properties[photoKey]).trim() &&
              String(properties[photoKey]).trim() !== "null"
          ) && "photos"
        : properties[cfg.key];
      const isEmpty =
        val === null ||
        val === undefined ||
        String(val).trim() === "" ||
        String(val).trim() === "null";

      const row = document.createElement("div");
      row.className = "facility-detail-row";

      const label = document.createElement("span");
      label.className = "facility-detail-label";
      label.textContent = cfg.label;

      const value = document.createElement("span");
      value.className = "facility-detail-value";

      // 값이 없어도 항목은 남기고 '-' 로 표시한다 (어떤 정보가 비어 있는지 보이도록)
      if (isEmpty) {
        value.classList.add("is-empty");
        value.textContent = "-";
        row.appendChild(label);
        row.appendChild(value);
        detailList.appendChild(row);
        return;
      }

      const strVal = String(val).trim();
      const isHttpUrl =
        strVal.startsWith("http://") || strVal.startsWith("https://");

      if (cfg.isPhotoGallery) {
        // photo_1~photo_5 중 값이 있는 것만 모아 한 줄 갤러리로 표시
        const photoUrls = ["photo_1", "photo_2", "photo_3", "photo_4", "photo_5"]
          .map((photoKey) => properties[photoKey])
          .filter((url) => url && String(url).trim() && String(url).trim() !== "null")
          .map((url) => String(url).trim());
        row.classList.add("facility-detail-row-block");
        value.appendChild(createFacilityPhotoGallery(photoUrls));
      } else if (cfg.isAudio && isHttpUrl) {
        const audio = document.createElement("audio");
        audio.className = "facility-media-audio";
        audio.controls = true;
        audio.preload = "none";
        audio.src = strVal;
        row.classList.add("facility-detail-row-block");
        value.appendChild(audio);
      } else if (cfg.isVideo && isHttpUrl) {
        const video = document.createElement("video");
        video.className = "facility-media-video";
        video.controls = true;
        video.preload = "metadata";
        video.src = strVal;
        row.classList.add("facility-detail-row-block");
        value.appendChild(video);
      } else if ((cfg.isMedia || cfg.isAudio || cfg.isVideo) && isHttpUrl) {
        const link = document.createElement("a");
        link.href = strVal;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "열기 (새 창)";
        link.className = "facility-media-link";
        value.appendChild(link);
      } else if (cfg.isDateTime) {
        value.textContent = formatFacilityDateTime(strVal);
      } else if (cfg.valueMap) {
        value.textContent = formatFacilityCodeValue(cfg.valueMap, strVal);
      } else {
        value.textContent = strVal;
      }

      row.appendChild(label);
      row.appendChild(value);
      detailList.appendChild(row);
    });

    // 정의된 필드 외에 추가 프로퍼티가 있으면 표시 (단, 기 표시된 키, geometry, total_id 등 제외)
    const knownKeys = new Set(DETAIL_FIELD_CONFIG.map((c) => c.key));
    knownKeys.add("geometry");
    knownKeys.add("type");
    knownKeys.add("total_id");
    knownKeys.add("id");
    // 내부 관리용 키(행정구역 코드·원본 테이블 식별자 등)는 사용자에게 보여주지 않음
    INTERNAL_DETAIL_KEYS.forEach((key) => knownKeys.add(key));

    Object.keys(properties).forEach((k) => {
      if (knownKeys.has(k)) return;
      const val = properties[k];
      if (
        val === null ||
        val === undefined ||
        String(val).trim() === "" ||
        String(val).trim() === "null"
      ) {
        return;
      }

      const row = document.createElement("div");
      row.className = "facility-detail-row";

      const label = document.createElement("span");
      label.className = "facility-detail-label";
      label.textContent = k;

      const value = document.createElement("span");
      value.className = "facility-detail-value";

      const strVal = String(val).trim();
      if (strVal.startsWith("http://") || strVal.startsWith("https://")) {
        const link = document.createElement("a");
        link.href = strVal;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "열기 (새 창)";
        link.className = "facility-media-link";
        value.appendChild(link);
      } else {
        value.textContent = strVal;
      }

      row.appendChild(label);
      row.appendChild(value);
      detailList.appendChild(row);
    });

    if (detailList.children.length === 0) {
      bodyEl.innerHTML = '<div class="facility-detail-empty">표시할 정보가 없습니다.</div>';
    } else {
      bodyEl.appendChild(detailList);
    }

    // 내용이 채워진 뒤(=높이 확정) 지도 이동 애니메이션까지 끝나면 팝업 전체가 보이도록 보정
    ensureFacilityPopupVisible();
  } catch (error) {
    console.error("시설물 상세정보 로드 오류:", error);
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="facility-detail-error">상세정보를 불러오는 데 실패했습니다.</div>';
    }
  }
}

// 팝업 닫기
function closeFacilityPopup() {
  if (facilityOverlay) {
    facilityOverlay.setPosition(undefined);
  }
  selectedTotalId = null;

  // 호버 커서 상태 복원
  if (isFacilityHovered) {
    const map = getMap();
    if (map && map.getTargetElement()) {
      map.getTargetElement().style.cursor = "";
    }
    isFacilityHovered = false;
  }

  // 목록 선택 상태 해제
  const items = document.querySelectorAll(".facility-item.selected");
  items.forEach((item) => {
    item.classList.remove("selected");
  });

  // 지도 선택 스타일 복원
  if (facilitySource) {
    facilitySource.changed();
  }
}

// 레이어/소스 getter
function getFacilityLayer() {
  return facilityLayer;
}

function getFacilitySource() {
  return facilitySource;
}

export {
  initializeFacilityModule,
  loadFacilities,
  selectFacility,
  showFacilityDetail,
  closeFacilityPopup,
  loadFacilitySidoList,
  loadFacilitySggList,
  loadFacilityEmdList,
  getFacilityLayer,
  getFacilitySource,
};

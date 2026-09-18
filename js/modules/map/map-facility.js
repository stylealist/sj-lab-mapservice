// QField 시설물 레이어 및 관리 모듈
import { getMap } from "./map-core.js";
import { MapEventManager } from "./map-events.js";
import { getApiUrl } from "./map-wfs.js";
import { bindOverlayHeaderDrag } from "./map-popup-drag.js";

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
// 팝업 표시 순번 — 다른 시설물을 고르거나 닫으면 올려서 이전 표시 대기를 무효화
let facilityPopupRevealToken = 0;

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
  // 값이 비어 있으면 보수 불필요로 본다 (목록 필터 matchesFacilityRepairFilter 와 같은 기준 — Y 가 아니면 불필요)
  { key: "repair_required_yn", label: "보수 필요 여부", valueMap: "repair", emptyValue: "N" },
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
  { key: "video", label: "현장 영상", isVideo: true },
  { key: "audio_memo", label: "현장 특이사항", isAudio: true },
  // 음성(audio_memo)을 STT로 받아쓴 결과. 동기화 워커가 <컬럼>_txt 에 채운다.
  // 바로 위 음성 항목에 이어지도록 순서를 유지할 것
  { key: "audio_memo_txt", label: "음성 변환 내용" },
  // facility_memo 는 앱에서 텍스트 입력 필드라 그 _txt 는 항상 비어 있어 숨긴다
  { key: "facility_memo_txt", label: "시설물 특이사항 변환", hidden: true },
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
  // 목록 필터·헤더 배지와 같은 용어로 표시 (앱 ValueMap 원문: Y=정비요청, N=양호)
  repair: {
    Y: "보수 필요",
    N: "보수 불필요",
  },
};

/**
 * 첨부 파일(사진·음성·영상)의 재생 URL을 만든다.
 *
 * DB에는 URL이 아니라 QField 프로젝트 내 상대 경로(DCIM/x.jpg 등)가 저장되고
 * 원본은 QFieldCloud에 있으며 인증이 필요하다. 브라우저가 직접 받을 수 없으므로
 * 백엔드 중계 엔드포인트를 통해 받는다. 값이 이미 http(s) URL이면 그대로 쓴다.
 */
function buildFacilityMediaUrl(totalId, rawPath) {
  const path = String(rawPath || "").trim();
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  return getApiUrl(
    `/map/qfield/facilities/${encodeURIComponent(totalId)}/media?path=${encodeURIComponent(path)}`
  );
}

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

// 팝업 기본 위치 오프셋 — 핀 오른쪽에 띄운다.
// 선택된 핀은 원본 24x32 를 1.25배로 그리므로 기준점 기준 반폭이 15px,
// 거기에 여백 9px 를 더해 24px 오른쪽에 붙인다(positioning: center-left 와 함께 사용).
const FACILITY_POPUP_OFFSET = [24, 0];
// 상세 응답이 이 시간(ms)보다 늦으면 "불러오는 중" 상태로 팝업을 먼저 보여준다
const FACILITY_POPUP_SLOW_REVEAL_MS = 1200;
const FACILITY_ICON_COLOR = "#2563eb"; // 기본 시설물 (파랑)
const FACILITY_WARN_COLOR = "#d97706"; // 보수 필요 (주황)
const FACILITY_OFFICE_DONE_COLOR = "#059669"; // 보수 필요 중 내업 완료 (초록)

// 내업 처리 상태 코드 및 한글 매핑
// 내업은 보수 필요(repair_required_yn = Y) 시설물만 대상이며, 기록이 없으면 PENDING(미완료)이다.
// PENDING 은 저장값이 아니라 "기록 없음" 표시값이므로 작성 폼 선택지에는 넣지 않는다.
const OFFICE_WORK_STATUS_MAP = {
  PENDING: "미완료",
  RECEIVED: "접수",
  IN_PROGRESS: "처리중",
  DONE: "완료",
  HOLD: "보류",
};

const OFFICE_WORK_STATUS_BADGE_CLASS = {
  PENDING: "status-badge-pending",
  RECEIVED: "status-badge-received",
  IN_PROGRESS: "status-badge-in-progress",
  DONE: "status-badge-done",
  HOLD: "status-badge-hold",
};

// 시설물의 내업 상태 코드 — 보수 필요가 아니면 ""(내업 대상 아님), 보수 필요인데 값이 없거나 모르는 값이면 PENDING
function resolveOfficeWorkStatus(needsRepair, status) {
  if (!needsRepair) return "";
  const code = String(status || "").toUpperCase();
  return OFFICE_WORK_STATUS_MAP[code] ? code : "PENDING";
}

// 목록·팝업 헤더용 내업 배지 클래스 (완료는 지도 핀과 같은 짙은 초록)
function getOfficeWorkBadgeClass(statusCode) {
  return statusCode === "DONE" ? "badge-office-done" : OFFICE_WORK_STATUS_BADGE_CLASS[statusCode];
}

// 시설물 종류별 글리프 — fclt_nm 에 아래 keywords 가 포함되면 해당 아이콘을 사용
// ※ 운영 기준은 DB(map.facility_icon)이며 `GET /map/qfield/facility-icons`로 불러온다.
//    아래 배열은 API 조회 실패·빈 응답일 때만 쓰는 **대체값**이므로, 아이콘을 추가·변경할 때는
//    이 파일이 아니라 DB 행을 수정할 것 (생성 스크립트: mapservice-rest/db/map_facility_icon.sql)
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

// 아이콘 설정에서 핀 색 결정 (보수 필요 시설물 중 내업 완료는 초록 계열)
function getFacilityPinColor(iconConfig, needsRepair, isOfficeDone = false) {
  if (needsRepair) {
    if (isOfficeDone) {
      return iconConfig.officeDoneColor || FACILITY_OFFICE_DONE_COLOR;
    }
    return iconConfig.warnColor || FACILITY_WARN_COLOR;
  }
  return iconConfig.pinColor || FACILITY_ICON_COLOR;
}

/**
 * 시설물 아이콘 설정을 DB(map.facility_icon)에서 불러온다.
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
        officeDoneColor: row.officeDoneColor,
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

// 팝업 헤더를 지도 아이콘과 같은 규칙으로 채움 (아이콘 + 종류·보수필요·내업완료·상태 배지)
function renderFacilityPopupHeader(facilityName, needsRepair, conditionText, officeWorkInfo = null) {
  const iconEl = document.getElementById("facilityPopupIcon");
  const metaEl = document.getElementById("facilityPopupMeta");
  if (!iconEl || !metaEl) return;

  const isOfficeDone = officeWorkInfo && String(officeWorkInfo.status || "").toUpperCase() === "DONE";
  const iconConfig = resolveFacilityIcon(facilityName);
  const pinColor = getFacilityPinColor(iconConfig, needsRepair, isOfficeDone);

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
  // 보수 필요 여부는 항상 둘 중 하나를 보여준다 (Y 가 아니면 불필요 — 목록 필터와 같은 기준)
  if (needsRepair) {
    badges.push({ text: "보수 필요", className: "badge-repair" });
  } else {
    badges.push({ text: "보수 불필요", className: "badge-no-repair" });
  }

  // 내업 상태 배지 (보수 필요 시설물만): 미완료/접수/처리중/완료/보류
  // 완료는 완료일·담당자 문구를 덧붙인다 (예: "내업 완료 · 2026-09-18 · 홍길동")
  const officeStatusCode = resolveOfficeWorkStatus(needsRepair, officeWorkInfo && officeWorkInfo.status);
  if (officeStatusCode) {
    const parts = [`내업 ${OFFICE_WORK_STATUS_MAP[officeStatusCode]}`];
    if (isOfficeDone && officeWorkInfo.completeDate) {
      parts.push(officeWorkInfo.completeDate);
    }
    if (isOfficeDone && officeWorkInfo.managerNm) {
      parts.push(officeWorkInfo.managerNm);
    }
    badges.push({ text: parts.join(" · "), className: getOfficeWorkBadgeClass(officeStatusCode) });
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

// 종류·보수필요·내업완료·선택 상태에 맞는 스타일 반환 (캐시)
function getFacilityStyle(iconConfig, needsRepair, isOfficeDone, isSelected) {
  const statusKey = needsRepair ? (isOfficeDone ? "done" : "warn") : "base";
  const cacheKey = `${iconConfig.type}|${statusKey}|${isSelected ? "sel" : "def"}`;
  if (facilityStyleCache.has(cacheKey)) {
    return facilityStyleCache.get(cacheKey);
  }

  const pinColor = getFacilityPinColor(iconConfig, needsRepair, isOfficeDone);
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
  const officeWorkStatus = feature.get("office_work_status") || "";
  const isOfficeDone = String(officeWorkStatus).toUpperCase() === "DONE";

  // 보수 필요 여부 필터 및 내업 필터에 맞지 않는 핀은 그리지 않는다 (스타일이 없으면 클릭·호버 대상에서도 빠짐)
  if (!matchesFacilityRepairFilter(needsRepair)) return null;
  if (!matchesFacilityOfficeFilter(needsRepair, officeWorkStatus)) return null;

  return getFacilityStyle(
    resolveFacilityIcon(feature.get("fclt_nm")),
    needsRepair,
    isOfficeDone,
    isSelected
  );
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
    <div class="facility-popup-office-footer hidden" id="facilityOfficeFooter"></div>
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
    // 팝업을 핀 오른쪽에 붙인다. 세로 가운데 맞춤은 OpenLayers 의 center-left 가
    // 내용이 채워지기 전 높이로 계산돼 어긋나므로, top-left 로 두고 아래에서 직접 계산한다.
    positioning: "top-left",
    stopEvent: true,
    offset: FACILITY_POPUP_OFFSET.slice(),
    // autoPan 은 끈다. setPosition 직후 실행되면 selectFacility 의 가운데 이동 애니메이션과
    // 겹쳐 팝업이 한 번 보였다가 자리를 옮긴다. 화면 안 보정은 revealFacilityPopup 이
    // 이동이 끝난 뒤 panIntoView 로 직접 한다.
    autoPan: false,
  });
  map.addOverlay(facilityOverlay);

  // 헤더를 끌어 팝업 위치를 옮길 수 있게 함 (WFS·WMS 팝업과 같은 공용 모듈)
  bindOverlayHeaderDrag(facilityOverlay, popupEl.querySelector(".facility-popup-header"), {
    ignoreSelector: ".facility-popup-close",
  });

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
      // 지도에서 직접 클릭한 경우: 가운데로만 옮기고 배율은 그대로 둔다
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

  // 아이콘 설정은 DB(map.facility_icon)에서 불러오며, 실패해도 내장 기본 아이콘으로 계속 동작함
  loadFacilityIconConfig();
  bindFacilityKeywordSearch();
  bindFacilityRepairFilter();
  bindFacilityOfficeFilter();
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
// 보수 필요 여부 필터: "all"(기본) | "repair"(repair_required_yn = Y) | "noRepair"(Y 가 아닌 전부 — N·빈 값)
let facilityRepairFilter = "all";
// 내업 상태 필터: "all"(기본) | "PENDING"(미완료) | "RECEIVED" | "IN_PROGRESS" | "DONE" | "HOLD"
// "all" 이 아니면 보수 필요 시설물 중 그 상태인 것만 남는다 (보수 불필요 시설물은 내업 대상이 아님)
let facilityOfficeFilter = "all";

function matchesFacilityRepairFilter(needsRepair) {
  if (facilityRepairFilter === "repair") return needsRepair;
  if (facilityRepairFilter === "noRepair") return !needsRepair;
  return true;
}

function matchesFacilityOfficeFilter(needsRepair, officeWorkStatus) {
  if (facilityOfficeFilter === "all") return true;
  return resolveOfficeWorkStatus(needsRepair, officeWorkStatus) === facilityOfficeFilter;
}

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
      officeWorkStatus: props.office_work_status || null,
      officeWorkCompleteDate: props.office_work_complete_date || null,
      condition: String(props.facility_condition || "").trim(),
      searchText: `${name} ${subParts.join(" ")}`.toLowerCase(),
    });
  });

  return items;
}

// 목록 DOM 생성 — 검색어·보수 필요 여부·내업 처리 필터 적용, 지도와 같은 아이콘 표시
function renderFacilityList() {
  const listEl = document.getElementById("facilityList");
  const countEl = document.getElementById("facilityCount");
  const panelCountEl = document.getElementById("panelCount");
  const emptyEl = document.getElementById("facilityEmpty");
  if (!listEl) return;

  const keyword = facilityKeyword.trim().toLowerCase();
  const keywordItems = keyword
    ? facilityListItems.filter((item) => item.searchText.includes(keyword))
    : facilityListItems;

  // 보수 필요 필터와 내업 필터가 함께 적용(AND)
  const visibleItems = keywordItems.filter(
    (item) =>
      matchesFacilityRepairFilter(item.needsRepair) &&
      matchesFacilityOfficeFilter(item.needsRepair, item.officeWorkStatus)
  );

  // 보수 필요 필터 건수 (현재 내업 필터 적용 기준)
  const itemsForRepairCounts = keywordItems.filter((item) =>
    matchesFacilityOfficeFilter(item.needsRepair, item.officeWorkStatus)
  );
  const repairCount = itemsForRepairCounts.filter((item) => item.needsRepair).length;
  updateFacilityRepairCounts({
    all: itemsForRepairCounts.length,
    repair: repairCount,
    noRepair: itemsForRepairCounts.length - repairCount,
  });

  // 내업 필터 건수 (현재 보수 필요 필터 적용 기준)
  const itemsForOfficeCounts = keywordItems.filter((item) =>
    matchesFacilityRepairFilter(item.needsRepair)
  );
  const officeCounts = { all: itemsForOfficeCounts.length };
  Object.keys(OFFICE_WORK_STATUS_MAP).forEach((code) => {
    officeCounts[code] = 0;
  });
  itemsForOfficeCounts.forEach((item) => {
    const code = resolveOfficeWorkStatus(item.needsRepair, item.officeWorkStatus);
    if (code) officeCounts[code] += 1;
  });
  updateFacilityOfficeCounts(officeCounts);

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

    const isOfficeDone = String(item.officeWorkStatus || "").toUpperCase() === "DONE";

    // 지도 핀과 같은 아이콘 (종류·보수필요·내업완료 색 규칙 공유)
    const iconConfig = resolveFacilityIcon(item.name);
    const iconWrap = document.createElement("span");
    iconWrap.className = "facility-item-icon";
    const iconImg = document.createElement("img");
    iconImg.src = buildFacilityIconUrl(
      iconConfig.glyph,
      getFacilityPinColor(iconConfig, item.needsRepair, isOfficeDone)
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

    // 배지 영역: 보수필요 배지 옆에 내업 완료 배지 표시
    const badgesWrap = document.createElement("div");
    badgesWrap.className = "facility-item-badges";

    if (item.needsRepair) {
      const badge = document.createElement("span");
      badge.className = "facility-badge badge-repair";
      badge.textContent = "보수필요";
      badgesWrap.appendChild(badge);
    } else if (item.condition) {
      const badge = document.createElement("span");
      badge.className = "facility-badge badge-condition";
      badge.textContent = item.condition;
      badgesWrap.appendChild(badge);
    }

    // 보수 필요 시설물은 내업 상태(미완료/접수/처리중/완료/보류)를 항상 표시
    const officeStatusCode = resolveOfficeWorkStatus(item.needsRepair, item.officeWorkStatus);
    if (officeStatusCode) {
      const officeBadge = document.createElement("span");
      officeBadge.className = `facility-badge ${getOfficeWorkBadgeClass(officeStatusCode)}`;
      officeBadge.textContent = `내업 ${OFFICE_WORK_STATUS_MAP[officeStatusCode]}`;
      badgesWrap.appendChild(officeBadge);
    }

    if (badgesWrap.children.length > 0) {
      li.appendChild(badgesWrap);
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

function updateFacilityRepairCounts(counts) {
  document.querySelectorAll("[data-repair-count]").forEach((el) => {
    const value = counts[el.getAttribute("data-repair-count")] || 0;
    el.textContent = value.toLocaleString();
  });
}

// 내업 select 의 각 항목 뒤에 건수를 붙인다 (예: "완료 (3)")
function updateFacilityOfficeCounts(counts) {
  const selectEl = document.getElementById("facilityOfficeSelect");
  if (!selectEl) return;
  Array.from(selectEl.options).forEach((option) => {
    const label = option.getAttribute("data-label") || option.textContent.replace(/\s*\(\d[\d,]*\)$/, "");
    option.setAttribute("data-label", label);
    option.textContent = `${label} (${(counts[option.value] || 0).toLocaleString()})`;
  });
}

// 내업 필터 줄은 "보수 필요"를 고른 경우에만 보인다 (내업은 보수 요청 건의 후속 처리)
function syncFacilityOfficeFilterVisibility() {
  const rowEl = document.getElementById("facilityOfficeFilterRow");
  if (!rowEl) return;
  const visible = facilityRepairFilter === "repair";
  rowEl.classList.toggle("hidden", !visible);

  // 숨기면서 필터가 남아 있으면 보이지 않는 조건이 목록을 계속 거르게 되므로 전체로 되돌린다
  if (!visible && facilityOfficeFilter !== "all") {
    facilityOfficeFilter = "all";
    const selectEl = document.getElementById("facilityOfficeSelect");
    if (selectEl) selectEl.value = "all";
  }
}

// 보수 필요 여부 필터 바인딩 — 목록을 다시 그리고 지도 핀 스타일도 갱신 (서버 재조회 없음)
function bindFacilityRepairFilter() {
  const groupEl = document.getElementById("facilityRepairFilter");
  if (!groupEl) return;
  const options = Array.from(groupEl.querySelectorAll("[data-repair-filter]"));

  const applyRepairFilter = (value) => {
    facilityRepairFilter = value;
    options.forEach((option) => {
      const isActive = option.getAttribute("data-repair-filter") === value;
      option.classList.toggle("active", isActive);
      option.setAttribute("aria-checked", isActive ? "true" : "false");
    });

    // 보수 필요를 벗어나면 내업 줄을 감추고 필터도 전체로 되돌린다
    syncFacilityOfficeFilterVisibility();

    // 열려 있는 팝업의 시설물이 필터에서 빠지면 핀이 사라지므로 팝업도 닫는다
    if (selectedTotalId) {
      const selectedItem = facilityListItems.find((item) => item.totalId === String(selectedTotalId));
      if (
        selectedItem &&
        (!matchesFacilityRepairFilter(selectedItem.needsRepair) ||
          !matchesFacilityOfficeFilter(selectedItem.needsRepair, selectedItem.officeWorkStatus))
      ) {
        closeFacilityPopup();
      }
    }

    renderFacilityList();
    if (facilitySource) facilitySource.changed();
  };

  options.forEach((option) => {
    option.addEventListener("click", () => applyRepairFilter(option.getAttribute("data-repair-filter")));
  });
}

// 내업 상태 필터 바인딩 — 목록을 다시 그리고 지도 핀 스타일도 갱신 (서버 재조회 없음)
function bindFacilityOfficeFilter() {
  const selectEl = document.getElementById("facilityOfficeSelect");
  if (!selectEl) return;

  const applyOfficeFilter = (value) => {
    facilityOfficeFilter = value;

    // 열려 있는 팝업의 시설물이 필터에서 빠지면 핀이 사라지므로 팝업도 닫는다
    if (selectedTotalId) {
      const selectedItem = facilityListItems.find((item) => item.totalId === String(selectedTotalId));
      if (
        selectedItem &&
        (!matchesFacilityRepairFilter(selectedItem.needsRepair) ||
          !matchesFacilityOfficeFilter(selectedItem.needsRepair, selectedItem.officeWorkStatus))
      ) {
        closeFacilityPopup();
      }
    }

    renderFacilityList();
    if (facilitySource) facilitySource.changed();
  };

  selectEl.addEventListener("change", () => applyOfficeFilter(selectEl.value));
  syncFacilityOfficeFilterVisibility();
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
      updateFacilityRepairCounts({ all: 0, repair: 0, noRepair: 0 });
      updateFacilityOfficeCounts({ all: 0, done: 0, notDone: 0 });
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
 * 지도 이동 애니메이션이 끝나면 callback 을 부른다(최대 약 1.5초 대기).
 * token 이 바뀌면(다른 시설물을 고르거나 팝업을 닫으면) 부르지 않는다.
 */
function whenFacilityViewSettled(map, token, callback) {
  const deadline = Date.now() + 1500;
  const run = () => {
    if (token !== facilityPopupRevealToken) return;
    if (map.getView().getAnimating() && Date.now() < deadline) {
      requestAnimationFrame(run);
      return;
    }
    callback();
  };
  requestAnimationFrame(run);
}

/**
 * 지도 이동이 끝난 뒤 팝업을 최종 위치에 맞춰 한 번에 보여준다.
 *
 * showFacilityDetail 은 팝업을 숨긴 상태(is-positioning, visibility: hidden)로 자리만 잡아 두고,
 * 여기서 ① 가운데 이동 애니메이션 종료 → ② 높이에 맞춘 세로 가운데 오프셋 → ③ 화면 밖이면 panIntoView
 * → ④ 그 보정 이동까지 끝난 뒤 숨김을 푼다. 이동 도중에 보이면 핀 아래에 나왔다가 자리를 옮겨 어지럽다.
 *
 * setPosition 재호출이 아니라 panIntoView 를 쓰는 이유: 같은 좌표로 setPosition 을 다시 호출하면
 * 값이 바뀌지 않아 보정이 실행되지 않는다. 이미 보이는 팝업에 다시 불러도(느린 응답 후 내용이 채워질 때)
 * 위치만 다시 맞춘다.
 */
function revealFacilityPopup(token) {
  const map = getMap();
  if (!map || !facilityOverlay) return;

  whenFacilityViewSettled(map, token, () => {
    if (!facilityOverlay || facilityOverlay.getPosition() === undefined) return;

    // 마지막 프레임을 반영해야 오버레이 픽셀 위치와 요소 크기를 정확히 잴 수 있다
    map.renderSync();

    // 핀 세로 가운데에 맞춘다 (visibility: hidden 이어도 레이아웃은 잡혀 높이를 잴 수 있음)
    const element = facilityOverlay.getElement();
    const height = element ? element.getBoundingClientRect().height : 0;
    if (height > 0) {
      facilityOverlay.setOffset([
        FACILITY_POPUP_OFFSET[0],
        FACILITY_POPUP_OFFSET[1] - Math.round(height / 2),
      ]);
    }

    facilityOverlay.panIntoView({ margin: 24, animation: { duration: 200 } });

    whenFacilityViewSettled(map, token, () => {
      if (element) element.classList.remove("is-positioning");
    });
  });
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

/**
 * 시설물이 "눈에 보이는 지도 영역"의 가운데에 오도록 하는 view center 를 계산한다.
 *
 * 지도 요소(#map)의 가운데와 사용자가 실제로 보는 지도의 가운데가 다르다.
 *  - 가로: #map 은 화면 전체 너비이고, 좌측 레이어 패널(.layer-panel)이 그 위에 겹쳐 떠 있다.
 *  - 세로: #map 은 화면 높이만큼인데 60px 헤더 아래에서 시작해, 아래쪽 일부가 화면 밖으로 넘친다.
 * 그래서 view center 를 시설물 좌표로 그대로 두면 왼쪽·아래로 치우쳐 보인다.
 * 화면 안에 보이는 부분과 패널이 가리는 폭을 매번 재서 반영하므로, 패널을 접었을 때나
 * 창 크기가 바뀌어도 맞는다.
 */
function getFacilityViewCenter(coordinate, resolution) {
  const map = getMap();
  const size = map && map.getSize();
  if (!size || !resolution) return coordinate;

  const mapRect = map.getTargetElement().getBoundingClientRect();

  // 화면(뷰포트) 안에 실제로 보이는 지도 영역
  let left = Math.max(mapRect.left, 0);
  const right = Math.min(mapRect.right, window.innerWidth);
  const top = Math.max(mapRect.top, 0);
  const bottom = Math.min(mapRect.bottom, window.innerHeight);

  // 좌측 패널이 겹쳐 가리는 부분은 제외 (접혀 있으면 오른쪽 끝이 거의 0 이라 자연히 빠짐)
  const panel = document.querySelector(".layer-panel");
  if (panel) {
    left = Math.max(left, Math.min(panel.getBoundingClientRect().right, right));
  }
  if (right <= left || bottom <= top) return coordinate;

  // 지도 요소 기준 픽셀에서 "보이는 가운데"가 "요소 가운데"보다 얼마나 떨어져 있는지
  const offsetX = (left + right) / 2 - mapRect.left - size[0] / 2;
  const offsetY = (top + bottom) / 2 - mapRect.top - size[1] / 2;

  // 시설물을 화면에서 (offsetX, offsetY) 만큼 옮겨 보이게 하려면 view center 를 반대로 둔다.
  // 화면 y 는 아래로 커지고 지도 y 는 위로 커지므로 y 는 부호가 반대다.
  return [
    coordinate[0] - offsetX * resolution,
    coordinate[1] + offsetY * resolution,
  ];
}

/**
 * 시설물 선택 (목록 또는 지도에서 호출)
 *
 * 어느 쪽에서 고르든 선택한 시설물을 지도 가운데로 옮긴다.
 * zoomIn 은 "멀리 있을 수 있는 목록에서 골랐을 때만" 확대까지 할지를 정한다
 * (지도에서 핀을 직접 클릭한 경우에는 이미 보고 있는 배율이므로 바꾸지 않는다).
 */
function selectFacility(totalId, zoomIn = true) {
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
    const view = map.getView();
    const targetZoom = zoomIn ? Math.max(view.getZoom(), 16) : view.getZoom();
    // 확대까지 하는 경우 이동 후의 해상도로 계산해야 보이는 영역 가운데에 정확히 맞는다
    const targetResolution = view.getResolutionForZoom(targetZoom);
    view.animate({
      center: getFacilityViewCenter(targetCoord, targetResolution),
      zoom: targetZoom,
      duration: 400,
    });
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
  const officeFooterEl = document.getElementById("facilityOfficeFooter");

  if (!popupEl || !facilityOverlay) return;

  // 이전 선택의 보정·표시 대기를 무효화
  const revealToken = ++facilityPopupRevealToken;

  // 오버레이 위치 지정 (이전에 드래그로 옮겨 둔 위치는 초기화)
  // 지도 이동과 상세 로딩이 끝날 때까지는 숨겨 두고 revealFacilityPopup 에서 보여준다
  if (coordinate) {
    popupEl.classList.add("is-positioning");
    facilityOverlay.setOffset(FACILITY_POPUP_OFFSET.slice());
    facilityOverlay.setPosition(coordinate);
  }

  // 응답이 늦으면 "불러오는 중" 상태로라도 먼저 보여준다 (내용이 채워지면 위치를 다시 맞춤)
  setTimeout(() => {
    if (revealToken === facilityPopupRevealToken && popupEl.classList.contains("is-positioning")) {
      revealFacilityPopup(revealToken);
    }
  }, FACILITY_POPUP_SLOW_REVEAL_MS);

  // 상세 응답을 기다리는 동안에도 목록에 이미 있는 값으로 헤더를 먼저 채움
  const loadedFeature = facilitySource ? facilitySource.getFeatureById(totalId) : null;
  const loadedName = loadedFeature ? loadedFeature.get("fclt_nm") : "";
  const loadedNeedsRepair =
    String(loadedFeature ? loadedFeature.get("repair_required_yn") : "").toUpperCase() === "Y";
  const loadedOfficeStatus = loadedFeature ? loadedFeature.get("office_work_status") : null;
  const loadedOfficeCompleteDate = loadedFeature ? loadedFeature.get("office_work_complete_date") : null;

  if (titleEl) titleEl.textContent = loadedName || "시설물 상세정보";
  renderFacilityPopupHeader(loadedName, loadedNeedsRepair, "", {
    status: loadedOfficeStatus,
    completeDate: loadedOfficeCompleteDate,
  });
  if (bodyEl) {
    bodyEl.innerHTML = '<div class="facility-detail-loading">상세정보를 불러오는 중...</div>';
    bodyEl.scrollTop = 0;
  }
  // 하단 고정 내업 영역은 상세 응답에서 보수 필요로 확인된 뒤에만 채운다 (이전 시설물 내용 제거)
  clearFacilityOfficeFooter(officeFooterEl);

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
    const featOfficeStatus = properties.office_work_status !== undefined ? properties.office_work_status : loadedOfficeStatus;
    const featOfficeCompleteDate = properties.office_work_complete_date !== undefined ? properties.office_work_complete_date : loadedOfficeCompleteDate;

    // 상태 값은 본문에 행으로 나오므로 헤더에는 종류, 보수 필요, 내업 완료 배지만 둔다
    renderFacilityPopupHeader(
      properties.fclt_nm,
      String(properties.repair_required_yn || "").toUpperCase() === "Y",
      "",
      {
        status: featOfficeStatus,
        completeDate: featOfficeCompleteDate,
      }
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
      const rawVal = cfg.isPhotoGallery
        ? ["photo_1", "photo_2", "photo_3", "photo_4", "photo_5"].find(
            (photoKey) =>
              properties[photoKey] &&
              String(properties[photoKey]).trim() &&
              String(properties[photoKey]).trim() !== "null"
          ) && "photos"
        : properties[cfg.key];
      // emptyValue 가 있는 항목은 값이 비어 있을 때 '-' 대신 그 값으로 해석한다
      const isRawEmpty =
        rawVal === null ||
        rawVal === undefined ||
        String(rawVal).trim() === "" ||
        String(rawVal).trim() === "null";
      const val = isRawEmpty && cfg.emptyValue !== undefined ? cfg.emptyValue : rawVal;
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
          .map((url) => buildFacilityMediaUrl(totalId, url));
        row.classList.add("facility-detail-row-block");
        value.appendChild(createFacilityPhotoGallery(photoUrls));
      } else if (cfg.isAudio) {
        const audio = document.createElement("audio");
        audio.className = "facility-media-audio";
        audio.controls = true;
        audio.preload = "none";
        audio.src = buildFacilityMediaUrl(totalId, strVal);
        row.classList.add("facility-detail-row-block");
        value.appendChild(audio);
      } else if (cfg.isVideo) {
        const video = document.createElement("video");
        video.className = "facility-media-video";
        video.controls = true;
        video.preload = "metadata";
        video.src = buildFacilityMediaUrl(totalId, strVal);
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

    // 내업 처리 섹션은 보수 필요 시설물에만 둔다 (백엔드도 보수 필요가 아닌 시설물의 작성은 400으로 거부)
    // 본문 스크롤과 상관없이 보이도록 본문이 아니라 팝업 하단 고정 영역에 넣는다
    if (String(properties.repair_required_yn || "").toUpperCase() === "Y" && officeFooterEl) {
      const officeSection = createOfficeWorkSection(totalId);
      officeFooterEl.appendChild(officeSection);
      officeFooterEl.classList.remove("hidden");

      // 내업 처리 이력 비동기 조회
      loadFacilityOfficeWorks(totalId);
    }

  } catch (error) {
    console.error("시설물 상세정보 로드 오류:", error);
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="facility-detail-error">상세정보를 불러오는 데 실패했습니다.</div>';
    }
  } finally {
    // 내용이 채워진 뒤(=높이 확정) 지도 이동까지 끝나면 최종 위치에서 보여줌 (오류 문구도 동일)
    revealFacilityPopup(revealToken);
  }
}

// ==========================================================================
// 내업 처리 CRUD 및 UI 모듈
// ==========================================================================

/**
 * 팝업 하단 고정 내업 영역을 비우고 숨긴다 (팝업을 열 때마다 호출)
 */
function clearFacilityOfficeFooter(footerEl) {
  if (!footerEl) return;
  footerEl.innerHTML = "";
  footerEl.scrollTop = 0;
  footerEl.classList.add("hidden");
}

/**
 * 내업 처리 섹션 생성
 */
function createOfficeWorkSection(totalId) {
  const section = document.createElement("div");
  section.className = "facility-office-section";
  section.id = "facilityOfficeSection";

  // 헤더 (제목 + 건수 배지 + 내업 작성 버튼)
  const header = document.createElement("div");
  header.className = "facility-office-section-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "facility-office-title-wrap";

  const title = document.createElement("h4");
  title.className = "facility-office-title";
  title.textContent = "내업 처리 내역";

  const countPill = document.createElement("span");
  countPill.className = "facility-office-count";
  countPill.id = "facilityOfficeCount";
  countPill.textContent = "0";

  titleWrap.appendChild(title);
  titleWrap.appendChild(countPill);

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "facility-office-btn-create";
  createBtn.id = "facilityOfficeCreateBtn";
  createBtn.textContent = "+ 내업 작성";

  header.appendChild(titleWrap);
  header.appendChild(createBtn);
  section.appendChild(header);

  // 폼 컨테이너 (작성 / 수정 시 노출)
  const formContainer = document.createElement("div");
  formContainer.className = "facility-office-form-container hidden";
  formContainer.id = "facilityOfficeFormContainer";
  section.appendChild(formContainer);

  // 이력 및 요약 내용 컨테이너
  const content = document.createElement("div");
  content.className = "facility-office-content";
  content.id = "facilityOfficeContent";
  content.innerHTML = '<div class="facility-office-loading">내업 처리 이력을 불러오는 중...</div>';
  section.appendChild(content);

  createBtn.addEventListener("click", () => {
    openOfficeWorkForm(totalId, null);
  });

  return section;
}

/**
 * 내업 작성/수정 폼 열기
 */
function openOfficeWorkForm(totalId, editItem = null) {
  const formContainer = document.getElementById("facilityOfficeFormContainer");
  if (!formContainer) return;

  const isEdit = Boolean(editItem && editItem.work_id);
  formContainer.classList.remove("hidden");
  formContainer.innerHTML = `
    <div class="facility-office-form-header">
      <span class="facility-office-form-title">${isEdit ? "내업 처리 수정" : "내업 처리 작성"}</span>
      <button type="button" class="facility-office-form-close" id="facilityOfficeFormCloseBtn">×</button>
    </div>
    <form class="facility-office-form" id="facilityOfficeForm">
      <div class="facility-office-form-error hidden" id="facilityOfficeFormError"></div>
      <div class="facility-office-form-grid">
        <div class="facility-office-form-group col-span-2">
          <label for="officeWorkStatus">처리 상태 <span class="required">*</span></label>
          <select id="officeWorkStatus" name="work_status">
            <option value="">-- 상태 선택 --</option>
            <option value="RECEIVED">접수</option>
            <option value="IN_PROGRESS">처리중</option>
            <option value="DONE">완료</option>
            <option value="HOLD">보류</option>
          </select>
        </div>
        <div class="facility-office-form-group col-span-2">
          <label for="officeWorkContent">처리 내용</label>
          <textarea id="officeWorkContent" name="work_content" placeholder="처리할 내업 내용을 입력하세요"></textarea>
        </div>
        <div class="facility-office-form-group">
          <label for="officeDeptNm">담당 부서</label>
          <input type="text" id="officeDeptNm" name="dept_nm" placeholder="담당 부서명" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeManagerNm">담당자</label>
          <input type="text" id="officeManagerNm" name="manager_nm" placeholder="담당자 이름" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeManagerTel">연락처</label>
          <input type="text" id="officeManagerTel" name="manager_tel" placeholder="연락처" />
        </div>
        <div class="facility-office-form-group">
          <label for="officePlanDate">처리 예정일</label>
          <input type="date" id="officePlanDate" name="plan_date" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeCompleteDate">완료일 <span class="required" id="completeDateReqMark" style="display:none;">*</span></label>
          <input type="date" id="officeCompleteDate" name="complete_date" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeCost">비용 (원)</label>
          <input type="number" id="officeCost" name="cost" min="0" step="1" placeholder="숫자만 입력" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeVendorNm">시공 업체</label>
          <input type="text" id="officeVendorNm" name="vendor_nm" placeholder="시공 업체명" />
        </div>
        <div class="facility-office-form-group">
          <label for="officeContractNo">계약번호</label>
          <input type="text" id="officeContractNo" name="contract_no" placeholder="계약번호" />
        </div>
        <div class="facility-office-form-group col-span-2">
          <label for="officeBeforePhoto">처리 전 사진 경로</label>
          <input type="text" id="officeBeforePhoto" name="before_photo" placeholder="사진 경로 또는 URL" />
        </div>
        <div class="facility-office-form-group col-span-2">
          <label for="officeAfterPhoto">처리 후 사진 경로</label>
          <input type="text" id="officeAfterPhoto" name="after_photo" placeholder="사진 경로 또는 URL" />
        </div>
        <div class="facility-office-form-group col-span-2">
          <label for="officeRemark">비고</label>
          <textarea id="officeRemark" name="remark" placeholder="기타 비고사항"></textarea>
        </div>
      </div>
      <div class="facility-office-form-actions">
        <button type="button" class="facility-office-btn-cancel" id="facilityOfficeFormCancelBtn">취소</button>
        <button type="submit" class="facility-office-btn-submit" id="facilityOfficeFormSubmitBtn">저장</button>
      </div>
    </form>
  `;

  const statusSelect = formContainer.querySelector("#officeWorkStatus");
  const contentInput = formContainer.querySelector("#officeWorkContent");
  const deptInput = formContainer.querySelector("#officeDeptNm");
  const managerInput = formContainer.querySelector("#officeManagerNm");
  const telInput = formContainer.querySelector("#officeManagerTel");
  const planDateInput = formContainer.querySelector("#officePlanDate");
  const completeDateInput = formContainer.querySelector("#officeCompleteDate");
  const costInput = formContainer.querySelector("#officeCost");
  const vendorInput = formContainer.querySelector("#officeVendorNm");
  const contractInput = formContainer.querySelector("#officeContractNo");
  const beforePhotoInput = formContainer.querySelector("#officeBeforePhoto");
  const afterPhotoInput = formContainer.querySelector("#officeAfterPhoto");
  const remarkInput = formContainer.querySelector("#officeRemark");
  const errorEl = formContainer.querySelector("#facilityOfficeFormError");
  const reqMark = formContainer.querySelector("#completeDateReqMark");

  const updateReqMark = () => {
    if (reqMark) reqMark.style.display = statusSelect.value === "DONE" ? "inline" : "none";
  };
  statusSelect.addEventListener("change", updateReqMark);

  if (editItem) {
    statusSelect.value = editItem.work_status || "";
    contentInput.value = editItem.work_content || "";
    deptInput.value = editItem.dept_nm || "";
    managerInput.value = editItem.manager_nm || "";
    telInput.value = editItem.manager_tel || "";
    planDateInput.value = editItem.plan_date || "";
    completeDateInput.value = editItem.complete_date || "";
    costInput.value = editItem.cost !== null && editItem.cost !== undefined ? editItem.cost : "";
    vendorInput.value = editItem.vendor_nm || "";
    contractInput.value = editItem.contract_no || "";
    beforePhotoInput.value = editItem.before_photo || "";
    afterPhotoInput.value = editItem.after_photo || "";
    remarkInput.value = editItem.remark || "";
    updateReqMark();
  }

  const closeForm = () => {
    formContainer.classList.add("hidden");
    formContainer.innerHTML = "";
  };

  const closeBtn = formContainer.querySelector("#facilityOfficeFormCloseBtn");
  const cancelBtn = formContainer.querySelector("#facilityOfficeFormCancelBtn");
  closeBtn.addEventListener("click", closeForm);
  cancelBtn.addEventListener("click", closeForm);

  const form = formContainer.querySelector("#facilityOfficeForm");
  const submitBtn = formContainer.querySelector("#facilityOfficeFormSubmitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    errorEl.textContent = "";

    const statusVal = statusSelect.value.trim();
    const contentVal = contentInput.value.trim();
    const deptVal = deptInput.value.trim();
    const managerVal = managerInput.value.trim();
    const telVal = telInput.value.trim();
    const planDateVal = planDateInput.value.trim();
    const completeDateVal = completeDateInput.value.trim();
    const costRaw = costInput.value.trim();
    const vendorVal = vendorInput.value.trim();
    const contractVal = contractInput.value.trim();
    const beforePhotoVal = beforePhotoInput.value.trim();
    const afterPhotoVal = afterPhotoInput.value.trim();
    const remarkVal = remarkInput.value.trim();

    // 폼 검증
    if (!statusVal) {
      errorEl.textContent = "처리 상태를 선택해 주세요.";
      errorEl.classList.remove("hidden");
      statusSelect.focus();
      return;
    }

    if (statusVal === "DONE" && !completeDateVal) {
      errorEl.textContent = "완료 상태인 경우 완료일을 입력해 주세요.";
      errorEl.classList.remove("hidden");
      completeDateInput.focus();
      return;
    }

    let costNum = null;
    if (costRaw !== "") {
      const parsed = Number(costRaw);
      if (isNaN(parsed) || parsed < 0) {
        errorEl.textContent = "비용은 0 이상의 숫자만 입력해 주세요.";
        errorEl.classList.remove("hidden");
        costInput.focus();
        return;
      }
      costNum = parsed;
    }

    const payload = {
      work_status: statusVal,
      work_content: contentVal || null,
      dept_nm: deptVal || null,
      manager_nm: managerVal || null,
      manager_tel: telVal || null,
      plan_date: planDateVal || null,
      complete_date: completeDateVal || null,
      cost: costNum,
      vendor_nm: vendorVal || null,
      contract_no: contractVal || null,
      before_photo: beforePhotoVal || null,
      after_photo: afterPhotoVal || null,
      remark: remarkVal || null,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "저장 중...";

    try {
      if (isEdit) {
        await updateFacilityOfficeWork(editItem.work_id, payload);
      } else {
        await createFacilityOfficeWork(totalId, payload);
      }
      closeForm();
      await loadFacilityOfficeWorks(totalId);
    } catch (err) {
      console.error("내업 처리 저장 실패:", err);
      errorEl.textContent = err.message || "저장 중 오류가 발생했습니다. 다시 시도해 주세요.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "저장";
    }
  });

  // 폼은 하단 고정 영역의 섹션 헤더 바로 아래에 있으므로 그 영역만 맨 위로 올린다.
  // scrollIntoView 는 지도 컨테이너·문서까지 함께 스크롤할 수 있어 쓰지 않는다.
  const officeFooterEl = document.getElementById("facilityOfficeFooter");
  if (officeFooterEl) officeFooterEl.scrollTop = 0;
}

/**
 * 내업 개별 카드 DOM 생성 (XSS 방지 textContent 사용)
 */
function createOfficeWorkCard(totalId, item, isLatest) {
  const card = document.createElement("div");
  card.className = `facility-office-card ${isLatest ? "facility-office-latest" : "facility-office-past-item"}`;

  // 헤더: 상태 배지 + 일자 + 액션(수정/삭제)
  const header = document.createElement("div");
  header.className = "facility-office-card-header";

  const left = document.createElement("div");
  left.className = "facility-office-card-left";

  const statusBadge = document.createElement("span");
  const statusKey = String(item.work_status || "").toUpperCase();
  const statusName = OFFICE_WORK_STATUS_MAP[statusKey] || item.work_status || "미지정";
  const badgeClass = OFFICE_WORK_STATUS_BADGE_CLASS[statusKey] || "status-badge-hold";
  statusBadge.className = `facility-office-status-badge ${badgeClass}`;
  statusBadge.textContent = statusName;
  left.appendChild(statusBadge);

  const dateSpan = document.createElement("span");
  dateSpan.className = "facility-office-card-date";
  const dateVal = item.complete_date || item.plan_date || (item.reg_date ? formatFacilityDateTime(item.reg_date) : "");
  dateSpan.textContent = dateVal ? `· ${dateVal}` : "";
  left.appendChild(dateSpan);

  header.appendChild(left);

  const actions = document.createElement("div");
  actions.className = "facility-office-card-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "facility-office-card-btn";
  editBtn.textContent = "수정";
  editBtn.addEventListener("click", () => {
    openOfficeWorkForm(totalId, item);
  });
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "facility-office-card-btn btn-delete";
  deleteBtn.textContent = "삭제";
  deleteBtn.addEventListener("click", async () => {
    if (window.confirm("내업 처리 기록을 삭제하시겠습니까?\n삭제된 기록은 복구할 수 없습니다.")) {
      try {
        await deleteFacilityOfficeWork(item.work_id);
        await loadFacilityOfficeWorks(totalId);
      } catch (err) {
        console.error("삭제 실패:", err);
        alert(err.message || "삭제 중 오류가 발생했습니다.");
      }
    }
  });
  actions.appendChild(deleteBtn);

  header.appendChild(actions);
  card.appendChild(header);

  // 본문: 처리 내용
  if (item.work_content) {
    const content = document.createElement("div");
    content.className = "facility-office-card-content";
    content.textContent = item.work_content;
    card.appendChild(content);
  }

  // 상세 그리드: 담당부서, 담당자, 연락처, 비용, 업체, 계약번호, 비고
  const grid = document.createElement("div");
  grid.className = "facility-office-card-grid";

  const addGridItem = (label, val) => {
    if (!val && val !== 0) return;
    const gItem = document.createElement("div");
    gItem.className = "facility-office-grid-item";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label + ":";
    const valSpan = document.createElement("span");
    valSpan.textContent = String(val);

    gItem.appendChild(labelSpan);
    gItem.appendChild(valSpan);
    grid.appendChild(gItem);
  };

  const deptParts = [item.dept_nm, item.manager_nm].filter(Boolean);
  if (deptParts.length > 0) {
    addGridItem("담당", deptParts.join(" · "));
  }
  if (item.manager_tel) {
    addGridItem("연락처", item.manager_tel);
  }
  if (item.cost !== null && item.cost !== undefined && item.cost !== "") {
    addGridItem("비용", Number(item.cost).toLocaleString() + "원");
  }
  if (item.vendor_nm) {
    addGridItem("시공업체", item.vendor_nm);
  }
  if (item.contract_no) {
    addGridItem("계약번호", item.contract_no);
  }
  if (item.plan_date && !item.complete_date) {
    addGridItem("예정일", item.plan_date);
  }
  if (item.complete_date) {
    addGridItem("완료일", item.complete_date);
  }
  if (item.remark) {
    addGridItem("비고", item.remark);
  }

  if (grid.children.length > 0) {
    card.appendChild(grid);
  }

  // 사진 경로 표시
  const photos = [
    { label: "처리 전 사진", path: item.before_photo },
    { label: "처리 후 사진", path: item.after_photo },
  ].filter((p) => p.path && String(p.path).trim());

  if (photos.length > 0) {
    const photoRow = document.createElement("div");
    photoRow.style.display = "flex";
    photoRow.style.gap = "8px";
    photoRow.style.marginTop = "4px";
    photoRow.style.fontSize = "0.72rem";

    photos.forEach((p) => {
      const a = document.createElement("a");
      a.className = "facility-media-link";
      a.href = buildFacilityMediaUrl(totalId, p.path);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = p.label;
      photoRow.appendChild(a);
    });
    card.appendChild(photoRow);
  }

  return card;
}

/**
 * 내업 목록 UI 렌더링 (최신 1건 요약 + 이전 이력 아코디언)
 */
function renderFacilityOfficeWorks(totalId, items) {
  const container = document.getElementById("facilityOfficeContent");
  if (!container) return;

  container.innerHTML = "";

  if (!items || items.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "facility-office-empty";
    emptyEl.textContent = "등록된 내업 처리 내역이 없습니다.";
    container.appendChild(emptyEl);
    return;
  }

  // 1. 최신 1건 요약 카드
  const latestItem = items[0];
  const latestCard = createOfficeWorkCard(totalId, latestItem, true);
  container.appendChild(latestCard);

  // 2. 이력이 여러 건이면 접었다 펼 수 있는 이전 이력 목록
  if (items.length > 1) {
    const historyToggle = document.createElement("div");
    historyToggle.className = "facility-office-history-toggle";
    historyToggle.id = "facilityOfficeHistoryToggle";

    const toggleText = document.createElement("span");
    toggleText.textContent = `이전 내업 이력 (${items.length - 1}건)`;

    const toggleArrow = document.createElement("span");
    toggleArrow.className = "facility-office-history-arrow";
    toggleArrow.textContent = "▼";

    historyToggle.appendChild(toggleText);
    historyToggle.appendChild(toggleArrow);
    container.appendChild(historyToggle);

    const historyList = document.createElement("div");
    historyList.className = "facility-office-history-list hidden";
    historyList.id = "facilityOfficeHistoryList";

    for (let i = 1; i < items.length; i++) {
      const pastCard = createOfficeWorkCard(totalId, items[i], false);
      historyList.appendChild(pastCard);
    }
    container.appendChild(historyList);

    historyToggle.addEventListener("click", () => {
      const isHidden = historyList.classList.toggle("hidden");
      toggleArrow.textContent = isHidden ? "▼" : "▲";
    });
  }
}

/**
 * 시설물 내업 상태 갱신 (목록 데이터, 벡터 피처, 팝업 헤더, 지도 핀 동기화)
 */
function updateFacilityOfficeState(totalId, status, completeDate, managerNm) {
  // 1. facilityListItems 데이터 갱신
  const item = facilityListItems.find((it) => it.totalId === String(totalId));
  if (item) {
    item.officeWorkStatus = status;
    item.officeWorkCompleteDate = completeDate;
  }

  // 2. OpenLayers feature properties 갱신
  if (facilitySource) {
    const feature = facilitySource.getFeatureById(String(totalId));
    if (feature) {
      feature.set("office_work_status", status);
      feature.set("office_work_complete_date", completeDate);
    }
  }

  // 3. 팝업 헤더 갱신
  const loadedFeature = facilitySource ? facilitySource.getFeatureById(String(totalId)) : null;
  const name = (item && item.name) || (loadedFeature && loadedFeature.get("fclt_nm")) || "";
  const needsRepair = item
    ? item.needsRepair
    : String(loadedFeature ? loadedFeature.get("repair_required_yn") : "").toUpperCase() === "Y";

  renderFacilityPopupHeader(name, needsRepair, "", {
    status: status,
    completeDate: completeDate,
    managerNm: managerNm,
  });

  // 4. 목록 배지 및 지도 핀 갱신
  renderFacilityList();
  if (facilitySource) {
    facilitySource.changed();
  }
}

/**
 * 특정 시설물의 내업 목록 로드
 */
async function loadFacilityOfficeWorks(totalId) {
  const container = document.getElementById("facilityOfficeContent");
  const countEl = document.getElementById("facilityOfficeCount");
  if (!container) return;

  try {
    const url = getApiUrl(`/map/qfield/facilities/${encodeURIComponent(totalId)}/office-works`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`내업 목록 조회 실패: ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (countEl) countEl.textContent = items.length.toString();

    // UI 렌더링
    renderFacilityOfficeWorks(totalId, items);

    // 최신 상태로 시설물 데이터 및 지도 핀 갱신 (기록이 없으면 미완료 — 삭제로 0건이 된 경우 포함)
    const latest = items.length > 0 ? items[0] : null;
    const latestStatus = latest ? latest.work_status : "PENDING";
    const latestCompleteDate = latest ? latest.complete_date : null;
    const latestManager = latest ? latest.manager_nm : null;

    updateFacilityOfficeState(totalId, latestStatus, latestCompleteDate, latestManager);
  } catch (error) {
    console.warn("내업 정보 조회 실패:", error.message);
    if (countEl) countEl.textContent = "0";
    if (container) {
      container.innerHTML = '<div class="facility-office-empty">등록된 내업 처리 내역이 없습니다.</div>';
    }
  } finally {
    // 팝업 내용 갱신 후 오버레이 크기 변경에 따른 위치 보정
    if (facilityOverlay && facilityOverlay.getPosition() !== undefined) {
      const el = facilityOverlay.getElement();
      const h = el ? el.getBoundingClientRect().height : 0;
      if (h > 0) {
        facilityOverlay.setOffset([
          FACILITY_POPUP_OFFSET[0],
          FACILITY_POPUP_OFFSET[1] - Math.round(h / 2),
        ]);
        facilityOverlay.panIntoView({ margin: 24, animation: { duration: 150 } });
      }
    }
  }
}

// 오류 응답 본문의 {"message": "..."} 를 사용자에게 보여줄 문구로 꺼낸다 (JSON 이 아니면 본문 그대로)
async function readApiErrorMessage(response) {
  const errorText = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(errorText);
    if (parsed && parsed.message) return parsed.message;
  } catch (e) {
    // JSON 이 아니면 아래에서 원문 사용
  }
  return errorText || response.statusText;
}

/**
 * 내업 생성 API 호출 (POST /map/qfield/facilities/{totalId}/office-works)
 */
async function createFacilityOfficeWork(totalId, workData) {
  const url = getApiUrl(`/map/qfield/facilities/${encodeURIComponent(totalId)}/office-works`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workData),
  });
  if (!response.ok) {
    throw new Error(`저장 실패 (${response.status}): ${await readApiErrorMessage(response)}`);
  }
  return await response.json();
}

/**
 * 내업 수정 API 호출 (PUT /map/qfield/office-works/{workId})
 */
async function updateFacilityOfficeWork(workId, workData) {
  const url = getApiUrl(`/map/qfield/office-works/${encodeURIComponent(workId)}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workData),
  });
  if (!response.ok) {
    throw new Error(`수정 실패 (${response.status}): ${await readApiErrorMessage(response)}`);
  }
  return await response.json();
}

/**
 * 내업 삭제 API 호출 (DELETE /map/qfield/office-works/{workId})
 */
async function deleteFacilityOfficeWork(workId) {
  const url = getApiUrl(`/map/qfield/office-works/${encodeURIComponent(workId)}`);
  const response = await fetch(url, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`삭제 실패 (${response.status}): ${await readApiErrorMessage(response)}`);
  }
  return true;
}

// 팝업 닫기
function closeFacilityPopup() {
  facilityPopupRevealToken++; // 대기 중인 표시 보정 취소
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
  loadFacilityOfficeWorks,
  matchesFacilityOfficeFilter,
};

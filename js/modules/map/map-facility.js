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

// 내업 상태 필터에만 쓰는 묶음 값 — 실제 상태 코드가 아니라 "완료를 뺀 나머지 전부"(아직 손이 남은 건)를 뜻한다.
// 내업을 완료해도 보수 필요 여부(외업 값)는 그대로라 보수 필요 탭에 남는데, 그중 처리할 것만 보려는 용도.
const OFFICE_WORK_OPEN_FILTER = "OPEN";

// 시설물의 내업 상태 코드 — 보수 필요가 아니면 ""(내업 대상 아님), 보수 필요인데 값이 없거나 모르는 값이면 PENDING
function resolveOfficeWorkStatus(needsRepair, status) {
  if (!needsRepair) return "";
  const code = String(status || "").toUpperCase();
  return OFFICE_WORK_STATUS_MAP[code] ? code : "PENDING";
}

// 내업이 완료된(=더 처리할 게 없는) 시설물인지
function isOfficeWorkDone(needsRepair, status) {
  return resolveOfficeWorkStatus(needsRepair, status) === "DONE";
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
      declutterMode: FACILITY_DECLUTTER_MODE,
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
            declutterMode: FACILITY_DECLUTTER_MODE,
          }),
        }),
        iconStyle,
      ]
    : iconStyle;

  facilityStyleCache.set(cacheKey, style);
  return style;
}

// 시설물 핀 스타일 — 필터만 보고 만든다(펼침 여부는 보지 않음).
// 펼친 핀은 원래 자리 대신 펼쳐진 자리에 그려야 하므로 펼침 레이어가 이 함수를 직접 쓴다.
function buildFacilityPinStyle(feature) {
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

// 시설물 레이어 스타일 함수 — 펼쳐 놓은 시설물은 펼침 레이어가 대신 그리므로 여기서는 숨긴다
function facilityStyleFunction(feature) {
  if (isFacilitySpiderExpanded(feature)) return null;
  return buildFacilityPinStyle(feature);
}

/* ============================================================================
   레이어 순서
   시설물(핀·묶음)은 이 서비스의 주 기능이라 **항상 다른 레이어 위에** 그린다.
   다른 레이어의 현재 값: WFS·WMS 1000, 영역 선택 999~1000, 측정·기본 지도는 미지정(0).
   ============================================================================ */

// 다른 레이어와 충분히 벌려 둔 기본값. 새 레이어가 이 값에 가까워지면 아래 보정이 다시 올린다.
const FACILITY_LAYER_Z_INDEX = 1500;
// 시설물 심볼의 declutter 모드.
// "obstacle" = 항상 그리되(하나도 숨지 않음) 다른 declutter 심볼이 이 자리를 피해 가게 한다.
// zIndex 만으로는 부족하다 — OpenLayers 가 declutter 심볼을 프레임 마지막에 따로 그려서
// declutter 를 쓰는 WFS 레이어 아이콘이 시설물 위에 올라오기 때문(2026-09-23 실제 발생).
const FACILITY_DECLUTTER_MODE = "obstacle";
// 새 레이어가 시설물보다 높거나 같게 들어왔을 때 올려 줄 여유
const FACILITY_LAYER_Z_MARGIN = 10;

/**
 * 시설물 레이어를 항상 맨 위로 유지한다.
 * 지금은 시설물(1500)이 가장 높지만, 다른 모듈이 나중에 더 높은 zIndex 로 레이어를 추가하면
 * 핀이 가려지므로 레이어가 추가·제거될 때마다 다시 계산한다.
 */
function keepFacilityLayerOnTop(map) {
  const raiseFacilityLayer = () => {
    if (!facilityLayer) return;
    let highestOther = Number.NEGATIVE_INFINITY;
    map.getLayers().forEach((layer) => {
      // 시설물 자신과 그 위에 붙는 펼침 레이어는 기준에서 뺀다(서로를 밀어 올리며 값이 무한히 커지는 것 방지)
      if (layer === facilityLayer || layer === facilitySpiderLayer) return;
      const zIndex = layer.getZIndex();
      if (typeof zIndex === "number" && zIndex > highestOther) {
        highestOther = zIndex;
      }
    });

    const desired =
      highestOther === Number.NEGATIVE_INFINITY
        ? FACILITY_LAYER_Z_INDEX
        : Math.max(FACILITY_LAYER_Z_INDEX, highestOther + FACILITY_LAYER_Z_MARGIN);
    if (facilityLayer.getZIndex() !== desired) {
      facilityLayer.setZIndex(desired);
    }
    // 펼친 핀은 묶음 배지 위에 있어야 한다
    if (facilitySpiderLayer && facilitySpiderLayer.getZIndex() !== desired + 1) {
      facilitySpiderLayer.setZIndex(desired + 1);
    }
  };

  raiseFacilityLayer();
  // setZIndex 는 add/remove 이벤트를 일으키지 않으므로 순환 호출 걱정은 없다
  map.getLayers().on("add", raiseFacilityLayer);
  map.getLayers().on("remove", raiseFacilityLayer);
}

/* ============================================================================
   핀 묶음(클러스터링)
   전국 조회 시 2,400여 개의 핀이 겹쳐 개수를 가늠할 수 없으므로, 가까운 핀을 하나로 묶어
   개수를 보여주고 누르면 그 범위로 확대한다. 묶음은 표시 방식일 뿐이라 원본 소스
   (facilitySource)는 그대로 두고 ol.source.Cluster 를 씌운다 — getFeatureById·목록 연동 등
   기존 코드는 원본 소스를 계속 쓴다.
   ============================================================================ */

// 묶는 거리(px)와 묶음끼리의 최소 간격(px)
const FACILITY_CLUSTER_DISTANCE = 44;
const FACILITY_CLUSTER_MIN_DISTANCE = 20;
const FACILITY_CLUSTER_STORAGE_KEY = "sjLabFacilityCluster";

let facilityClusterSource = null;
let facilityClusteringEnabled = true;
const facilityClusterStyleCache = new Map();

// 필터를 통과한 피처만 묶음에 넣는다. null 을 돌려주면 그 피처는 묶음에서 빠지므로
// 화면의 개수 배지가 필터 결과와 항상 일치한다(스타일에서 거르는 것만으로는 개수가 어긋남).
function facilityClusterGeometry(feature) {
  const needsRepair = String(feature.get("repair_required_yn") || "").toUpperCase() === "Y";
  const officeWorkStatus = feature.get("office_work_status") || "";
  if (!matchesFacilityRepairFilter(needsRepair)) return null;
  if (!matchesFacilityOfficeFilter(needsRepair, officeWorkStatus)) return null;

  const geometry = feature.getGeometry();
  if (!geometry) return null;
  return geometry.getType() === "Point"
    ? geometry
    : new ol.geom.Point(ol.extent.getCenter(geometry.getExtent()));
}

// 묶음 색: 아직 처리할 보수 건이 있으면 경고색, 전부 내업 완료면 완료색, 그 외에는 기본색
function resolveFacilityClusterTone(members) {
  let hasRepair = false;
  let hasOpenRepair = false;
  members.forEach((member) => {
    if (String(member.get("repair_required_yn") || "").toUpperCase() !== "Y") return;
    hasRepair = true;
    if (String(member.get("office_work_status") || "").toUpperCase() !== "DONE") {
      hasOpenRepair = true;
    }
  });
  if (hasOpenRepair) return "warn";
  if (hasRepair) return "done";
  return "base";
}

/**
 * 묶음 배지를 SVG 한 장으로 만든다(원 + 개수 숫자, 선택 시 강조 링까지).
 * 숫자를 `ol.style.Text` 로 얹지 않는 이유: 레이어가 declutter 라 텍스트는 declutter 대상이 되어
 * 같은 자리의 원(obstacle)과 충돌해 사라진다(2026-09-23 실제 발생). 이미지 하나로 그리면 항상 보인다.
 */
function buildFacilityClusterIconUrl(size, color, radius, isSelected) {
  const ring = isSelected ? radius + 7 : radius;
  const half = Math.ceil(ring + 3);
  const box = half * 2;
  const fontSize = radius >= 20 ? 13 : 12;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + box + '" height="' + box + '" viewBox="0 0 ' + box + " " + box + '">' +
    (isSelected
      ? '<circle cx="' + half + '" cy="' + half + '" r="' + (radius + 7) +
        '" fill="rgba(59, 130, 246, 0.30)" stroke="#2563eb" stroke-width="3"/>'
      : "") +
    '<circle cx="' + half + '" cy="' + half + '" r="' + radius + '" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>' +
    '<text x="' + half + '" y="' + half + '" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="\'Noto Sans KR\', sans-serif" font-size="' + fontSize + '" font-weight="600" fill="#ffffff">' +
    size +
    "</text></svg>";

  return { url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), box };
}

function getFacilityClusterStyle(size, tone, isSelected) {
  const cacheKey = `${size}|${tone}|${isSelected ? "sel" : "def"}`;
  if (facilityClusterStyleCache.has(cacheKey)) {
    return facilityClusterStyleCache.get(cacheKey);
  }

  const color =
    tone === "warn" ? FACILITY_WARN_COLOR : tone === "done" ? FACILITY_OFFICE_DONE_COLOR : FACILITY_ICON_COLOR;
  // 개수가 많을수록 조금씩 커지되 한없이 커지지 않도록 로그로 제한한다
  const radius = Math.round(Math.min(26, 14 + Math.log10(Math.max(size, 1)) * 8));
  const icon = buildFacilityClusterIconUrl(size, color, radius, isSelected);

  const style = new ol.style.Style({
    image: new ol.style.Icon({
      src: icon.url,
      anchor: [0.5, 0.5],
      size: [icon.box, icon.box],
      imgSize: [icon.box, icon.box],
      declutterMode: FACILITY_DECLUTTER_MODE,
    }),
  });

  facilityClusterStyleCache.set(cacheKey, style);
  return style;
}

// 묶음 레이어 스타일 — 1건이면 기존 시설물 핀 그대로, 2건 이상이면 개수 배지.
// 이미 펼쳐 놓은 묶음은 배지를 그리지 않는다(펼친 핀만 보이게).
function facilityClusterStyleFunction(clusterFeature) {
  const members = clusterFeature.get("features") || [];
  if (members.length === 0) return null;
  if (isFacilitySpiderExpandedGroup(members)) return null;
  if (members.length === 1) return facilityStyleFunction(members[0]);

  const isSelected =
    Boolean(selectedTotalId) &&
    members.some((member) => String(member.get("total_id") || member.getId()) === String(selectedTotalId));

  return getFacilityClusterStyle(members.length, resolveFacilityClusterTone(members), isSelected);
}

// 묶음 안의 원본 피처들 (묶지 않은 상태면 그 피처 자신)
function getClusterMembers(feature) {
  const members = feature.get("features");
  return Array.isArray(members) ? members : [feature];
}

/* ----------------------------------------------------------------------------
   묶음 펼치기(spiderfy)
   같은 건물에 여러 시설물이 있으면 좌표가 사실상 같아 **끝까지 확대해도 묶음이 풀리지 않는다**.
   그 경우 핀을 중심에서 부채꼴로 펼쳐(연결선 포함) 하나씩 고를 수 있게 한다.
   ---------------------------------------------------------------------------- */

const FACILITY_SPIDER_MIN_RADIUS = 42; // 펼칠 때 중심에서 핀까지의 최소 거리(px)
const FACILITY_SPIDER_STEP = 5; // 개수가 많을수록 반지름을 늘리는 정도(px)
// 이 배율 이상으로 충분히 확대하면 같은 자리 시설물이 저절로 펼쳐진다(클릭할 필요 없음).
// 건물 하나가 화면을 채울 정도로 들어갔을 때 나오도록 잡았다(최대 배율 19).
const FACILITY_SPIDER_MIN_ZOOM = 18;

let facilitySpiderSource = null;
let facilitySpiderLayer = null;
let facilitySpiderKey = null; // 지금 펼쳐 둔 구성이 무엇인지 — 같으면 다시 그리지 않는다
// 지금 펼쳐 놓은 시설물 id. 원래 자리의 핀과 묶음 배지를 숨기는 데 쓴다.
const facilitySpiderExpandedIds = new Set();

function isFacilitySpiderExpanded(feature) {
  if (facilitySpiderExpandedIds.size === 0) return false;
  return facilitySpiderExpandedIds.has(String(feature.get("total_id") || feature.getId()));
}

// 묶음 구성원이 전부 펼쳐진 상태인지 (그 묶음의 개수 배지를 숨길지 판단)
function isFacilitySpiderExpandedGroup(members) {
  if (facilitySpiderExpandedIds.size === 0 || members.length === 0) return false;
  return members.every((member) => isFacilitySpiderExpanded(member));
}

// 펼친 핀 스타일 — 원본 피처 기준으로 기존 핀 규칙을 그대로 쓴다(펼침 여부는 보지 않는 builder 사용)
function facilitySpiderStyleFunction(feature) {
  const source = feature.get("__facilityFeature");
  return source ? buildFacilityPinStyle(source) : null;
}

function initFacilitySpiderLayer(map) {
  if (facilitySpiderLayer) return;
  facilitySpiderSource = new ol.source.Vector();
  facilitySpiderLayer = new ol.layer.Vector({
    source: facilitySpiderSource,
    style: facilitySpiderStyleFunction,
    updateWhileAnimating: false,
    updateWhileInteracting: false,
    // 시설물 레이어와 같은 이유로 obstacle declutter (docs/map-architecture.md 참고)
    declutter: true,
    zIndex: FACILITY_LAYER_Z_INDEX + 1,
  });
  map.addLayer(facilitySpiderLayer);

  // 확대·이동이 끝날 때마다 펼침 상태를 다시 계산한다(클릭이 아니라 배율로 결정)
  map.on("moveend", syncFacilitySpiders);
}

function clearFacilitySpider() {
  facilitySpiderKey = null;
  facilitySpiderExpandedIds.clear();
  if (facilitySpiderSource) facilitySpiderSource.clear();
}

/**
 * 지금 화면에서 펼쳐야 할 묶음들을 모은다.
 * - 묶어 보기 켬: 화면 안에 **아직 묶여 있는 것 전부**. 이 배율까지 들어왔는데도 묶여 있다는 것은
 *   구성원이 서로 묶음 거리(FACILITY_CLUSTER_DISTANCE) 안에 붙어 있다는 뜻이라, 더 확대해도
 *   풀리지 않거나 풀려도 겹쳐 보인다. "좌표가 완전히 같을 때만" 펼치면 몇 미터씩 떨어진 묶음이
 *   끝까지 안 풀리는 문제가 생긴다(2026-09-23 실제 발생).
 * - 묶어 보기 끔: 좌표가 같아 서로 완전히 겹치는 핀들(필터 통과분만)
 */
function collectFacilitySpiderGroups() {
  const map = getMap();
  if (!map) return [];

  const view = map.getView();
  const zoom = view.getZoom();
  if (typeof zoom !== "number" || zoom < FACILITY_SPIDER_MIN_ZOOM) return [];

  const size = map.getSize();
  if (!size) return [];
  const extent = view.calculateExtent(size);
  const groups = [];

  if (facilityClusteringEnabled && facilityClusterSource) {
    facilityClusterSource.forEachFeatureInExtent(extent, (clusterFeature) => {
      const members = clusterFeature.get("features") || [];
      if (members.length < 2) return;
      groups.push({ coordinate: clusterFeature.getGeometry().getCoordinates(), members });
    });
    return groups;
  }

  if (!facilitySource) return [];
  // 묶어 보기를 껐을 때도 좌표가 같은 핀은 하나만 보이므로 같은 방식으로 펼친다
  const byCoordinate = new Map();
  facilitySource.forEachFeatureInExtent(extent, (feature) => {
    const needsRepair = String(feature.get("repair_required_yn") || "").toUpperCase() === "Y";
    if (!matchesFacilityRepairFilter(needsRepair)) return;
    if (!matchesFacilityOfficeFilter(needsRepair, feature.get("office_work_status") || "")) return;

    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== "Point") return;
    const coordinate = geometry.getCoordinates();
    const key = coordinate[0].toFixed(2) + "|" + coordinate[1].toFixed(2);
    if (!byCoordinate.has(key)) byCoordinate.set(key, { coordinate, members: [] });
    byCoordinate.get(key).members.push(feature);
  });

  byCoordinate.forEach((group) => {
    if (group.members.length > 1) groups.push(group);
  });
  return groups;
}

// 펼친 구성이 바뀌었는지 비교할 식별자 (배율이 바뀌면 반지름도 달라지므로 함께 넣는다)
function buildFacilitySpiderKey(groups, resolution) {
  if (groups.length === 0) return "";
  const ids = groups
    .map((group) =>
      group.members
        .map((member) => String(member.get("total_id") || member.getId()))
        .sort()
        .join(",")
    )
    .sort()
    .join(";");
  return ids + "@" + resolution.toFixed(4);
}

// 한 묶음을 원형으로 펼친 핀을 만든다. 연결선은 그리지 않는다 —
// 묶음 배지가 사라지고 핀만 자리를 잡아야 "확대하니 저절로 흩어졌다"처럼 보인다.
function buildFacilitySpiderFeatures(group, resolution) {
  const { coordinate, members } = group;
  const radiusPx = FACILITY_SPIDER_MIN_RADIUS + Math.max(0, members.length - 4) * FACILITY_SPIDER_STEP;
  const radius = radiusPx * resolution;

  return members.map((member, index) => {
    const angle = (2 * Math.PI * index) / members.length - Math.PI / 2;
    const target = [coordinate[0] + Math.cos(angle) * radius, coordinate[1] + Math.sin(angle) * radius];

    const leaf = new ol.Feature({ geometry: new ol.geom.Point(target) });
    // 스타일·클릭 처리에서 원본 피처를 그대로 쓰기 위해 참조만 들고 있는다(속성 복사 X)
    leaf.set("__facilityFeature", member);
    return leaf;
  });
}

/**
 * 펼침 상태를 현재 배율·화면에 맞춘다. 클릭이 아니라 **확대만으로** 펼쳐지게 하는 진입점이며,
 * 구성이 그대로면 아무것도 다시 그리지 않는다(이동할 때마다 깜빡이지 않도록).
 */
function syncFacilitySpiders() {
  if (!facilitySpiderSource) return;
  const map = getMap();
  if (!map) return;

  const groups = collectFacilitySpiderGroups();
  const resolution = map.getView().getResolution() || 1;
  const key = buildFacilitySpiderKey(groups, resolution);

  if (key === facilitySpiderKey) return;

  facilitySpiderSource.clear();
  facilitySpiderExpandedIds.clear();
  facilitySpiderKey = key;

  if (groups.length > 0) {
    const features = [];
    groups.forEach((group) => {
      group.members.forEach((member) => {
        facilitySpiderExpandedIds.add(String(member.get("total_id") || member.getId()));
      });
      features.push(...buildFacilitySpiderFeatures(group, resolution));
    });
    facilitySpiderSource.addFeatures(features);
  }

  // 펼친 대상이 바뀌었으면 원래 자리의 핀·배지를 숨기거나 되살려야 하므로 본 레이어도 다시 그린다
  if (facilityClusteringEnabled && facilityClusterSource) {
    facilityClusterSource.changed();
  } else if (facilitySource) {
    facilitySource.changed();
  }
}

// 펼친 핀에서 원본 시설물 피처를 꺼낸다 (연결선이면 null)
function resolveSpiderFacility(feature) {
  if (!feature) return null;
  return feature.get("__facilityFeature") || null;
}

/**
 * 묶음을 눌렀을 때: 그 범위로 확대한다.
 * 좌표가 사실상 같아 확대해도 갈라지지 않는 묶음은 펼침 배율까지 확대만 한다 —
 * 그 배율에 이르면 `syncFacilitySpiders()`가 알아서 부채꼴로 펼친다(클릭으로 펼치지 않음).
 */
function expandFacilityCluster(members) {
  const map = getMap();
  if (!map || members.length === 0) return;

  const extent = ol.extent.createEmpty();
  members.forEach((member) => {
    const geometry = member.getGeometry();
    if (geometry) ol.extent.extend(extent, geometry.getExtent());
  });
  if (ol.extent.isEmpty(extent)) return;

  const view = map.getView();
  const center = ol.extent.getCenter(extent);
  const resolution = view.getResolution();
  // 구성원들이 화면에서 얼마나 떨어져 있는지(px). 묶음 거리보다 좁으면 더 확대해도 계속 묶인다
  const spreadPx = Math.max(ol.extent.getWidth(extent), ol.extent.getHeight(extent)) / resolution;

  if (spreadPx < FACILITY_CLUSTER_DISTANCE) {
    // fit 으로는 갈라지지 않으므로 펼쳐지는 배율까지 올려 준다(그 배율에서 자동으로 흩어짐)
    const targetZoom = Math.min(Math.max(view.getZoom() + 2, FACILITY_SPIDER_MIN_ZOOM), view.getMaxZoom());
    view.animate({ center, zoom: targetZoom, duration: 400 });
    return;
  }

  view.fit(extent, {
    duration: 400,
    padding: [80, 80, 80, 80],
    maxZoom: Math.max(view.getZoom() + 1, 17),
  });
}

// 클러스터링 켬/끔 — 레이어의 소스와 스타일만 바꾼다(원본 소스와 데이터는 그대로)
function applyFacilityClustering(enabled) {
  facilityClusteringEnabled = Boolean(enabled);
  clearFacilitySpider(); // 묶음 여부가 바뀌면 펼침 구성도 달라지므로 비우고 다시 계산한다
  if (!facilityLayer || !facilitySource) return;

  if (facilityClusteringEnabled) {
    if (!facilityClusterSource) {
      facilityClusterSource = new ol.source.Cluster({
        source: facilitySource,
        distance: FACILITY_CLUSTER_DISTANCE,
        minDistance: FACILITY_CLUSTER_MIN_DISTANCE,
        geometryFunction: facilityClusterGeometry,
      });
    }
    facilityLayer.setStyle(facilityClusterStyleFunction);
    facilityLayer.setSource(facilityClusterSource);
    facilityClusterSource.refresh();
  } else {
    facilityLayer.setStyle(facilityStyleFunction);
    facilityLayer.setSource(facilitySource);
  }

  syncFacilitySpiders();
}

// 필터·선택이 바뀌었을 때 지도 표시 갱신. 묶음은 개수까지 다시 계산해야 하므로 refresh 를 쓴다.
function refreshFacilityLayer() {
  // 펼쳐 둔 핀도 선택 강조가 바뀌므로 같이 다시 그린다(내용은 그대로)
  if (facilitySpiderSource) facilitySpiderSource.changed();

  if (facilityClusteringEnabled && facilityClusterSource) {
    facilityClusterSource.refresh();
  } else if (facilitySource) {
    facilitySource.changed();
  }

  // 필터가 바뀌면 펼칠 대상도 달라진다 (구성이 같으면 안에서 그냥 빠져나온다)
  syncFacilitySpiders();
}

function readFacilityClusterPreference() {
  try {
    return window.localStorage.getItem(FACILITY_CLUSTER_STORAGE_KEY) !== "off";
  } catch (e) {
    return true; // 사생활 보호 모드 등으로 저장소를 못 읽어도 기본값으로 동작해야 한다
  }
}

function saveFacilityClusterPreference(enabled) {
  try {
    window.localStorage.setItem(FACILITY_CLUSTER_STORAGE_KEY, enabled ? "on" : "off");
  } catch (e) {
    /* 저장에 실패해도 이번 세션 동안은 그대로 동작한다 */
  }
}

// 핀 묶음 토글 바인딩 (서버 재조회 없음)
function bindFacilityClusterToggle() {
  const toggleEl = document.getElementById("facilityClusterToggle");
  if (!toggleEl) return;
  toggleEl.checked = facilityClusteringEnabled;
  toggleEl.addEventListener("change", () => {
    applyFacilityClustering(toggleEl.checked);
    saveFacilityClusterPreference(toggleEl.checked);
  });
}

// 팝업 요소 생성
function createPopupElement() {
  const popup = document.createElement("div");
  popup.id = "facility-popup";
  popup.className = "facility-popup";

  // 가로 배치: 왼쪽 .facility-popup-main(기존 세로 플렉스 전체) + 오른쪽 내업 작성 칸(열 때만 붙음).
  // 작성 칸을 별도 오버레이가 아니라 같은 요소 안에 두어야 헤더 드래그·지도 이동 때 함께 움직인다.
  popup.innerHTML = `
    <div class="facility-popup-main" id="facilityPopupMain">
      <div class="facility-popup-header">
        <span class="facility-popup-icon" id="facilityPopupIcon" aria-hidden="true"></span>
        <div class="facility-popup-title" id="facilityPopupTitle">시설물 상세정보</div>
        <button class="facility-popup-close" id="facilityPopupCloseBtn" title="닫기 (ESC)">×</button>
      </div>
      <div class="facility-popup-meta" id="facilityPopupMeta"></div>
      <div class="facility-popup-body" id="facilityPopupBody">
        <div class="facility-detail-loading">상세정보를 불러오는 중...</div>
      </div>
      <div class="facility-popup-resizer hidden" id="facilityOfficeResizer" role="separator"
        aria-orientation="horizontal" tabindex="0" aria-controls="facilityOfficeFooter"
        aria-label="상세정보와 내업 영역 크기 조절 (위/아래 방향키)" title="끌어서 내업 영역 크기 조절"></div>
      <div class="facility-popup-office-footer hidden" id="facilityOfficeFooter"></div>
    </div>
  `;

  return popup;
}

// ==========================================================================
// 상세 본문 ↔ 내업 영역 경계 리사이저
// ==========================================================================

const FACILITY_OFFICE_MIN_HEIGHT = 80; // 내업 요약 한 줄은 보이도록
const FACILITY_OFFICE_MAX_RATIO = 0.75; // 팝업 높이 대비 상한 (상세 본문이 몇 줄은 남게)
const FACILITY_OFFICE_KEY_STEP = 20; // 방향키 한 번에 조절하는 높이
const FACILITY_OFFICE_HEIGHT_STORAGE_KEY = "sjlab.facilityOfficeFooterHeight";

// 사용자가 조절한 내업 영역 높이(px). null 이면 CSS 기본값(min(300px, 45vh))을 쓴다.
// 팝업을 닫았다 열어도 유지되도록 모듈 변수에 두고, 가능하면 localStorage 에도 남긴다.
let facilityOfficeFooterHeight = readStoredFacilityOfficeHeight();

function readStoredFacilityOfficeHeight() {
  try {
    const stored = Number(window.localStorage.getItem(FACILITY_OFFICE_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch (e) {
    return null; // 저장소를 못 쓰는 환경이면 기본값
  }
}

function storeFacilityOfficeHeight(height) {
  try {
    window.localStorage.setItem(FACILITY_OFFICE_HEIGHT_STORAGE_KEY, String(Math.round(height)));
  } catch (e) {
    // 저장 실패해도 모듈 변수로는 유지된다
  }
}

// 내업 영역 높이 상한 — 팝업 높이 상한(CSS max-height: min(600px, 100vh - 170px))의 75%
function getFacilityOfficeMaxHeight() {
  const popupMaxHeight = Math.min(600, window.innerHeight - 170);
  return Math.max(FACILITY_OFFICE_MIN_HEIGHT, Math.round(popupMaxHeight * FACILITY_OFFICE_MAX_RATIO));
}

function clampFacilityOfficeHeight(height) {
  return Math.min(getFacilityOfficeMaxHeight(), Math.max(FACILITY_OFFICE_MIN_HEIGHT, height));
}

// 저장된 높이를 현재 창 크기 범위로 맞춰 내업 영역에 적용한다 (null 이면 CSS 기본값으로 둔다)
function applyFacilityOfficeFooterHeight() {
  const footerEl = document.getElementById("facilityOfficeFooter");
  const resizerEl = document.getElementById("facilityOfficeResizer");
  if (!footerEl) return;

  if (facilityOfficeFooterHeight === null) {
    footerEl.style.height = "";
    footerEl.style.maxHeight = "";
  } else {
    const height = clampFacilityOfficeHeight(facilityOfficeFooterHeight);
    footerEl.style.height = `${height}px`;
    footerEl.style.maxHeight = "none";
  }

  if (resizerEl) {
    resizerEl.setAttribute("aria-valuemin", String(FACILITY_OFFICE_MIN_HEIGHT));
    resizerEl.setAttribute("aria-valuemax", String(getFacilityOfficeMaxHeight()));
    resizerEl.setAttribute("aria-valuenow", String(Math.round(footerEl.getBoundingClientRect().height)));
  }
}

function setFacilityOfficeFooterHeight(height) {
  facilityOfficeFooterHeight = clampFacilityOfficeHeight(height);
  applyFacilityOfficeFooterHeight();
}

// 내업 영역과 리사이저를 함께 보이거나 숨긴다 (보수 불필요 시설물은 둘 다 숨김)
function setFacilityOfficeFooterVisible(visible) {
  const footerEl = document.getElementById("facilityOfficeFooter");
  const resizerEl = document.getElementById("facilityOfficeResizer");
  if (footerEl) footerEl.classList.toggle("hidden", !visible);
  if (resizerEl) resizerEl.classList.toggle("hidden", !visible);
  if (visible) applyFacilityOfficeFooterHeight();
}

/**
 * 리사이저 드래그·방향키 바인딩.
 * 리사이저는 헤더 밖에 있어 bindOverlayHeaderDrag(헤더에만 걸림)와 겹치지 않고,
 * pointerdown 전파도 막아 지도·팝업 이동으로 번지지 않게 한다.
 * 높이를 바꾸는 동안 팝업 위치(offset)는 건드리지 않는다.
 */
function bindFacilityOfficeResizer(popupEl) {
  const resizerEl = popupEl.querySelector("#facilityOfficeResizer");
  const footerEl = popupEl.querySelector("#facilityOfficeFooter");
  if (!resizerEl || !footerEl) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  resizerEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    startY = event.clientY;
    startHeight = footerEl.getBoundingClientRect().height;
    resizerEl.setPointerCapture(event.pointerId);
    resizerEl.classList.add("dragging");
    popupEl.classList.add("is-resizing");
    event.preventDefault(); // 텍스트 선택 방지
    event.stopPropagation();
  });

  resizerEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    // 위로 끌면(clientY 감소) 내업 영역이 커진다
    setFacilityOfficeFooterHeight(startHeight + (startY - event.clientY));
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    resizerEl.classList.remove("dragging");
    popupEl.classList.remove("is-resizing");
    if (event.pointerId !== undefined && resizerEl.hasPointerCapture(event.pointerId)) {
      resizerEl.releasePointerCapture(event.pointerId);
    }
    if (facilityOfficeFooterHeight !== null) storeFacilityOfficeHeight(facilityOfficeFooterHeight);
  };
  resizerEl.addEventListener("pointerup", endDrag);
  resizerEl.addEventListener("pointercancel", endDrag);

  resizerEl.addEventListener("keydown", (event) => {
    let delta = 0;
    if (event.key === "ArrowUp") delta = FACILITY_OFFICE_KEY_STEP;
    else if (event.key === "ArrowDown") delta = -FACILITY_OFFICE_KEY_STEP;
    else return;
    event.preventDefault();
    event.stopPropagation(); // 지도 키보드 이동으로 번지지 않게
    setFacilityOfficeFooterHeight(footerEl.getBoundingClientRect().height + delta);
    storeFacilityOfficeHeight(facilityOfficeFooterHeight);
  });

  // 창 높이가 바뀌면 상한도 바뀌므로 범위를 다시 맞춘다
  window.addEventListener("resize", () => {
    if (!footerEl.classList.contains("hidden")) applyFacilityOfficeFooterHeight();
  });
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

  // 벡터 소스 및 레이어 생성 (docs/map-architecture.md 규칙 준수: 최상단 zIndex, obstacle declutter)
  facilitySource = new ol.source.Vector();
  facilityLayer = new ol.layer.Vector({
    source: facilitySource,
    style: facilityStyleFunction,
    updateWhileAnimating: false,
    updateWhileInteracting: false,
    // declutter 를 켜되 시설물 스타일은 전부 declutterMode: "obstacle" 이다(FACILITY_DECLUTTER_MODE).
    // OpenLayers 는 declutter 레이어의 심볼을 모든 레이어를 그린 뒤 마지막에 따로 그리므로,
    // 이걸 끄면 zIndex 를 아무리 올려도 declutter 를 쓰는 WFS 레이어 아이콘에 가려진다.
    // obstacle 은 "항상 그리되 다른 declutter 심볼이 피해 가게" 하는 모드라 시설물 핀은 하나도 숨지 않는다
    // (= 목록 건수와 지도 표출 건수 일치 규칙 유지).
    declutter: true,
    zIndex: FACILITY_LAYER_Z_INDEX,
  });

  map.addLayer(facilityLayer);

  // 묶음을 펼쳤을 때(spiderfy) 핀과 연결선을 그릴 레이어 — 시설물 레이어 바로 위
  initFacilitySpiderLayer(map);

  // 시설물이 이 서비스의 주 기능이므로 나중에 추가되는 레이어에도 가리지 않게 한다
  keepFacilityLayerOnTop(map);

  // 핀 묶음(클러스터링) 적용 — 기본 켬, 사용자가 끄면 그 선택을 기억한다
  facilityClusteringEnabled = readFacilityClusterPreference();
  applyFacilityClustering(facilityClusteringEnabled);

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
  // 상세 본문과 내업 영역 사이 경계를 끌어 크기 조절 (헤더 드래그와는 별개 요소)
  bindFacilityOfficeResizer(popupEl);

  // 팝업 닫기 버튼 이벤트 바인딩
  const closeBtn = popupEl.querySelector("#facilityPopupCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeFacilityPopup();
    });
  }

  // 창 크기가 바뀌면 작성 폼의 배치(오른쪽 칸 ↔ 본문 교체)를 다시 판단한다 (입력값은 그대로 유지)
  window.addEventListener("resize", () => {
    if (activeOfficeForm) applyOfficeFormLayout();
  });

  // ESC 키로 팝업 닫기 이벤트 등록
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
      closeFacilityPopup();
    }
  });

  // 지도 클릭 이벤트 등록 (고유 id: facility-click-layer)
  MapEventManager.registerClickHandler("facility-click-layer", (evt) => {
    // 펼친 핀(spiderfy)이 있으면 그쪽을 먼저 본다 — 묶음 배지 위에 떠 있기 때문
    let spiderFeature = null;
    map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
      if (layer === facilitySpiderLayer) {
        spiderFeature = feature;
        return true;
      }
    });

    if (spiderFeature) {
      const facilityFeature = resolveSpiderFacility(spiderFeature);
      if (facilityFeature) {
        const spiderTotalId = facilityFeature.get("total_id") || facilityFeature.getId();
        selectFacility(spiderTotalId, false);
      }
      return;
    }

    let clickedFeature = null;
    map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
      if (layer === facilityLayer) {
        clickedFeature = feature;
        return true;
      }
    });

    if (clickedFeature) {
      // 묶음(2건 이상)을 누르면 그 범위로 확대해 풀어 보여주고, 1건이면 그 시설물을 선택한다
      const members = getClusterMembers(clickedFeature);
      if (members.length > 1) {
        expandFacilityCluster(members);
        return;
      }
      const target = members[0];
      const totalId = target.get("total_id") || target.getId();
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
      if (layer === facilityLayer || layer === facilitySpiderLayer) {
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
  bindFacilityClusterToggle();
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
// 내업 상태 필터: "all"(기본) | "OPEN"(처리 대기 — 완료 제외) | "PENDING"(미완료) | "RECEIVED" | "IN_PROGRESS" | "DONE" | "HOLD"
// "all" 이 아니면 보수 필요 시설물 중 그 상태인 것만 남는다 (보수 불필요 시설물은 내업 대상이 아님)
let facilityOfficeFilter = "all";

function matchesFacilityRepairFilter(needsRepair) {
  if (facilityRepairFilter === "repair") return needsRepair;
  if (facilityRepairFilter === "noRepair") return !needsRepair;
  return true;
}

function matchesFacilityOfficeFilter(needsRepair, officeWorkStatus) {
  if (facilityOfficeFilter === "all") return true;
  const code = resolveOfficeWorkStatus(needsRepair, officeWorkStatus);
  // 처리 대기 = 내업 대상(보수 필요)이면서 완료가 아닌 전부 (미완료·접수·처리중·보류)
  if (facilityOfficeFilter === OFFICE_WORK_OPEN_FILTER) return code !== "" && code !== "DONE";
  return code === facilityOfficeFilter;
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
  const filteredItems = keywordItems.filter(
    (item) =>
      matchesFacilityRepairFilter(item.needsRepair) &&
      matchesFacilityOfficeFilter(item.needsRepair, item.officeWorkStatus)
  );

  // 내업 완료 건은 더 처리할 게 없으므로 목록 뒤로 보낸다 (나머지는 조회 순서 그대로 — 안정 정렬).
  // 내업을 완료해도 보수 필요 여부(외업 값)는 바뀌지 않아 보수 필요 목록에 계속 남기 때문.
  const visibleItems = [
    ...filteredItems.filter((item) => !isOfficeWorkDone(item.needsRepair, item.officeWorkStatus)),
    ...filteredItems.filter((item) => isOfficeWorkDone(item.needsRepair, item.officeWorkStatus)),
  ];

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
  const officeCounts = { all: itemsForOfficeCounts.length, [OFFICE_WORK_OPEN_FILTER]: 0 };
  Object.keys(OFFICE_WORK_STATUS_MAP).forEach((code) => {
    officeCounts[code] = 0;
  });
  itemsForOfficeCounts.forEach((item) => {
    const code = resolveOfficeWorkStatus(item.needsRepair, item.officeWorkStatus);
    if (!code) return;
    officeCounts[code] += 1;
    if (code !== "DONE") officeCounts[OFFICE_WORK_OPEN_FILTER] += 1;
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
    // 필터가 바뀌면 펼쳐 둔 핀은 더 이상 맞지 않으므로 접는다
    clearFacilitySpider();
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
        closeFacilityPopup({ force: true });
      }
    }

    renderFacilityList();
    refreshFacilityLayer();
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
    // 필터가 바뀌면 펼쳐 둔 핀은 더 이상 맞지 않으므로 접는다
    clearFacilitySpider();
    facilityOfficeFilter = value;

    // 열려 있는 팝업의 시설물이 필터에서 빠지면 핀이 사라지므로 팝업도 닫는다
    if (selectedTotalId) {
      const selectedItem = facilityListItems.find((item) => item.totalId === String(selectedTotalId));
      if (
        selectedItem &&
        (!matchesFacilityRepairFilter(selectedItem.needsRepair) ||
          !matchesFacilityOfficeFilter(selectedItem.needsRepair, selectedItem.officeWorkStatus))
      ) {
        closeFacilityPopup({ force: true });
      }
    }

    renderFacilityList();
    refreshFacilityLayer();
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

  // 이전 선택 및 팝업 닫기 (구역을 바꿔 목록을 새로 받으므로 확인 없이 닫음)
  closeFacilityPopup({ force: true });

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
      updateFacilityOfficeCounts({ all: 0 });
      clearFacilitySpider();
      if (facilitySource) facilitySource.clear();
      return;
    }

    // 1) 목록 렌더링 (검색어가 있으면 걸러서 표시)
    facilityListItems = buildFacilityListItems(rawFeatures);
    renderFacilityList();

    // 2) 지도 표출: 목록 렌더링 후 같은 응답 데이터로 벡터 레이어 채우기
    // docs/map-architecture.md 규칙: featureProjection에 vectorSource.getProjection()(= null) 전달
    if (facilitySource) {
      clearFacilitySpider();
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
      // 새로 받은 데이터 기준으로 펼침 상태를 다시 맞춘다(배율이 이미 충분하면 바로 펼쳐짐)
      syncFacilitySpiders();
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
    clearFacilitySpider();
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
  // 작성 중인 내업 내용이 있으면 다른 시설물로 넘어가기 전에 확인한다 (취소하면 선택을 바꾸지 않음)
  if (!confirmDiscardOfficeForm()) return;
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
    refreshFacilityLayer();
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
  // 이전 시설물의 작성 폼은 닫는다 (확인은 selectFacility 에서 이미 받음)
  closeOfficeWorkForm();
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
      setFacilityOfficeFooterVisible(true);

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
  setFacilityOfficeFooterVisible(false);
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

  // 저장 후 알림 (예: 기록은 저장됐지만 일부 사진 업로드 실패)
  const notice = document.createElement("div");
  notice.className = "facility-office-notice hidden";
  notice.id = "facilityOfficeNotice";
  notice.setAttribute("role", "alert");
  section.appendChild(notice);

  // 이력 및 요약 내용 컨테이너
  const content = document.createElement("div");
  content.className = "facility-office-content";
  content.id = "facilityOfficeContent";
  content.innerHTML = '<div class="facility-office-loading">내업 처리 이력을 불러오는 중...</div>';
  section.appendChild(content);

  createBtn.addEventListener("click", () => {
    hideFacilityOfficeNotice();
    openOfficeWorkForm(totalId, null);
  });

  return section;
}

// 내업 섹션 상단 알림 표시 (문구와 세부 항목은 모두 textContent 로 넣는다)
function showFacilityOfficeNotice(message, details = []) {
  const notice = document.getElementById("facilityOfficeNotice");
  if (!notice) return;
  notice.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "facility-office-notice-close";
  closeBtn.title = "알림 닫기";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", hideFacilityOfficeNotice);
  notice.appendChild(closeBtn);

  const text = document.createElement("div");
  text.textContent = message;
  notice.appendChild(text);

  if (details.length > 0) {
    const list = document.createElement("ul");
    details.forEach((detail) => {
      const li = document.createElement("li");
      li.textContent = detail;
      list.appendChild(li);
    });
    notice.appendChild(list);
  }
  notice.classList.remove("hidden");

  const officeFooterEl = document.getElementById("facilityOfficeFooter");
  if (officeFooterEl) officeFooterEl.scrollTop = 0;
}

function hideFacilityOfficeNotice() {
  const notice = document.getElementById("facilityOfficeNotice");
  if (!notice) return;
  notice.classList.add("hidden");
  notice.innerHTML = "";
}

// ==========================================================================
// 내업 처리 전·후 사진 (파일 업로드)
// ==========================================================================

const OFFICE_PHOTO_KINDS = [
  { kind: "BEFORE", label: "처리 전 사진" },
  { kind: "AFTER", label: "처리 후 사진" },
];
const OFFICE_PHOTO_MAX_COUNT = 5; // 종류별 최대 장수 (서버는 6장째를 409 로 거부)
const OFFICE_PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 장당 10MB (서버 상한과 동일)
const OFFICE_PHOTO_MAX_EDGE = 1600; // 업로드 전 브라우저 축소 — 긴 변 상한
const OFFICE_PHOTO_JPEG_QUALITY = 0.8;
const OFFICE_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OFFICE_PHOTO_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

function getOfficePhotoKindLabel(kind) {
  const found = OFFICE_PHOTO_KINDS.find((k) => k.kind === kind);
  return found ? found.label : kind;
}

function isAllowedOfficePhoto(file) {
  if (file.type) return OFFICE_PHOTO_MIME_TYPES.has(file.type);
  return OFFICE_PHOTO_EXTENSIONS.test(file.name); // 형식을 모르는 브라우저는 확장자로 판정
}

// 저장된 사진 원본 URL — <img src> 에 바로 쓴다
function buildOfficePhotoUrl(workId, photoId) {
  return getApiUrl(
    `/map/qfield/office-works/${encodeURIComponent(workId)}/photos/${encodeURIComponent(photoId)}`
  );
}

async function loadOfficePhotoImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (e) {
      // 아래 <img> 방식으로 다시 시도
    }
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽을 수 없습니다"));
    };
    img.src = objectUrl;
  });
}

/**
 * 업로드 전 브라우저 축소: 긴 변이 1600px 보다 크면 canvas 로 줄여 JPEG(품질 0.8)로 바꾼다.
 * 원본이 이미 작으면 형식 그대로 둔다. PNG·WEBP 를 JPEG 로 바꾸면 파일명 확장자도 .jpg 로 맞춘다
 * (투명 영역은 흰 바탕으로 채움).
 */
async function resizeOfficePhoto(file) {
  const image = await loadOfficePhotoImage(file);
  const width = image.width;
  const height = image.height;
  const longEdge = Math.max(width, height);

  if (!longEdge || longEdge <= OFFICE_PHOTO_MAX_EDGE) {
    if (image.close) image.close();
    return file;
  }

  const scale = OFFICE_PHOTO_MAX_EDGE / longEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (image.close) image.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", OFFICE_PHOTO_JPEG_QUALITY)
  );
  if (!blob) throw new Error("사진을 변환하지 못했습니다");

  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * 내업 사진 목록 조회 (GET /map/qfield/office-works/{workId}/photos)
 */
async function fetchOfficeWorkPhotos(workId) {
  const url = getApiUrl(`/map/qfield/office-works/${encodeURIComponent(workId)}/photos`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`사진 목록 조회 실패 (${response.status})`);
  }
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * 내업 사진 업로드 (POST /map/qfield/office-works/{workId}/photos, multipart: file, kind)
 */
async function uploadOfficeWorkPhoto(workId, kind, file) {
  const url = getApiUrl(`/map/qfield/office-works/${encodeURIComponent(workId)}/photos`);
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("kind", kind);
  // Content-Type 은 브라우저가 multipart 경계값과 함께 채우도록 지정하지 않는다
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const statusHint =
      response.status === 413 ? "10MB 초과" : response.status === 409 ? "종류별 5장 초과" : "";
    const message = await readApiErrorMessage(response);
    throw new Error(`${response.status}${statusHint ? ` ${statusHint}` : ""}: ${message}`);
  }
  return await response.json();
}

/**
 * 내업 사진 삭제 (DELETE /map/qfield/office-works/{workId}/photos/{photoId})
 */
async function deleteOfficeWorkPhoto(workId, photoId) {
  const response = await fetch(buildOfficePhotoUrl(workId, photoId), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`사진 삭제 실패 (${response.status}): ${await readApiErrorMessage(response)}`);
  }
  return true;
}

// 썸네일 한 칸 — 누르면 원본을 새 창으로 연다. onRemove 가 있으면 × 버튼을 붙인다
function createOfficePhotoThumb(src, href, options = {}) {
  const { title = "", isNew = false, onRemove = null } = options;
  const thumb = document.createElement("div");
  thumb.className = `facility-office-photo-thumb${isNew ? " is-new" : ""}`;

  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = title ? `${title} (원본 보기)` : "원본 보기";

  const img = document.createElement("img");
  img.src = src;
  img.alt = title || "내업 사진";
  img.loading = "lazy";
  link.appendChild(img);
  thumb.appendChild(link);

  if (isNew) {
    const badge = document.createElement("span");
    badge.className = "facility-office-photo-new";
    badge.textContent = "새 사진";
    thumb.appendChild(badge);
  }

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "facility-office-photo-remove";
    removeBtn.title = "사진 삭제";
    removeBtn.setAttribute("aria-label", `${title || "사진"} 삭제`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      onRemove();
    });
    thumb.appendChild(removeBtn);
  }
  return thumb;
}

/**
 * 작성·수정 폼의 사진 칸 (라벨 + 썸네일 + 파일 선택) 을 다시 그린다.
 */
function renderOfficePhotoField(fieldEl, state, handlers) {
  const kind = fieldEl.dataset.kind;
  const total = state.existing.length + state.pending.length;
  const inputId = `officePhotoInput${kind}`;
  fieldEl.innerHTML = "";

  const label = document.createElement("label");
  label.setAttribute("for", inputId);
  label.textContent = `${getOfficePhotoKindLabel(kind)} (${total}/${OFFICE_PHOTO_MAX_COUNT})`;
  fieldEl.appendChild(label);

  const thumbs = document.createElement("div");
  thumbs.className = "facility-office-photo-thumbs";

  state.existing.forEach((photo) => {
    const url = buildOfficePhotoUrl(state.workId, photo.photo_id);
    thumbs.appendChild(
      createOfficePhotoThumb(url, url, {
        title: photo.file_name,
        onRemove: () => handlers.onDeleteExisting(photo),
      })
    );
  });
  state.pending.forEach((pendingItem) => {
    thumbs.appendChild(
      createOfficePhotoThumb(pendingItem.previewUrl, pendingItem.previewUrl, {
        title: pendingItem.file.name,
        isNew: true,
        onRemove: () => handlers.onRemovePending(pendingItem),
      })
    );
  });

  // 파일 선택 (여러 장). 5장이 차면 숨긴다
  if (total < OFFICE_PHOTO_MAX_COUNT) {
    const addLabel = document.createElement("label");
    addLabel.className = "facility-office-photo-add";
    addLabel.title = "jpg·png·webp, 장당 10MB";

    const input = document.createElement("input");
    input.type = "file";
    input.id = inputId;
    input.multiple = true;
    input.accept = "image/jpeg,image/png,image/webp";
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.value = ""; // 같은 파일을 다시 골라도 change 가 나도록
      if (files.length > 0) handlers.onAddFiles(files);
    });

    const plus = document.createElement("span");
    plus.textContent = "+ 사진";
    addLabel.appendChild(input);
    addLabel.appendChild(plus);
    thumbs.appendChild(addLabel);
  }
  fieldEl.appendChild(thumbs);

  const hint = document.createElement("div");
  hint.className = "facility-office-photo-hint";
  hint.textContent = state.loadError
    ? "저장된 사진 목록을 불러오지 못했습니다. 새 사진은 저장할 때 올립니다."
    : state.pending.length > 0
      ? "새 사진은 저장 버튼을 누르면 올라갑니다 (긴 변 1600px로 줄여서 업로드)."
      : "jpg·png·webp, 종류별 최대 5장, 장당 10MB";
  fieldEl.appendChild(hint);
}

/**
 * 읽기 전용 카드에 저장된 사진 썸네일을 붙인다 (목록은 카드마다 한 번만 조회)
 */
async function loadOfficeWorkCardPhotos(photoWrap, workId) {
  if (!photoWrap || !workId || photoWrap.dataset.loaded) return;
  photoWrap.dataset.loaded = "true";
  try {
    const photos = await fetchOfficeWorkPhotos(workId);
    photoWrap.innerHTML = "";
    OFFICE_PHOTO_KINDS.forEach(({ kind, label }) => {
      const kindPhotos = photos.filter((p) => String(p.kind).toUpperCase() === kind);
      if (kindPhotos.length === 0) return;

      const row = document.createElement("div");
      row.className = "facility-office-photo-row";
      const rowLabel = document.createElement("span");
      rowLabel.className = "facility-office-photo-row-label";
      rowLabel.textContent = label.replace(" 사진", "");
      row.appendChild(rowLabel);

      const thumbs = document.createElement("div");
      thumbs.className = "facility-office-photo-thumbs";
      kindPhotos.forEach((photo) => {
        const url = buildOfficePhotoUrl(workId, photo.photo_id);
        thumbs.appendChild(createOfficePhotoThumb(url, url, { title: photo.file_name }));
      });
      row.appendChild(thumbs);
      photoWrap.appendChild(row);
    });
    photoWrap.classList.toggle("hidden", photoWrap.children.length === 0);
  } catch (err) {
    // 사진 조회 실패는 기록 표시를 막지 않는다
    console.warn("내업 사진 조회 실패:", err.message);
    photoWrap.classList.add("hidden");
  }
}

// ==========================================================================
// 내업 작성·수정 칸 배치
//  - 넓은 화면: 상세 팝업(.facility-popup) 안 오른쪽 칸으로 펼친다 (같은 요소라 드래그·지도 이동에 함께 움직임)
//  - 좁은 화면: 오른쪽으로 펼치지 않고 팝업 안에서 상세 본문 자리를 폼으로 바꾼다 ("← 상세로" 로 복귀)
// ==========================================================================

const OFFICE_FORM_SIDE_WIDTH = 400; // 오른쪽 칸 폭 — CSS .facility-popup > .facility-office-form-panel 과 같게
const OFFICE_FORM_PIN_ROOM = 160; // 오른쪽 칸을 펼쳐도 핀 왼쪽에 남길 지도 폭 (핀 주변이 보이도록)
const OFFICE_FORM_VIEW_MARGIN = 24; // panIntoView 여백 (revealFacilityPopup 과 같게)
const OFFICE_FORM_OPEN_ANIMATION_MS = 180; // CSS facilityOfficeSideOpen 애니메이션 길이
const OFFICE_FORM_DISCARD_MESSAGE = "작성 중인 내업 내용이 사라집니다. 닫을까요?";

// 열려 있는 작성·수정 폼 { panel, mode, isDirty(), dispose(reload) }. 없으면 null
let activeOfficeForm = null;

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// 지도 위에 떠 있는 오른쪽 컨트롤(줌·사이드 탭·배경지도 선택). 팝업보다 위에 그려져 겹치면 입력란을 가린다
const FACILITY_MAP_CONTROL_SELECTOR = ".ol-zoom, .cadastral-control, .map-type-selector";
const FACILITY_MAP_CONTROL_COLUMN_SELECTOR = ".ol-zoom, .cadastral-control"; // 세로로 길게 뻗은 줄
const FACILITY_MAP_CONTROL_GAP = 12; // 컨트롤과 팝업 사이 여백

function getVisibleRect(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

// 화면에 실제로 보이는 지도 영역의 좌우 경계
// (좌측 레이어 패널이 가리는 부분 제외 — getFacilityViewCenter 와 같은 기준, 오른쪽 세로 컨트롤 줄도 제외)
function getVisibleMapBounds() {
  const map = getMap();
  const mapEl = map && map.getTargetElement();
  if (!mapEl) return { left: 0, right: window.innerWidth };
  const mapRect = mapEl.getBoundingClientRect();
  let left = Math.max(mapRect.left, 0);
  let right = Math.min(mapRect.right, window.innerWidth);
  const panelRect = getVisibleRect(document.querySelector(".layer-panel"));
  if (panelRect) left = Math.max(left, Math.min(panelRect.right, right));
  document.querySelectorAll(FACILITY_MAP_CONTROL_COLUMN_SELECTOR).forEach((ctrl) => {
    const rect = getVisibleRect(ctrl);
    if (rect && rect.left > left) right = Math.min(right, rect.left - FACILITY_MAP_CONTROL_GAP);
  });
  return { left, right: Math.max(left, right) };
}

function getVisibleMapWidth() {
  const { left, right } = getVisibleMapBounds();
  return right - left;
}

/**
 * 팝업이 오른쪽 지도 컨트롤에 가려지면 가려진 만큼 지도를 옆으로 민다 (팝업 offset 은 그대로).
 * panIntoView 는 지도 요소 가장자리만 보므로, 그 위에 떠 있는 컨트롤까지는 피하지 못한다.
 * 왼쪽 패널 밖으로 밀려나지 않는 범위에서만 옮긴다.
 */
function avoidFacilityMapControls() {
  const map = getMap();
  const popupEl = facilityOverlay && facilityOverlay.getElement();
  if (!map || !popupEl || facilityOverlay.getPosition() === undefined) return;
  map.renderSync();
  const popupRect = popupEl.getBoundingClientRect();

  let shift = 0;
  document.querySelectorAll(FACILITY_MAP_CONTROL_SELECTOR).forEach((ctrl) => {
    const rect = getVisibleRect(ctrl);
    if (!rect) return;
    const overlaps =
      rect.top < popupRect.bottom && rect.bottom > popupRect.top &&
      rect.left < popupRect.right && rect.right > popupRect.left;
    if (overlaps) shift = Math.max(shift, popupRect.right - (rect.left - FACILITY_MAP_CONTROL_GAP));
  });
  const { left } = getVisibleMapBounds();
  shift = Math.min(shift, popupRect.left - (left + OFFICE_FORM_VIEW_MARGIN));
  if (shift <= 0) return;

  const view = map.getView();
  const center = view.getCenter();
  view.animate({ center: [center[0] + shift * view.getResolution(), center[1]], duration: 200 });
}

// 핀 주변 여유 + 팝업 오프셋 + 상세 팝업 + 오른쪽 칸 + 양쪽 여백이 보이는 지도 폭에 들어가면 오른쪽 칸
function resolveOfficeFormMode() {
  const mainEl = document.getElementById("facilityPopupMain");
  const mainWidth = mainEl ? mainEl.getBoundingClientRect().width : 0;
  const requiredWidth =
    OFFICE_FORM_PIN_ROOM +
    FACILITY_POPUP_OFFSET[0] +
    mainWidth +
    OFFICE_FORM_SIDE_WIDTH +
    OFFICE_FORM_VIEW_MARGIN * 2;
  return getVisibleMapWidth() >= requiredWidth ? "side" : "inline";
}

// 팝업 폭·높이가 바뀐 뒤 화면 밖으로 나가거나 오른쪽 컨트롤에 가려진 부분만 지도를 밀어 보이게 한다
// (offset 은 건드리지 않음)
function panFacilityPopupIntoView(delay = 0) {
  const token = facilityPopupRevealToken;
  setTimeout(() => {
    if (token !== facilityPopupRevealToken) return; // 그사이 다른 시설물을 골랐거나 닫힘
    const map = getMap();
    if (!map || !facilityOverlay || facilityOverlay.getPosition() === undefined) return;
    facilityOverlay.panIntoView({ margin: OFFICE_FORM_VIEW_MARGIN, animation: { duration: 200 } });
    whenFacilityViewSettled(map, token, avoidFacilityMapControls);
  }, delay);
}

/**
 * 열려 있는 폼을 현재 창 크기에 맞는 자리(오른쪽 칸 / 본문 교체)에 둔다.
 * 폼 요소를 옮기기만 하므로 입력값·대기 중인 사진은 그대로 유지된다.
 */
function applyOfficeFormLayout() {
  if (!activeOfficeForm) return;
  const popupEl = document.getElementById("facility-popup");
  const mainEl = document.getElementById("facilityPopupMain");
  const bodyEl = document.getElementById("facilityPopupBody");
  if (!popupEl || !mainEl || !bodyEl) return;

  const { panel } = activeOfficeForm;
  const mode = resolveOfficeFormMode();
  if (mode === activeOfficeForm.mode && panel.isConnected) return;

  const isFirstOpen = !panel.isConnected;
  const scrollEl = panel.querySelector(".facility-office-form-scroll");
  const scrollTop = scrollEl ? scrollEl.scrollTop : 0;

  activeOfficeForm.mode = mode;
  if (mode === "side") {
    mainEl.style.width = "";
    popupEl.appendChild(panel);
  } else {
    // 본문 자리를 바꿔도 팝업 폭이 달라지지 않도록 지금 상세 폭을 고정한다 (닫을 때 풀림)
    if (!popupEl.classList.contains("has-office-inline")) {
      mainEl.style.width = `${Math.round(mainEl.getBoundingClientRect().width)}px`;
    }
    mainEl.insertBefore(panel, bodyEl); // 본문·리사이저·내업 영역은 CSS 로 숨김
  }
  popupEl.classList.toggle("has-office-side", mode === "side");
  popupEl.classList.toggle("has-office-inline", mode === "inline");
  if (scrollEl) scrollEl.scrollTop = scrollTop;

  // 오른쪽 칸을 처음 펼칠 때만 폭 애니메이션 (움직임 줄이기 설정이면 CSS 에서 꺼짐)
  const animate = isFirstOpen && mode === "side" && !prefersReducedMotion();
  panel.classList.toggle("is-opening", animate);
  if (animate) {
    setTimeout(() => panel.classList.remove("is-opening"), OFFICE_FORM_OPEN_ANIMATION_MS + 20);
  }
  panFacilityPopupIntoView(animate ? OFFICE_FORM_OPEN_ANIMATION_MS + 20 : 0);
}

/**
 * 작성 폼을 확인 없이 닫는다. reload 가 true 면(같은 시설물에서 폼만 닫을 때) 수정 중 지운 사진을
 * 반영하도록 카드 목록을 다시 불러온다 — 다른 시설물로 넘어가는 중에는 새 팝업에 옛 목록이 그려지므로 false.
 */
function closeOfficeWorkForm(reload = false) {
  if (!activeOfficeForm) return;
  const closingForm = activeOfficeForm;
  activeOfficeForm = null;

  const wasSide = closingForm.mode === "side";
  closingForm.dispose(reload);
  closingForm.panel.remove();

  const popupEl = document.getElementById("facility-popup");
  const mainEl = document.getElementById("facilityPopupMain");
  if (popupEl) popupEl.classList.remove("has-office-side", "has-office-inline");
  if (mainEl) mainEl.style.width = "";
  if (wasSide || reload) panFacilityPopupIntoView();
}

// 작성 중인 내용(바뀐 값·새로 고른 사진)이 있으면 버려도 되는지 묻는다. 폼이 없거나 바뀐 게 없으면 true
function confirmDiscardOfficeForm() {
  if (!activeOfficeForm || !activeOfficeForm.isDirty()) return true;
  return window.confirm(OFFICE_FORM_DISCARD_MESSAGE);
}

/**
 * 내업 작성/수정 폼 열기
 */
function openOfficeWorkForm(totalId, editItem = null) {
  // 이미 열린 폼(다른 기록 수정 등)에 작성 중인 내용이 있으면 먼저 확인
  if (!confirmDiscardOfficeForm()) return;
  closeOfficeWorkForm();

  const isEdit = Boolean(editItem && editItem.work_id);
  const formContainer = document.createElement("div");
  formContainer.className = "facility-office-form-panel";
  formContainer.id = "facilityOfficeFormPanel";
  formContainer.setAttribute("role", "region");
  formContainer.setAttribute("aria-label", isEdit ? "내업 수정" : "내업 작성");
  formContainer.innerHTML = `
    <div class="facility-office-form-header">
      <button type="button" class="facility-office-form-back" id="facilityOfficeFormBackBtn">← 상세로</button>
      <span class="facility-office-form-title">${isEdit ? "내업 수정" : "내업 작성"}</span>
      <button type="button" class="facility-office-form-close" id="facilityOfficeFormCloseBtn" title="닫기">×</button>
    </div>
    <form class="facility-office-form" id="facilityOfficeForm">
      <div class="facility-office-form-scroll">
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
        <div class="facility-office-form-group col-span-2 facility-office-photo-field" data-kind="BEFORE"></div>
        <div class="facility-office-form-group col-span-2 facility-office-photo-field" data-kind="AFTER"></div>
        <div class="facility-office-form-group col-span-2">
          <label for="officeRemark">비고</label>
          <textarea id="officeRemark" name="remark" placeholder="기타 비고사항"></textarea>
        </div>
      </div>
      </div>
      <div class="facility-office-form-progress hidden" id="facilityOfficeFormProgress"></div>
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
    remarkInput.value = editItem.remark || "";
    updateReqMark();
  }

  const showFormError = (message) => {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  };
  const clearFormError = () => {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  };

  // 처리 전·후 사진: 이미 저장된 사진(수정 시)과 저장 후 올릴 새 사진을 종류별로 관리한다
  const photoState = {};
  let photosChanged = false; // 수정 중 사진을 지웠으면 폼을 닫을 때 카드 목록을 다시 불러온다
  OFFICE_PHOTO_KINDS.forEach(({ kind }) => {
    photoState[kind] = { workId: isEdit ? editItem.work_id : null, existing: [], pending: [], loadError: false };
  });

  const renderPhotoFields = () => {
    formContainer.querySelectorAll(".facility-office-photo-field").forEach((fieldEl) => {
      renderOfficePhotoField(fieldEl, photoState[fieldEl.dataset.kind], {
        onAddFiles: (files) => addPendingPhotos(fieldEl.dataset.kind, files),
        onRemovePending: (pendingItem) => {
          const state = photoState[fieldEl.dataset.kind];
          state.pending = state.pending.filter((p) => p !== pendingItem);
          URL.revokeObjectURL(pendingItem.previewUrl);
          renderPhotoFields();
        },
        onDeleteExisting: (photo) => deleteExistingPhoto(fieldEl.dataset.kind, photo),
      });
    });
  };

  // 새로 고른 파일 검증(형식·장수) → 브라우저 축소 → 대기 목록에 추가. 서버는 저장 때 부른다
  const addPendingPhotos = async (kind, files) => {
    clearFormError();
    const state = photoState[kind];
    const kindLabel = getOfficePhotoKindLabel(kind);
    const invalid = files.filter((file) => !isAllowedOfficePhoto(file));
    if (invalid.length > 0) {
      showFormError(
        `jpg·png·webp 사진만 올릴 수 있습니다: ${invalid.map((file) => file.name).join(", ")}`
      );
      return;
    }
    const remain = OFFICE_PHOTO_MAX_COUNT - state.existing.length - state.pending.length;
    if (files.length > remain) {
      showFormError(
        `${kindLabel}은 최대 ${OFFICE_PHOTO_MAX_COUNT}장까지 올릴 수 있습니다 (추가 가능 ${Math.max(remain, 0)}장).`
      );
      return;
    }

    const failed = [];
    for (const file of files) {
      try {
        const resized = await resizeOfficePhoto(file);
        if (resized.size > OFFICE_PHOTO_MAX_BYTES) {
          failed.push(`${file.name} (10MB 초과)`);
          continue;
        }
        state.pending.push({ file: resized, previewUrl: URL.createObjectURL(resized) });
      } catch (err) {
        failed.push(`${file.name} (${err.message || "읽기 실패"})`);
      }
    }
    if (!formContainer.isConnected) return; // 준비 중에 폼이 닫힘
    renderPhotoFields();
    if (failed.length > 0) showFormError(`사진을 추가하지 못했습니다: ${failed.join(", ")}`);
  };

  const deleteExistingPhoto = async (kind, photo) => {
    if (!window.confirm("이 사진을 삭제하시겠습니까?\n저장 버튼과 상관없이 바로 삭제됩니다.")) return;
    clearFormError();
    try {
      await deleteOfficeWorkPhoto(editItem.work_id, photo.photo_id);
      const state = photoState[kind];
      state.existing = state.existing.filter((p) => p.photo_id !== photo.photo_id);
      photosChanged = true;
      renderPhotoFields();
    } catch (err) {
      console.error("사진 삭제 실패:", err);
      showFormError(err.message || "사진 삭제 중 오류가 발생했습니다.");
    }
  };

  renderPhotoFields();
  if (isEdit) {
    fetchOfficeWorkPhotos(editItem.work_id)
      .then((photos) => {
        if (!formContainer.isConnected) return;
        OFFICE_PHOTO_KINDS.forEach(({ kind }) => {
          photoState[kind].existing = photos.filter((p) => String(p.kind).toUpperCase() === kind);
        });
        renderPhotoFields();
      })
      .catch((err) => {
        console.warn("내업 사진 목록 조회 실패:", err.message);
        OFFICE_PHOTO_KINDS.forEach(({ kind }) => {
          photoState[kind].loadError = true;
        });
        renderPhotoFields();
      });
  }

  const revokePendingPhotos = () => {
    OFFICE_PHOTO_KINDS.forEach(({ kind }) => {
      photoState[kind].pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      photoState[kind].pending = [];
    });
  };

  // 이탈 확인용: 연 시점의 입력값(수정이면 채운 뒤)과 비교하고, 새로 고른 사진이 있으면 바뀐 것으로 본다.
  // 저장된 사진 삭제는 즉시 서버에 반영되므로 바뀐 값으로 치지 않는다.
  const readFormValues = () =>
    Array.from(formContainer.querySelectorAll("#facilityOfficeForm input:not([type=file]), #facilityOfficeForm select, #facilityOfficeForm textarea"))
      .map((el) => el.value)
      .join("");
  const initialValues = readFormValues();
  const isDirty = () =>
    readFormValues() !== initialValues ||
    OFFICE_PHOTO_KINDS.some(({ kind }) => photoState[kind].pending.length > 0);

  // 이 폼이 아직 열려 있을 때만 닫는다 (저장 중에 팝업을 닫거나 다른 폼을 열었으면 이미 닫힘)
  const closeThisForm = (reload) => {
    if (activeOfficeForm && activeOfficeForm.panel === formContainer) closeOfficeWorkForm(reload);
  };
  const requestCloseForm = () => {
    if (!confirmDiscardOfficeForm()) return;
    closeThisForm(true);
  };

  const closeBtn = formContainer.querySelector("#facilityOfficeFormCloseBtn");
  const backBtn = formContainer.querySelector("#facilityOfficeFormBackBtn");
  const cancelBtn = formContainer.querySelector("#facilityOfficeFormCancelBtn");
  closeBtn.addEventListener("click", requestCloseForm);
  backBtn.addEventListener("click", requestCloseForm);
  cancelBtn.addEventListener("click", requestCloseForm);

  // 칸 안의 입력·버튼 조작이 헤더 드래그나 지도 제스처로 번지지 않게 한다
  formContainer.addEventListener("pointerdown", (event) => event.stopPropagation());
  // 오른쪽 칸 헤더를 잡아도 팝업 전체를 옮길 수 있게 한다 (버튼 위에서 시작한 드래그는 제외)
  bindOverlayHeaderDrag(facilityOverlay, formContainer.querySelector(".facility-office-form-header"), {
    ignoreSelector: ".facility-office-form-close, .facility-office-form-back",
  });

  activeOfficeForm = {
    panel: formContainer,
    mode: null,
    isDirty,
    dispose: (reload) => {
      revokePendingPhotos();
      if (reload && photosChanged) loadFacilityOfficeWorks(totalId);
    },
  };
  applyOfficeFormLayout();

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
      // 예전 텍스트 경로 컬럼은 입력란을 없앴으므로 수정 시 기존 값을 그대로 보존한다 (PUT 은 전체 갱신)
      before_photo: (isEdit && editItem.before_photo) || null,
      after_photo: (isEdit && editItem.after_photo) || null,
      remark: remarkVal || null,
    };

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.textContent = "저장 중...";

    let saved;
    try {
      saved = isEdit
        ? await updateFacilityOfficeWork(editItem.work_id, payload)
        : await createFacilityOfficeWork(totalId, payload);
    } catch (err) {
      console.error("내업 처리 저장 실패:", err);
      showFormError(err.message || "저장 중 오류가 발생했습니다. 다시 시도해 주세요.");
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.textContent = "저장";
      return;
    }

    // 기록이 저장된 뒤(work_id 확보) 고른 사진을 순서대로 올린다
    const workId = isEdit ? editItem.work_id : saved && saved.work_id;
    const uploads = [];
    OFFICE_PHOTO_KINDS.forEach(({ kind }) => {
      photoState[kind].pending.forEach((p) => uploads.push({ kind, file: p.file }));
    });
    const failedUploads = [];
    if (uploads.length > 0) {
      const progressEl = formContainer.querySelector("#facilityOfficeFormProgress");
      for (let i = 0; i < uploads.length; i++) {
        const { kind, file } = uploads[i];
        if (progressEl) {
          progressEl.textContent = `사진 업로드 중 ${i + 1} / ${uploads.length} (${getOfficePhotoKindLabel(kind)} · ${file.name})`;
          progressEl.classList.remove("hidden");
        }
        submitBtn.textContent = `사진 업로드 ${i + 1}/${uploads.length}`;
        try {
          if (!workId) throw new Error("저장된 기록 번호를 확인하지 못했습니다");
          await uploadOfficeWorkPhoto(workId, kind, file);
        } catch (err) {
          console.error("내업 사진 업로드 실패:", err);
          failedUploads.push(`${getOfficePhotoKindLabel(kind)} ${file.name} — ${err.message}`);
        }
      }
    }

    // 저장이 끝나면 칸을 닫는다 (확인 없이). 목록은 아래에서 어차피 다시 불러온다
    closeThisForm(false);
    await loadFacilityOfficeWorks(totalId);
    if (failedUploads.length > 0) {
      showFacilityOfficeNotice(
        `내업 기록은 저장되었습니다. 다만 사진 ${failedUploads.length}장을 올리지 못했습니다 — 수정에서 다시 올려 주세요.`,
        failedUploads
      );
    }
  });
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

  // 보고서 PDF — 완료·보류 기록에만 (백엔드도 그 외 상태는 거부한다)
  if (statusKey === "DONE" || statusKey === "HOLD") {
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "facility-office-card-btn btn-report";
    reportBtn.textContent = "보고서";
    reportBtn.title = "시설물 정보와 내업 처리 내용을 PDF로 내려받습니다";
    reportBtn.addEventListener("click", () => downloadOfficeWorkReport(totalId, item, reportBtn));
    actions.appendChild(reportBtn);
  }

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
    hideFacilityOfficeNotice();
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

  // 업로드한 처리 전·후 사진 썸네일 (최신 카드는 바로, 이전 이력은 펼칠 때 조회)
  const photoWrap = document.createElement("div");
  photoWrap.className = "facility-office-photos hidden";
  photoWrap.dataset.workId = item.work_id || "";
  card.appendChild(photoWrap);
  if (isLatest) loadOfficeWorkCardPhotos(photoWrap, item.work_id);

  // 예전 텍스트 경로(before_photo/after_photo)로 남은 사진 링크 표시
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
      if (!isHidden) {
        historyList.querySelectorAll(".facility-office-photos").forEach((photoWrap) => {
          loadOfficeWorkCardPhotos(photoWrap, photoWrap.dataset.workId);
        });
      }
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
    refreshFacilityLayer();
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
/**
 * 응답 헤더에서 파일명을 얻는다. filename*=UTF-8''... 를 우선 쓰고, 없으면 filename="..." 을 쓴다.
 * 둘 다 없거나 파싱에 실패하면 null 을 돌려주고 호출부가 대체 이름을 만든다.
 */
function parseContentDispositionFileName(disposition) {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch (e) {
      // 잘못 인코딩된 값이면 아래 filename= 으로 넘어간다
    }
  }
  const plainMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plainMatch ? plainMatch[1].trim() : null;
}

/**
 * 내업 보고서 PDF 다운로드 (GET /map/qfield/facilities/{totalId}/report/pdf?workId=)
 *
 * 새 탭으로 열면 브라우저 뷰어가 뜨고 파일명이 사라지므로, 받아서 Blob 으로 저장한다.
 * 사진이 많으면 몇 초 걸릴 수 있어 버튼을 잠그고 진행 상태를 보여준다.
 */
async function downloadOfficeWorkReport(totalId, item, buttonEl) {
  hideFacilityOfficeNotice();
  const originalText = buttonEl ? buttonEl.textContent : "";
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "만드는 중...";
  }

  let objectUrl = null;
  try {
    const url = getApiUrl(
      `/map/qfield/facilities/${encodeURIComponent(totalId)}/report/pdf?workId=${encodeURIComponent(item.work_id)}`
    );
    const response = await fetch(url);

    if (!response.ok) {
      const serverMessage = await readApiErrorMessage(response);
      if (response.status === 404) {
        throw new Error("보고서를 만들 기록을 찾을 수 없습니다.");
      }
      if (response.status === 400 || response.status === 409) {
        throw new Error(serverMessage || "완료 또는 보류 상태에서만 보고서를 만들 수 있습니다.");
      }
      throw new Error(serverMessage || `보고서 생성 실패 (${response.status})`);
    }

    const blob = await response.blob();
    const fallbackDate = item.complete_date || new Date().toISOString().slice(0, 10);
    const fileName =
      parseContentDispositionFileName(response.headers.get("Content-Disposition")) ||
      `내업보고서_${totalId}_${fallbackDate}.pdf`;

    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error("내업 보고서 다운로드 오류:", error);
    showFacilityOfficeNotice(error.message || "보고서를 내려받지 못했습니다.");
  } finally {
    // 브라우저가 저장을 시작할 시간을 준 뒤 해제한다
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText || "보고서";
    }
  }
}

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

/**
 * 팝업 닫기. 작성 중인 내업 내용이 있으면 확인을 받고, 취소하면 닫지 않고 false 를 돌려준다.
 * 데이터 재조회·필터 변경처럼 사용자가 팝업을 직접 닫는 게 아닌 경우는 force 로 확인 없이 닫는다.
 */
function closeFacilityPopup(options = {}) {
  const force = Boolean(options && options.force);
  if (!force && !confirmDiscardOfficeForm()) return false;
  closeOfficeWorkForm();

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
    refreshFacilityLayer();
  }
  return true;
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

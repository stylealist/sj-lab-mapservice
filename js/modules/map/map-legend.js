// 지도 범례 모듈 — 지도 왼쪽 아래에 지금 보이는 것들의 기호를 설명한다.
//
// 규칙
//  - 시설물은 켜고 끄는 기능이 없어 **항상** 표시한다(상태 색 + 종류 아이콘, 묶어 보기가 켜져 있으면 묶음 배지).
//  - 그 밖의 레이어(WFS 편의점·버스정류장·CCTV·약국·병원·관공서, WMS)는 **켠 것만** 표시한다.
//  - 아이콘은 지도에서 쓰는 것을 그대로 가져오므로(각 모듈의 get*LegendItems), 아이콘·색 규칙을 바꾸면 범례도 따라 바뀐다.
//  - 머리글을 잡아 끌면 옮길 수 있고(4px 미만은 접기/펼치기 클릭으로 처리), 옮긴 자리는 localStorage 에 기억한다.
import { getMap } from "./map-core.js";
import { getFacilityLegendItems } from "./map-facility.js";
import { getWfsLegendItems } from "./map-wfs.js";
import { getWmsLegendItems } from "./map-wms.js";

const LEGEND_OPEN_STORAGE_KEY = "sjLabMapLegendOpen";
// 화면 아래 끝과 범례 사이 여백(px)
const LEGEND_BOTTOM_GAP = 16;
// 옮긴 자리를 기억하는 키
const LEGEND_POS_STORAGE_KEY = "sjLabMapLegendPos";
// 이만큼(px) 넘게 움직였을 때만 "끌었다"로 보고, 그 미만이면 접기/펼치기 클릭으로 본다
const LEGEND_DRAG_THRESHOLD = 4;
// 지도 가장자리와 범례 사이 최소 여백(px)
const LEGEND_EDGE_MARGIN = 8;

let legendInitialized = false;
let legendRefreshTimer = null;
// 사용자가 끌어다 놓은 자리 (지도 컨테이너 기준 left/top, 없으면 기본 자리)
let legendCustomPosition = null;
// 직전에 그린 공공데이터 레이어 키 목록 (새로 켜진 것이 있는지 비교용, 첫 렌더는 null)
let lastOverlayKeys = null;
// change:visible 리스너를 붙여 둔 레이어 (중복 등록 방지)
const watchedLayers = new WeakSet();

/** 펼침 상태 기억 (localStorage 를 못 써도 기본값 펼침으로 동작) */
function readLegendOpenPreference() {
  try {
    return window.localStorage.getItem(LEGEND_OPEN_STORAGE_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

function saveLegendOpenPreference(isOpen) {
  try {
    window.localStorage.setItem(LEGEND_OPEN_STORAGE_KEY, isOpen ? "on" : "off");
  } catch (e) {
    // 저장을 못 해도 이번 세션 동안은 동작한다
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLegendItem(item) {
  // 아이콘 크기가 제각각이라 같은 크기의 칸에 담아 줄을 맞춘다
  const icon = item.icon
    ? `<img class="map-legend-icon" src="${escapeHtml(item.icon)}" alt="" aria-hidden="true" />`
    : '<span class="map-legend-icon-blank" aria-hidden="true"></span>';
  return (
    `<li class="map-legend-item">` +
    `<span class="map-legend-icon-slot">${icon}</span>` +
    `<span class="map-legend-label">${escapeHtml(item.label)}</span>` +
    `</li>`
  );
}

function renderLegendSection(title, items, listClass = "") {
  if (!items || items.length === 0) return "";
  const listClassAttr = listClass ? ` ${listClass}` : "";
  return (
    `<div class="map-legend-section">` +
    `<p class="map-legend-section-title">${escapeHtml(title)}</p>` +
    `<ul class="map-legend-list${listClassAttr}">${items.map(renderLegendItem).join("")}</ul>` +
    `</div>`
  );
}

/** 지금 상태로 범례 내용을 다시 그린다 */
function refreshMapLegend() {
  const body = document.getElementById("mapLegendBody");
  if (!body) return;

  const facility = getFacilityLegendItems();

  let overlayItems = [];
  try {
    overlayItems = overlayItems.concat(getWfsLegendItems());
  } catch (e) {
    console.warn("범례: WFS 레이어 목록을 읽지 못했습니다.", e);
  }
  try {
    overlayItems = overlayItems.concat(getWmsLegendItems());
  } catch (e) {
    console.warn("범례: WMS 레이어 목록을 읽지 못했습니다.", e);
  }

  // 항상 있는 시설물 설명(상태 → 종류)을 먼저 두고, 켜고 끌 때마다 나타났다 사라지는
  // 공공데이터 레이어를 **맨 아래**에 둔다. 중간에 넣으면 레이어를 켤 때마다 아래 내용이
  // 밀려 내려가 자리가 흔들린다.
  const html =
    renderLegendSection("시설물 상태", facility.states) +
    renderLegendSection("시설물 종류", facility.types, "map-legend-list-grid") +
    renderLegendSection("공공데이터 레이어", overlayItems);

  body.innerHTML = html;
  positionLegendAboveViewportBottom();

  // 레이어를 새로 켰으면 그 항목이 보이도록 아래로 내려 준다(맨 아래에 붙어 있어 가려질 수 있음)
  const overlayKeys = overlayItems.map((item) => item.key).join("|");
  const hasNewOverlay =
    lastOverlayKeys !== null &&
    overlayItems.some((item) => !lastOverlayKeys.includes(item.key));
  lastOverlayKeys = overlayItems.map((item) => item.key);

  if (hasNewOverlay && overlayKeys) scrollLegendToBottom(body);
}

/** 새로 켠 레이어가 보이도록 범례 본문을 아래로 */
function scrollLegendToBottom(body) {
  if (body.scrollHeight <= body.clientHeight) return;

  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    body.scrollTo({ top: body.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  } catch (e) {
    body.scrollTop = body.scrollHeight;
  }
}

/** 같은 프레임에 여러 번 불려도 한 번만 그리도록 묶는다 */
function scheduleLegendRefresh() {
  if (legendRefreshTimer) return;
  legendRefreshTimer = window.setTimeout(() => {
    legendRefreshTimer = null;
    refreshMapLegend();
  }, 50);
}

/** 레이어 하나의 가시성 변화를 지켜본다 */
function watchLayer(layer) {
  if (!layer || typeof layer.on !== "function" || watchedLayers.has(layer)) return;
  watchedLayers.add(layer);
  layer.on("change:visible", scheduleLegendRefresh);
}

/** 지도에 올라와 있는 레이어 전부와, 앞으로 추가될 레이어까지 지켜본다 */
function watchMapLayers() {
  const map = getMap();
  if (!map || !map.getLayers) return;

  const layers = map.getLayers();
  layers.forEach(watchLayer);
  layers.on("add", (event) => {
    watchLayer(event.element);
    scheduleLegendRefresh();
  });
  layers.on("remove", scheduleLegendRefresh);
}

/**
 * 지도 컨테이너는 헤더 높이만큼 화면 아래로 넘쳐 있다(`.main-content`가 헤더 아래에서 시작하는데 높이는 100vh).
 * 그래서 컨테이너 기준 `bottom`만 주면 범례가 화면 밖으로 잘린다 — 넘친 만큼을 재서 더해 준다.
 */
function positionLegendAboveViewportBottom() {
  const legend = document.getElementById("mapLegend");
  const container = legend && legend.parentElement;
  if (!legend || !container) return;

  // 사용자가 옮겨 둔 자리가 있으면 그 자리를 유지한다(화면 밖으로 나가지 않게만 다시 맞춤)
  if (legendCustomPosition) {
    applyLegendPosition(legendCustomPosition);
    return;
  }

  const overflow = Math.max(0, Math.round(container.getBoundingClientRect().bottom - window.innerHeight));
  legend.style.bottom = `${overflow + LEGEND_BOTTOM_GAP}px`;
}

/** 저장해 둔 위치 읽기 (형식이 깨졌으면 무시하고 기본 자리) */
function readLegendPosition() {
  try {
    const raw = window.localStorage.getItem(LEGEND_POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    return { left: parsed.left, top: parsed.top };
  } catch (e) {
    return null;
  }
}

function saveLegendPosition(position) {
  try {
    window.localStorage.setItem(LEGEND_POS_STORAGE_KEY, JSON.stringify(position));
  } catch (e) {
    // 저장을 못 해도 이번 세션 동안은 옮긴 자리가 유지된다
  }
}

/**
 * 지도 안(그리고 화면 안)에 머무르도록 좌표를 다듬는다.
 * 지도 컨테이너는 헤더 높이만큼 화면 아래로 넘쳐 있으므로 아래쪽 한계는 화면 기준으로 잡는다.
 */
function clampLegendPosition(position) {
  const legend = document.getElementById("mapLegend");
  const container = legend && legend.parentElement;
  if (!legend || !container) return position;

  const containerRect = container.getBoundingClientRect();
  const legendRect = legend.getBoundingClientRect();
  const visibleBottom = Math.min(containerRect.height, window.innerHeight - containerRect.top);

  const maxLeft = Math.max(LEGEND_EDGE_MARGIN, containerRect.width - legendRect.width - LEGEND_EDGE_MARGIN);
  const maxTop = Math.max(LEGEND_EDGE_MARGIN, visibleBottom - legendRect.height - LEGEND_EDGE_MARGIN);

  return {
    left: Math.round(Math.min(Math.max(position.left, LEGEND_EDGE_MARGIN), maxLeft)),
    top: Math.round(Math.min(Math.max(position.top, LEGEND_EDGE_MARGIN), maxTop)),
  };
}

/** 옮긴 자리를 실제로 적용 (기본 자리의 left/bottom 대신 left/top 으로 붙인다) */
function applyLegendPosition(position) {
  const legend = document.getElementById("mapLegend");
  if (!legend) return;

  const clamped = clampLegendPosition(position);
  legendCustomPosition = clamped;
  legend.style.left = `${clamped.left}px`;
  legend.style.top = `${clamped.top}px`;
  legend.style.bottom = "auto";
}

/** 머리글을 잡아 끌어 범례를 옮긴다. 살짝만 눌렀다 떼면 접기/펼치기로 넘긴다. */
function bindLegendDrag(legend, head) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  const onPointerMove = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.abs(dx) < LEGEND_DRAG_THRESHOLD && Math.abs(dy) < LEGEND_DRAG_THRESHOLD) return;

    if (!moved) {
      moved = true;
      legend.classList.add("is-dragging");
    }
    applyLegendPosition({ left: startLeft + dx, top: startTop + dy });
  };

  const onPointerUp = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    try {
      head.releasePointerCapture(pointerId);
    } catch (e) {
      // 이미 해제된 경우 무시
    }
    pointerId = null;

    if (moved) {
      legend.classList.remove("is-dragging");
      if (legendCustomPosition) saveLegendPosition(legendCustomPosition);
      // 끌고 난 직후의 click 은 접기/펼치기로 치지 않는다
      legend.dataset.suppressToggle = "1";
      window.setTimeout(() => {
        delete legend.dataset.suppressToggle;
      }, 0);
    }
  };

  head.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;

    const containerRect = legend.parentElement.getBoundingClientRect();
    const legendRect = legend.getBoundingClientRect();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = legendRect.left - containerRect.left;
    startTop = legendRect.top - containerRect.top;
    moved = false;

    try {
      head.setPointerCapture(pointerId);
    } catch (e) {
      // 캡처를 못 해도 window 리스너로 처리된다
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    // 지도로 드래그가 새지 않게 (지도가 같이 끌려 가는 것 방지)
    event.stopPropagation();
  });
}

function bindLegendToggle() {
  const legend = document.getElementById("mapLegend");
  const toggle = document.getElementById("mapLegendToggle");
  if (!legend || !toggle) return;

  const applyOpenState = (isOpen) => {
    legend.classList.toggle("is-collapsed", !isOpen);
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.title = isOpen ? "범례 접기" : "범례 펼치기";
  };

  applyOpenState(readLegendOpenPreference());

  toggle.addEventListener("click", () => {
    // 방금 끌어서 옮긴 것이라면 접기/펼치기로 치지 않는다
    if (legend.dataset.suppressToggle) return;

    const willOpen = legend.classList.contains("is-collapsed");
    applyOpenState(willOpen);
    saveLegendOpenPreference(willOpen);
    // 접거나 펼치면 높이가 달라지므로 화면 안에 들어오도록 다시 맞춘다(애니메이션 뒤)
    window.setTimeout(positionLegendAboveViewportBottom, 260);
  });

  bindLegendDrag(legend, toggle);
}

/**
 * 범례 초기화 — 지도·WFS·WMS·시설물 모듈이 만들어진 뒤에 부른다.
 * 중복 호출은 무시한다(모듈 재초기화 가드와 같은 규칙).
 */
function initializeMapLegend() {
  if (legendInitialized) {
    scheduleLegendRefresh();
    return;
  }

  const legend = document.getElementById("mapLegend");
  if (!legend) {
    console.warn("범례: #mapLegend 요소를 찾을 수 없습니다.");
    return;
  }

  bindLegendToggle();
  watchMapLayers();

  // 지난번에 옮겨 둔 자리가 있으면 그대로 복원한다
  const savedPosition = readLegendPosition();
  if (savedPosition) applyLegendPosition(savedPosition);

  positionLegendAboveViewportBottom();
  window.addEventListener("resize", positionLegendAboveViewportBottom);

  // 시설물 아이콘 설정(DB)이 늦게 오거나 핀 묶어 보기를 켜고 끄면 다시 그린다
  document.addEventListener("sjlab:facility-legend-changed", scheduleLegendRefresh);

  legendInitialized = true;
  refreshMapLegend();
}

export { initializeMapLegend, refreshMapLegend };

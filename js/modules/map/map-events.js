// 맵 이벤트 관리 모듈
import { getMap } from "./map-core.js";

// 이벤트 리스너 저장소
let eventListeners = new Map();

// 이벤트 타입별 리스너 등록 함수들
const MapEventManager = {
  // 줌 변경 이벤트 등록
  registerZoomHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const zoomListener = existingListeners.find(
        (listener) => listener.type === "change:resolution"
      );
      if (zoomListener) {
        console.log(`줌 변경 이벤트 리스너가 이미 등록되어 있습니다: ${id}`);
        return;
      }
    }

    const listener = function () {
      const currentZoom = map.getView().getZoom();
      handler(currentZoom);
    };

    map.getView().on("change:resolution", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "change:resolution",
      listener: listener,
      target: map.getView(),
    });

    console.log(`줌 변경 이벤트 리스너 등록: ${id}`);
  },

  // 지도 이동 이벤트 등록
  registerMoveHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const moveListener = existingListeners.find(
        (listener) => listener.type === "moveend"
      );
      if (moveListener) {
        console.log(`지도 이동 이벤트 리스너가 이미 등록되어 있습니다: ${id}`);
        return;
      }
    }

    const listener = function () {
      const currentExtent = map.getView().calculateExtent(map.getSize());
      handler(currentExtent);
    };

    map.on("moveend", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "moveend",
      listener: listener,
      target: map,
    });

    console.log(`지도 이동 이벤트 리스너 등록: ${id}`);
  },

  // 클릭 이벤트 등록
  registerClickHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const clickListener = existingListeners.find(
        (listener) => listener.type === "click"
      );
      if (clickListener) {
        console.log(`클릭 이벤트 리스너가 이미 등록되어 있습니다: ${id}`);
        return;
      }
    }

    const listener = function (evt) {
      handler(evt);
    };

    map.on("click", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "click",
      listener: listener,
      target: map,
    });

    console.log(`클릭 이벤트 리스너 등록: ${id}`);
  },

  // 싱글클릭 이벤트 등록
  registerSingleClickHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const singleClickListener = existingListeners.find(
        (listener) => listener.type === "singleclick"
      );
      if (singleClickListener) {
        console.log(`싱글클릭 이벤트 리스너가 이미 등록되어 있습니다: ${id}`);
        return;
      }
    }

    const listener = function (evt) {
      handler(evt);
    };

    map.on("singleclick", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "singleclick",
      listener: listener,
      target: map,
    });

    console.log(`싱글클릭 이벤트 리스너 등록: ${id}`);
  },

  // 포인터 이동 이벤트 등록
  registerPointerMoveHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const pointerMoveListener = existingListeners.find(
        (listener) => listener.type === "pointermove"
      );
      if (pointerMoveListener) {
        console.log(
          `포인터 이동 이벤트 리스너가 이미 등록되어 있습니다: ${id}`
        );
        return;
      }
    }

    const listener = function (evt) {
      handler(evt);
    };

    map.on("pointermove", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "pointermove",
      listener: listener,
      target: map,
    });

    console.log(`포인터 이동 이벤트 리스너 등록: ${id}`);
  },

  // 컨텍스트 메뉴 이벤트 등록
  registerContextMenuHandler: function (id, handler) {
    const map = getMap();
    if (!map) return;

    // 이미 등록된 리스너가 있는지 확인
    if (eventListeners.has(id)) {
      const existingListeners = eventListeners.get(id);
      const contextMenuListener = existingListeners.find(
        (listener) => listener.type === "contextmenu"
      );
      if (contextMenuListener) {
        console.log(
          `컨텍스트 메뉴 이벤트 리스너가 이미 등록되어 있습니다: ${id}`
        );
        return;
      }
    }

    const listener = function (evt) {
      handler(evt);
    };

    map.on("contextmenu", listener);

    // 리스너 저장
    if (!eventListeners.has(id)) {
      eventListeners.set(id, []);
    }
    eventListeners.get(id).push({
      type: "contextmenu",
      listener: listener,
      target: map,
    });

    console.log(`컨텍스트 메뉴 이벤트 리스너 등록: ${id}`);
  },

  // 특정 ID의 모든 이벤트 리스너 제거
  unregisterHandler: function (id) {
    if (!eventListeners.has(id)) {
      console.log(`등록되지 않은 이벤트 ID: ${id}`);
      return;
    }

    const listeners = eventListeners.get(id);
    listeners.forEach(({ target, listener, type }) => {
      target.un(type, listener);
    });

    eventListeners.delete(id);
    console.log(`이벤트 리스너 제거: ${id}`);
  },

  // 모든 이벤트 리스너 제거
  unregisterAllHandlers: function () {
    eventListeners.forEach((listeners, id) => {
      listeners.forEach(({ target, listener, type }) => {
        target.un(type, listener);
      });
    });

    eventListeners.clear();
    console.log("모든 이벤트 리스너 제거됨");
  },

  // 등록된 이벤트 리스너 목록 조회
  getRegisteredHandlers: function () {
    const handlers = [];
    eventListeners.forEach((listeners, id) => {
      listeners.forEach(({ type }) => {
        handlers.push({ id, type });
      });
    });
    return handlers;
  },

  // 특정 ID의 이벤트 리스너 존재 여부 확인
  hasHandler: function (id) {
    return eventListeners.has(id);
  },

  // 디버깅: 현재 등록된 모든 이벤트 리스너 정보 출력
  debugHandlers: function () {
    console.log("=== 등록된 이벤트 리스너 목록 ===");
    eventListeners.forEach((listeners, id) => {
      console.log(`ID: ${id}`);
      listeners.forEach((listener, index) => {
        console.log(
          `  ${index + 1}. Type: ${listener.type}, Target: ${
            listener.target.constructor.name
          }`
        );
      });
    });
    console.log("================================");
  },
};

// 전역 객체에 등록
window.MapEventManager = MapEventManager;

export { MapEventManager };

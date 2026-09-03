// map-core.js의 initializeMap() 단위 테스트
//
// 이 프로젝트는 npm/번들러가 없고, OpenLayers(`ol`)는 브라우저에서 <script> 태그로
// 전역에 로드된다. Node에서 테스트하기 위해 initializeMap()이 실제로 사용하는
// ol.* / document / window API만 최소한으로 흉내낸 가짜 객체를 주입한다.
// (`node --test js/modules/map/map-core.test.js` 로 실행, 별도 설치 불필요)

import test from "node:test";
import assert from "node:assert/strict";

class FakeTileLayer {
  constructor(options) {
    this.options = options;
    this._visible = options.visible;
  }
  getVisible() {
    return this._visible;
  }
  setVisible(v) {
    this._visible = v;
  }
}

class FakeXYZSource {
  constructor(options) {
    this.options = options;
  }
}

class FakeView {
  constructor(options) {
    this.options = options;
  }
  getCenter() {
    return this.options.center;
  }
  getZoom() {
    return this.options.zoom;
  }
}

class FakeMap {
  constructor(options) {
    this.options = options;
    this._handlers = {};
  }
  on(type, cb) {
    (this._handlers[type] ??= []).push(cb);
  }
  once(type, cb) {
    (this._handlers[type] ??= []).push(cb);
  }
  getView() {
    return this.options.view;
  }
}

function installOlStub() {
  globalThis.ol = {
    layer: { Tile: FakeTileLayer },
    source: { XYZ: FakeXYZSource },
    Map: FakeMap,
    View: FakeView,
    control: {
      Zoom: class {
        constructor(options) {
          this.options = options;
        }
      },
      Attribution: class {
        constructor(options) {
          this.options = options;
        }
      },
    },
    interaction: {
      DragPan: class {},
      DoubleClickZoom: class {},
      MouseWheelZoom: class {},
    },
    proj: {
      // 실제 좌표 변환 대신, 어떤 좌표로 호출됐는지 검증할 수 있도록 원본 좌표를 보존한다.
      fromLonLat: (coord) => ({ __fromLonLat: coord }),
      toLonLat: (coord) => coord,
    },
  };
}

class FakeElement {
  constructor() {
    this.classList = {
      added: [],
      add(c) {
        this.added.push(c);
      },
    };
    this._listeners = {};
  }
  addEventListener(type, cb) {
    (this._listeners[type] ??= []).push(cb);
  }
  fire(type, evt) {
    (this._listeners[type] || []).forEach((cb) => cb(evt));
  }
}

// 매 테스트마다 새 DOM 요소를 만들어 document.getElementById/querySelector로 연결한다.
function installDomStub({ withMapElement = true, withContainer = true } = {}) {
  const els = {
    map: withMapElement ? new FakeElement() : null,
    header: new FakeElement(),
    mapContainer: withContainer ? new FakeElement() : null,
    mainContent: new FakeElement(),
  };
  globalThis.document = {
    getElementById: (id) =>
      id === "map" ? els.map : id === "header" ? els.header : null,
    querySelector: (sel) =>
      sel === ".map-container"
        ? els.mapContainer
        : sel === ".main-content"
        ? els.mainContent
        : null,
  };
  return els;
}

function fakeEvent() {
  return {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

installOlStub();
globalThis.window = globalThis; // 브라우저와 동일하게 window === globalThis로 맞춘다.

const { initializeMap, getMap } = await import("./map-core.js");

test("initializeMap: 배경/오버레이 레이어를 올바르게 구성한다", () => {
  installDomStub();
  const map = initializeMap();

  assert.equal(window.baseLayers.common.getVisible(), true);
  assert.equal(window.baseLayers.satellite.getVisible(), false);
  assert.equal(window.overlayLayers.hybrid.getVisible(), false);

  assert.match(
    window.baseLayers.common.options.source.options.url,
    /\/2d\/Base\/service\//
  );
  assert.match(
    window.baseLayers.satellite.options.source.options.url,
    /\/2d\/Satellite\/service\//
  );
  assert.match(
    window.overlayLayers.hybrid.options.source.options.url,
    /\/2d\/Hybrid\/service\//
  );

  // 배경 2개 + 오버레이 1개 = 총 3개 레이어가 ol.Map에 전달돼야 한다.
  assert.equal(map.options.layers.length, 3);
  assert.deepEqual(window.measureLayers, []);
});

test("initializeMap: 서울 중심, 줌 7~19 범위로 뷰를 생성한다", () => {
  installDomStub();
  const map = initializeMap();
  const view = map.getView();

  assert.deepEqual(view.getCenter(), { __fromLonLat: [127.0, 37.5] });
  assert.equal(view.getZoom(), 10);
  assert.equal(view.options.maxZoom, 19);
  assert.equal(view.options.minZoom, 7);
});

test("initializeMap: getMap()이 initializeMap()과 동일한 인스턴스를 반환한다", () => {
  installDomStub();
  const map = initializeMap();
  assert.equal(getMap(), map);
});

test("initializeMap: #map, .map-container 우클릭 시 브라우저 기본 메뉴를 막는다", () => {
  const els = installDomStub();
  initializeMap();

  const mapEvt = fakeEvent();
  els.map.fire("contextmenu", mapEvt);
  assert.equal(mapEvt.prevented, true);
  assert.equal(mapEvt.stopped, true);

  const containerEvt = fakeEvent();
  els.mapContainer.fire("contextmenu", containerEvt);
  assert.equal(containerEvt.prevented, true);
  assert.equal(containerEvt.stopped, true);
});

test("initializeMap: pointermove/postrender 이벤트 핸들러를 등록한다", () => {
  installDomStub();
  const map = initializeMap();
  assert.equal(map._handlers.pointermove.length, 1);
  assert.equal(map._handlers.postrender.length, 1);
});

test("initializeMap: #map 또는 .map-container가 없어도 예외 없이 동작한다", () => {
  installDomStub({ withMapElement: false, withContainer: false });
  assert.doesNotThrow(() => initializeMap());
});

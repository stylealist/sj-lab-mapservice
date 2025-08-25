// 맵 측정 도구 모듈
import { getMap } from "./map-core.js";
import { MapEventManager } from "./map-events.js";

// 측정 도구 이벤트 리스너 관리
function registerMeasureEventListeners() {
  // 컨텍스트 메뉴 이벤트 등록
  MapEventManager.registerContextMenuHandler(
    "measure-contextmenu",
    cancelMeasurement
  );

  // 포인터 이동 이벤트 등록
  MapEventManager.registerPointerMoveHandler(
    "measure-pointermove",
    moveListener
  );

  // 클릭 이벤트 등록
  MapEventManager.registerClickHandler("measure-click", clickListener);

  // 각도 측정 완료 이벤트 등록
  MapEventManager.registerClickHandler("measure-angle-finish", finishAngle);

  // 반경 측정 완료 이벤트 등록
  MapEventManager.registerClickHandler("measure-radius-finish", finishRadius);

  // 사전 이동 리스너 등록
  MapEventManager.registerPointerMoveHandler(
    "measure-pre-move",
    preMoveListener
  );

  // 완료된 측정 취소 이벤트 등록
  MapEventManager.registerContextMenuHandler(
    "measure-completed-cancel",
    completedCancelMeasurement
  );
}

function unregisterMeasureEventListeners() {
  // 모든 측정 관련 이벤트 리스너 제거
  MapEventManager.unregisterHandler("measure-contextmenu");
  MapEventManager.unregisterHandler("measure-pointermove");
  MapEventManager.unregisterHandler("measure-click");
  MapEventManager.unregisterHandler("measure-angle-finish");
  MapEventManager.unregisterHandler("measure-radius-finish");
  MapEventManager.unregisterHandler("measure-pre-move");
  MapEventManager.unregisterHandler("measure-completed-cancel");
}

// 측정 도구 관련 변수들
let measureInteraction = null;
let measureLayer = null;
let currentMeasureType = null;
let measureSource = null;
let measureOverlays = []; // 여러 팝업 오버레이를 관리
let measureFeatures = []; // 측정된 피처들을 관리

// 측정 도구 초기화
function initializeMeasureTools() {
  const map = getMap();

  // 측정용 벡터 레이어 생성
  measureSource = new ol.source.Vector();
  measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "#ff0000",
        width: 2,
      }),
      fill: new ol.style.Fill({
        color: "rgba(255, 0, 0, 0.1)",
      }),
      image: new ol.style.Circle({
        radius: 7,
        fill: new ol.style.Fill({
          color: "#ff0000",
        }),
        stroke: new ol.style.Stroke({
          color: "#ffffff",
          width: 2,
        }),
      }),
    }),
  });

  // 맵에 측정 레이어 추가
  map.addLayer(measureLayer);

  // 전역 측정 레이어 배열에 추가
  if (window.measureLayers) {
    window.measureLayers.push(measureLayer);
  }

  // 측정 완료 시 스타일 적용
  const measureStyle = function (feature) {
    const geometry = feature.getGeometry();
    const type = geometry.getType();

    let style;
    if (type === "Point") {
      style = new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7,
          fill: new ol.style.Fill({
            color: "#ff0000",
          }),
          stroke: new ol.style.Stroke({
            color: "#ffffff",
            width: 2,
          }),
        }),
      });
    } else if (type === "LineString") {
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#ff0000",
          width: 2,
        }),
      });
    } else if (type === "Polygon") {
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#ff0000",
          width: 2,
        }),
        fill: new ol.style.Fill({
          color: "rgba(255, 0, 0, 0.1)",
        }),
      });
    } else if (type === "Circle") {
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#ff0000",
          width: 2,
        }),
        fill: new ol.style.Fill({
          color: "rgba(255, 0, 0, 0.1)",
        }),
      });
    } else {
      // 기본 스타일 (기타 지오메트리 타입)
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#ff0000",
          width: 2,
        }),
      });
    }

    return style;
  };

  // 측정 중인 스타일
  const measureStyleFunction = function (feature) {
    if (!feature || !feature.getGeometry()) {
      return [];
    }

    const baseStyle = measureStyle(feature);
    if (!baseStyle) {
      return [];
    }

    const styles = [baseStyle];
    const geometry = feature.getGeometry();
    const type = geometry.getType();

    try {
      if (type === "LineString") {
        const coordinates = geometry.getCoordinates();
        if (coordinates && coordinates.length > 0) {
          const lastCoord = coordinates[coordinates.length - 1];

          // 마지막 점에 텍스트 스타일 추가
          const textStyle = new ol.style.Style({
            geometry: new ol.geom.Point(lastCoord),
            text: new ol.style.Text({
              text: formatLength(geometry),
              font: "14px Arial",
              fill: new ol.style.Fill({
                color: "#333",
              }),
              stroke: new ol.style.Stroke({
                color: "#fff",
                width: 3,
              }),
              offsetY: -10,
            }),
          });
          styles.push(textStyle);
        }
      } else if (type === "Polygon") {
        const coordinates = geometry.getCoordinates();
        if (coordinates && coordinates[0] && coordinates[0].length > 0) {
          const lastCoord = coordinates[0][coordinates[0].length - 1];

          // 면적/반경 텍스트 스타일 추가 (반경 모드일 때는 반경 출력)
          const textValue =
            currentMeasureType === "radius"
              ? formatRadius(geometry)
              : formatArea(geometry);

          const textStyle = new ol.style.Style({
            geometry: new ol.geom.Point(lastCoord),
            text: new ol.style.Text({
              text: textValue,
              font: "14px Arial",
              fill: new ol.style.Fill({
                color: "#333",
              }),
              stroke: new ol.style.Stroke({
                color: "#fff",
                width: 3,
              }),
              offsetY: -10,
            }),
          });
          styles.push(textStyle);
        }
      } else if (type === "Circle") {
        const center = geometry.getCenter();
        if (center) {
          // 반지름 텍스트 스타일 추가
          const textStyle = new ol.style.Style({
            geometry: new ol.geom.Point(center),
            text: new ol.style.Text({
              text: formatRadius(geometry),
              font: "14px Arial",
              fill: new ol.style.Fill({
                color: "#333",
              }),
              stroke: new ol.style.Stroke({
                color: "#fff",
                width: 3,
              }),
              offsetY: -10,
            }),
          });
          styles.push(textStyle);
        }
      }
    } catch (error) {
      console.warn("스타일 적용 중 오류:", error);
    }

    return styles;
  };

  measureLayer.setStyle(measureStyleFunction);
}

// 거리 측정
function measureDistance() {
  clearMeasurements();
  const map = getMap();

  let drawInteraction = null;
  let isDrawingCompleted = false; // 측정 완료 상태 추적
  let sketchFeature = null; // 진행 중인 스케치 피처 참조

  // 측정 취소 함수
  const cancelMeasurement = function () {
    try {
      // 측정이 완료되지 않은 상태에서만 팝업 생성 시도
      if (!isDrawingCompleted) {
        let featureForPopup = null;

        // 진행 중 스케치가 있다면 그 지오메트리를 복제하여 소스에 추가
        if (sketchFeature && sketchFeature.getGeometry()) {
          const sketchGeom = sketchFeature.getGeometry();
          if (
            sketchGeom.getType() === "LineString" &&
            sketchGeom.getCoordinates() &&
            sketchGeom.getCoordinates().length >= 2
          ) {
            featureForPopup = new ol.Feature({
              geometry: sketchGeom.clone(),
            });
            measureSource.addFeature(featureForPopup);
          }
        }

        // 스케치가 없거나 조건을 만족하지 못하면 소스의 마지막 피처 사용
        if (!featureForPopup) {
          const features = measureSource.getFeatures();
          const lastFeature = features[features.length - 1];
          if (
            lastFeature &&
            lastFeature.getGeometry().getType() === "LineString"
          ) {
            featureForPopup = lastFeature;
          }
        }

        if (featureForPopup) {
          const geometry = featureForPopup.getGeometry();
          const length = formatLength(geometry);
          createMeasurePopup(featureForPopup, "distance", length);
        }
      }

      if (drawInteraction) {
        map.removeInteraction(drawInteraction);
        drawInteraction = null;
      }

      // ESC 키 이벤트 리스너 제거
      document.removeEventListener("keydown", escKeyListener);

      // 우클릭 이벤트 리스너 제거
      map.un("contextmenu", cancelMeasurement);

      // 현재 측정 타입 초기화
      currentMeasureType = null;

      console.log("거리 측정이 취소되었습니다.");
    } catch (error) {
      console.error("거리 측정 취소 오류:", error);
    }
  };

  // ESC 키 이벤트 리스너
  const escKeyListener = function (event) {
    if (event.key === "Escape") {
      cancelMeasurement();
    }
  };

  // 우클릭 취소 이벤트
  map.on("contextmenu", cancelMeasurement);

  // ESC 키 이벤트 리스너 추가
  document.addEventListener("keydown", escKeyListener);

  drawInteraction = new ol.interaction.Draw({
    source: measureSource,
    type: "LineString",
    style: function (feature) {
      return measureLayer.getStyle()(feature);
    },
  });

  // 그리기 시작 시 스케치 피처 저장
  drawInteraction.on("drawstart", function (event) {
    isDrawingCompleted = false;
    sketchFeature = event.feature;
  });

  drawInteraction.on("drawend", function (event) {
    const feature = event.feature;
    const geometry = feature.getGeometry();
    const length = formatLength(geometry);
    console.log("측정된 거리:", length);

    // 측정 완료 상태로 변경
    isDrawingCompleted = true;
    sketchFeature = null;

    // 측정 팝업 표시
    createMeasurePopup(feature, "distance", length);

    // 측정 완료 후 이벤트 리스너 제거
    map.un("contextmenu", cancelMeasurement);
    document.removeEventListener("keydown", escKeyListener);

    // 새로운 취소 이벤트 리스너 등록 (완료된 측정용)
    const completedCancelMeasurement = function () {
      try {
        // 현재 그려진 피처 가져오기
        const features = measureSource.getFeatures();
        const lastFeature = features[features.length - 1];

        if (
          lastFeature &&
          lastFeature.getGeometry().getType() === "LineString"
        ) {
          const geometry = lastFeature.getGeometry();
          const length = formatLength(geometry);

          // 측정 팝업 표시
          createMeasurePopup(lastFeature, "distance", length);
        }

        if (drawInteraction) {
          map.removeInteraction(drawInteraction);
          drawInteraction = null;
        }
        map.un("contextmenu", completedCancelMeasurement);
        document.removeEventListener("keydown", completedEscKeyListener);
        currentMeasureType = null;
        console.log("완료된 거리 측정이 취소되었습니다.");
      } catch (error) {
        console.error("완료된 거리 측정 취소 오류:", error);
      }
    };

    const completedEscKeyListener = function (event) {
      if (event.key === "Escape") {
        completedCancelMeasurement();
      }
    };

    map.on("contextmenu", completedCancelMeasurement);
    document.addEventListener("keydown", completedEscKeyListener);
  });

  map.addInteraction(drawInteraction);
  currentMeasureType = "distance";
}

// 각도 측정
function measureAngle() {
  clearMeasurements();
  const map = getMap();

  let pointA = null; // 첫 번째 점 (첫 클릭)
  let pointB = null; // 꼭짓점 (두 번째 클릭)
  let angleFeature = null; // A-B-C를 잇는 LineString
  let isCompleted = false;
  let hoverFeature = null; // 시작 전 마우스 위치 표시용 점
  let tempLineFeature = null; // A에서 마우스까지 임시 선 (B 확정 전)

  // 각도 계산 헬퍼 (단위: 도)
  function calculateAngleDegrees(aCoord, bCoord, cCoord) {
    if (!aCoord || !bCoord || !cCoord) return 0;
    const ux = aCoord[0] - bCoord[0];
    const uy = aCoord[1] - bCoord[1];
    const vx = cCoord[0] - bCoord[0];
    const vy = cCoord[1] - bCoord[1];
    const dot = ux * vx + uy * vy;
    const nu = Math.hypot(ux, uy);
    const nv = Math.hypot(vx, vy);
    if (nu === 0 || nv === 0) return 0;
    let cosTheta = dot / (nu * nv);
    // 수치 오차 보정
    cosTheta = Math.max(-1, Math.min(1, cosTheta));
    const rad = Math.acos(cosTheta);
    const deg = (rad * 180) / Math.PI;
    // 0~180도로 제한
    return Math.round(deg * 10) / 10;
  }

  function formatAngleValue(deg) {
    return `${deg.toFixed ? deg.toFixed(1) : deg} °`;
  }

  // 피처 스타일 함수 (라인 + 꼭짓점 텍스트)
  function getAngleStyle(feature) {
    const coords = feature.getGeometry().getCoordinates();
    const a = coords[0];
    const b = coords[1];
    const c = coords[coords.length - 1];
    const deg = calculateAngleDegrees(a, b, c);

    const strokeStyle = new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#ff0000", width: 2 }),
    });
    const textStyle = new ol.style.Style({
      geometry: new ol.geom.Point(b),
      text: new ol.style.Text({
        text: formatAngleValue(deg),
        font: "14px Arial",
        fill: new ol.style.Fill({ color: "#333" }),
        stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
        offsetY: -10,
      }),
    });
    return [strokeStyle, textStyle];
  }

  // 취소 처리 (ESC/우클릭)
  const cancelMeasurement = function () {
    try {
      map.un("click", clickListener);
      map.un("click", finishAngle);
      map.un("pointermove", moveListener);
      map.un("pointermove", preMoveListener);
      map.un("contextmenu", cancelMeasurement);
      document.removeEventListener("keydown", escKeyListener);

      if (angleFeature && pointA && pointB) {
        const coords = angleFeature.getGeometry().getCoordinates();
        const a = coords[0];
        const b = coords[1];
        const c = coords[coords.length - 1];
        const deg = calculateAngleDegrees(a, b, c);
        const value = formatAngleValue(deg);
        createMeasurePopup(angleFeature, "angle", value);
      }

      pointA = null;
      pointB = null;
      angleFeature = null;
      if (hoverFeature) {
        measureSource.removeFeature(hoverFeature);
        hoverFeature = null;
      }
      if (tempLineFeature) {
        measureSource.removeFeature(tempLineFeature);
        tempLineFeature = null;
      }
      isCompleted = false;
      currentMeasureType = null;
      console.log("각도 측정이 취소되었습니다.");
    } catch (error) {
      console.error("각도 측정 취소 오류:", error);
    }
  };

  const escKeyListener = function (event) {
    if (event.key === "Escape") {
      cancelMeasurement();
    }
  };

  const clickListener = function (event) {
    try {
      if (!pointA) {
        pointA = event.coordinate;
        // 호버 점은 제거
        if (hoverFeature) {
          measureSource.removeFeature(hoverFeature);
          hoverFeature = null;
        }
        return;
      }
      if (!pointB) {
        pointB = event.coordinate;
        // A-B-B로 시작하여 포인터 이동에 따라 C 업데이트
        angleFeature = new ol.Feature({
          geometry: new ol.geom.LineString([pointA, pointB, pointB]),
        });
        angleFeature.setStyle(getAngleStyle);
        measureSource.addFeature(angleFeature);

        // 임시 선 제거 및 리스너 전환
        if (tempLineFeature) {
          measureSource.removeFeature(tempLineFeature);
          tempLineFeature = null;
        }
        map.un("pointermove", preMoveListener);
        map.on("pointermove", moveListener);
        map.un("click", clickListener);
        map.on("click", finishAngle);
        map.on("contextmenu", cancelMeasurement);
        document.addEventListener("keydown", escKeyListener);
        return;
      }
    } catch (error) {
      console.error("각도 측정 시작 오류:", error);
    }
  };

  // 시작 전 마우스 이동 시: 호버 점 표시, A 확정 후에는 A-마우스 임시 선 표시
  const preMoveListener = function (event) {
    try {
      const coord = event.coordinate;
      if (!pointA) {
        if (!hoverFeature) {
          hoverFeature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
          measureSource.addFeature(hoverFeature);
        } else if (hoverFeature.getGeometry()) {
          hoverFeature.getGeometry().setCoordinates(coord);
        }
      } else if (pointA && !pointB) {
        if (!tempLineFeature) {
          tempLineFeature = new ol.Feature({
            geometry: new ol.geom.LineString([pointA, coord]),
          });
          measureSource.addFeature(tempLineFeature);
        } else if (tempLineFeature.getGeometry()) {
          tempLineFeature.getGeometry().setCoordinates([pointA, coord]);
        }
        map.render();
      }
    } catch (error) {
      console.error("각도 측정 호버/임시선 표시 오류:", error);
    }
  };

  const moveListener = function (event) {
    try {
      if (pointA && pointB && angleFeature && !isCompleted) {
        const c = event.coordinate;
        const geom = angleFeature.getGeometry();
        const coords = geom.getCoordinates();
        coords[2] = c;
        geom.setCoordinates(coords);
        map.render();
      }
    } catch (error) {
      console.error("각도 측정 업데이트 오류:", error);
    }
  };

  const finishAngle = function (event) {
    try {
      if (pointA && pointB && angleFeature) {
        const c = event.coordinate;
        const geom = angleFeature.getGeometry();
        const coords = geom.getCoordinates();
        coords[2] = c;
        geom.setCoordinates(coords);

        const deg = calculateAngleDegrees(coords[0], coords[1], coords[2]);
        const value = formatAngleValue(deg);
        console.log("측정된 각도:", value);
        createMeasurePopup(angleFeature, "angle", value);

        map.un("pointermove", moveListener);
        map.un("click", finishAngle);
        map.un("contextmenu", cancelMeasurement);
        document.removeEventListener("keydown", escKeyListener);

        pointA = null;
        pointB = null;
        isCompleted = true;

        // 완료 후 취소 리스너 등록
        const completedCancelMeasurement = function () {
          try {
            map.un("contextmenu", completedCancelMeasurement);
            document.removeEventListener("keydown", completedEscKeyListener);
            currentMeasureType = null;
            console.log("완료된 각도 측정이 취소되었습니다.");
          } catch (error) {
            console.error("완료된 각도 측정 취소 오류:", error);
          }
        };
        const completedEscKeyListener = function (event) {
          if (event.key === "Escape") {
            completedCancelMeasurement();
          }
        };
        map.on("contextmenu", completedCancelMeasurement);
        document.addEventListener("keydown", completedEscKeyListener);
      }
    } catch (error) {
      console.error("각도 측정 완료 오류:", error);
    }
  };

  map.on("click", clickListener);
  map.on("pointermove", preMoveListener);
  // 각도 측정 전 단계에서도 ESC/우클릭으로 취소 가능하도록 리스너 등록
  map.on("contextmenu", cancelMeasurement);
  document.addEventListener("keydown", escKeyListener);
  currentMeasureType = "angle";
}

// 면적 측정
function measureArea() {
  clearMeasurements();
  const map = getMap();

  let drawInteraction = null;

  // 측정 취소 함수
  const cancelMeasurement = function () {
    try {
      if (drawInteraction) {
        // 현재 그려진 피처 가져오기
        const features = measureSource.getFeatures();
        const lastFeature = features[features.length - 1];

        if (lastFeature) {
          const geometry = lastFeature.getGeometry();
          const area = formatArea(geometry);

          // 측정 팝업 표시
          createMeasurePopup(lastFeature, "area", area);
        }

        map.removeInteraction(drawInteraction);
        drawInteraction = null;
      }

      // ESC 키 이벤트 리스너 제거
      document.removeEventListener("keydown", escKeyListener);

      // 우클릭 이벤트 리스너 제거
      map.un("contextmenu", cancelMeasurement);

      // 현재 측정 타입 초기화
      currentMeasureType = null;

      console.log("면적 측정이 취소되었습니다.");
    } catch (error) {
      console.error("면적 측정 취소 오류:", error);
    }
  };

  // ESC 키 이벤트 리스너
  const escKeyListener = function (event) {
    if (event.key === "Escape") {
      cancelMeasurement();
    }
  };

  // 우클릭 취소 이벤트
  map.on("contextmenu", cancelMeasurement);

  // ESC 키 이벤트 리스너 추가
  document.addEventListener("keydown", escKeyListener);

  drawInteraction = new ol.interaction.Draw({
    source: measureSource,
    type: "Polygon",
    style: function (feature) {
      return measureLayer.getStyle()(feature);
    },
  });

  drawInteraction.on("drawend", function (event) {
    const feature = event.feature;
    const geometry = feature.getGeometry();
    const area = formatArea(geometry);
    console.log("측정된 면적:", area);

    // 측정 팝업 표시
    createMeasurePopup(feature, "area", area);

    // 측정 완료 후 이벤트 리스너 제거
    map.un("contextmenu", cancelMeasurement);
    document.removeEventListener("keydown", escKeyListener);

    // 새로운 취소 이벤트 리스너 등록 (완료된 측정용)
    const completedCancelMeasurement = function () {
      try {
        if (drawInteraction) {
          map.removeInteraction(drawInteraction);
          drawInteraction = null;
        }
        map.un("contextmenu", completedCancelMeasurement);
        document.removeEventListener("keydown", completedEscKeyListener);
        currentMeasureType = null;
        console.log("완료된 면적 측정이 취소되었습니다.");
      } catch (error) {
        console.error("완료된 면적 측정 취소 오류:", error);
      }
    };

    const completedEscKeyListener = function (event) {
      if (event.key === "Escape") {
        completedCancelMeasurement();
      }
    };

    map.on("contextmenu", completedCancelMeasurement);
    document.addEventListener("keydown", completedEscKeyListener);
  });

  map.addInteraction(drawInteraction);
  currentMeasureType = "area";
}

// 반경 측정
function measureRadius() {
  clearMeasurements();
  const map = getMap();

  // Circle 대신 Point로 시작점을 찍고, 그 다음 클릭으로 반경을 결정하는 방식으로 변경
  let startPoint = null;
  let radiusFeature = null;
  let radiusLine = null; // 보조 직선은 표시하지 않음
  let centerFeature = null;
  let hoverFeature = null; // 시작 전 마우스 위치 표시용 점

  // 원을 그리는 헬퍼 함수 (Polygon으로 원 생성)
  function createCirclePolygon(center, radius) {
    const circle = new ol.geom.Circle(center, radius);
    // Circle 지오메트리를 다각형으로 근사화
    const polygon = ol.geom.Polygon.fromCircle(circle, 128);
    return polygon;
  }

  // 측정 취소 함수
  const cancelMeasurement = function () {
    try {
      // 이벤트 리스너 제거
      map.un("click", clickListener);
      map.un("click", finishRadius);
      map.un("pointermove", preMoveListener);
      map.un("pointermove", moveListener);
      map.un("contextmenu", cancelMeasurement);

      // ESC 키 이벤트 리스너 제거
      document.removeEventListener("keydown", escKeyListener);

      // 반경 측정이 완료된 상태라면 팝업 표시
      if (startPoint && radiusFeature) {
        const geometry = radiusFeature.getGeometry();
        const radius = formatRadius(geometry);

        // 측정 팝업 표시
        createMeasurePopup(radiusFeature, "radius", radius);
      } else {
        // 진행 중인 측정 요소들 제거
        if (centerFeature) {
          measureSource.removeFeature(centerFeature);
        }
        if (radiusFeature) {
          measureSource.removeFeature(radiusFeature);
        }
        if (hoverFeature) {
          measureSource.removeFeature(hoverFeature);
          hoverFeature = null;
        }
      }

      // 변수 초기화
      startPoint = null;
      radiusFeature = null;
      radiusLine = null;
      centerFeature = null;

      // 현재 측정 타입 초기화
      currentMeasureType = null;

      console.log("반경 측정이 취소되었습니다.");
    } catch (error) {
      console.error("측정 취소 오류:", error);
    }
  };

  // ESC 키 이벤트 리스너
  const escKeyListener = function (event) {
    if (event.key === "Escape") {
      cancelMeasurement();
    }
  };

  // 첫 번째 클릭으로 중심점 설정
  const clickListener = function (event) {
    try {
      if (!startPoint) {
        startPoint = event.coordinate;

        // 시작 전 호버 점 제거 및 리스너 해제
        if (hoverFeature) {
          measureSource.removeFeature(hoverFeature);
          hoverFeature = null;
        }
        map.un("pointermove", preMoveListener);

        // 중심점 피처 생성
        centerFeature = new ol.Feature({
          geometry: new ol.geom.Point(startPoint),
        });
        measureSource.addFeature(centerFeature);

        // 반경 측정에서는 보조 직선을 생성하지 않음

        // 원 피처 생성 (초기 반지름 0)
        radiusFeature = new ol.Feature({
          geometry: createCirclePolygon(startPoint, 0),
        });
        measureSource.addFeature(radiusFeature);

        // 반경 도형과 중심점의 연관 관계 저장 (삭제 시 함께 정리하기 위함)
        radiusFeature.set("centerFeature", centerFeature);

        // 마우스 이동 이벤트 추가
        map.on("pointermove", moveListener);

        // 우클릭 취소 이벤트 추가
        map.on("contextmenu", cancelMeasurement);

        // ESC 키 이벤트 리스너 추가
        document.addEventListener("keydown", escKeyListener);

        // 두 번째 클릭 이벤트로 변경
        map.un("click", clickListener);
        map.on("click", finishRadius);
      }
    } catch (error) {
      console.error("반경 측정 시작 오류:", error);
    }
  };

  // 시작 전 마우스 이동 시, 호버용 빨간 점 표시
  const preMoveListener = function (event) {
    try {
      if (!startPoint) {
        const coord = event.coordinate;
        if (!hoverFeature) {
          hoverFeature = new ol.Feature({
            geometry: new ol.geom.Point(coord),
          });
          measureSource.addFeature(hoverFeature);
        } else if (hoverFeature.getGeometry()) {
          hoverFeature.getGeometry().setCoordinates(coord);
        }
      }
    } catch (error) {
      console.error("반경 측정 호버 표시 오류:", error);
    }
  };

  // 마우스 이동 시 반지름 업데이트
  const moveListener = function (event) {
    try {
      if (startPoint && radiusFeature) {
        const currentPoint = event.coordinate;
        // 투영 좌표계(EPSG:3857)의 길이 사용 (단위: m)
        const radius = new ol.geom.LineString([
          startPoint,
          currentPoint,
        ]).getLength();

        // 보조 직선 업데이트 없음

        // 원 업데이트 - 새로운 Polygon 지오메트리로 교체
        const newCirclePolygon = createCirclePolygon(startPoint, radius);
        radiusFeature.setGeometry(newCirclePolygon);

        // 지도 다시 렌더링 강제
        map.render();
      }
    } catch (error) {
      console.error("반경 측정 업데이트 오류:", error);
    }
  };

  // 두 번째 클릭으로 반지름 확정
  const finishRadius = function (event) {
    try {
      if (startPoint && radiusFeature) {
        const endPoint = event.coordinate;
        // 투영 좌표계(EPSG:3857)의 길이 사용 (단위: m)
        const radius = new ol.geom.LineString([
          startPoint,
          endPoint,
        ]).getLength();

        // 최종 반지름 설정
        const finalCirclePolygon = createCirclePolygon(startPoint, radius);
        radiusFeature.setGeometry(finalCirclePolygon);

        // 측정 결과 출력 및 팝업 생성
        const radiusText = formatRadius(radiusFeature.getGeometry());
        console.log("측정된 반경:", radiusText);
        createMeasurePopup(radiusFeature, "radius", radiusText);

        // 중심점 표시는 완료 후에는 제거
        if (centerFeature) {
          measureSource.removeFeature(centerFeature);
          // 반경 피처의 연관 관계도 해제
          radiusFeature.set("centerFeature", null);
        }

        // 이벤트 리스너 제거
        map.un("pointermove", preMoveListener);
        map.un("pointermove", moveListener);
        map.un("click", finishRadius);
        map.un("contextmenu", cancelMeasurement);
        document.removeEventListener("keydown", escKeyListener);

        // 변수 초기화
        startPoint = null;
        radiusFeature = null;
        radiusLine = null;
        centerFeature = null;

        // 새로운 취소 이벤트 리스너 등록 (완료된 측정용)
        const completedCancelMeasurement = function () {
          try {
            map.un("contextmenu", completedCancelMeasurement);
            document.removeEventListener("keydown", completedEscKeyListener);
            currentMeasureType = null;
            console.log("완료된 반경 측정이 취소되었습니다.");
          } catch (error) {
            console.error("완료된 반경 측정 취소 오류:", error);
          }
        };

        const completedEscKeyListener = function (event) {
          if (event.key === "Escape") {
            completedCancelMeasurement();
          }
        };

        map.on("contextmenu", completedCancelMeasurement);
        document.addEventListener("keydown", completedEscKeyListener);
      }
    } catch (error) {
      console.error("반경 측정 완료 오류:", error);
    }
  };

  // 첫 번째 클릭 이벤트 등록
  map.on("click", clickListener);
  // 시작 전 호버 점 표시를 위한 포인터 이동 등록
  map.on("pointermove", preMoveListener);

  currentMeasureType = "radius";
}

// 측정 팝업 생성
function createMeasurePopup(feature, measureType, value) {
  const map = getMap();
  const geometry = feature.getGeometry();

  // 새로운 오버레이 생성
  const overlay = new ol.Overlay({
    element: document.createElement("div"),
    positioning: "bottom-center",
    offset: [0, -10],
    stopEvent: true,
  });

  // 팝업 요소 생성
  const popupElement = document.createElement("div");
  popupElement.className = "measure-popup";
  popupElement.innerHTML = `
    <div class="popup-header">
      <span class="popup-title">${
        measureType === "distance"
          ? "거리 측정"
          : measureType === "radius"
          ? "반경 측정"
          : measureType === "angle"
          ? "각도 측정"
          : "면적 측정"
      }</span>
      <button class="popup-close" onclick="closeMeasurePopup('${
        feature.ol_uid
      }')">×</button>
    </div>
    <div class="popup-content">
      <div class="measure-value">${value}</div>
      <button class="delete-measure-btn" onclick="deleteMeasure('${
        feature.ol_uid
      }')">측정 삭제</button>
    </div>
  `;

  // 팝업에서 모든 마우스 이벤트 전파 방지
  popupElement.addEventListener("mousedown", function (event) {
    event.stopPropagation();
  });

  popupElement.addEventListener("mouseup", function (event) {
    event.stopPropagation();
  });

  popupElement.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  popupElement.addEventListener("dblclick", function (event) {
    event.stopPropagation();
  });

  // 팝업 스타일 적용
  popupElement.style.cssText = `
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 12px;
    min-width: 150px;
    font-family: Arial, sans-serif;
    z-index: 1000;
  `;

  // 팝업 내부 요소 스타일
  const header = popupElement.querySelector(".popup-header");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 8px;
  `;

  const title = popupElement.querySelector(".popup-title");
  title.style.cssText = `
    font-weight: bold;
    color: #374151;
    font-size: 14px;
  `;

  const closeBtn = popupElement.querySelector(".popup-close");
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const content = popupElement.querySelector(".popup-content");
  content.style.cssText = `
    text-align: center;
  `;

  const valueDiv = popupElement.querySelector(".measure-value");
  valueDiv.style.cssText = `
    font-size: 16px;
    font-weight: bold;
    color: #3b82f6;
    margin-bottom: 8px;
  `;

  const deleteBtn = popupElement.querySelector(".delete-measure-btn");
  deleteBtn.style.cssText = `
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  // 호버 효과
  closeBtn.onmouseover = () => (closeBtn.style.color = "#374151");
  closeBtn.onmouseout = () => (closeBtn.style.color = "#6b7280");
  deleteBtn.onmouseover = () => (deleteBtn.style.backgroundColor = "#dc2626");
  deleteBtn.onmouseout = () => (deleteBtn.style.backgroundColor = "#ef4444");

  // 버튼 클릭 시 이벤트 전파 방지
  closeBtn.addEventListener("mousedown", function (event) {
    event.stopPropagation();
  });

  closeBtn.addEventListener("mouseup", function (event) {
    event.stopPropagation();
  });

  closeBtn.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  deleteBtn.addEventListener("mousedown", function (event) {
    event.stopPropagation();
  });

  deleteBtn.addEventListener("mouseup", function (event) {
    event.stopPropagation();
  });

  deleteBtn.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  // 지오메트리 중심점 계산
  let center;
  if (geometry.getType() === "LineString") {
    const coordinates = geometry.getCoordinates();
    const midIndex = Math.floor(coordinates.length / 2);
    center = coordinates[midIndex];
  } else if (geometry.getType() === "Polygon") {
    center = geometry.getInteriorPoint().getCoordinates();
  }

  // 오버레이 설정
  overlay.setPosition(center);
  overlay.setElement(popupElement);
  map.addOverlay(overlay);

  // 오버레이와 피처 정보 저장
  const overlayInfo = {
    overlay: overlay,
    feature: feature,
    popupElement: popupElement,
  };
  measureOverlays.push(overlayInfo);
  measureFeatures.push(feature);

  console.log(`측정 팝업 생성됨: ${measureType} - ${value}`);
}

// 측정 팝업 닫기 (도형도 함께 삭제)
function closeMeasurePopup(featureId) {
  const map = getMap();

  // 이벤트 전파 방지
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const overlayIndex = measureOverlays.findIndex(
    (info) => info.feature.ol_uid === featureId
  );
  if (overlayIndex !== -1) {
    const overlayInfo = measureOverlays[overlayIndex];

    // 오버레이 제거
    map.removeOverlay(overlayInfo.overlay);

    // 피처 제거
    measureSource.removeFeature(overlayInfo.feature);

    // 반경 측정에서 생성된 중심점 피처가 있으면 함께 제거
    const linkedCenter = overlayInfo.feature.get
      ? overlayInfo.feature.get("centerFeature")
      : null;
    if (linkedCenter) {
      measureSource.removeFeature(linkedCenter);
    }

    // 배열에서 제거
    measureOverlays.splice(overlayIndex, 1);
    const featureIndex = measureFeatures.findIndex(
      (f) => f.ol_uid === featureId
    );
    if (featureIndex !== -1) {
      measureFeatures.splice(featureIndex, 1);
    }

    console.log(`측정 팝업과 도형이 삭제되었습니다. (ID: ${featureId})`);
  }
}

// 측정 도형 삭제
function deleteMeasure(featureId) {
  // 이벤트 전파 방지
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  closeMeasurePopup(featureId);
}

// 측정 초기화
function clearMeasurements() {
  const map = getMap();

  if (measureInteraction) {
    map.removeInteraction(measureInteraction);
    measureInteraction = null;
  }

  // 모든 측정 오버레이 제거
  measureOverlays.forEach((overlayInfo) => {
    map.removeOverlay(overlayInfo.overlay);
  });

  // 배열 초기화
  measureOverlays = [];
  measureFeatures = [];

  // 소스 초기화
  measureSource.clear();
  currentMeasureType = null;
}

// 거리 포맷팅
function formatLength(line) {
  const length = ol.sphere.getLength(line);
  let output;
  if (length > 1000) {
    output = Math.round((length / 1000) * 100) / 100 + " km";
  } else {
    output = Math.round(length * 100) / 100 + " m";
  }
  return output;
}

// 면적 포맷팅
function formatArea(polygon) {
  const area = ol.sphere.getArea(polygon);
  let output;
  if (area > 1000000) {
    output = Math.round((area / 1000000) * 100) / 100 + " km²";
  } else {
    output = Math.round(area * 100) / 100 + " m²";
  }
  return output;
}

// 반경 포맷팅
function formatRadius(geometry) {
  let radius;
  if (geometry.getType() === "Circle") {
    radius = geometry.getRadius();
  } else if (geometry.getType() === "Polygon") {
    // Polygon(원 근사)의 경우 중심-첫번째 꼭짓점 간의 거리(투영 좌표계 길이)로 반경 계산
    const coordinates = geometry.getCoordinates()[0];
    if (coordinates && coordinates.length > 0) {
      const center = geometry.getInteriorPoint().getCoordinates();
      radius = new ol.geom.LineString([center, coordinates[0]]).getLength();
    } else {
      radius = 0;
    }
  } else {
    radius = 0;
  }

  let output;
  if (radius > 1000) {
    output = Math.round((radius / 1000) * 100) / 100 + " km";
  } else {
    output = Math.round(radius * 100) / 100 + " m";
  }
  return output;
}

// 전역 객체에 측정 함수들 추가
window.measureDistance = measureDistance;
window.measureArea = measureArea;
window.measureRadius = measureRadius;
window.measureAngle = measureAngle;
window.clearMeasurements = clearMeasurements;
window.createMeasurePopup = createMeasurePopup;
window.closeMeasurePopup = closeMeasurePopup;
window.deleteMeasure = deleteMeasure;

export {
  initializeMeasureTools,
  measureDistance,
  measureArea,
  measureRadius,
  measureAngle,
  clearMeasurements,
  createMeasurePopup,
  closeMeasurePopup,
  deleteMeasure,
};

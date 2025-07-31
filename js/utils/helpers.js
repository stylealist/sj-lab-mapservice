// 유틸리티 함수들

// AJAX 요청 함수 (향후 확장용)
function makeAjaxRequest(url, options = {}) {
  return fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    ...options,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .catch((error) => {
      console.error("AJAX 요청 실패:", error);
      throw error;
    });
}

// 좌표 변환
function transformCoordinates(coordinate, fromProjection, toProjection) {
  return ol.proj.transform(coordinate, fromProjection, toProjection);
}

// 거리 계산 (미터)
function calculateDistance(coord1, coord2) {
  const point1 = new ol.geom.Point(coord1);
  const point2 = new ol.geom.Point(coord2);
  return point1.getCoordinates()[0] - point2.getCoordinates()[0];
}

// 포맷팅 함수들
function formatCoordinate(coordinate) {
  return `${coordinate[0].toFixed(6)}, ${coordinate[1].toFixed(6)}`;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters / 1000).toFixed(2)}km`;
  }
}

// 유틸리티 객체
const utils = {
  transformCoordinates,
  calculateDistance,
  formatCoordinate,
  formatDistance,
};

// 전역 객체에 유틸리티 함수들 추가
window.mapUtils = utils;
window.makeAjaxRequest = makeAjaxRequest;

export { makeAjaxRequest, utils };

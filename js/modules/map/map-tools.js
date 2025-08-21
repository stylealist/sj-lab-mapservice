// 맵 도구 모듈
import { getMap } from './map-core.js';

// 맵 도구 함수들
const mapTools = {
  // 현재 뷰포트 정보 가져오기
  getViewportInfo: function () {
    const map = getMap();
    const view = map.getView();
    const extent = view.calculateExtent(map.getSize());
    const center = view.getCenter();
    const zoom = view.getZoom();

    return {
      center: ol.proj.toLonLat(center),
      zoom: zoom,
      extent: ol.proj.transformExtent(extent, "EPSG:3857", "EPSG:4326"),
    };
  },

  // 특정 좌표로 이동
  flyTo: function (coordinate, zoom = 15) {
    const map = getMap();
    const transformedCoord = ol.proj.fromLonLat(coordinate);
    const view = map.getView();

    view.animate({
      center: transformedCoord,
      zoom: zoom,
      duration: 1000,
    });
  },

  // 줌 레벨 설정
  setZoom: function (zoom) {
    const map = getMap();
    const view = map.getView();
    view.animate({
      zoom: zoom,
      duration: 500,
    });
  },

  // 맵 리셋
  resetMap: function () {
    const map = getMap();
    const view = map.getView();
    view.animate({
      center: ol.proj.fromLonLat([127.0, 37.5]),
      zoom: 10,
      duration: 1000,
    });
  },

  // 현재 중심 좌표 가져오기
  getCenter: function () {
    const map = getMap();
    const center = map.getView().getCenter();
    return ol.proj.toLonLat(center);
  },

  // 현재 줌 레벨 가져오기
  getZoom: function () {
    const map = getMap();
    return map.getView().getZoom();
  },

  // 맵 크기 가져오기
  getSize: function () {
    const map = getMap();
    return map.getSize();
  },

  // 맵 뷰포트 범위 가져오기
  getExtent: function () {
    const map = getMap();
    const view = map.getView();
    const extent = view.calculateExtent(map.getSize());
    return ol.proj.transformExtent(extent, "EPSG:3857", "EPSG:4326");
  }
};

// 전역 객체에 맵 도구 추가
window.mapTools = mapTools;

export { mapTools };

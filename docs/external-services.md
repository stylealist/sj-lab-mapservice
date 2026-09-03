# 외부 연동

- 지도 타일: VWorld (`xdworld.vworld.kr`) — 별도 API 키 없이 XYZ 타일 직접 요청.
- POI/WFS 데이터: 자사 백엔드(`api.sj-lab.co.kr`, 로컬은 `:8100`).
- WMS: 자사 GeoServer(`geoserver.sj-lab.co.kr`).
- 로드뷰: 카카오맵 SDK (`window.KAKAO_APP_KEY`, index.html에 하드코딩되어 있음).

## 반드시 지킬 것

- WFS 요청 URL은 항상 `js/modules/map/map-wfs.js`의 `getApiUrl()`을 통해서만 생성할 것 — `location.hostname`으로 로컬(`:8100`)/운영(`api.sj-lab.co.kr`)을 자동 전환하므로 절대 URL을 직접 하드코딩하지 말 것.
- VWorld 타일(`xdworld.vworld.kr`)은 인증 키 없이 XYZ 타일을 직접 요청하는 기존 방식입니다. 새 배경지도/오버레이 레이어를 추가할 때도 임의로 인증 헤더나 API 키 파라미터를 붙이지 말 것 — 기존 요청 방식과 어긋나 CORS/인증 오류가 날 수 있음.
- GeoServer WMS(`map-wms.js`)는 `TILED: true`, `BUFFER: 50`, `FEATURE_COUNT: 10` 등 성능 튜닝 파라미터가 명시돼 있습니다. 새 WMS 레이어를 추가할 때도 이 파라미터 세트를 유지할 것.

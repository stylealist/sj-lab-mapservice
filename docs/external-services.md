# 외부 연동

- 지도 타일: VWorld (`xdworld.vworld.kr`) — 별도 API 키 없이 XYZ 타일 직접 요청.
- POI/WFS·시설물 데이터: 자사 백엔드 `mapservice-rest`(운영 `api.sj-lab.co.kr`, 로컬은 API Gateway `localhost:8100` 경유).
- WMS: 자사 GeoServer(`geoserver.sj-lab.co.kr`).
- 로드뷰: 카카오맵 SDK (`window.KAKAO_APP_KEY`, index.html에 하드코딩되어 있음).

## 반드시 지킬 것

- WFS 요청 URL은 항상 `js/modules/map/map-wfs.js`의 `getApiUrl()`을 통해서만 생성할 것 — `location.hostname`으로 로컬(`:8100`)/운영(`api.sj-lab.co.kr`)을 자동 전환하므로 절대 URL을 직접 하드코딩하지 말 것.
- VWorld 타일(`xdworld.vworld.kr`)은 인증 키 없이 XYZ 타일을 직접 요청하는 기존 방식입니다. 새 배경지도/오버레이 레이어를 추가할 때도 임의로 인증 헤더나 API 키 파라미터를 붙이지 말 것 — 기존 요청 방식과 어긋나 CORS/인증 오류가 날 수 있음.
- GeoServer WMS(`map-wms.js`)는 `TILED: true`, `BUFFER: 50`, `FEATURE_COUNT: 10` 등 성능 튜닝 파라미터가 명시돼 있습니다. 새 WMS 레이어를 추가할 때도 이 파라미터 세트를 유지할 것.
- 로컬에서 API를 호출하려면 프론트엔드를 `http://localhost:4000`에서 서빙할 것 — 게이트웨이 CORS 허용 origin이 4000뿐이라 다른 포트(예: `python -m http.server 8000`)에서는 API 호출이 403으로 막힘.

# MCP·총괄 설정 (이전됨)

GitHub/DB MCP 설정(`.mcp.json`), 로컬 비밀값(`.claude/settings.local.json`), Bash 가드 훅, DB 분석 문서, 로컬 개발 구성(포트·라우팅·CORS) 문서는 2026-09-15에 통합 허브 저장소 `mapservice-rest`(`C:\developer\workspace\mapservice-rest`)로 옮겼습니다. 저장소를 넘나드는 작업과 DB 조회는 그 저장소에서 Claude Code 세션을 띄워 진행합니다 — `docs/mcp.md`, `docs/dev-environment.md` 참고.

## 반드시 지킬 것

- 이 저장소는 public입니다. 토큰·DB 접속 문자열·인프라 정보를 이 저장소에 다시 추가하지 말 것. `.gitignore`의 `.claude/settings.local.json` 항목은 로컬 설정 파일이 실수로 커밋되지 않도록 계속 유지할 것.

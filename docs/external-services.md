# 외부 연동

- 지도 타일: VWorld (`xdworld.vworld.kr`) — 별도 API 키 없이 XYZ 타일 직접 요청.
- POI/WFS 데이터: 자사 백엔드(`api.sj-lab.co.kr`, 로컬은 `:8100`).
- WMS: 자사 GeoServer(`geoserver.sj-lab.co.kr`).
- 로드뷰: 카카오맵 SDK (`window.KAKAO_APP_KEY`, index.html에 하드코딩되어 있음).

## 반드시 지킬 것

- WFS 요청 URL은 항상 `js/modules/map/map-wfs.js`의 `getApiUrl()`을 통해서만 생성할 것 — `location.hostname`으로 로컬(`:8100`)/운영(`api.sj-lab.co.kr`)을 자동 전환하므로 절대 URL을 직접 하드코딩하지 말 것.
- VWorld 타일(`xdworld.vworld.kr`)은 인증 키 없이 XYZ 타일을 직접 요청하는 기존 방식입니다. 새 배경지도/오버레이 레이어를 추가할 때도 임의로 인증 헤더나 API 키 파라미터를 붙이지 말 것 — 기존 요청 방식과 어긋나 CORS/인증 오류가 날 수 있음.
- GeoServer WMS(`map-wms.js`)는 `TILED: true`, `BUFFER: 50`, `FEATURE_COUNT: 10` 등 성능 튜닝 파라미터가 명시돼 있습니다. 새 WMS 레이어를 추가할 때도 이 파라미터 세트를 유지할 것.

# MCP 연결 (`.mcp.json`)

Claude Code가 저장소 루트의 `.mcp.json`으로 프로젝트 공용 MCP 서버를 불러옵니다. 처음 사용할 때 서버별로 승인 창이 뜨고, 연결 상태는 Claude Code에서 `/mcp`로 확인합니다.

- `github` — GitHub 원격 MCP(`api.githubcopilot.com/mcp/`). 서버/백엔드 저장소의 코드·이슈·PR 조회용. 환경변수 `GITHUB_PERSONAL_ACCESS_TOKEN` 필요.
- `sjlabDevDb` — PostgreSQL MCP(`@modelcontextprotocol/server-postgres`, 읽기 전용 트랜잭션으로만 쿼리). 환경변수 `SJLAB_DEV_DATABASE_URL`(예: `postgresql://readonly_user:비밀번호@호스트:5432/DB명`) 필요. `node`/`npx` 필요.

두 환경변수의 실제 값은 `.claude/settings.local.json`의 `env`에 넣습니다(프로젝트 전용·로컬 전용, `.gitignore`로 커밋 제외). 값을 바꾸면 Claude Code를 재시작해야 반영됩니다.

```json
{
  "enabledMcpjsonServers": ["github", "sjlabDevDb"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "github_pat_...",
    "SJLAB_DEV_DATABASE_URL": "postgresql://readonly_user:비밀번호@호스트:5432/DB명"
  }
}
```

## 반드시 지킬 것

- 토큰·DB 접속 문자열을 `.mcp.json`이나 문서에 직접 적지 말 것. `${변수:-}` 형태로 환경변수에서만 읽음 — `.mcp.json`은 git에 커밋되는 파일임.
- `.gitignore`의 `.claude/settings.local.json` 항목을 지우지 말 것 — 이 저장소는 public이며, 이 파일에 실제 토큰·DB 비밀번호가 들어 있음. 비밀번호에 `@`·`:`·`/`·`#` 등이 있으면 URL 인코딩(`@` → `%40`)할 것.
- `SJLAB_DEV_DATABASE_URL`에는 **개발/복제 DB의 읽기 전용 계정**만 넣을 것. 운영 DB 쓰기 권한 계정을 연결하지 말 것.
- GitHub 토큰은 필요한 저장소만 선택한 fine-grained 토큰(Contents/Issues/Pull requests 읽기 위주)으로 발급할 것.
- `sjlabDevDb`의 `cmd /c npx` 래퍼는 네이티브 Windows용입니다. macOS/Linux/WSL에서는 `command`를 `npx`로 바꾸고 `args`의 `/c`, `npx`를 빼야 함.

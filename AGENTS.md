# Agent Guidelines & Project Instructions

이 프로젝트의 아키텍처 원칙, 코딩 컨벤션 및 환경 제약 사항은 루트의 `CLAUDE.md`에 정의되어 있습니다.

## Antigravity 및 AI 에이전트 필수 준수 사항

1. **기본 지침 (CLAUDE.md 준수)**:
   - 작업을 시작하기 전 반드시 루트의 `CLAUDE.md`를 먼저 확인하고 명시된 아키텍처, 실행 명령, 개발 원칙을 준수한다.
2. **서브 문서(@docs/...) 및 세부 규격 탐색**:
   - `CLAUDE.md` 본문에 `@docs/...` 또는 파일 경로로 지정된 참조 문서들(예: `docs/map-architecture.md`, `docs/ui-conventions.md`, `docs/external-services.md` 등)이 있을 경우, 관련 기능이나 모듈을 작업하기 전에 반드시 해당 서브파일들을 먼저 읽어 설계 및 규칙을 확인한다.
3. **통합 환경 및 제약 사항 엄수**:
   - 빌드 도구·패키지 매니저·번들러가 없는 순수 정적 ES 모듈 구조 유지
   - 전역 브리지 패턴(`js/modules/map/map.js` 및 `window.*` 등록) 준수
   - 초기화 가드 플래그(`window.appInitialized` 등) 보존
   - 허용 포트(`http://localhost:4000`) 및 API 게이트웨이(`localhost:8100`) 연동 환경 준수
   - 변수 및 함수 네이밍 시 카멜 표기법(`camelCase`) 준수
   - 코드 추가 및 수정 중 지침 갱신이 필요할 경우 `CLAUDE.md`와 `README.md`를 함께 최신화
   - 답변 작성 시 항상 한국어로 답변

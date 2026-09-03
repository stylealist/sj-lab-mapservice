---
name: release-check
description: 배포 전 단위 테스트 점검. "배포해도 되나", "릴리스 전 확인해줘", "테스트 통과했어?" 같은 요청에 사용.
allowed-tools: Glob Bash(node --test:*) Bash(npm test:*) Bash(npm run test:*) Read
---

이 스킬은 **단위 테스트의 존재 여부와 통과 여부만** 확인한다. 테스트가 없다고 새로 작성하지 않는다 — 없으면 그대로 실패로 보고하고 멈춘다.

1. **테스트 파일/설정 존재 확인** — 다음을 찾는다.
   - `**/*.test.js`, `**/*.spec.js`
   - `**/__tests__/**`
   - `test/`, `tests/` 디렉터리
   - `package.json`의 `scripts.test`
   현재 이 저장소에는 `package.json`도 없고 위 패턴에 해당하는 파일도 없다. 아무것도 없으면 "단위 테스트 없음"으로 즉시 실패 처리하고 멈춘다.
2. **테스트 실행** — 1에서 뭔가 발견됐을 때만 진행한다. `package.json`에 `scripts.test`가 있으면 `npm test`, 없고 `*.test.js`/`*.spec.js`만 있으면 `node --test <경로>`로 실행한다. 실패하면 즉시 멈춘다.
3. 결과를 아래 표로 보고한다.

| 항목 | 결과 | 비고 |
|---|---|---|
| 단위 테스트 파일/설정 존재 | ✅/❌ | |
| 단위 테스트 통과 | ✅/❌/N-A | 1번이 ❌면 N-A |

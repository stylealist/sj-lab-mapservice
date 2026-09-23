# SJ 시설물 관리 — 지도 웹 프론트엔드 (sj-lab-mapservice)

`sj-lab-mapservice`는 OpenLayers 기반으로 구축된 순수 정적 싱글 페이지 애플리케이션(SPA)입니다. 현장조사로 수집된 약 2,500건의 시설물 데이터와 공공 지리정보(CCTV, 버스정류장 등)를 웹 지도 및 목록으로 동기화 표출하고, 보수 필요 시설물에 대한 현장 사진/미디어 열람 및 내업(사무실 조치) 기록 관리를 지원합니다.

---

## 1. 서비스 역할 및 핵심 책임

- **공간정보(GIS) 시각화 및 연쇄 필터링**: 시·도 → 시·군·구 → 읍·면·동 3단계 행정구역 연쇄 필터와 시설물 상태(보수 필요/불필요/내업 상태별)에 따른 실시간 공간 렌더링 및 목록 뷰 동기화.
- **대용량 피처 클러스터링 및 가상 분산(Spidering)**: 수천 건의 지점 객체를 축척별 클러스터 배지로 집약하고, 고배율 확대 시 동일/인접 좌표 객체를 원형으로 펼쳐 개별 선택성을 보장.
- **시설물 내업 및 멀티미디어 조치 UI**: 조치 이력 등록, 일정/비용 산정, 현장 전/후 사진 업로드(클라이언트 이미지 리사이징), QFieldCloud 원격 미디어(사진/음성/영상) 스트리밍 팝업, PDF 보고서 생성.
- **SSO 게이트웨이 연동**: 세션 토큰 감지 시 중앙 로그인 서버(`/auth/login.html`)와 연동하여 무중단 사용자 인증을 보장.

---

## 2. 기술 스택

- **코어 기술**: HTML5, CSS3, Modern JavaScript (ES Modules, Vanilla JS)
- **GIS 렌더링 라이브러리**: OpenLayers 7.x (Vendor Bundle), VWorld 배경지도 타일
- **멀티미디어**: Hls.js (CCTV 실시간 스트리밍 재생), Web Audio API
- **아키텍처 구조**: No-Build 순수 정적 SPA (Webpack/Vite 등 빌드 도구 의존성 없음)
- **배포 환경**: NGINX 정적 웹서버 (포트 4000 / 운영 `https://sj-lab.co.kr/map/`)

---

## 3. UI 및 데이터 인터랙션 프로세스

### 3.1 지도 렌더링 및 데이터 흐름

```
[클라이언트 지도 뷰포트]
       │
       ├─ 1. 행정구역 BBOX 이동 ──> [API Gateway :8100] ──> [mapservice-rest]
       │                            (/map/admin-area/bbox)
       ├─ 2. 시설물 GeoJSON 요청 ─> (/map/qfield/facilities)
       │                            (뷰포트 BBOX + 50% 버퍼 프리패칭)
       │
       ▼ 수신 및 렌더링 파이프라인
[OpenLayers MapCanvas]
  ├── Base Layer: VWorld 항공/기본 지도 타일
  ├── Public WFS Layer: CCTV, 버스정류장, 병원, 약국 등 (BBOX 격자 표본)
  └── Custom Facility Layer:
        ├── geometryFunction: 필터링 조건 즉시 적용 (목록과 배지 일치)
        ├── Cluster Source: 거리 기반 핀 집약 및 카운트 배지
        └── Spidering Mechanism: 18 레벨 이상 고배율 시 원형 분산 배치
```

### 3.2 내업 처리 및 미디어 워크플로우
1. 지도 핀 클릭 → 상세 팝업 오픈 → 백엔드 `/map/qfield/facilities/{id}/media`를 통해 QFieldCloud 원격 첨부 파일(사진/음성/영상) 조회.
2. 보수 필요 시설물에 대해 "내업 작성" 탭 활성화 → 처리 상태(`IN_PROGRESS`, `DONE` 등) 및 내역 입력.
3. 조치 전/후 증빙 사진 등록:
   - 브라우저 Canvas API를 통해 최대 1600px, JPEG 품질 0.8로 자동 압축 리사이징.
   - Multipart API 호출로 전송하고 부분 실패 시 사용자 피드백 안내.

---

## 4. 핵심 엔지니어링 구현 상세

### 4.1 클러스터링 배지와 목록 건수의 엄격한 일치 (geometryFunction 필터링)
OpenLayers의 기본 클러스터는 소스 내 모든 피처를 집약하므로, 화면 필터를 스타일 레이어에서만 적용할 경우 클러스터 배지의 숫자와 좌측 목록의 건수가 불일치하는 문제가 발생합니다.
- `ol.source.Cluster`의 `geometryFunction` 내부에서 시설물 보수 필터 및 내업 상태 필터를 직접 평가하여, 탈락한 피처는 `null`을 반환하도록 설계.
- 필터를 통과한 피처만 클러스터링 계산에 참여하여 **배지 수치와 UI 목록 카운트의 100% 동기화**를 달성했습니다.

```javascript
function facilityClusterGeometry(feature) {
  if (!matchesFacilityRepairFilter(feature)) return null;
  if (!matchesFacilityOfficeFilter(feature)) return null;
  return feature.getGeometry();
}
```

### 4.2 초근접/동일 좌표 시설물의 가상 분산(Spidering) 알고리즘
동일 건물에 복수의 시설물이 등록된 경우 최대 배율(Zoom 18 이상)에서도 클러스터가 분리되지 않아 개별 객체 클릭이 불가능한 한계가 존재했습니다.
- 배율 18 이상에서 묶여 있는 피처 그룹을 감지하여 가상 중심점 둘레로 반경 분산(Spidering) 좌표를 동적 생성.
- 클러스터 배지를 숨기고 개별 핀으로 흩뿌려 표시함으로써 고배율 환경에서의 접근성과 조작성을 완벽히 확보했습니다.

### 4.3 Declutter 파이프라인과 레이어 렌더 순서 제어
시설물 핀이 공공데이터 아이콘에 가려지는 현상을 해결하기 위해:
- 단순 `zIndex` 조정 대신 OpenLayers의 Declutter 렌더러 동작 방식을 분석하여, 시설물 심볼 스타일을 `declutterMode: "obstacle"`로 구성.
- 시설물 핀은 화면에 무조건 렌더링되면서 인접한 공공데이터 심볼이 이를 피해 배치되도록 제어하여 현장 시설물의 시인성을 최우선 보장했습니다.

### 4.4 뷰포트 버퍼 프리패칭 (BBOX Caching)
사용자가 지도를 이동할 때마다 API를 과도하게 재호출하지 않도록:
- 현재 뷰포트 기준 가로/세로 50% 확장된 영역을 쿼리하고 응답 바운더리를 캐싱(`wfsFetchState`).
- 확장 영역 내에서의 팬(Pan) 이동 시 네트워크 요청을 건너뛰어 체감 반응 속도를 향상시켰습니다.

---

## 5. 프로젝트 디렉터리 구조

```
sj-lab-mapservice/
├── index.html                  # 단일 페이지 뷰 (지도, 소개, 연락처)
├── css/
│   ├── layouts/main.css        # 전체 화면 레이아웃
│   ├── components/header.css   # 상단 헤더, SSO 사용자 정보, 링크
│   └── components/layer-panel.css # 좌측 시설물 목록 및 내업 패널
└── js/
    ├── auth-gate.js            # 최상단 로드 SSO 인증 게이트 스크립트
    ├── app.js                  # 전체 모듈 라이프사이클 및 초기화 가드
    └── modules/
        ├── ui.js               # 패널 조작, 모달, 페이지 전환 이벤트
        └── map/
            ├── map.js          # 모듈 통합 배럴 및 Window 인터페이스 브리지
            ├── map-core.js     # 지도 인스턴스, VWorld 배경지도 초기화
            ├── map-facility.js # 시설물 피처 렌더링, 클러스터링, 스파이더링
            ├── map-wfs.js      # 공공데이터 레이어 관리
            └── map-detail.js   # 상세 팝업, 미디어 재생, 내업 폼 연동
```

---

## 6. 로컬 실행 및 확인

별도의 빌드 과정 없이 정적 웹 서버를 통해 구동합니다:
```bash
# Python 내장 웹서버를 이용한 포트 4000 기동 (게이트웨이 CORS 허용 포트)
python -m http.server 4000
```
- 브라우저 접속: `http://localhost:4000`
- 인증 상태가 없을 경우 자동으로 `http://localhost:8100/auth/login.html`로 리다이렉트됩니다.

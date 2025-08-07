# SJ Map Platform

VWorld 지도 API를 활용한 웹 기반 지도 서비스입니다.

## 🚀 주요 기능

- **다양한 배경지도**: 일반지도, 위성영상, 하이브리드
- **반응형 디자인**: 모바일, 태블릿, 데스크톱 지원
- **모듈화된 구조**: 유지보수와 확장이 용이한 코드 구조
- **현대적인 UI**: 깔끔하고 직관적인 사용자 인터페이스

## 📁 프로젝트 구조

```
sj-lab-mapservice/
├── index.html                 # 메인 HTML 파일
├── README.md                  # 프로젝트 문서
├── css/
│   ├── layouts/
│   │   └── main.css          # 메인 레이아웃 스타일
│   └── components/
│       ├── header.css        # 헤더 컴포넌트 스타일
│       └── layer-panel.css   # 레이어 패널 스타일
└── js/
    ├── app.js                # 메인 애플리케이션 파일
    ├── modules/
    │   ├── map.js           # 맵 관련 기능
    │   └── ui.js            # UI 관련 기능
    └── utils/
        └── helpers.js        # 유틸리티 함수들
```

## 🛠️ 기술 스택

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **지도 라이브러리**: OpenLayers 7.4.0
- **지도 서비스**: VWorld API
- **모듈 시스템**: ES6 Modules

## 🎯 모듈 구조

### JavaScript 모듈

#### `js/app.js` - 메인 애플리케이션

- 애플리케이션 초기화
- 모듈 import 및 통합

#### `js/modules/map.js` - 맵 기능

- OpenLayers 맵 초기화
- 레이어 관리 (일반지도, 위성영상, 하이브리드)
- 맵 이벤트 처리
- 맵 도구 함수들

#### `js/modules/ui.js` - UI 기능

- 네비게이션 관리
- 레이어 패널 제어
- 탭 전환 기능
- 로딩 상태 관리

#### `js/utils/helpers.js` - 유틸리티

- AJAX 요청 함수
- 좌표 변환 함수
- 거리 계산 함수
- 포맷팅 함수들

### CSS 모듈

#### `css/layouts/main.css` - 메인 레이아웃

- 기본 스타일 리셋
- 페이지 레이아웃
- 반응형 디자인

#### `css/components/header.css` - 헤더 컴포넌트

- 네비게이션 바 스타일
- 로고 및 버튼 디자인

#### `css/components/layer-panel.css` - 레이어 패널

- 사이드 패널 스타일
- 탭 인터페이스
- 레이어 목록 디자인

## 🚀 시작하기

1. **프로젝트 클론**

   ```bash
   git clone [repository-url]
   cd sj-lab-mapservice
   ```

2. **로컬 서버 실행**

   ```bash
   # Python 3
   python -m http.server 8000

   # Node.js
   npx serve .

   # PHP
   php -S localhost:8000
   ```

3. **브라우저에서 접속**
   ```
   http://localhost:8000
   ```

## 🎨 사용법

### 지도 조작

- **드래그**: 지도 이동
- **마우스 휠**: 줌 인/아웃
- **더블클릭**: 줌 인

### 레이어 전환

1. 왼쪽 레이어 패널 열기
2. "배경지도" 탭 선택
3. 원하는 지도 타입 선택

### 네비게이션

- 상단 네비게이션 바에서 페이지 전환
- 지도, 정보 등 다양한 페이지 제공

## 🔧 개발자 도구

브라우저 콘솔에서 사용 가능한 전역 객체들:

```javascript
// 맵 인스턴스
window.mapInstance;

// 맵 도구들
window.mapTools;
window.mapTools.flyTo([127.0, 37.5], 15); // 특정 좌표로 이동
window.mapTools.setZoom(12); // 줌 레벨 설정
window.mapTools.resetMap(); // 맵 리셋

// 유틸리티 함수들
window.mapUtils;
window.mapUtils.formatCoordinate([127.0, 37.5]); // 좌표 포맷팅
window.mapUtils.calculateDistance(coord1, coord2); // 거리 계산
```

## 📱 반응형 지원

- **데스크톱**: 전체 기능 지원
- **태블릿**: 터치 인터페이스 최적화
- **모바일**: 간소화된 UI

## 🔄 모듈 확장

새로운 기능 추가 시:

1. **새 모듈 생성**: `js/modules/` 디렉토리에 추가
2. **CSS 컴포넌트**: `css/components/` 디렉토리에 추가
3. **메인 파일에서 import**: `js/app.js`에서 모듈 import

## 🐛 문제 해결

### 일반적인 문제들

1. **모듈 로드 오류**

   - 로컬 서버 사용 확인
   - 브라우저 개발자 도구에서 네트워크 탭 확인

2. **지도가 표시되지 않음**

   - 인터넷 연결 확인
   - VWorld API 서비스 상태 확인

3. **레이어 패널이 작동하지 않음**
   - JavaScript 콘솔에서 오류 확인
   - DOM 요소 ID 확인

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 문의

프로젝트에 대한 문의사항이 있으시면 이슈를 생성해 주세요.

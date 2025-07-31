# SJ Lab Map Service

OpenLayers와 VWorld를 활용한 SPA(Single Page Application) 맵 서비스입니다.

## 🗺️ 주요 기능

- **다양한 배경지도**: 일반지도, 위성영상, 하이브리드 지도 제공
- **SPA 구조**: 페이지 새로고침 없이 부드러운 네비게이션
- **반응형 디자인**: 모바일과 데스크톱에서 최적화된 사용자 경험
- **실시간 좌표 표시**: 마우스 포인터 위치의 좌표 정보 표시
- **줌 레벨 표시**: 현재 맵의 줌 레벨 정보 표시

## 🛠️ 기술 스택

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Map Library**: OpenLayers 8.2.0
- **Map Service**: VWorld (한국 국토정보플랫폼)
- **Architecture**: SPA (Single Page Application)

## 🚀 시작하기

### 1. 프로젝트 클론

```bash
git clone [repository-url]
cd sj-lab-mapservice
```

### 2. 로컬 서버 실행

```bash
# Python 3
python -m http.server 8000

# 또는 Node.js
npx http-server

# 또는 Live Server (VS Code 확장)
```

### 3. 브라우저에서 접속

```
http://localhost:8000
```

## 📁 프로젝트 구조

```
sj-lab-mapservice/
├── index.html          # 메인 HTML 파일
├── css/
│   └── styles.css      # CSS 스타일시트
├── js/
│   └── app.js         # JavaScript 애플리케이션 로직
└── README.md          # 프로젝트 문서
```

## 🗺️ 맵 기능

### 배경지도 레이어

- **일반지도**: 기본 도로 및 건물 정보
- **위성영상**: 고해상도 위성 이미지
- **하이브리드**: 위성 이미지 + 도로 정보 오버레이

### 맵 컨트롤

- 줌 인/아웃 버튼
- 레이어 전환 버튼
- 실시간 좌표 표시
- 줌 레벨 표시

## 🎨 UI/UX 특징

- **모던 디자인**: 그라데이션 헤더와 카드 기반 레이아웃
- **반응형**: 모바일, 태블릿, 데스크톱 최적화
- **부드러운 애니메이션**: CSS 트랜지션과 호버 효과
- **직관적인 네비게이션**: 탭 기반 페이지 전환

## 🔧 개발자 도구

브라우저 콘솔에서 다음 전역 객체들을 사용할 수 있습니다:

```javascript
// 맵 인스턴스
window.mapInstance;

// 유틸리티 함수들
window.mapUtils.transformCoordinates();
window.mapUtils.formatCoordinate();
window.mapUtils.calculateDistance();

// 맵 도구들
window.mapTools.getViewportInfo();
window.mapTools.flyTo([127.0, 37.5], 15);
window.mapTools.setZoom(12);
window.mapTools.resetMap();
```

## 📱 반응형 지원

- **데스크톱**: 전체 기능과 사이드바 컨트롤
- **태블릿**: 적응형 레이아웃과 터치 최적화
- **모바일**: 세로 레이아웃과 터치 친화적 인터페이스

## 🌐 브라우저 지원

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 연락처

- **이메일**: contact@sjlab.com
- **전화번호**: 02-1234-5678
- **주소**: 서울특별시 강남구 테헤란로 123

---

© 2024 SJ Lab. All rights reserved.

// ==========================================================================
// 프로젝트 소개 영상 팝업 모달 모듈 (intro-modal.js)
// ==========================================================================

const STORAGE_KEY = "SJ_MAP_INTRO_HIDE_UNTIL";

/**
 * 팝업 다시 보지 않기 기간이 유효한지 확인
 * @returns {boolean} true이면 팝업을 띄우지 않음
 */
export function isIntroModalDismissed() {
  try {
    const hideUntil = localStorage.getItem(STORAGE_KEY);
    if (!hideUntil) return false;
    const expiry = Number(hideUntil);
    if (isNaN(expiry)) return false;
    return Date.now() < expiry;
  } catch (e) {
    console.warn("[IntroModal] localStorage 접근 실패:", e);
    return false;
  }
}

/**
 * 지정된 일수 동안 팝업 다시 보지 않기 설정 후 닫기
 * @param {number} days - 1, 7, 30 등
 */
export function hideIntroModalFor(days) {
  try {
    const ms = Number(days) * 24 * 60 * 60 * 1000;
    const expiry = Date.now() + ms;
    localStorage.setItem(STORAGE_KEY, String(expiry));
    console.log(`[IntroModal] ${days}일간 팝업 숨김 설정 완료 (만료: ${new Date(expiry).toLocaleString()})`);
  } catch (e) {
    console.warn("[IntroModal] localStorage 저장 실패:", e);
  }
  closeIntroModal();
}

/**
 * 팝업 모달 열기
 */
export function openIntroModal() {
  const modal = document.getElementById("introVideoModal");
  if (!modal) return;

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");

  // 비디오 준비
  const video = document.getElementById("introVideoPlayer");
  if (video) {
    // 사용자의 직접 인터랙션 전 자동 재생은 정책상 음소거가 필요하므로 컨트롤을 통한 수동 재생 유도
    video.currentTime = 0;
  }
}

/**
 * 팝업 모달 닫기
 */
export function closeIntroModal() {
  const modal = document.getElementById("introVideoModal");
  if (!modal) return;

  // 재생 중인 비디오 정지
  const video = document.getElementById("introVideoPlayer");
  if (video && !video.paused) {
    try {
      video.pause();
    } catch (e) {
      // ignore
    }
  }

  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

/**
 * "자세히 보기" 동작: 팝업 닫고 소개(About) 탭으로 이동
 */
export function navigateToIntroAbout() {
  closeIntroModal();

  // 상단 헤더의 '소개' 네비게이션 버튼 트리거
  const aboutBtn = document.querySelector('.nav-btn[data-page="about"]');
  if (aboutBtn) {
    aboutBtn.click();
  } else {
    // 만약 버튼을 못 찾으면 직접 페이지 전환 폴백
    const pages = document.querySelectorAll(".page");
    pages.forEach((p) => p.classList.remove("active"));
    const aboutPage = document.getElementById("about-page");
    if (aboutPage) aboutPage.classList.add("active");
  }
}

/**
 * 모달 초기화 및 이벤트 리스너 바인딩
 */
export function initializeIntroModal() {
  const modal = document.getElementById("introVideoModal");
  if (!modal) {
    console.warn("[IntroModal] #introVideoModal 요소를 찾을 수 없습니다.");
    return;
  }

  // 1. 닫기 버튼들 바인딩
  const closeBtn = document.getElementById("introModalCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeIntroModal);
  }

  const dismissBtn = document.getElementById("introModalDismissBtn");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", closeIntroModal);
  }

  // 2. "자세히 보기" 버튼 바인딩
  const detailBtn = document.getElementById("introModalDetailBtn");
  if (detailBtn) {
    detailBtn.addEventListener("click", navigateToIntroAbout);
  }

  // 3. 1일 / 7일 / 30일 다시 보지 않기 버튼들 바인딩
  const hideButtons = modal.querySelectorAll(".intro-hide-btn");
  hideButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      const days = this.getAttribute("data-days");
      if (days) {
        hideIntroModalFor(Number(days));
      }
    });
  });

  // 4. 백드롭 클릭 시 닫기 (카드 영역 클릭은 제외)
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      closeIntroModal();
    }
  });

  // 5. ESC 키로 닫기
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("active")) {
      closeIntroModal();
    }
  });

  // 6. 비디오 플레이어 폴백 처리 (영상 미존재 또는 로드 오류 시)
  const video = document.getElementById("introVideoPlayer");
  const fallback = document.getElementById("introVideoFallback");
  if (video && fallback) {
    video.addEventListener("error", function () {
      console.info("[IntroModal] 비디오 소스 로드 불가 - 시스템 시연 안내 폴백 활성화");
      fallback.classList.remove("hidden");
    });
  }

  // 7. 다시 보지 않기 기간 검사 후 팝업 띄우기
  if (!isIntroModalDismissed()) {
    // 맵 로딩과 자연스럽게 어우러지도록 600ms 후 부드럽게 오픈
    setTimeout(() => {
      openIntroModal();
    }, 600);
  } else {
    console.log("[IntroModal] 다시 보지 않기 기간이 활성화되어 팝업을 표시하지 않습니다.");
  }

  // 개발 및 테스트 편의를 위해 전역 객체에 등록
  window.SjIntroModal = {
    open: openIntroModal,
    close: closeIntroModal,
    hideFor: hideIntroModalFor,
    resetHideStatus: () => localStorage.removeItem(STORAGE_KEY),
  };
}

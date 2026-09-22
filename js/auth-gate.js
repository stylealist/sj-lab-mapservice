// SSO 로그인 게이트. 이 페이지의 다른 어떤 스크립트보다도 먼저(문서 head 최상단) 로드되어야
// 인증 안 된 상태의 화면이 잠깐이라도 그려지지 않는다.
//
// 다루는 것: 로컬에 토큰이 있는지 확인 -> 없으면 로그인 서버로 이동 -> 로그인 서버가 다시
// 이 페이지로 돌려보낼 때 URL 해시(#auth_token=...)에 실려 오는 토큰을 저장.
//
// 이 게이트는 화면 접근을 막는 용도(UX 게이트)이며, 백엔드 API(mapservice-rest 등)는
// 이 토큰 검증을 강제하지 않는다(2026-09-22 기준, sj-lab-authserver CLAUDE.md 참고).
(function () {
  "use strict";

  var STORAGE_KEY = "sjLabAuthToken";
  var LOGIN_PATH = "/auth/login.html";

  function getAuthBaseUrl() {
    var hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8100";
    }
    return "https://api.sj-lab.co.kr";
  }

  function readStoredToken() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.accessToken || !data.expiresAt) return null;
      if (Date.now() >= data.expiresAt) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function storeToken(accessToken, expiresInSeconds, username) {
    var data = {
      accessToken: accessToken,
      username: username || "",
      expiresAt: Date.now() + Math.max(0, (Number(expiresInSeconds) || 0) * 1000)
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // 저장 실패해도 이번 페이지 로드는 메모리상 값으로 계속 진행
    }
    return data;
  }

  function clearStoredToken() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* no-op */ }
  }

  function redirectToLogin() {
    var redirectUri = window.location.href.split("#")[0];
    var loginUrl = getAuthBaseUrl() + LOGIN_PATH + "?redirect_uri=" + encodeURIComponent(redirectUri);
    window.location.replace(loginUrl);
  }

  // 로그인 서버에서 돌아온 경우 — 해시에서 토큰을 꺼내 저장하고 주소창에서 지운다.
  function consumeFragmentToken() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf("auth_token=") === -1) return null;
    var fragmentParams = new URLSearchParams(hash.replace(/^#/, ""));
    var token = fragmentParams.get("auth_token");
    if (!token) return null;
    var data = storeToken(token, fragmentParams.get("auth_expires"), fragmentParams.get("auth_username"));
    var cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
    return data;
  }

  window.SjLabAuth = {
    getToken: function () {
      var data = readStoredToken();
      return data ? data.accessToken : null;
    },
    getUsername: function () {
      var data = readStoredToken();
      return data ? data.username : null;
    },
    logout: function () {
      clearStoredToken();
      redirectToLogin();
    },
    getAuthBaseUrl: getAuthBaseUrl
  };

  var current = consumeFragmentToken() || readStoredToken();
  if (!current) {
    redirectToLogin();
  }
})();

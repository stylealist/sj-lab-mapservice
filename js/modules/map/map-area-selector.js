// 지도 영역 선택 모듈
import { getMap } from "./map-core.js";

// Toast 메시지 표시 함수
function showToast(message, type = "info") {
  // 기존 Toast 제거
  const existingToast = document.querySelector(".toast-message");
  if (existingToast) {
    existingToast.remove();
  }

  // Toast 요소 생성
  const toast = document.createElement("div");
  toast.className = `toast-message toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${
        type === "info" ? "ℹ️" : type === "success" ? "✅" : "❌"
      }</span>
      <span class="toast-text">${message}</span>
    </div>
  `;

  // 스타일 추가
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${
      type === "info" ? "#2196F3" : type === "success" ? "#4CAF50" : "#f44336"
    };
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    max-width: 400px;
    text-align: center;
    animation: slideDown 0.3s ease-out;
  `;

  // 애니메이션 CSS 추가
  if (!document.querySelector("#toast-styles")) {
    const style = document.createElement("style");
    style.id = "toast-styles";
    style.textContent = `
      @keyframes slideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      .toast-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // 3초 후 자동 제거
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = "slideDown 0.3s ease-out reverse";
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}

let isAreaSelecting = false;
let selectionRectangle = null;
let startCoordinate = null;
let endCoordinate = null;
let isDragging = false;
let tempRectangle = null;

// 영역 선택 모드 활성화
function startAreaSelection() {
  const map = getMap();
  if (!map) return;

  isAreaSelecting = true;
  map.getTargetElement().style.cursor = "crosshair";

  // 기존 선택 영역 제거
  clearAreaSelection();

  // UI 업데이트
  updateAreaSelectionUI();

  console.log("영역 선택 모드 활성화");
}

// 지도편집 시작 (Toast 메시지와 함께)
function startMapEdit() {
  // Toast 메시지 표시
  showToast(
    "지도에서 편집할 영역을 사각형으로 선택해주세요. 두 번 클릭하여 영역을 완성하세요.",
    "info"
  );

  // 영역 선택 시작
  startAreaSelection();
}

// 영역 선택 모드 비활성화
function stopAreaSelection() {
  const map = getMap();
  if (!map) return;

  isAreaSelecting = false;
  isDragging = false;
  map.getTargetElement().style.cursor = "default";

  // UI 업데이트
  updateAreaSelectionUI();

  console.log("영역 선택 모드 비활성화");
}

// 선택된 영역 제거
function clearAreaSelection() {
  const map = getMap();
  if (!map) return;

  if (selectionRectangle) {
    map.removeLayer(selectionRectangle);
    selectionRectangle = null;
  }

  if (tempRectangle) {
    map.removeLayer(tempRectangle);
    tempRectangle = null;
  }

  startCoordinate = null;
  endCoordinate = null;
  isDragging = false;

  // 지도편집 탭이 제거되었으므로 DOM 요소 접근 제거
  console.log("선택 영역 제거됨");
}

// 영역 선택 이벤트 핸들러
function handleMapClick(event) {
  if (!isAreaSelecting) return;

  const map = getMap();
  const coordinate = event.coordinate;

  if (!startCoordinate) {
    // 첫 번째 클릭 - 시작점 설정
    startCoordinate = coordinate;
    isDragging = true;
    console.log("시작점 설정:", coordinate);
  } else {
    // 두 번째 클릭 - 끝점 설정 및 영역 완성
    endCoordinate = coordinate;
    isDragging = false;
    createSelectionRectangle();
    stopAreaSelection();
    updateAreaInfo();

    // 영역 선택 완료 후 팝업 표시
    showEditPopup();
  }
}

// 마우스 이동 이벤트 핸들러 (드래그 중 사각형 표시)
function handleMapPointerMove(event) {
  if (!isAreaSelecting || !isDragging || !startCoordinate) return;

  const map = getMap();
  const coordinate = event.coordinate;

  // 임시 사각형 업데이트
  updateTempRectangle(startCoordinate, coordinate);
}

// 임시 사각형 업데이트
function updateTempRectangle(startCoord, currentCoord) {
  const map = getMap();
  if (!map) return;

  // 기존 임시 사각형 제거
  if (tempRectangle) {
    map.removeLayer(tempRectangle);
  }

  // 좌표 정렬 (좌상단, 우하단)
  const minX = Math.min(startCoord[0], currentCoord[0]);
  const maxX = Math.max(startCoord[0], currentCoord[0]);
  const minY = Math.min(startCoord[1], currentCoord[1]);
  const maxY = Math.max(startCoord[1], currentCoord[1]);

  // 사각형 좌표 생성
  const rectangleCoords = [
    [minX, minY], // 좌상단
    [maxX, minY], // 우상단
    [maxX, maxY], // 우하단
    [minX, maxY], // 좌하단
    [minX, minY], // 닫기
  ];

  // 사각형 폴리곤 생성
  const rectangle = new ol.geom.Polygon([rectangleCoords]);
  const rectangleFeature = new ol.Feature(rectangle);

  // 스타일 설정 (임시 사각형은 더 투명하게)
  rectangleFeature.setStyle(
    new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "#ff0000",
        width: 2,
        lineDash: [5, 5], // 점선으로 표시
      }),
      fill: new ol.style.Fill({
        color: "rgba(255, 0, 0, 0.05)", // 매우 투명
      }),
    })
  );

  // 벡터 레이어 생성
  const vectorSource = new ol.source.Vector({
    features: [rectangleFeature],
  });

  tempRectangle = new ol.layer.Vector({
    source: vectorSource,
    zIndex: 999, // 최종 사각형보다 낮은 z-index
  });

  map.addLayer(tempRectangle);
}

// 선택 사각형 생성
function createSelectionRectangle() {
  const map = getMap();
  if (!map || !startCoordinate || !endCoordinate) return;

  // 기존 선택 영역 제거
  if (selectionRectangle) {
    map.removeLayer(selectionRectangle);
  }

  // 임시 사각형 제거
  if (tempRectangle) {
    map.removeLayer(tempRectangle);
    tempRectangle = null;
  }

  // 좌표 정렬 (좌상단, 우하단)
  const minX = Math.min(startCoordinate[0], endCoordinate[0]);
  const maxX = Math.max(startCoordinate[0], endCoordinate[0]);
  const minY = Math.min(startCoordinate[1], endCoordinate[1]);
  const maxY = Math.max(startCoordinate[1], endCoordinate[1]);

  // 사각형 좌표 생성
  const rectangleCoords = [
    [minX, minY], // 좌상단
    [maxX, minY], // 우상단
    [maxX, maxY], // 우하단
    [minX, maxY], // 좌하단
    [minX, minY], // 닫기
  ];

  // 사각형 폴리곤 생성
  const rectangle = new ol.geom.Polygon([rectangleCoords]);
  const rectangleFeature = new ol.Feature(rectangle);

  // 스타일 설정
  rectangleFeature.setStyle(
    new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "#ff0000",
        width: 2,
      }),
      fill: new ol.style.Fill({
        color: "rgba(255, 0, 0, 0.1)",
      }),
    })
  );

  // 벡터 레이어 생성
  const vectorSource = new ol.source.Vector({
    features: [rectangleFeature],
  });

  selectionRectangle = new ol.layer.Vector({
    source: vectorSource,
    zIndex: 1000,
  });

  map.addLayer(selectionRectangle);

  console.log("선택 사각형 생성됨");
}

// 영역 정보 업데이트
function updateAreaInfo() {
  if (!startCoordinate || !endCoordinate) return;

  const minX = Math.min(startCoordinate[0], endCoordinate[0]);
  const maxX = Math.max(startCoordinate[0], endCoordinate[0]);
  const minY = Math.min(startCoordinate[1], endCoordinate[1]);
  const maxY = Math.max(startCoordinate[1], endCoordinate[1]);

  const width = maxX - minX;
  const height = maxY - minY;

  console.log("영역 정보 업데이트:", {
    topLeft: [minX, minY],
    bottomRight: [maxX, maxY],
    size: [width, height],
  });
}

// 편집 팝업 표시
function showEditPopup() {
  // 기존 팝업 제거
  const existingPopup = document.querySelector(".edit-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // 팝업 생성
  const popup = document.createElement("div");
  popup.className = "edit-popup";
  popup.innerHTML = `
    <div class="edit-popup-content">
      <div class="edit-popup-header">
        <h3>지도 영역 편집</h3>
        <button class="edit-popup-close" onclick="closeEditPopup()">×</button>
      </div>
      <div class="edit-popup-body">
        <p>선택된 영역을 편집하시겠습니까?</p>
        <div class="edit-popup-actions">
          <button class="edit-btn secondary" onclick="clearAreaSelection(); closeEditPopup();">취소</button>
          <button class="edit-btn primary" onclick="openFabricEditor(); closeEditPopup();">편집기 열기</button>
        </div>
      </div>
    </div>
  `;

  // 스타일 추가
  popup.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    animation: fadeIn 0.3s ease-out;
  `;

  // 팝업 스타일 추가
  if (!document.querySelector("#edit-popup-styles")) {
    const style = document.createElement("style");
    style.id = "edit-popup-styles";
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .edit-popup-content {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        max-width: 400px;
        width: 90%;
        animation: slideUp 0.3s ease-out;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .edit-popup-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      .edit-popup-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
      }
      .edit-popup-close {
        background: none;
        border: none;
        font-size: 24px;
        color: #6b7280;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: background-color 0.2s;
      }
      .edit-popup-close:hover {
        background-color: #f3f4f6;
      }
      .edit-popup-body {
        padding: 20px 24px 24px;
      }
      .edit-popup-body p {
        margin: 0 0 20px;
        color: #4b5563;
        font-size: 14px;
      }
      .edit-popup-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      .edit-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .edit-btn.secondary {
        background: #f3f4f6;
        color: #374151;
      }
      .edit-btn.secondary:hover {
        background: #e5e7eb;
      }
      .edit-btn.primary {
        background: linear-gradient(135deg, rgb(30, 41, 59) 0%, rgb(51, 65, 85) 50%, rgb(71, 85, 105) 100%);
        color: white;
      }
      .edit-btn.primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(popup);
}

// 편집 팝업 닫기
function closeEditPopup() {
  const popup = document.querySelector(".edit-popup");
  if (popup) {
    // 애니메이션 없이 즉시 제거
    popup.remove();
  }

  // 그린 영역 제거 (취소 버튼과 동일한 동작)
  clearAreaSelection();
}

// UI 업데이트
function updateAreaSelectionUI() {
  // 지도편집 탭이 제거되었으므로 UI 업데이트는 필요 없음
  // 이 함수는 호환성을 위해 유지하지만 실제로는 아무것도 하지 않음
  console.log("UI 업데이트 (지도편집 탭 제거로 인해 비활성화)");
}

// Fabric.js 편집기 열기
function openFabricEditor() {
  if (!startCoordinate || !endCoordinate) {
    alert("먼저 편집할 영역을 선택해주세요.");
    return;
  }

  // 선택된 영역의 이미지를 캡처
  captureMapArea();
}

// 지도 영역 캡처
function captureMapArea() {
  const map = getMap();
  if (!map) return;

  // 선택된 영역의 좌표 계산
  const minX = Math.min(startCoordinate[0], endCoordinate[0]);
  const maxX = Math.max(startCoordinate[0], endCoordinate[0]);
  const minY = Math.min(startCoordinate[1], endCoordinate[1]);
  const maxY = Math.max(startCoordinate[1], endCoordinate[1]);

  // 선택된 영역의 사각형과 임시 사각형 제거 (캡처 전)
  if (selectionRectangle) {
    map.removeLayer(selectionRectangle);
  }
  if (tempRectangle) {
    map.removeLayer(tempRectangle);
  }

  // 박스가 완전히 사라진 후 캡처하기 위해 잠시 대기
  setTimeout(() => {
    try {
      // 선택된 영역의 픽셀 좌표 계산
      const topLeftPixel = map.getPixelFromCoordinate([minX, maxY]);
      const bottomRightPixel = map.getPixelFromCoordinate([maxX, minY]);

      // 선택 영역의 픽셀 크기 계산
      const selectionWidth = Math.abs(bottomRightPixel[0] - topLeftPixel[0]);
      const selectionHeight = Math.abs(bottomRightPixel[1] - topLeftPixel[1]);

      console.log("선택 영역 픽셀 크기:", selectionWidth, "x", selectionHeight);
      console.log("선택 영역 픽셀 좌표:", topLeftPixel, "to", bottomRightPixel);

      // 지도 캔버스에서 선택 영역만 추출
      const mapCanvas = map.getViewport().querySelector("canvas");
      if (mapCanvas) {
        // 임시 캔버스 생성하여 선택 영역만 복사
        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");

        // 선택 영역 크기로 임시 캔버스 설정
        tempCanvas.width = selectionWidth;
        tempCanvas.height = selectionHeight;

        // 원본 캔버스에서 선택 영역만 복사
        tempCtx.drawImage(
          mapCanvas,
          topLeftPixel[0],
          topLeftPixel[1], // 소스 시작점
          selectionWidth,
          selectionHeight, // 소스 크기
          0,
          0, // 대상 시작점
          selectionWidth,
          selectionHeight // 대상 크기
        );

        // 임시 캔버스를 이미지로 변환
        const imageDataURL = tempCanvas.toDataURL("image/png", 1.0);

        // 이미지 데이터 URL 검증
        if (!imageDataURL || imageDataURL === "data:,") {
          console.error("이미지 캡처 실패: 빈 데이터 URL");
          alert("지도 이미지 캡처에 실패했습니다. 다시 시도해주세요.");
          return;
        }

        console.log(
          "선택 영역 캡처 성공, 데이터 URL 길이:",
          imageDataURL.length
        );
        console.log(
          "캡처된 이미지 크기:",
          selectionWidth,
          "x",
          selectionHeight
        );

        // 로딩 메시지 표시
        showToast("이미지를 편집기로 전송 중입니다...", "info");

        // Fabric.js 편집기로 전송
        openFabricEditorWithImage(imageDataURL);
      } else {
        console.error("지도 캔버스를 찾을 수 없습니다.");
        alert("지도 캔버스를 찾을 수 없습니다.");
      }
    } catch (error) {
      console.error("이미지 캡처 중 오류:", error);
      alert("지도 이미지 캡처 중 오류가 발생했습니다.");
    }
  }, 200); // 박스 제거 후 200ms 대기
}

// Fabric.js 편집기 열기 (이미지와 함께)
function openFabricEditorWithImage(imageDataURL) {
  // 새 창에서 기존 fabric-editor.html 열기
  const editorWindow = window.open(
    "html/fabric/fabric-editor.html",
    "fabric-editor",
    "width=1200,height=800,scrollbars=yes,resizable=yes"
  );

  if (editorWindow) {
    // 창이 완전히 로드된 후 이미지 설정
    editorWindow.addEventListener("load", function () {
      // 즉시 로딩 메시지 표시
      setTimeout(() => {
        if (editorWindow.showLoadingMessage) {
          editorWindow.showLoadingMessage("캡처 이미지를 불러오는 중입니다...");
        }
      }, 100);

      // fabric-editor.html이 로드된 후 실행
      setTimeout(() => {
        try {
          // fabric-editor.html의 loadMapAreaImage 함수 호출
          if (editorWindow.loadMapAreaImage) {
            editorWindow.loadMapAreaImage(imageDataURL);
            console.log("지도 영역 이미지가 편집기에 로드되었습니다.");
          } else {
            console.error("loadMapAreaImage 함수를 찾을 수 없습니다.");
          }
        } catch (error) {
          console.error("이미지 로드 중 오류 발생:", error);
        }
      }, 1500); // fabric-editor.html 완전 로드 대기
    });
  }
}

// 이벤트 리스너 등록
function initializeAreaSelector() {
  const map = getMap();
  if (!map) return;

  // 지도 클릭 이벤트 등록
  map.on("click", handleMapClick);

  // 지도 포인터 이동 이벤트 등록 (드래그 중 사각형 표시)
  map.on("pointermove", handleMapPointerMove);

  // 지도편집 탭이 제거되었으므로 UI 버튼 이벤트 등록 제거
  console.log("지도 영역 선택 기능 초기화 완료");
}

// 전역 함수로 노출
window.startAreaSelection = startAreaSelection;
window.stopAreaSelection = stopAreaSelection;
window.clearAreaSelection = clearAreaSelection;
window.openFabricEditor = openFabricEditor;
window.initializeAreaSelector = initializeAreaSelector;
window.startMapEdit = startMapEdit;
window.closeEditPopup = closeEditPopup;

export {
  startAreaSelection,
  stopAreaSelection,
  clearAreaSelection,
  openFabricEditor,
  initializeAreaSelector,
};

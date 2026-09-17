// 지도 팝업(ol.Overlay) 헤더 드래그 이동 공용 모듈
// 시설물 상세 팝업(map-facility.js), WFS 레이어 팝업(map-wfs.js), WMS 팝업(map-wms.js)이 함께 쓴다.

/**
 * 팝업 헤더를 잡아 끌어 위치를 옮길 수 있게 한다.
 *
 * 오버레이의 좌표(position)는 대상 지점에 고정해 두고 offset 만 바꾼다.
 * 그래야 옮긴 뒤에도 지도를 움직이면 팝업이 대상 지점을 계속 따라다닌다.
 * ignoreSelector(닫기 버튼 등) 위에서 시작한 드래그는 무시한다.
 *
 * 팝업 요소를 새로 만들 때마다 다시 호출하면 되며, 요소가 제거되면 리스너도 함께 사라진다.
 */
export function bindOverlayHeaderDrag(overlay, header, options = {}) {
  if (!overlay || !header) return;
  const { ignoreSelector = "" } = options;

  // 인라인 스타일 팝업(WFS·WMS)도 드래그 가능한 헤더로 보이도록 직접 지정
  header.style.cursor = "move";
  header.style.userSelect = "none";
  header.style.touchAction = "none"; // 모바일에서 드래그가 지도 제스처로 새지 않도록

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseOffset = [0, 0];

  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return; // 왼쪽 버튼만
    if (ignoreSelector && event.target.closest(ignoreSelector)) return;

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    baseOffset = overlay.getOffset().slice();

    header.setPointerCapture(event.pointerId);
    header.classList.add("dragging");
    header.style.cursor = "grabbing";
    event.preventDefault(); // 텍스트 선택 방지
  });

  header.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    overlay.setOffset([
      baseOffset[0] + (event.clientX - startX),
      baseOffset[1] + (event.clientY - startY),
    ]);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    header.classList.remove("dragging");
    header.style.cursor = "move";
    if (event.pointerId !== undefined && header.hasPointerCapture(event.pointerId)) {
      header.releasePointerCapture(event.pointerId);
    }
  };

  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);
}

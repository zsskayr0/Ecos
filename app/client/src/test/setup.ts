import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// O jsdom não implementa PointerEvent com `pointerId`/`pointerType`, que é o que o arrasto por ponteiro lê.
if (typeof window.PointerEvent === "undefined" || !("pointerType" in window.PointerEvent.prototype)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: PointerEventPolyfill, configurable: true, writable: true });
}

// Também ausentes no jsdom: o arrasto usa `setPointerCapture` e a rolagem automática usa `scrollBy`/`requestAnimationFrame`.
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.scrollBy) Element.prototype.scrollBy = () => {};

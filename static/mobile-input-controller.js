(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MobileInputController = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class MobileInputController {
    constructor({
      send,
      now,
      setTimeout,
      clearTimeout,
      moveInterval = 8,
      doubleTapWindow = 320,
      doubleClickGap = 60,
      longPressDelay = 520,
      wheelInterval = 24,
    }) {
      this.send = send;
      this.now = now;
      this.setTimeout = setTimeout;
      this.clearTimeout = clearTimeout;
      this.moveInterval = moveInterval;
      this.doubleTapWindow = doubleTapWindow;
      this.doubleClickGap = doubleClickGap;
      this.longPressDelay = longPressDelay;
      this.wheelInterval = wheelInterval;

      this.activePointers = new Map();
      this.lastTapTime = 0;
      this.pendingMove = { dx: 0, dy: 0 };
      this.moveFlushTimer = null;
      this.lastMoveTime = 0;
      this.pendingWheel = 0;
      this.wheelFlushTimer = null;
      this.lastWheelTime = 0;
      this.pressedKeys = new Set();
    }

    pointerDown(event) {
      const tapEligible = this.activePointers.size === 0;
      if (!tapEligible) {
        for (const activePointer of this.activePointers.values()) {
          activePointer.tapEligible = false;
          this.cancelLongPress(activePointer);
        }
      }

      const pointer = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startedAt: this.now(),
        tapEligible,
        longPressed: false,
        longPressTimer: null,
      };

      pointer.longPressTimer = this.setTimeout(() => {
        const current = this.activePointers.get(event.pointerId);
        if (!current) return;
        const travel = Math.hypot(current.lastX - current.x, current.lastY - current.y);
        if (current.tapEligible && travel < 10 && this.activePointers.size === 1) {
          current.longPressed = true;
          this.send({ type: "click", button: "right" });
        }
      }, this.longPressDelay);

      this.activePointers.set(event.pointerId, pointer);
    }

    pointerMove(event) {
      const pointer = this.activePointers.get(event.pointerId);
      if (!pointer) return;

      const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
      const pointerCount = this.activePointers.size;
      for (const sample of samples.length ? samples : [event]) {
        const dx = sample.clientX - pointer.lastX;
        const dy = sample.clientY - pointer.lastY;
        pointer.lastX = sample.clientX;
        pointer.lastY = sample.clientY;

        const travel = Math.hypot(pointer.lastX - pointer.x, pointer.lastY - pointer.y);
        if (travel >= 10) {
          this.cancelLongPress(pointer);
        }

        if (pointerCount === 1) {
          this.queueMove(dx * 1.25, dy * 1.25);
        } else if (pointerCount === 2) {
          this.queueWheel(-dy * 0.25);
        }
      }
    }

    pointerUp(event) {
      this.endPointer(event, false);
    }

    pointerCancel(event) {
      this.endPointer(event, true);
    }

    pressKey(code) {
      if (this.pressedKeys.has(code)) return false;
      this.pressedKeys.add(code);
      this.send({ type: "key", code, down: true });
      return true;
    }

    releaseKey(code) {
      if (!this.pressedKeys.has(code)) return false;
      this.pressedKeys.delete(code);
      this.send({ type: "key", code, down: false });
      return true;
    }

    releaseAllKeys() {
      const released = Array.from(this.pressedKeys);
      for (const code of released) {
        this.send({ type: "key", code, down: false });
      }
      this.pressedKeys.clear();
      return released;
    }

    sendText(value) {
      if (typeof value !== "string" || !value.trim()) return false;
      this.send({ type: "text", value });
      return true;
    }

    sendCommand(action) {
      if (!action) return;
      this.send({ type: "cmd", action });
    }

    clearPendingTap() {
      this.lastTapTime = 0;
    }

    endPointer(event, canceled) {
      const pointer = this.activePointers.get(event.pointerId);
      if (!pointer) return;
      this.cancelLongPress(pointer);
      this.activePointers.delete(event.pointerId);
      if (canceled) return;

      const duration = this.now() - pointer.startedAt;
      const travel = Math.hypot(pointer.lastX - pointer.x, pointer.lastY - pointer.y);
      if (pointer.tapEligible && !pointer.longPressed && duration < 220 && travel < 10) {
        const now = this.now();
        if (this.lastTapTime > 0 && now - this.lastTapTime < this.doubleTapWindow) {
          this.setTimeout(
            () => this.send({ type: "click", button: "left", clickCount: 2 }),
            this.doubleClickGap,
          );
          this.lastTapTime = 0;
        } else {
          this.send({ type: "click", button: "left", clickCount: 1 });
          this.lastTapTime = now;
        }
      }
    }

    cancelLongPress(pointer) {
      if (!pointer.longPressTimer) return;
      this.clearTimeout(pointer.longPressTimer);
      pointer.longPressTimer = null;
    }

    queueMove(dx, dy) {
      this.pendingMove.dx += dx;
      this.pendingMove.dy += dy;
      if (!this.moveFlushTimer) {
        this.moveFlushTimer = this.setTimeout(() => this.flushMove(), this.moveInterval);
      }
    }

    flushMove() {
      this.moveFlushTimer = null;
      const now = this.now();
      if (now - this.lastMoveTime < this.moveInterval) {
        this.moveFlushTimer = this.setTimeout(
          () => this.flushMove(),
          this.moveInterval - (now - this.lastMoveTime),
        );
        return;
      }
      const dx = this.pendingMove.dx;
      const dy = this.pendingMove.dy;
      this.pendingMove = { dx: 0, dy: 0 };
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        this.send({ type: "move", dx, dy });
        this.lastMoveTime = now;
      }
    }

    queueWheel(dy) {
      this.pendingWheel += dy;
      if (!this.wheelFlushTimer) {
        this.wheelFlushTimer = this.setTimeout(() => this.flushWheel(), this.wheelInterval);
      }
    }

    flushWheel() {
      this.wheelFlushTimer = null;
      const now = this.now();
      if (now - this.lastWheelTime < this.wheelInterval) {
        this.wheelFlushTimer = this.setTimeout(
          () => this.flushWheel(),
          this.wheelInterval - (now - this.lastWheelTime),
        );
        return;
      }
      const dy = this.pendingWheel;
      this.pendingWheel = 0;
      if (Math.abs(dy) > 0.5) {
        this.send({ type: "wheel", dy });
        this.lastWheelTime = now;
      }
    }
  }

  return MobileInputController;
});

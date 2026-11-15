// A press shorter than this that stays within TAP_MAX_TRAVEL is a tap. A touch that starts soon after a tap and is
// held this long becomes a drag, so every touch after a tap ends as either a double click or a drag.
export const TAP_MAX_DURATION_MS = 400;
export const TAP_MAX_TRAVEL = 10;
// A tap's click waits this long for a second touch, which turns the pair into a double click or a drag.
export const DOUBLE_TAP_WINDOW_MS = 320;

export type Point = { x: number; y: number };
export type GestureMode = 'pointer' | 'scroll' | 'drag';

export type GestureState = {
  mode: GestureMode;
  startedAt: number;
  start: Point;
  last: Point;
  // Where the current one- or two-finger phase began; travel is measured from here.
  anchor: Point;
  maxTouches: number;
  // Sticky: once the tracked point travels TAP_MAX_TRAVEL from the anchor, the gesture is no longer a tap.
  moved: boolean;
  // Began within DOUBLE_TAP_WINDOW_MS of a tap whose click has not been sent yet.
  afterTap: boolean;
};

export function beginGesture(point: Point, now: number, afterTap = false): GestureState {
  return {
    mode: 'pointer',
    startedAt: now,
    start: point,
    last: point,
    anchor: point,
    maxTouches: 1,
    moved: false,
    afterTap,
  };
}

export function distance(from: Point, to: Point) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function recordPosition(state: GestureState, point: Point) {
  if (distance(state.anchor, point) >= TAP_MAX_TRAVEL) state.moved = true;
  state.last = point;
}

export function shouldBeginDrag(state: GestureState) {
  return state.afterTap && state.mode === 'pointer' && state.maxTouches === 1;
}

export function shouldTap(state: GestureState, now: number) {
  return (
    state.mode === 'pointer' &&
    state.maxTouches === 1 &&
    !state.moved &&
    now - state.startedAt < TAP_MAX_DURATION_MS
  );
}

export function shouldRightClick(state: GestureState, now: number) {
  return state.maxTouches === 2 && !state.moved && now - state.startedAt < TAP_MAX_DURATION_MS;
}

export function centroid(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

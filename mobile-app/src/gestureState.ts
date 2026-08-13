export const LONG_PRESS_DELAY_MS = 520;
export const TAP_MAX_DURATION_MS = 220;
export const TAP_MAX_TRAVEL = 10;

export type Point = { x: number; y: number };
export type GestureMode = 'idle' | 'pointer' | 'scroll' | 'window';

export type GestureState = {
  mode: GestureMode;
  startedAt: number;
  start: Point;
  last: Point;
  maxTouches: number;
};

export function beginGesture(point: Point, now: number): GestureState {
  return {
    mode: 'pointer',
    startedAt: now,
    start: point,
    last: point,
    maxTouches: 1,
  };
}

export function distance(from: Point, to: Point) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function shouldBeginWindowMode(state: GestureState) {
  return state.mode === 'pointer' && state.maxTouches === 1 && distance(state.start, state.last) < TAP_MAX_TRAVEL;
}

export function shouldTap(state: GestureState, now: number) {
  return (
    state.mode === 'pointer' &&
    state.maxTouches === 1 &&
    now - state.startedAt < TAP_MAX_DURATION_MS &&
    distance(state.start, state.last) < TAP_MAX_TRAVEL
  );
}

export function centroid(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

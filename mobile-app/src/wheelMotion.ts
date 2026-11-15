export type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

// After the fingers lift, the release velocity decays exponentially with this time constant.
export const COAST_TIME_CONSTANT_MS = 325;
// Wheel units per millisecond. Slower releases stop at once; a coast ends once it slows below the stop speed.
export const COAST_MIN_START_SPEED = 0.06;
export const COAST_STOP_SPEED = 0.02;
// The release velocity averages the movement of this last stretch of the gesture.
const VELOCITY_WINDOW_MS = 100;
// Fingers that rested this long before lifting do not coast.
const RELEASE_PAUSE_MS = 50;

export type WheelMotion = {
  // Finger movement in wheel units. Movement within one frame is summed and whole units are sent once per frame.
  push: (delta: number) => void;
  // The fingers lifted: coast at the release velocity, if they were still moving.
  release: () => void;
  // Drop unsent movement and any coast. Returns whether a coast was running.
  stop: () => boolean;
};

export function createWheelMotion(
  emit: (dy: number) => void,
  scheduler: FrameScheduler,
  now: () => number,
): WheelMotion {
  let frame: number | null = null;
  let pending = 0;
  // The Host scrolls in whole units; the fraction carries into the next frame so slow scrolls still move.
  let remainder = 0;
  let samples: { at: number; delta: number }[] = [];
  let velocity = 0;
  let coastedAt: number | null = null;

  const endCoast = () => {
    velocity = 0;
    coastedAt = null;
  };

  const run = () => {
    frame = null;
    if (coastedAt !== null) {
      const at = now();
      const decay = Math.exp(-(at - coastedAt) / COAST_TIME_CONSTANT_MS);
      // Distance covered while the velocity decayed over this step.
      pending += velocity * COAST_TIME_CONSTANT_MS * (1 - decay);
      velocity *= decay;
      coastedAt = at;
      if (Math.abs(velocity) < COAST_STOP_SPEED) endCoast();
    }
    const total = pending + remainder;
    const whole = Math.trunc(total);
    pending = 0;
    remainder = total - whole;
    if (whole !== 0) emit(whole);
    if (coastedAt !== null) frame = scheduler.request(run);
  };

  const schedule = () => {
    if (frame === null) frame = scheduler.request(run);
  };

  return {
    push(delta) {
      endCoast();
      // A fraction left over from the other direction would eat into the first unit of this one.
      if (delta * remainder < 0) remainder = 0;
      const at = now();
      samples.push({ at, delta });
      samples = samples.filter((sample) => at - sample.at <= VELOCITY_WINDOW_MS);
      pending += delta;
      schedule();
    },
    release() {
      const at = now();
      const recent = samples.filter((sample) => at - sample.at <= VELOCITY_WINDOW_MS);
      samples = [];
      const first = recent[0];
      const last = recent[recent.length - 1];
      if (!first || !last || last.at === first.at || at - last.at > RELEASE_PAUSE_MS) return;
      // Each sample's delta is the movement since the one before it, so the first sample only marks the start.
      const travel = recent.slice(1).reduce((sum, sample) => sum + sample.delta, 0);
      const releaseVelocity = travel / (last.at - first.at);
      if (Math.abs(releaseVelocity) < COAST_MIN_START_SPEED) return;
      velocity = releaseVelocity;
      coastedAt = at;
      schedule();
    },
    stop() {
      const coasting = coastedAt !== null;
      endCoast();
      pending = 0;
      remainder = 0;
      samples = [];
      if (frame !== null) scheduler.cancel(frame);
      frame = null;
      return coasting;
    },
  };
}

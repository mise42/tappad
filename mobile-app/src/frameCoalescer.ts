export type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type LatestFrameCoalescer<T> = {
  push: (value: T) => void;
  cancel: () => void;
};

export function createLatestFrameCoalescer<T>(
  emit: (value: T) => void,
  scheduler: FrameScheduler,
): LatestFrameCoalescer<T> {
  let frame: number | null = null;
  let latest: T;
  let hasPendingValue = false;

  const run = () => {
    frame = null;
    if (!hasPendingValue) return;
    hasPendingValue = false;
    emit(latest);
  };

  return {
    push(value) {
      latest = value;
      hasPendingValue = true;
      if (frame === null) frame = scheduler.request(run);
    },
    cancel() {
      hasPendingValue = false;
      if (frame === null) return;
      scheduler.cancel(frame);
      frame = null;
    },
  };
}

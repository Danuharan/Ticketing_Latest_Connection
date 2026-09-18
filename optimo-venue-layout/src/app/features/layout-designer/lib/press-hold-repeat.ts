export type PressHoldRepeatControl = {
  stop: () => void;
};

/** Fire `action` once immediately, then repeat while the pointer is held. */
export function startPressHoldRepeat(
  action: () => void,
  options?: { initialDelayMs?: number; intervalMs?: number },
): PressHoldRepeatControl {
  const initialDelayMs = options?.initialDelayMs ?? 320;
  const intervalMs = options?.intervalMs ?? 70;

  action();

  let delayTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    delayTimer = null;
    intervalTimer = setInterval(action, intervalMs);
  }, initialDelayMs);

  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  return {
    stop: () => {
      if (delayTimer) {
        clearTimeout(delayTimer);
        delayTimer = null;
      }
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
    },
  };
}

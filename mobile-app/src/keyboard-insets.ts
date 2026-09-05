export function keyboardInsetFromFrame(
  windowHeight: number,
  keyboardScreenY: number | null,
  bottomSafeArea: number,
) {
  if (keyboardScreenY === null) return 0;
  return Math.max(windowHeight - keyboardScreenY - bottomSafeArea, 0);
}

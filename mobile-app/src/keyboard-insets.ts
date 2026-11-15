// React Native's Android keyboard events report the IME height above the system bars
// (and re-emit it when a voice or emoji panel changes height), so it already excludes
// the bottom safe area. iOS reports the full keyboard frame, including the home indicator.
export function keyboardInset(
  platform: string,
  keyboardHeight: number | null,
  bottomSafeArea: number,
) {
  if (keyboardHeight === null) return 0;
  const inset = platform === 'android' ? keyboardHeight : keyboardHeight - bottomSafeArea;
  return Math.max(inset, 0);
}

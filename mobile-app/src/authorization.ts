export const AUTHORIZATION_PASSWORD_PREFIX = 'tappad.authorization-password.v1.';
export const AUTHORIZATION_PASSWORD_LIMIT_BYTES = 1_024;
export const AUTHORIZATION_RETRY_COOLDOWN_MS = 2_000;

type AuthorizationRecoveryInput = {
  requestActive: boolean;
  passwordSaved: boolean;
  submittedAt: number | null;
  now: number;
};

export type AuthorizationRecoveryState = 'hidden' | 'cooldown' | 'replace';

export function authorizationPasswordKey(hostId: string) {
  return `${AUTHORIZATION_PASSWORD_PREFIX}${encodeURIComponent(hostId)}`;
}

export function authorizationPasswordError(password: string) {
  if (!password) return '请输入此 Host 的密码。';
  if (!/^[\x20-\x7E]+$/.test(password)) return '首版授权仅支持 ASCII 密码。';
  if (password.length > AUTHORIZATION_PASSWORD_LIMIT_BYTES) return '密码过长。';
  return null;
}

export function authorizationResultNotice(status: string | undefined, message: string | undefined) {
  if (status === 'submitted') return '已提交';
  return message || '授权输入未提交。';
}

export function authorizationRecoveryState({
  requestActive,
  passwordSaved,
  submittedAt,
  now,
}: AuthorizationRecoveryInput): AuthorizationRecoveryState {
  if (!requestActive || !passwordSaved || submittedAt === null) return 'hidden';
  return now - submittedAt < AUTHORIZATION_RETRY_COOLDOWN_MS ? 'cooldown' : 'replace';
}

export function shouldMaskAuthorizationPassword(visible: boolean) {
  return !visible;
}

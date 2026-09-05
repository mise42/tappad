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
  if (!password) return 'Enter the Host password.';
  if (!/^[\x20-\x7E]+$/.test(password)) return 'Only ASCII passwords are supported.';
  if (password.length > AUTHORIZATION_PASSWORD_LIMIT_BYTES) return 'Password is too long.';
  return null;
}

export function authorizationResultNotice(status: string | undefined, message: string | undefined) {
  if (status === 'submitted') return 'Submitted';
  return message || 'Authorization was not submitted.';
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

export const MATCH_STATUSES = {
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  WON: 'WON',
  LOST: 'LOST',
  VOID: 'VOID',
  INTERRUPTED: 'INTERRUPTED',
  POSTPONED: 'POSTPONED',
} as const;

export type MatchStatus = typeof MATCH_STATUSES[keyof typeof MATCH_STATUSES];

export const ACCESS_MODES = {
  FREE: 'FREE',
  REGISTRATION_REQUIRED: 'REGISTRATION_REQUIRED',
  GATED_LATER: 'GATED_LATER',
  /** @deprecated mapped to REGISTRATION_REQUIRED */
  VIP_REFERRAL: 'VIP_REFERRAL',
  /** @deprecated mapped to GATED_LATER */
  DEPOSIT_REQUIRED: 'DEPOSIT_REQUIRED',
} as const;

export type AccessMode = typeof ACCESS_MODES[keyof typeof ACCESS_MODES];

export const VERIFY_STATUSES = {
  NONE: 'none',
  PENDING: 'pending',
  VERIFIED: 'verified',
} as const;

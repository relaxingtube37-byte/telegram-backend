export const MATCH_STATUSES = {
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  WON: 'WON',
  LOST: 'LOST',
  VOID: 'VOID',
  INTERRUPTED: 'INTERRUPTED',
} as const;

export type MatchStatus = typeof MATCH_STATUSES[keyof typeof MATCH_STATUSES];

export const ACCESS_MODES = {
  FREE: 'FREE',
  VIP_REFERRAL: 'VIP_REFERRAL',
} as const;

export type AccessMode = typeof ACCESS_MODES[keyof typeof ACCESS_MODES];

export const VERIFY_STATUSES = {
  NONE: 'none',
  PENDING: 'pending',
  VERIFIED: 'verified',
} as const;

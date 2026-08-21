export { db } from './db/connection';
export { UsersRepo } from './db/repositories/users.repo';
export { ReferralsRepo } from './db/repositories/referrals.repo';
export { PredictionsRepo } from './db/repositories/predictions.repo';
export { SettingsRepo } from './db/repositories/settings.repo';
export { buildReferralUrl, buildGoUrl } from './utils/subidBuilder';

import { UsersRepo } from './db/repositories/users.repo';
export const setVerified = UsersRepo.setVerified;
export const setUserDeposited = UsersRepo.setDeposited;
export const setPendingSite = UsersRepo.setPendingSite;
export const getLatestUnverifiedUser = UsersRepo.getLatestUnverified;

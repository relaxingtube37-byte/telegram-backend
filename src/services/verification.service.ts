import { UsersRepo } from '../db/repositories/users.repo';
import { ReferralsRepo } from '../db/repositories/referrals.repo';
import { buildReferralUrl } from '../utils/subidBuilder';
import { Logger } from '../utils/logger';

export const VerificationService = {
  getRedirectUrl: (siteId: number, telegramId: number): string => {
    const site = ReferralsRepo.getById(siteId);
    if (!site) return '';

    // Mark pending site click for fallback postback matching
    UsersRepo.setPendingSite(telegramId, siteId);
    return buildReferralUrl(site.referral_url, telegramId);
  },

  handlePostback: (targetKey: string, rawSubId?: string, isDeposit = false) => {
    let site = targetKey ? ReferralsRepo.getByPostbackKey(targetKey) : undefined;
    if (!site) {
      site = ReferralsRepo.getActive()[0];
    }
    const siteId = site ? site.id : undefined;
    const siteName = site ? site.name : 'Default Partner';

    let telegramId: number | null = null;
    if (rawSubId) {
      const digits = String(rawSubId).replace(/\D/g, '');
      if (digits && digits.length >= 5) {
        telegramId = parseInt(digits, 10);
      }
    }

    // Fallback matching if subid was lost by partner network
    if (!telegramId || isNaN(telegramId)) {
      const fallbackUser = UsersRepo.getLatestUnverified(site.id);
      if (fallbackUser) {
        telegramId = fallbackUser.telegram_id;
        Logger.info(`[POSTBACK FALLBACK] Matched to user ${telegramId}`);
      }
    }

    if (!telegramId) {
      return { success: false, error: 'Missing numeric subid/user_id in request and no pending user found' };
    }

    if (isDeposit) {
      UsersRepo.setDeposited(telegramId);
      Logger.success(`[POSTBACK DEPOSIT] User ${telegramId} deposited via site "${siteName}"`);
    } else {
      UsersRepo.setVerified(telegramId, siteId, 'postback');
      Logger.success(`[POSTBACK VERIFIED] User ${telegramId} verified via site "${siteName}"`);
    }

    return {
      success: true,
      status: isDeposit ? 'deposited' : 'verified',
      telegram_id: String(telegramId),
      site: siteName,
    };
  },
};

import { Request, Response } from 'express';
import { VerificationService } from '../services/verification.service';

export const GoRedirectController = {
  handleRedirect: async (req: Request, res: Response) => {
    const siteId = parseInt(String(req.params.siteId), 10);
    const telegramId = parseInt(String(req.params.userId), 10);

    if (isNaN(siteId) || isNaN(telegramId)) {
      return res.status(400).send('Invalid site or user ID');
    }

    const redirectUrl = VerificationService.getRedirectUrl(siteId, telegramId);
    if (!redirectUrl) {
      return res.status(404).send('Referral site not found or inactive');
    }

    return res.redirect(302, redirectUrl);
  },
};

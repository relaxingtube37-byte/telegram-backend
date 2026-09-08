import { Request, Response } from 'express';
import { VerificationService } from '../services/verification.service';
import type { ReferralActionType } from '../business-actions';

function parseOptionalInt(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

export const GoRedirectController = {
  handleRedirect: async (req: Request, res: Response) => {
    const siteId = parseInt(String(req.params.siteId), 10);
    const userRef = String(req.params.userId || '').trim();

    if (isNaN(siteId) || !userRef) {
      return res.status(400).send('Invalid site or user ID');
    }

    const actionRaw = String(req.query.action || 'registration').toLowerCase();
    const action: ReferralActionType = actionRaw === 'watch_live' ? 'watch_live' : 'registration';

    const result = VerificationService.buildAttributedRedirect({
      siteId,
      userRef,
      action,
      sessionRef: String(req.query.session || req.query.session_ref || '').trim() || undefined,
      matchId: parseOptionalInt(req.query.match_id ?? req.query.matchId),
      fixtureId: parseOptionalInt(req.query.fixture_id ?? req.query.fixtureId),
      pageContext: String(req.query.page || req.query.page_context || '').trim() || undefined,
    });

    if (!result.ok) {
      return res.status(result.status).send(result.error);
    }

    // Expose click id for debugging/tests without leaking in partner page
    res.setHeader('X-Ptin-Click-Id', result.click_id);
    return res.redirect(302, result.url);
  },
};

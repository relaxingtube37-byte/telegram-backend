/** Phase D editorial validation (server-side gate before publish). */

export type EditorialPublishStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived';

export const EDITORIAL_STATUS_FLOW: Record<EditorialPublishStatus, EditorialPublishStatus[]> = {
  draft: ['review', 'archived'],
  review: ['draft', 'approved', 'archived'],
  approved: ['review', 'published', 'archived'],
  published: ['archived', 'draft'],
  archived: ['draft'],
};

export const FORBIDDEN_EDITORIAL_PHRASES = [
  'bet now',
  'place a bet',
  'guaranteed win',
  'sure win',
  'sure bet',
  'lock it in',
  'cash out',
  'free bet',
  'bonus code',
  'deposit now',
  'odds boost',
  'gamble',
  'betting tip of the day',
  'must bet',
];

export interface EditorialValidationInput {
  fixtureId?: number;
  title?: string;
  shortSummary?: string;
  slug?: string;
  seoTitle?: string;
  seoDescription?: string;
  guestSafeSummary?: string;
  keyFacts?: string[];
  bodyText?: string;
}

export function canTransitionStatus(from: EditorialPublishStatus, to: EditorialPublishStatus): boolean {
  if (from === to) return true;
  return (EDITORIAL_STATUS_FLOW[from] || []).includes(to);
}

export function validateEditorialForPublish(input: EditorialValidationInput): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.fixtureId) errors.push('fixtureId is required');
  if (!input.title?.trim()) errors.push('title is required');
  if (!input.shortSummary?.trim()) errors.push('shortSummary is required');
  if (!input.slug?.trim()) errors.push('slug is required');
  if (!input.seoTitle?.trim()) errors.push('seo title is required');
  if (!input.seoDescription?.trim()) errors.push('seo description is required');
  if (!input.guestSafeSummary?.trim()) errors.push('guestSafeSummary is required for publish');

  const titleLen = (input.title || '').trim().length;
  if (input.title && (titleLen < 12 || titleLen > 110)) {
    errors.push('title length must be 12–110 characters');
  }
  const seoTitleLen = (input.seoTitle || '').trim().length;
  if (input.seoTitle && (seoTitleLen < 20 || seoTitleLen > 65)) {
    errors.push('title tag length must be 20–65 characters');
  }
  const descLen = (input.seoDescription || '').trim().length;
  if (input.seoDescription && (descLen < 70 || descLen > 170)) {
    errors.push('meta description length must be 70–170 characters');
  }

  const slug = (input.slug || '').trim();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    errors.push('slug failed sanity check');
  }

  if (!input.keyFacts || input.keyFacts.length < 2) {
    errors.push('publish requires at least 2 key facts');
  }

  const blob = [
    input.title,
    input.shortSummary,
    input.guestSafeSummary,
    input.bodyText,
    ...(input.keyFacts || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const p of FORBIDDEN_EDITORIAL_PHRASES) {
    if (blob.includes(p)) {
      errors.push(`forbidden betting-heavy phrase: "${p}"`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

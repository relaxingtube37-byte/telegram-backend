import { ENV } from '../config/env';

export const buildReferralUrl = (baseUrl: string, telegramId: number): string => {
  if (!baseUrl || !baseUrl.trim()) return '';
  const cleanUrl = baseUrl.trim();
  const sub = String(telegramId);
  try {
    const parsed = new URL(cleanUrl);
    parsed.searchParams.set('subid', sub);
    parsed.searchParams.set('sub1', sub);
    if (!parsed.searchParams.has('sub_id')) parsed.searchParams.set('sub_id', sub);
    if (!parsed.searchParams.has('click_id')) parsed.searchParams.set('click_id', sub);
    return parsed.toString();
  } catch {
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}subid=${sub}&sub1=${sub}`;
  }
};

export const buildGoUrl = (siteId: number, telegramId: number): string => {
  return `${ENV.PUBLIC_BASE_URL}/go/${siteId}/${telegramId}`;
};

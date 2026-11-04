/** Copy and context for the holiday operations pause announcement email. */

export type OperationsPauseAnnouncementEmailContext = {
  shopUrl: string;
  closedFromLabel: string;
  resumeLabel: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  paragraphOne: string;
  paragraphTwo: string;
  signOff: string;
  teamLineOne: string;
  teamLineTwo: string;
  ctaLabel: string;
  currentYear: number;
};

export const DEFAULT_OPERATIONS_PAUSE_EMAIL_CLOSED_FROM = 'November 5';
export const DEFAULT_OPERATIONS_PAUSE_EMAIL_RESUME = 'January 2027';

export function operationsPauseAnnouncementEmailSubject(): string {
  return 'Closed for the holidays';
}

export function buildOperationsPauseAnnouncementEmailContext(options?: {
  shopUrl?: string;
  closedFromLabel?: string;
  resumeLabel?: string;
}): OperationsPauseAnnouncementEmailContext {
  const closedFromLabel =
    options?.closedFromLabel?.trim() ||
    process.env.OPERATIONS_PAUSE_CLOSED_FROM?.trim() ||
    DEFAULT_OPERATIONS_PAUSE_EMAIL_CLOSED_FROM;
  const resumeLabel =
    options?.resumeLabel?.trim() ||
    process.env.OPERATIONS_PAUSE_RESUME_LABEL?.trim() ||
    DEFAULT_OPERATIONS_PAUSE_EMAIL_RESUME;
  const shopUrl =
    options?.shopUrl?.trim() ||
    process.env.OPERATIONS_PAUSE_EMAIL_SHOP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    'https://www.relisted.com/shop';

  const preheader = `Rentals and purchases pause from ${closedFromLabel} until ${resumeLabel}. Browse and list anytime.`;

  return {
    shopUrl,
    closedFromLabel,
    resumeLabel,
    preheader,
    eyebrow: 'An important update from Relisted Labels',
    headline: 'Closed for the holidays',
    paragraphOne:
      'After a full year with our community, we are taking a holiday break.',
    paragraphTwo: `Rentals and purchases pause from ${closedFromLabel} through ${resumeLabel}. You can still explore the shop and list from your wardrobe.`,
    signOff: 'Happy holidays. See you in the new year.',
    teamLineOne: 'With love,',
    teamLineTwo: 'the Relisted Labels team',
    ctaLabel: 'Continue browsing',
    currentYear: new Date().getFullYear(),
  };
}

export type OperationsPauseConfig = {
  active: boolean;
  resumeLabel: string;
  closedFromLabel: string;
};

export const DEFAULT_OPERATIONS_PAUSE_RESUME_LABEL = 'January 2027';
export const DEFAULT_OPERATIONS_PAUSE_CLOSED_FROM = 'November 5';

export const OPERATIONS_PAUSE_USER_MESSAGE =
  'Relisted Labels is closed for the holidays. Rentals and purchases are paused for now.';

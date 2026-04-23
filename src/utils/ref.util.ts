import { randomUUID } from 'crypto';

export const generateTransactionRef = () => {
  return `${randomUUID()}-${Date.now()}`;
};

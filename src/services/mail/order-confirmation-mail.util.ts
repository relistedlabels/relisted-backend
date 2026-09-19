import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';

export function resolveOrderConfirmationMailSubject(input: {
  listerNewOrderConfirmed?: boolean;
  customerName?: string;
}): string {
  if (input.listerNewOrderConfirmed) {
    return Auth_Otp_Token_Subject.LISTER_ORDER_PLACED;
  }
  if (input.customerName?.trim()) {
    return Auth_Otp_Token_Subject.CONFIRM_ORDER;
  }
  return Auth_Otp_Token_Subject.ORDER_AWAITING_APPROVAL;
}

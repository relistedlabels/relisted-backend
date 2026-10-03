import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';
import { resolveOrderConfirmationMailSubject } from './order-confirmation-mail.util';

describe('resolveOrderConfirmationMailSubject', () => {
  it('uses lister subject for paid lister confirmations', () => {
    expect(
      resolveOrderConfirmationMailSubject({
        listerNewOrderConfirmed: true,
        customerName: 'Ada',
      }),
    ).toBe(Auth_Otp_Token_Subject.LISTER_ORDER_PLACED);
  });

  it('uses renter confirmation subject when customerName is present', () => {
    expect(
      resolveOrderConfirmationMailSubject({
        customerName: 'Ada',
      }),
    ).toBe(Auth_Otp_Token_Subject.CONFIRM_ORDER);
  });

  it('uses approval subject for legacy lister approval emails', () => {
    expect(resolveOrderConfirmationMailSubject({})).toBe(
      Auth_Otp_Token_Subject.ORDER_AWAITING_APPROVAL,
    );
  });
});

import { notifyAdminsReturnRequestPastDue } from './notify-admins-return-request-past-due.util';
import { fetchAdminAlertRecipients } from './shipment-admin-alert-recipients';

jest.mock('./shipment-admin-alert-recipients', () => ({
  fetchAdminAlertRecipients: jest.fn(),
}));

const mockFetchAdmins = fetchAdminAlertRecipients as jest.MockedFunction<
  typeof fetchAdminAlertRecipients
>;

describe('notifyAdminsReturnRequestPastDue', () => {
  const mockNotification = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const mockMail = {
    sendAdminReturnRequestPastDueAlert: jest.fn().mockResolvedValue(undefined),
  };
  const mockPrisma = {} as never;

  const input = {
    orderId: 'order-uuid-1',
    humanOrderId: 'ORD-1001',
    shipmentId: 'ship-ret-1',
    productName: 'Silk dress',
    renterName: 'Jane Renter',
    renterEmail: 'jane@example.com',
    listerName: 'Style Closet',
    windowLabel: 'Mon 10 Jun, 8am to 5pm',
    daysPastDue: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAdmins.mockResolvedValue([
      { id: 'admin-1', email: 'admin@test.com', name: 'Admin One' },
      { id: 'admin-2', email: 'ops@test.com', name: 'Ops Admin' },
    ]);
  });

  it('sends in-app notification and email to each admin recipient', async () => {
    const count = await notifyAdminsReturnRequestPastDue(
      mockPrisma,
      mockNotification as never,
      mockMail as never,
      input,
    );

    expect(count).toBe(2);
    expect(mockNotification.createNotification).toHaveBeenCalledTimes(2);
    expect(mockNotification.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        title: 'Overdue return request',
        type: 'ADMIN_RETURN_REQUEST_PAST_DUE',
        sendEmail: false,
        metadata: expect.objectContaining({
          orderId: 'order-uuid-1',
          orderNumber: 'ORD-1001',
          shipmentId: 'ship-ret-1',
          daysPastDue: 1,
        }),
      }),
    );
    expect(mockMail.sendAdminReturnRequestPastDueAlert).toHaveBeenCalledTimes(2);
    expect(mockMail.sendAdminReturnRequestPastDueAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@test.com',
        humanOrderId: 'ORD-1001',
        renterEmail: 'jane@example.com',
        daysPastDue: 1,
      }),
    );
  });

  it('returns 0 and skips notifications when no admin recipients exist', async () => {
    mockFetchAdmins.mockResolvedValue([]);

    const count = await notifyAdminsReturnRequestPastDue(
      mockPrisma,
      mockNotification as never,
      mockMail as never,
      input,
    );

    expect(count).toBe(0);
    expect(mockNotification.createNotification).not.toHaveBeenCalled();
    expect(mockMail.sendAdminReturnRequestPastDueAlert).not.toHaveBeenCalled();
  });

  it('continues when one admin email fails', async () => {
    mockMail.sendAdminReturnRequestPastDueAlert
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce(undefined);

    const count = await notifyAdminsReturnRequestPastDue(
      mockPrisma,
      mockNotification as never,
      mockMail as never,
      input,
    );

    expect(count).toBe(2);
    expect(mockNotification.createNotification).toHaveBeenCalledTimes(2);
    expect(mockMail.sendAdminReturnRequestPastDueAlert).toHaveBeenCalledTimes(2);
  });
});

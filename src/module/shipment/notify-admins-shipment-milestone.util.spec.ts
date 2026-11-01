import {
  notifyAdminsShipmentBooked,
  notifyAdminsShipmentDelivered,
} from './notify-admins-shipment-milestone.util';
import { fetchAdminAlertRecipients } from './shipment-admin-alert-recipients';

jest.mock('./shipment-admin-alert-recipients', () => ({
  fetchAdminAlertRecipients: jest.fn(),
}));

const fetchAdmins = fetchAdminAlertRecipients as jest.MockedFunction<
  typeof fetchAdminAlertRecipients
>;

describe('notifyAdminsShipmentMilestone', () => {
  const prisma = {} as any;
  const notificationService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  };
  const mailService = {
    sendAdminShipmentBookedAlert: jest.fn().mockResolvedValue(undefined),
    sendAdminShipmentDeliveredAlert: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('notifies all admins on booked', async () => {
    fetchAdmins.mockResolvedValue([
      { id: 'a1', email: 'admin@relisted.com', name: 'Admin' },
    ]);

    const count = await notifyAdminsShipmentBooked(
      prisma,
      notificationService as any,
      mailService as any,
      {
        shipmentId: 'sh-1',
        humanOrderId: 'ORD-1',
        legLabel: 'Outbound',
        productNames: ['Dress'],
      },
    );

    expect(count).toBe(1);
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_SHIPMENT_BOOKED' }),
    );
    expect(mailService.sendAdminShipmentBookedAlert).toHaveBeenCalled();
  });

  it('notifies all admins on delivered', async () => {
    fetchAdmins.mockResolvedValue([
      { id: 'a1', email: 'admin@relisted.com', name: 'Admin' },
    ]);

    await notifyAdminsShipmentDelivered(
      prisma,
      notificationService as any,
      mailService as any,
      {
        shipmentId: 'sh-1',
        humanOrderId: 'ORD-1',
        legLabel: 'Return',
      },
    );

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_SHIPMENT_DELIVERED' }),
    );
    expect(mailService.sendAdminShipmentDeliveredAlert).toHaveBeenCalled();
  });

  it('returns 0 when no admins', async () => {
    fetchAdmins.mockResolvedValue([]);
    const count = await notifyAdminsShipmentBooked(
      prisma,
      notificationService as any,
      mailService as any,
      {
        shipmentId: 'sh-1',
        humanOrderId: 'ORD-1',
        legLabel: 'Outbound',
      },
    );
    expect(count).toBe(0);
    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });
});

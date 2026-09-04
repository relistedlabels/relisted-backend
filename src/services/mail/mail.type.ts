import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class VerificationDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;

  @IsString()
  @IsOptional()
  verificationLink?: string;

  @IsNumber()
  @IsOptional()
  expiryMinutes?: number;

  @IsOptional()
  @IsBoolean()
  adminMfa?: boolean;
}

export class VerifyOrderDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  renterName: string;
  @IsString()
  orderId: string;
  @IsNumber()
  totalAmount: number;
  @IsString()
  platformName: string;

  @IsString()
  approvalLink: string;

  @IsString()
  productName: string;
  @IsString()
  days: string;
  @IsNumber()
  price: number;

  @IsOptional()
  items?: any[];

  @IsString()
  @IsOptional()
  requestType?: string;

  /** When true, lister email is a paid order confirmation (no approval / expiry copy). */
  @IsOptional()
  @IsBoolean()
  listerNewOrderConfirmed?: boolean;

  /** Renter checkout confirmation */
  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsOptional()
  orderLink?: string;

  @IsOptional()
  orderLines?: Array<{
    productName: string;
    imageUrl?: string | null;
    lineType: 'rental' | 'purchase';
    days?: number;
    rentalPeriodText?: string | null;
    rentalDeliveryWindowText?: string | null;
    returnPickupWindowText?: string | null;
    purchaseDeliveryWindowText?: string | null;
  }>;

  @IsOptional()
  @IsBoolean()
  hasOrderLines?: boolean;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  year: number;

  @IsNumber()
  @IsOptional()
  expiryMinutes?: number;
}

export class RentalRequestDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  listerName: string;
  @IsString()
  productName: string;
  @IsString()
  requestId: string;
  @IsNumber()
  rentalDays: number;
  @IsNumber()
  totalPrice: number;
  @IsString()
  startDate: string;
  @IsString()
  endDate: string;
  @IsString()
  @IsOptional()
  viewLink?: string;

  @IsBoolean()
  @IsOptional()
  withdrawn?: boolean;

  @IsBoolean()
  @IsOptional()
  afterApproval?: boolean;

  @IsString()
  @IsOptional()
  requestType?: string;
}

export class AvailabilityRequestReminderDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  listerName: string;

  @IsString()
  productName: string;

  @IsString()
  intent: 'rerequest' | 'now_available';

  @IsString()
  @IsOptional()
  requestType?: string;

  @IsString()
  cartLink: string;
}

export class AvailabilityCheckoutReminderDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  listerName: string;

  @IsString()
  productName: string;

  @IsString()
  requestType: string;

  @IsString()
  cartLink: string;

  @IsString()
  @IsOptional()
  stage?: string;
}

export class AvailabilityExpiredListerReminderDto {
  @IsEmail()
  email: string;

  @IsString()
  listerName: string;

  @IsString()
  renterName: string;

  @IsString()
  productName: string;

  @IsString()
  requestType: string;

  @IsString()
  orderLink: string;

  @IsString()
  @IsOptional()
  stage?: string;
}

export class RentalResponseDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  listerName: string;
  @IsString()
  productName: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  reason?: string;
  @IsString()
  @IsOptional()
  notes?: string;
  @IsString()
  @IsOptional()
  checkoutLink?: string;

  @IsString()
  @IsOptional()
  requestType?: string;
}

export class WithdrawalDto {
  @IsEmail()
  email: string;
  @IsString()
  userName: string;
  @IsNumber()
  amount: number;
  @IsString()
  reference: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  bankName?: string;
  @IsString()
  @IsOptional()
  accountNumber?: string;
}

export class ShippingDto {
  @IsEmail()
  email: string;
  @IsString()
  userName: string;
  @IsString()
  orderId: string;
  @IsString()
  status: string;
  @IsString()
  @IsOptional()
  trackingNumber?: string;
  /** Carrier tracking page URL (from dispatch or resolved from pricing tier). */
  @IsString()
  @IsOptional()
  trackingUrl?: string;
  /** e.g. Topship, Shipbubble, Chowdeck Relay — used in email copy when no trackingUrl. */
  @IsString()
  @IsOptional()
  trackingProviderLabel?: string;
  @IsString()
  @IsOptional()
  estimatedDelivery?: string;
  /** Overrides default "Shipping Status Update" subject when set */
  @IsString()
  @IsOptional()
  emailSubject?: string;
  /** Optional <h2> title inside the shipping-update template */
  @IsString()
  @IsOptional()
  emailHeading?: string;
  @IsString()
  @IsOptional()
  pickupWindowSummary?: string;
  @IsString()
  @IsOptional()
  extraNote?: string;
}

/** Lister: return picked up and moving toward lister */
export class ListerReturnInTransitDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  orderNumber: string;
  @IsString()
  orderPageUrl: string;
  @IsString()
  platformName: string;
  @IsString()
  @IsOptional()
  trackingNumber?: string;
  @IsString()
  @IsOptional()
  trackingUrl?: string;
  @IsString()
  @IsOptional()
  trackingProviderLabel?: string;
}

/** Lister: carrier shows delivered — prompt confirm receipt flow */
export class ListerReturnDeliveredConfirmDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  orderNumber: string;
  @IsString()
  orderPageUrl: string;
  @IsString()
  platformName: string;
  @IsString()
  @IsOptional()
  trackingNumber?: string;
}

/** Lister: pickup window ended without completed return leg */
export class ListerReturnWindowPassedDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  orderNumber: string;
  @IsString()
  orderPageUrl: string;
  @IsString()
  platformName: string;
}

export class ReturnInitiatedDto {
  @IsEmail()
  email: string;
  @IsString()
  curatorName: string;
  @IsString()
  renterName: string;
  @IsString()
  renterEmail: string;
  @IsString()
  renterPhone: string;
  @IsString()
  renterAddress: string;
  @IsString()
  orderId: string;
  @IsString()
  itemCondition: string;
  @IsString()
  @IsOptional()
  damageNotes?: string;
  @IsString()
  platformName: string;
  /** RETURN shipment window (checkout / availability flow). */
  @IsString()
  @IsOptional()
  returnWindowSummary?: string;
  @IsString()
  @IsOptional()
  orderPageUrl?: string;
  @IsString()
  @IsOptional()
  itemSummary?: string;
}

export class ReturnCompletedDto {
  @IsEmail()
  email: string;
  @IsString()
  renterName: string;
  @IsString()
  orderId: string;
  @IsString()
  listerCondition: string;
  @IsString()
  @IsOptional()
  listerDamageNotes?: string;
  @IsNumber()
  collateralReleased: number;
  @IsString()
  @IsOptional()
  walletUrl?: string;
  @IsString()
  platformName: string;
}

export class DisputeCreatedDto {
  @IsEmail()
  email: string;

  @IsString()
  adminName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  raisedByName: string;

  @IsString()
  raisedByRole: string;

  @IsString()
  category: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  adminLink?: string;
}

export class DisputeStatusDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  status: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  preferredResolution?: string;

  @IsString()
  @IsOptional()
  disputeLink?: string;

  @IsNumber()
  @IsOptional()
  collateralWithheldToLister?: number;

  @IsNumber()
  @IsOptional()
  collateralReturnedToRenter?: number;

  @IsNumber()
  @IsOptional()
  compensationToLister?: number;

  @IsString()
  @IsOptional()
  disputeRecipient?: 'renter' | 'lister';

  @IsString()
  @IsOptional()
  resolutionDetails?: string;

  @IsNumber()
  @IsOptional()
  refundAmount?: number;

  @IsNumber()
  @IsOptional()
  renterWalletCreditTotal?: number;

  @IsBoolean()
  @IsOptional()
  showRenterWithdrawSteps?: boolean;

  @IsNumber()
  @IsOptional()
  listerEscrowPayout?: number;

  @IsNumber()
  @IsOptional()
  listerCollateralCompensation?: number;

  @IsNumber()
  @IsOptional()
  listerWalletCreditTotal?: number;

  @IsBoolean()
  @IsOptional()
  showListerWithdrawSteps?: boolean;

  @IsString()
  @IsOptional()
  walletWithdrawLink?: string;
}

export class DisputeMessageDto {
  @IsEmail()
  email: string;

  @IsString()
  recipientName: string;

  @IsString()
  senderName: string;

  @IsString()
  disputeId: string;

  @IsString()
  orderId: string;

  @IsString()
  @IsOptional()
  messagePreview?: string;

  @IsString()
  @IsOptional()
  threadLink?: string;
}

export class ReturnDueReminderDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  orderId: string;

  @IsString()
  orderLink: string;

  @IsString()
  dueDate: string;

  @IsString()
  @IsOptional()
  productName?: string;

  @IsString()
  @IsOptional()
  reminderType?: '24_hours' | 'morning_of';
}

export class ReturnRequestReminderDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  orderId: string;

  @IsString()
  orderLink: string;

  @IsString()
  productName: string;

  @IsString()
  @IsOptional()
  reminderType?:
    | '24_hours_before'
    | 'morning_of'
    | 'hourly'
    | '30_minutes'
    | '15_minutes'
    | '5_minutes'
    | 'past_due_morning'
    | 'past_due_afternoon'
    | 'past_due_evening';

  @IsString()
  @IsOptional()
  windowLabel?: string;

  @IsOptional()
  daysPastDue?: number;

  @IsOptional()
  collateralAtRisk?: number;

  @IsOptional()
  penaltyPercent?: number;
}

export class EscrowReleaseNotificationDto {
  @IsEmail()
  email: string;

  @IsString()
  userName: string;

  @IsString()
  orderId: string;

  @IsString()
  orderLink: string;

  @IsNumber()
  @IsOptional()
  amountReleased: number;

  @IsString()
  userType: 'renter' | 'lister';

  @IsString()
  @IsOptional()
  productName?: string;

  @IsString()
  @IsOptional()
  walletUrl?: string;
}

export class AdminWithdrawalRequestAlertDto {
  @IsEmail()
  email: string;

  @IsString()
  adminName: string;

  @IsString()
  reference: string;

  @IsNumber()
  amount: number;

  @IsString()
  requesterName: string;

  @IsString()
  requesterEmail: string;

  @IsString()
  requesterRole: string;

  @IsString()
  bankName: string;

  @IsString()
  accountNumber: string;

  @IsString()
  @IsOptional()
  accountName?: string;

  @IsString()
  adminLink: string;
}

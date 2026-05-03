import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ShipmentService } from './shipment.service';
import { ListShipmentsDto } from './dto/list-shipments.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';

@Controller()
export class ShipmentController {
  constructor(private readonly shipmentService: ShipmentService) {}

  // ─── Admin: list all shipments (filterable) ─────────────────────────────────
  @Auth([Role.ADMIN])
  @Get('shipments')
  listShipments(@Query() dto: ListShipmentsDto) {
    return this.shipmentService.listShipments(dto);
  }

  // ─── Admin: single shipment + attempt logs ──────────────────────────────────
  @Auth([Role.ADMIN])
  @Get('shipments/:id')
  getShipment(@Param('id') id: string) {
    return this.shipmentService.getShipment(id);
  }

  // ─── Admin + User: tracking status for a shipment ───────────────────────────
  @Auth()
  @Get('shipments/:id/tracking')
  getTracking(@Param('id') id: string) {
    return this.shipmentService.getTracking(id);
  }

  // ─── Admin + User: both shipments for an order ──────────────────────────────
  @Auth()
  @Get('orders/:orderId/shipments')
  getOrderShipments(@Param('orderId') orderId: string) {
    return this.shipmentService.getOrderShipments(orderId);
  }

  // ─── Admin: cancel a PENDING shipment ──────────────────────────────────────
  @Auth([Role.ADMIN])
  @Post('shipments/:id/cancel')
  cancelShipment(@Param('id') id: string) {
    return this.shipmentService.cancelShipment(id);
  }

  // ─── Admin: manually redispatch a DISPATCH_FAILED shipment ─────────────────
  @Auth([Role.ADMIN])
  @Post('shipments/:id/redispatch')
  redispatch(@Param('id') id: string) {
    return this.shipmentService.redispatch(id);
  }
}

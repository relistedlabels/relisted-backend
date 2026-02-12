import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { ListersService } from './listers.service';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';

@ApiTags('Listers')
@ApiBearerAuth()
@Controller('api/listers')
export class ListersController {
  constructor(private readonly listersService: ListersService) {}

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('inventory/top-items')
  @ApiOperation({ summary: 'Top performing items by rental count' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 5 })
  @ApiResponse({ status: 200, description: 'Top items with rentals count, price, availability' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Lister or Admin only' })
  getTopItems(
    @AuthUser() user: userEntity,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 5;
    return this.listersService.getTopItems(user, limitNum);
  }

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('rentals/recent')
  @ApiOperation({ summary: 'Recent rental activity for listers' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'delivered', 'return_due'] })
  @ApiResponse({ status: 200, description: 'Recent rentals with item, dresser, return due' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Lister or Admin only' })
  getRecentRentals(
    @AuthUser() user: userEntity,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.listersService.getRecentRentals(user, pageNum, limitNum, status ?? 'all');
  }

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('orders')
  @ApiOperation({ summary: 'Paginated list of orders for listers with status filter' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'ongoing', 'completed', 'cancelled'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, example: '-createdAt' })
  @ApiResponse({ status: 200, description: 'Orders with pagination and summary' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Lister or Admin only' })
  getOrders(
    @AuthUser() user: userEntity,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.listersService.getOrders(
      user,
      status,
      pageNum,
      limitNum,
      sort ?? '-createdAt',
    );
  }

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('orders/:orderId/items')
  @ApiOperation({ summary: 'Items in an order' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order items with return due, amount, status' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  getOrderItems(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
  ) {
    return this.listersService.getOrderItems(user, orderId);
  }

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('orders/:orderId/progress')
  @ApiOperation({ summary: 'Order progress timeline' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Steps and progress percentage' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  getOrderProgress(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
  ) {
    return this.listersService.getOrderProgress(user, orderId);
  }

  @Auth([Role.LISTER, Role.ADMIN])
  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Single order details' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order with timeline, escrow, items' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  getOrderById(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
  ) {
    return this.listersService.getOrderById(user, orderId);
  }

  // 9. Approve order
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('orders/:orderId/approve')
  @ApiOperation({ summary: 'Approve a pending order (lister)' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({
    status: 200,
    description: 'Order approved successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({
    description:
      'Order is not pending approval, approval window expired, or user not allowed',
  })
  @ApiNotFoundResponse({ description: 'Order not found' })
  approveOrder(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
    @Body('notes') notes?: string,
  ) {
    return this.listersService.approveOrder(user, orderId, notes);
  }

  // 10. Reject order
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('orders/:orderId/reject')
  @ApiOperation({ summary: 'Reject a pending order (lister)' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({
    status: 200,
    description: 'Order rejected successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({
    description:
      'Order is not pending approval, approval window expired, or user not allowed',
  })
  @ApiNotFoundResponse({ description: 'Order not found' })
  rejectOrder(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
    @Body()
    body: {
      reason: string;
      notes?: string;
      refundType?: string;
    },
  ) {
    return this.listersService.rejectOrder(user, orderId, body);
  }

  // 11. Update order status through lifecycle
  @Auth([Role.LISTER, Role.ADMIN])
  @Put('orders/:orderId/status')
  @ApiOperation({ summary: 'Update order status (dispatched, in_transit, delivered, etc.)' })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({
    status: 200,
    description: 'Order status updated',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden or invalid status transition' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  updateOrderStatus(
    @AuthUser() user: userEntity,
    @Param('orderId') orderId: string,
    @Body()
    body: {
      status: string;
      trackingNumber?: string;
      notes?: string;
      estimatedDeliveryDate?: string;
    },
  ) {
    return this.listersService.updateOrderStatus(user, orderId, body);
  }

  // ---------------------------------------------------------------------------
  // LISTER DISPUTES
  // ---------------------------------------------------------------------------

  // 19. GET /api/listers/disputes/stats
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/stats')
  @ApiOperation({ summary: 'Lister dispute statistics' })
  @ApiQuery({
    name: 'timeframe',
    required: false,
    description: 'Optional timeframe (e.g. month, week)',
  })
  @ApiResponse({ status: 200, description: 'Dispute statistics' })
  getDisputeStats(
    @AuthUser() user: userEntity,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.listersService.getDisputeStats(user, timeframe);
  }

  // 20. GET /api/listers/disputes
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes')
  @ApiOperation({ summary: 'Paginated list of disputes for lister' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['all', 'pending_review', 'in_review', 'resolved', 'rejected'],
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['-dateSubmitted', 'dateSubmitted', 'status', '-status', 'amount', '-amount'],
  })
  @ApiResponse({ status: 200, description: 'Disputes list with pagination' })
  getDisputes(
    @AuthUser() user: userEntity,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.listersService.getDisputesList(
      user,
      pageNum,
      limitNum,
      status ?? 'all',
      search,
      sortBy ?? '-dateSubmitted',
    );
  }

  // 21. POST /api/listers/disputes
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('disputes')
  @ApiOperation({ summary: 'Create a new dispute for an order' })
  @ApiResponse({ status: 201, description: 'Dispute created successfully' })
  createDispute(
    @AuthUser() user: userEntity,
    @Body()
    body: {
      orderId: string;
      orderNumber?: string;
      category: string;
      description: string;
      preferredResolution?: string;
      evidenceFiles?: string[];
    },
  ) {
    return this.listersService.createDispute(user, body);
  }

  // 22. GET /api/listers/disputes/:disputeId
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId')
  @ApiOperation({ summary: 'Get full dispute details' })
  @ApiParam({ name: 'disputeId', description: 'Human-readable dispute ID' })
  @ApiResponse({ status: 200, description: 'Dispute details returned' })
  @ApiNotFoundResponse({ description: 'Dispute not found' })
  getDisputeDetails(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
  ) {
    return this.listersService.getDisputeDetails(user, disputeId);
  }

  // 23. GET /api/listers/disputes/:disputeId/overview
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId/overview')
  @ApiOperation({ summary: 'Get dispute overview content' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  getDisputeOverview(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
  ) {
    return this.listersService.getDisputeOverview(user, disputeId);
  }

  // 24. GET /api/listers/disputes/:disputeId/evidence
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId/evidence')
  @ApiOperation({ summary: 'Get dispute evidence files' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  getDisputeEvidence(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
  ) {
    return this.listersService.getDisputeEvidence(user, disputeId);
  }

  // 25. GET /api/listers/disputes/:disputeId/timeline
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId/timeline')
  @ApiOperation({ summary: 'Get dispute timeline events' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  getDisputeTimeline(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
  ) {
    return this.listersService.getDisputeTimeline(user, disputeId);
  }

  // 26. GET /api/listers/disputes/:disputeId/resolution
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId/resolution')
  @ApiOperation({ summary: 'Get dispute resolution info' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  getDisputeResolution(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
  ) {
    return this.listersService.getDisputeResolution(user, disputeId);
  }

  // 27. GET /api/listers/disputes/:disputeId/messages
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('disputes/:disputeId/messages')
  @ApiOperation({ summary: 'Get dispute conversation messages' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getDisputeMessages(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.listersService.getDisputeMessages(
      user,
      disputeId,
      pageNum,
      limitNum,
    );
  }

  // 28. POST /api/listers/disputes/:disputeId/messages
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('disputes/:disputeId/messages')
  @ApiOperation({ summary: 'Send a message in a dispute conversation' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  sendDisputeMessage(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
    @Body()
    body: {
      content: string;
      mediaIds?: string[];
    },
  ) {
    return this.listersService.addDisputeMessage(user, disputeId, body);
  }

  // 29. POST /api/listers/disputes/:disputeId/withdraw
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('disputes/:disputeId/withdraw')
  @ApiOperation({ summary: 'Withdraw a pending dispute' })
  @ApiParam({ name: 'disputeId', description: 'Dispute ID' })
  withdrawDispute(
    @AuthUser() user: userEntity,
    @Param('disputeId') disputeId: string,
    @Body()
    body: {
      reason?: string;
      notes?: string;
    },
  ) {
    return this.listersService.withdrawDispute(user, disputeId, body);
  }

  // ---------------------------------------------------------------------------
  // LISTER PROFILE, VERIFICATIONS & ISSUE CATEGORIES (per-lister)
  // ---------------------------------------------------------------------------

  // 31. GET /api/listers/profile
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('profile')
  @ApiOperation({ summary: 'Get lister profile' })
  @ApiQuery({
    name: 'includeAddresses',
    required: false,
    description: 'Include address list (default: true)',
  })
  getListerProfile(
    @AuthUser() user: userEntity,
    @Query('includeAddresses') includeAddresses?: string,
  ) {
    const inc =
      includeAddresses === undefined
        ? true
        : includeAddresses === 'true';
    return this.listersService.getListerProfile(user, inc);
  }

  // 32. PUT /api/listers/profile
  @Auth([Role.LISTER, Role.ADMIN])
  @Put('profile')
  @ApiOperation({ summary: 'Update lister profile info' })
  updateListerProfile(
    @AuthUser() user: userEntity,
    @Body()
    body: {
      fullName?: string;
      phone?: string;
    },
  ) {
    return this.listersService.updateListerProfile(user, body);
  }

  // 33. GET /api/listers/profile/addresses
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('profile/addresses')
  @ApiOperation({ summary: 'Get lister addresses' })
  getListerAddresses(@AuthUser() user: userEntity) {
    return this.listersService.getListerAddresses(user);
  }

  // 34. POST /api/listers/profile/addresses
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('profile/addresses')
  @ApiOperation({ summary: 'Add or update lister address' })
  addListerAddress(
    @AuthUser() user: userEntity,
    @Body()
    body: {
      type?: string;
      street: string;
      city: string;
      state: string;
      postalCode?: string;
      country: string;
      isDefault?: boolean;
    },
  ) {
    return this.listersService.addListerAddress(user, body);
  }

  // 35. POST /api/listers/profile/avatar
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('profile/avatar')
  @ApiOperation({
    summary:
      'Update lister profile avatar (links to existing upload by uploadId)',
  })
  updateProfileAvatar(
    @AuthUser() user: userEntity,
    @Body() body: { uploadId: string },
  ) {
    return this.listersService.updateProfileAvatar(user, body);
  }

  // 36. GET /api/listers/profile/business
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('profile/business')
  @ApiOperation({ summary: 'Get lister business profile' })
  getBusinessProfile(@AuthUser() user: userEntity) {
    return this.listersService.getBusinessProfile(user);
  }

  // 37. PUT /api/listers/profile/business
  @Auth([Role.LISTER, Role.ADMIN])
  @Put('profile/business')
  @ApiOperation({ summary: 'Update lister business profile' })
  updateBusinessProfile(
    @AuthUser() user: userEntity,
    @Body()
    body: {
      businessName?: string;
      businessCategory?: string;
      businessDescription?: string;
      businessEmail?: string;
      businessPhone?: string;
      businessAddress?: string;
      website?: string;
    },
  ) {
    return this.listersService.updateBusinessProfile(user, body);
  }

  // 38. GET /api/listers/verifications/status
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('verifications/status')
  @ApiOperation({ summary: 'Get lister verification status' })
  getVerificationStatus(@AuthUser() user: userEntity) {
    return this.listersService.getVerificationStatus(user);
  }

  // 39. GET /api/listers/verifications/documents
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('verifications/documents')
  @ApiOperation({ summary: 'Get lister verification documents' })
  getVerificationDocuments(@AuthUser() user: userEntity) {
    return this.listersService.getVerificationDocuments(user);
  }

  // 40. POST /api/listers/verifications/nin
  @Auth([Role.LISTER, Role.ADMIN])
  @Post('verifications/nin')
  @ApiOperation({
    summary:
      'Attach existing upload as NIN verification document (upload handled by /upload)',
  })
  uploadNinDocument(
    @AuthUser() user: userEntity,
    @Body() body: { uploadId: string; ninNumber?: string },
  ) {
    return this.listersService.uploadNinDocument(user, body);
  }

  // 41. GET /api/listers/verifications/bvn
  @Auth([Role.LISTER, Role.ADMIN])
  @Get('verifications/bvn')
  @ApiOperation({ summary: 'Get masked BVN info' })
  getBvnInfo(@AuthUser() user: userEntity) {
    return this.listersService.getBvnInfo(user);
  }

  // 42. PUT /api/listers/verifications/emergency-contact
  @Auth([Role.LISTER, Role.ADMIN])
  @Put('verifications/emergency-contact')
  @ApiOperation({ summary: 'Update emergency contact information' })
  updateEmergencyContact(
    @AuthUser() user: userEntity,
    @Body()
    body: {
      fullName: string;
      email?: string;
      phone: string;
      relationship: string;
    },
  ) {
    return this.listersService.updateEmergencyContact(user, body);
  }
}

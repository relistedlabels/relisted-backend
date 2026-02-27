import { Controller, Get, Patch, Delete, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('Admin Disputes')
@Controller('api/admin/disputes')
export class AdminDisputesController {
  constructor(private readonly adminService: AdminService) {}
}

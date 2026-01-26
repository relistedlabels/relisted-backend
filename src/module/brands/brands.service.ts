import { Injectable } from '@nestjs/common';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma:PrismaService){}


  async findAll() {
    return await this.prisma.brand.findMany()
  }

 
}

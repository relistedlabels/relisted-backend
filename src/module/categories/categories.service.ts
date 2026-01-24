import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class CategoriesService {
 constructor(private readonly prisma:PrismaService){}

  async findAll() {
    return await this.prisma.productCategory.findMany();
  }

}
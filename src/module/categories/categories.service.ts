import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class CategoriesService {
 constructor(private readonly prisma:PrismaService){}


 
   async create(dto: CreateCategoryDto, user: userEntity) {
     return this.prisma.brand.create({
       data: {
         name: dto.name,
         user: {
           connect: { id: user.id },
         },
       },
     });
   }



  async findAll() {
    return await this.prisma.productCategory.findMany();
  } 



  

}
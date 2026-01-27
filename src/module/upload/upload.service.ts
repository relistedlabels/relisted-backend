import { Injectable } from '@nestjs/common';

import cloudinary, { handleUpload } from 'src/config/cloudinary.config';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class UploadService {
    constructor(private readonly prisma :PrismaService){}

    
async uploadFile(id:string,file:Express.Multer.File,user:userEntity ){
    const uploadResult:any = await handleUpload(file.buffer)

    const data= await this.prisma.upload.create({
        data:{
            id,
           name:file.originalname,
           url:uploadResult.secure_url,
           publicId:uploadResult.public_id,
           type:file.mimetype,
           fieldName:file.fieldname,
           size:file.size,
           user:{
            connect:{
                id:user.id
            }
           }
        }
    })
    return data

}

// get upload by id  

async uploadIds(ids:string[]){
    return await this.prisma.upload.findMany({
        where:{
            id:{in:ids}
        },
      
    })}


// download the url 
async download(id:string){
return await this.prisma.upload.findUnique({
    where:{
        id
    },
    select:{
        url:true,type:true
    }
})
}
// delete upload from cloudinary

async deleteUpload(ids:string[],user:userEntity){
    const uploads =await this.prisma.upload.findMany({
        where:{
            id:{in:ids},
            // user:{
            //     id:user.sub
            // }
        }
    }) 
    // delete from cloudinary 
    for(let upload of uploads){
        if(upload.publicId){
            await cloudinary.uploader.destroy(upload.publicId)
        }
    }


    // delete in db 
  return await this.prisma.upload.deleteMany({
        where:{
            id:{in:ids},
            // user:{
            //     id:user.sub
            // }
        }
    })

}
}

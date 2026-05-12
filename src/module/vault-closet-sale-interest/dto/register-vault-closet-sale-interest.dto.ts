import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RegisterVaultClosetSaleInterestDto {
  @ApiProperty({
    example: 'you@example.com',
    description: 'Email to notify when the Vault Closet sale is live',
  })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

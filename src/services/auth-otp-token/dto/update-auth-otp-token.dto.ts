import { PartialType } from '@nestjs/mapped-types';
import { CreateAuthOtpTokenDto } from './create-auth-otp-token.dto';

export class UpdateAuthOtpTokenDto extends PartialType(CreateAuthOtpTokenDto) {}

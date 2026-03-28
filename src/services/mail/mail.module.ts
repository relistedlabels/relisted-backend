import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailerModule } from '@nestjs-modules/mailer';
import { join } from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';

@Global()
@Module({
  imports:[
    MailerModule.forRoot({
      transport: {
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT),
        secure: process.env.MAIL_PORT === '465',
        auth: process.env.MAIL_USERNAME
          ? {
              user: process.env.MAIL_USERNAME,
              pass: process.env.MAIL_PASSWORD,
            }
          : undefined,
      },
      defaults: {
        from: process.env.MAIL_DEFAULT || 'Relisted <noreply@relisted.com>',
      },
      template:{
        dir:join(process.cwd(),"./src/services/mail/templates"),
        adapter:new HandlebarsAdapter({
          eq: (v1, v2) => v1 === v2,
        }),
        options:{
          strict:true
        }
      }
    })
  ],
  controllers: [MailController],
  providers: [MailService],
  exports:[MailService]
})
export class MailModule {}

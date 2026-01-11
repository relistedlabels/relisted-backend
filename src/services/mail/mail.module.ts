import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailerModule } from '@nestjs-modules/mailer';
import { join } from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

@Global()
@Module({
  imports:[
    MailerModule.forRoot({
      transport:{
        host:process.env.MAIL_HOST,
        port:Number(process.env.MAIL_PORT),
        auth:{
          user:process.env.MAIL_USERNAME,
          pass:process.env.MAIL_PASSWORD
        }
      },
      defaults:{
        from:`hotel website ${process.env.MAILDEFAULT}`
      },
      template:{
        dir:join(process.cwd(),"./src/services/mail/templates"),
        adapter:new HandlebarsAdapter(),
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

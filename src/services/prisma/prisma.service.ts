
// // import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// // import { PrismaClient } from '@prisma/client'; 
// // import { PrismaPg } from '@prisma/adapter-pg';
// // import { Pool } from 'pg';
// // import { config } from 'dotenv';
// // import { join } from 'path';

// // // Load environment variables
// // config({ path: join(process.cwd(), '.env') });

// // @Injectable()
// // export class PrismaService
// //   extends PrismaClient
// //   implements OnModuleInit, 
// //   OnModuleDestroy
// // {
// //   constructor() {
// //     const databaseUrl = process.env.DATABASE_URL;
// //     if (!databaseUrl) {
// //       throw new Error(
// //         'DATABASE_URL is missing in .env'
// //       );
// //     }


// //     const pool = new Pool({ connectionString: databaseUrl });


// //     const adapter = new PrismaPg(pool);

// //     super({ adapter });
// //   }

// //   async onModuleInit() {
// //     await this.$connect();
// //     console.log('✅ Connected to database');
    
// //   }

// //   // async onModuleDestroy() {
// //   //   await this.$disconnect();
// //   // }
// // }




// import { Injectable, OnModuleInit } from '@nestjs/common';
// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import { Pool } from 'pg';
// import { config } from 'dotenv';
// import { join } from 'path';

// config({ path: join(process.cwd(), '.env') });

// @Injectable()
// export class PrismaService
//   extends PrismaClient
//   implements OnModuleInit
// {
//   constructor() {
//     const databaseUrl = process.env.DATABASE_URL;
//     if (!databaseUrl) {
//       throw new Error('DATABASE_URL is missing in .env');
//     }

//     const pool = new Pool({
//       connectionString: databaseUrl,
//        ssl: { rejectUnauthorized: false },
//       max: 10,
//       idleTimeoutMillis: 30000,
//       connectionTimeoutMillis: 2000,
//     });

//     const adapter = new PrismaPg(pool);
//     super({ adapter });
//   }

//   async onModuleInit() {
//     await this.$connect();
//     console.log('✅ Connected to database');
//   }
// }



import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env') });

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is missing in .env');
    }

    // ✅ Fix: Increase connection timeout and add SSL mode
    const pool = new Pool({
      connectionString: databaseUrl + '?sslmode=require', // Add SSL mode
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // ✅ Increased from 2000ms to 10000ms
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error(' Database connection failed:', error.message);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
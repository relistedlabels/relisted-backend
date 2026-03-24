
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(process.cwd(), '.env') });

async function verifyDb() {
  const databaseUrl = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Checking Order table columns...');
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Order';
    `;
    console.log('Columns:', JSON.stringify(result, null, 2));

    const shipmentIdExists = (result as any[]).some(c => c.column_name === 'shipmentId');
    console.log('shipmentId exists:', shipmentIdExists);

  } catch (error) {
    console.error('Error verifying DB:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

verifyDb();

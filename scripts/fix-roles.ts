import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env') });

const databaseUrl = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Updating CURATOR roles to LISTER...');
  try {
    const result = await prisma.$executeRawUnsafe(`UPDATE "User" SET "role" = 'LISTER'::"Role" WHERE "role" = 'CURATOR'::"Role"`);
    console.log(`Successfully updated ${result} rows.`);
  } catch (err) {
    console.error('Error updating roles:', err);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

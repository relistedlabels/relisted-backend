import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(process.cwd(), '.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing in .env');
}

// Create Postgres pool
const pool = new Pool({ connectionString: databaseUrl });

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Create Prisma client with adapter
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed Brands only on empty table
  const brandCount = await prisma.brand.count();
  if (brandCount === 0) {
    await prisma.brand.createMany({
      data: [
        { name: 'Nike' },
        { name: 'Adidas' },
        { name: 'Zara' },
        { name: 'H&M' },
        { name: 'Gucci' },
        { name: 'Louis Vuitton' },
        { name: 'Puma' },
        { name: 'Balenciaga' },
        { name: 'Versace' },
        { name: 'Uniqlo' },
      ],
    });
  }

  // Seed Categories only on empty table
  const categoryCount = await prisma.productCategory.count();
  if (categoryCount === 0) {
    await prisma.productCategory.createMany({
      data: [
        { name: 'Tops' },
        { name: 'Bottoms' },
        { name: 'Dresses' },
        { name: 'Outerwear' },
        { name: 'Footwear' },
        { name: 'Accessories' },
        { name: 'Activewear' },
        { name: 'Formal Wear' },
        { name: 'Casual Wear' },
        { name: 'Traditional Wear' },
      ],
    });
  }

  // Tags that show in the box (display order first), then other searchable tags
  const boxTags = [
    'New season',
    'Date night',
    'Brunch outfit',
    'Night out',
    'Wedding guest',
    'Mini dress',
    'Midi dress',
    'Classy',
    'Vacation',
    'Party',
    'Luxury',
    'Formal wear',
  ];
  const otherSearchableTags = [
    'Long dress',
    'Festival outfit',
    'Travel',
    'Old money',
    'It girl',
    'Gen z',
    'Minimal',
    'Girls night out',
    'Birthday outfit',
    'Vacation outfit',
    'Bodycon',
    'Flowy dress',
    'Elegant',
    'Sexy but classy',
    'Day to night',
    'Dinner outfit',
    'Weekend outfit',
    'Street style',
    'Tailored fit',
    'Relaxed fit',
    'Minimal style',
    'Elevated basics',
  ];
  const allTagNames = [...boxTags, ...otherSearchableTags];
  const tagCount = await prisma.tag.count();
  if (tagCount === 0) {
    await prisma.tag.createMany({
      data: allTagNames.map((name) => ({ name })),
    });
  }
  console.log('Brands, categories, and tags seed check complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

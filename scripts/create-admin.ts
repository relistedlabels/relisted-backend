import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import { resolve, join } from 'path';

// Load environment variables - must be done before importing PrismaClient
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// Ensure DATABASE_URL is set
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(' DATABASE_URL is not set in .env file');
  console.error('   Looking for .env at:', envPath);
  process.exit(1);
}

// Create Prisma client with adapter (same as PrismaService)
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function createAdmin() {
  const email = 'nwikechisom77@gmail.com';
  const name = 'Nwike Chisom';

  // Generate a random password (16 characters: 12 alphanumeric + 4 special chars)
  const randomPassword = generateRandomPassword();
  
  console.log('Creating admin user...\n');
  console.log(`Email: ${email}`);
  console.log(`Name: ${name}`);
  console.log(`Password: ${randomPassword}\n`);

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(' User already exists with this email.');
      console.log('If you want to update the password, please delete the user first or use a different email.\n');
      process.exit(1);
    }

    // Hash the password
    const hashedPassword = await argon2.hash(randomPassword);

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: Role.ADMIN,
        isVerified: true, // Admin accounts are pre-verified
        provider: null,
      },
    });


  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function generateRandomPassword(): string {
  // Generate a secure random password: 12 alphanumeric + 4 special characters
  const length = 16;
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '!@#$%&*';
  const allChars = lowercase + uppercase + numbers + special;

  // Ensure at least one character from each category
  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

createAdmin();

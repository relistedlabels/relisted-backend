import { AppModule } from './src/app.module';
import { NestFactory } from '@nestjs/core';
import { ProfileService } from './src/module/profile/profile.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const profileService = app.get(ProfileService);
  const prisma = app.get(PrismaService);

  try {
    // 1. Setup Test User
    const email = `test_profile_bank_${Date.now()}@test.com`;
    const user = await prisma.user.create({
      data: {
        email,
        password: "hashedpassword",
        name: "Test Profile Bank",
        role: "LISTER",
        isVerified: true,
      }
    });

    console.log(`Created test user: ${user.id}`);

    // 2. Test Profile Create with Bank Info
    console.log("Creating profile with bank info...");
    const createDto: any = {
      phoneNumber: "08011112222",
      bankAccounts: {
        bankName: "First Bank",
        accountNumber: "1234567890",
        nameOfAccount: "Test Profile Bank",
        bankCode: "011"
      }
    };

    const userEntity: any = { id: user.id };
    await profileService.create(createDto, userEntity);

    const bankAccount = await (prisma as any).bankAccount.findFirst({
      where: { userId: user.id }
    });
    console.log("Bank Account Created:", bankAccount?.bankName, bankAccount?.accountNumber);

    // 3. Test Profile Update with New Bank Info (Update Existing)
    console.log("Updating profile with same account number but different bank...");
    const updateDto: any = {
      phoneNumber: "08011112222",
      bankAccounts: {
        bankName: "Guaranty Trust Bank",
        accountNumber: "1234567890",
        nameOfAccount: "Test Profile Bank Updated",
        bankCode: "058"
      }
    };

    await profileService.update(user.id, updateDto, userEntity);

    const updatedBank = await (prisma as any).bankAccount.findFirst({
      where: { userId: user.id, accountNumber: "1234567890" }
    });
    console.log("Bank Account Updated:", updatedBank?.bankName, updatedBank?.accountName);

    // 4. Test Profile Update with New Account Number (Create New)
    console.log("Updating profile with new account number...");
    const newAccountDto: any = {
      phoneNumber: "08011112222",
      bankAccounts: {
        bankName: "Wema Bank",
        accountNumber: "0987654321",
        nameOfAccount: "Test Profile Bank New",
        bankCode: "035"
      }
    };

    await profileService.update(user.id, newAccountDto, userEntity);

    const allBankAccounts = await (prisma as any).bankAccount.findMany({
      where: { userId: user.id }
    });
    console.log("Total Bank Accounts for user:", allBankAccounts.length);
    console.log("New Bank Account exists:", allBankAccounts.some((b: any) => b.accountNumber === "0987654321"));

    // Clean up
    console.log("Cleaning up generated resources...");
    await (prisma as any).bankAccount.deleteMany({ where: { userId: user.id } });
    await prisma.profile.delete({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    console.log("Cleanup complete!");
  } catch (error: any) {
    console.error("Test execution failed:", error);
  } finally {
    await app.close();
  }
}

bootstrap();

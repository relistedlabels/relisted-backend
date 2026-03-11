import { AppModule } from './src/app.module';
import { NestFactory } from '@nestjs/core';
import { RentersService } from './src/module/renters/renters.service';
import { AdminService } from './src/module/admin/admin.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const rentersService = app.get(RentersService);
  const adminService = app.get(AdminService);
  const prisma = app.get(PrismaService);

  try {
    // 1. Setup Test User
    const email = `test_va_${Date.now()}@checkout.com`;
    const user = await prisma.user.create({
      data: {
        email,
        password: "hashedpassword",
        name: "Test VA User",
        role: "RENTER",
        isVerified: true,
        profile: {
          create: {
            phoneNumber: "08012341234"
          }
        },
        wallet: {
          create: {
            mainBalance: 50000,
            availableBalance: 50000,
            collateralBalance: 0
          }
        }
      }
    });

    console.log(`Created test user: ${user.id}`);

    // 2. Test VA Generation on Profile Update
    console.log("Updating profile with NIN to trigger VA generation...");
    const profileUpdateRes = await rentersService.updateProfile(user.id, {
      nin: "12345678901",
      phone: "08012341234"
    });
    
    console.log("Profile Update result:", profileUpdateRes?.data?.profile?.virtualAccount);
    
    // Check if VA is in getProfile
    const profileData = await rentersService.getProfile(user.id);
    console.log("Get Profile VA Data:", profileData?.data?.profile?.virtualAccount);

    // 3. Test Withdrawal Loop
    console.log("Setting up Bank Account...");
    const bankAccount = await prisma.bankAccount.create({
      data: {
        userId: user.id,
        bankName: "Guaranty Trust Bank",
        bankCode: "058",
        accountNumber: "0123456789",
        accountName: "Test VA User"
      }
    });

    console.log("Initiating Withdrawal...");
    const withdrawalRes = await rentersService.requestWithdrawal(user.id, {
      amount: 10000,
      bankAccountId: bankAccount.id
    });
    console.log("Withdrawal Requested:", withdrawalRes.data.withdrawal);

    // Wallet transaction deduction check
    const walletAfterDeduction = await prisma.wallet.findUnique({ where: { userId: user.id } });
    console.log(`Wallet Balance After Deduction: ${walletAfterDeduction?.mainBalance} (Expected 40000)`);

    // Admin View check
    console.log("Fetching Admin Withdrawals...");
    const adminWithdrawals = await adminService.getAllWithdrawals(1, 10);
    const targetWithdrawal = adminWithdrawals.data.withdrawals.find((w: any) => w.id === withdrawalRes.data.withdrawal.withdrawalId);
    console.log("Found in admin view:", targetWithdrawal?.status);


    // Admin Reject -> Refund test
    console.log("Rejecting Withdrawal to test Refund...");
    await adminService.updateWithdrawalStatus(targetWithdrawal!.id, "REJECTED", "Testing refund");
    
    const walletAfterRefund = await prisma.wallet.findUnique({ where: { userId: user.id } });
    console.log(`Wallet Balance After Refund: ${walletAfterRefund?.mainBalance} (Expected 50000)`);

    // Clean up
    console.log("Cleaning up generated resources...");
    await prisma.withdrawalRequest.deleteMany({ where: { userId: user.id } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: user.id } } });
    await prisma.wallet.delete({ where: { userId: user.id } });
    await prisma.virtualAccount.deleteMany({ where: { userId: user.id } });
    await prisma.bankAccount.deleteMany({ where: { userId: user.id } });
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

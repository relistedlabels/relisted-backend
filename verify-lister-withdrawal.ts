import { AppModule } from './src/app.module';
import { NestFactory } from '@nestjs/core';
import { ListersService } from './src/module/listers/listers.service';
import { AdminService } from './src/module/admin/admin.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const listersService = app.get(ListersService);
  const adminService = app.get(AdminService);
  const prisma = app.get(PrismaService);

  try {
    // 1. Setup Test Lister
    const email = `test_lister_wd_${Date.now()}@checkout.com`;
    const user = await prisma.user.create({
      data: {
        email,
        password: "hashedpassword",
        name: "Test Lister WD",
        role: "LISTER",
        isVerified: true,
        profile: {
          create: {
            phoneNumber: "09011112222"
          }
        },
        wallet: {
          create: {
            mainBalance: 75000,
            availableBalance: 75000,
            collateralBalance: 0
          }
        }
      }
    });

    console.log(`Created test lister: ${user.id}`);

    // 2. Setup Bank Account
    console.log("Setting up Bank Account...");
    const bankAccount = await prisma.bankAccount.create({
      data: {
        userId: user.id,
        bankName: "Zenith Bank",
        bankCode: "057",
        accountNumber: "9876543210",
        accountName: "Test Lister WD"
      }
    });

    // 3. Test Wallet Info Retrieval
    console.log("Fetching Wallet Info...");
    const walletRes = await listersService.getWallet(user.id);
    console.log("Wallet Balance:", walletRes.data.wallet.balance.totalBalance);

    // 4. Test Withdrawal Loop
    console.log("Initiating Withdrawal...");
    const withdrawalRes = await listersService.requestWithdrawal(user.id, {
      amount: 25000,
      bankAccountId: bankAccount.id
    });
    console.log("Withdrawal Requested:", withdrawalRes.data.withdrawal);

    // Wallet transaction deduction check
    const walletAfterDeduction = await prisma.wallet.findUnique({ where: { userId: user.id } });
    console.log(`Wallet Balance After Deduction: ${walletAfterDeduction?.mainBalance} (Expected 50000)`);

    // Admin View check
    console.log("Fetching Admin Withdrawals...");
    const adminWithdrawals = await adminService.getAllWithdrawals(1, 10);
    const targetWithdrawal = adminWithdrawals.data.withdrawals.find((w: any) => w.id === withdrawalRes.data.withdrawal.withdrawalId);
    console.log("Found in admin view:", targetWithdrawal?.status);


    // Admin Reject -> Refund test
    console.log("Rejecting Withdrawal to test Refund...");
    await adminService.updateWithdrawalStatus(targetWithdrawal!.id, "REJECTED", "Testing lister refund");
    
    const walletAfterRefund = await prisma.wallet.findUnique({ where: { userId: user.id } });
    console.log(`Wallet Balance After Refund: ${walletAfterRefund?.mainBalance} (Expected 75000)`);

    // Clean up
    console.log("Cleaning up generated resources...");
    await prisma.withdrawalRequest.deleteMany({ where: { userId: user.id } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: user.id } } });
    await prisma.wallet.delete({ where: { userId: user.id } });
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

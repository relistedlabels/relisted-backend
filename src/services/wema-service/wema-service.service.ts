import { Injectable } from '@nestjs/common';
import { CreateFundWalletDto } from './dto/create-wema-service.dto';
import { UpdateWemaServiceDto } from './dto/update-wema-service.dto';
import { userEntity } from 'src/module/auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { addMinutes } from 'date-fns';
import { generateTransactionRef } from 'src/utils/ref.util';
import { connectId } from 'prisma/prisma.utils';

@Injectable()
export class WemaServiceService {
  constructor(private readonly prisma:PrismaService){}
async createAccount(user:userEntity,amount:number) {
const userExist =await this.prisma.user.findUnique({
  where:{id:user.id},
  include:{
    profile:true
  }
})



  const vaNumber = `698${Math.floor(1000000 + Math.random() * 9000000)}`;
//  create virtual account
  const virtualAccount = await this.prisma.virtualAccount.create({
    data: {
      userId: user.id,
      prefix:"698",
      vaNumber,
      status: 'PENDING',
      expiresAt: addMinutes(new Date(), 30),
     
      bvn:userExist?.profile?.bvn
      
    },
  });

// create transaction 
const transaction =await this.prisma.transaction.create({
  data:{
    amount,
    referenceId:await generateTransactionRef(),
    user:connectId(user.id)
  }
})


  return {
    message: 'Virtual account generated',
    vaNumber: virtualAccount.vaNumber,
    amount: virtualAccount.amount,
    expiresAt: virtualAccount.expiresAt,
    transactionReference:transaction.referenceId
    
  };
}

async nameLookup(dto: any) {
  const account = await this.prisma.virtualAccount.findUnique({
    where: { vaNumber: dto.accountnumber },
    include: { user: { include: { profile: true } } }
  });

  if (!account || account.status === 'INACTIVE') {
    return {
      accountname: "Invalid Account",
      status: "07",
      status_desc: "Invalid Account",
      amount: "0",
      bvn: "",
      nin: ""
    };
  }

  return {
    accountname: `Relisted-labels/${account.user.name}`,
    status: "00",
    status_desc: "Okay",
    amount: account.amount ? account.amount.toString() : "0",
    bvn: account.bvn || account.user.profile?.bvn || "2211234567",
    nin: account.nin || "00019927725273"
  };
}

async transactionNotify(dto: any) {
  const vaNumber = dto.craccount;
  const account = await this.prisma.virtualAccount.findUnique({
    where: { vaNumber }
  });

  if (!account || account.status === 'INACTIVE') {
    return {
      transactionreference: "",
      status: "07",
      status_desc: "Invalid Account"
    };
  }

  const existingTx = await this.prisma.transaction.findUnique({
    where: { sessionId: String(dto.sessionid) }
  });

  if (existingTx) {
    return {
      transactionreference: existingTx.referenceId,
      status: "00",
      status_desc: "Okay"
    };
  }

  const referenceId = await generateTransactionRef();

  const transaction = await this.prisma.transaction.create({
    data: {
      amount: parseFloat(dto.amount) || 0,
      referenceId,
      status: 'SUCCESS',
      userId: account.userId,
      virtualAccountId: account.id,
      sessionId: String(dto.sessionid),
      paymentReference: dto.paymentreference,
      originatorName: dto.originatorname,
      originatorAccountNumber: dto.originatoraccountnumber,
      bankName: dto.bankname,
      narration: dto.narration,
      crAccountName: dto.craccountname,
      crAccount: dto.craccount,
      bankCode: dto.bankcode,
    }
  });

  await this.fundWallet(account.userId, parseFloat(dto.amount) || 0);

  return {
    transactionreference: referenceId,
    status: "00",
    status_desc: "Okay"
  };
}

 async fundWallet(userId: string, amount: number) {
  let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await this.prisma.wallet.create({
      data: {
        userId,
        mainBalance: 0,
        availableBalance: 0,
        collateralBalance: 0
      }
    });
  }
  await this.prisma.wallet.update({
    where: { id: wallet.id },
    data: { mainBalance: wallet.mainBalance + amount }
  });

  await this.prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type: 'MAIN',
      status: 'SUCCESS',
      note: 'Wema Virtual Account Deposit'
    }
  });
}

async fetchMiniStatement(dto: any) {
  const vaNumber = String(dto.accountnumber);
  const account = await this.prisma.virtualAccount.findUnique({
    where: { vaNumber }
  });

  if (!account) return { transactions: [] };

  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

  const txs = await this.prisma.transaction.findMany({
    where: { 
      virtualAccountId: account.id,
      createdAt: { gte: tenDaysAgo },
      status: 'SUCCESS'
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    transactions: txs.map(tx => ({
      accountNo: tx.crAccount || vaNumber,
      bankName: "Wema Bank",
      amount: tx.amount,
      direction: "Credit",
      transactionDate: tx.createdAt.toISOString()
    }))
  };
}

async getKycDetails(dto: any) {
  const vaNumber = String(dto.accountnumber);
  const account = await this.prisma.virtualAccount.findUnique({
    where: { vaNumber },
    include: {
      user: { include: { profile: true } }
    }
  });

  if (!account) {
    return { status_desc: "Invalid Account" };
  }

  const wallet = await this.prisma.wallet.findUnique({
    where: { userId: account.userId }
  });

  return {
    accountname: account.user.name,
    BVN: account.bvn || account.user.profile?.bvn || null,
    NIN: account.nin || account.user.profile?.nin || null,
    mobilenumber: account.user.profile?.phoneNumber || "",
    walletbalance: wallet?.mainBalance || 0,
    status_desc: account.status === 'INACTIVE' ? 'Inactive' : 'Active'
  };
}

async blockAccount(dto: any) {
  const vaNumber = String(dto.accountnumber);
  const blockreason = dto.blockreason;

  const account = await this.prisma.virtualAccount.findUnique({
    where: { vaNumber }
  });

  if (!account) {
    return { message: "Invalid Account" };
  }

  await this.prisma.virtualAccount.update({
    where: { id: account.id },
    data: {
      status: 'INACTIVE',
      blockReason: blockreason
    }
  });

  return { message: "Account Restricted Successfully" };
}

// ==========================================
// TODO: Implement placeholders for wallet operations later
// ==========================================

async fundWalletPlaceholder(dto: any) {
  // Placeholder implementation for funding wallet
  return { 
    message: "Placeholder: Wallet funded successfully", 
    amount: dto.amount || 0 
  };
}

async removeMoneyPlaceholder(dto: any) {
  // Placeholder implementation for removing money from wallet
  return { 
    message: "Placeholder: Money removed from wallet successfully", 
    amount: dto.amount || 0 
  };
}

async getTransactionsPlaceholder(page: number, limit: number) {
  // Placeholder implementation for paginated transactions
  return {
    message: "Placeholder: Paginated transactions fetched",
    data: [],
    meta: { page, limit, total: 0 }
  };
}

async getWalletBalancePlaceholder() {
  // Placeholder implementation for fetching wallet balance
  return { 
    message: "Placeholder: Wallet balance fetched", 
    mainBalance: 0,
    availableBalance: 0,
    collateralBalance: 0
  };
}

}

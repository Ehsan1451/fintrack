-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('SALARY', 'FREELANCE', 'GIFT', 'OTHER_INCOME', 'FOOD', 'TRANSPORT', 'HOUSING', 'SHOPPING', 'ENTERTAINMENT', 'BILLS', 'EDUCATION', 'HEALTH', 'OTHER_EXPENSE');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "category" "TransactionCategory" NOT NULL DEFAULT 'OTHER_EXPENSE';

-- Preserve a sensible category for existing income transactions.
UPDATE "Transaction" SET "category" = 'OTHER_INCOME' WHERE "type" = 'INCOME';

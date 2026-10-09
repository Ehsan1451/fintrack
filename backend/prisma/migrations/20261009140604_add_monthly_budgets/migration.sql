-- CreateEnum
CREATE TYPE "BudgetCategory" AS ENUM ('FOOD', 'TRANSPORT', 'HOUSING', 'SHOPPING', 'ENTERTAINMENT', 'BILLS', 'EDUCATION', 'HEALTH', 'OTHER_EXPENSE');

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "limit" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Budget_month_format_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "Budget_limit_positive_check" CHECK ("limit" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_month_category_key" ON "Budget"("userId", "month", "category");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

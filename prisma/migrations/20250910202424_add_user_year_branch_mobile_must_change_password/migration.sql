-- AlterTable
ALTER TABLE "users" ADD COLUMN     "branch" VARCHAR(100),
ADD COLUMN     "mobile" VARCHAR(20),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "year" VARCHAR(10);

-- CreateIndex
CREATE INDEX "users_mobile_idx" ON "users"("mobile");

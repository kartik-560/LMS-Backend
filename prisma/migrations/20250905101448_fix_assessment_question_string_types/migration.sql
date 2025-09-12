-- AlterTable
ALTER TABLE "AssessmentQuestion" ADD COLUMN     "correctOptionIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "correctText" TEXT,
ADD COLUMN     "pairs" JSONB,
ADD COLUMN     "sampleAnswer" TEXT;

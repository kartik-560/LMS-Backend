/*
  Warnings:

  - Added the required column `type` to the `assessment_questions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "assessment_questions" ADD COLUMN     "type" VARCHAR(30) NOT NULL;

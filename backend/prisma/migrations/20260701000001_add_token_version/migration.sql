-- AlterTable: add tokenVersion column for session-isolation on password change
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

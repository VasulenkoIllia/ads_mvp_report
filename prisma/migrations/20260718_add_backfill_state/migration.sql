-- CreateEnum
CREATE TYPE "BackfillStatus" AS ENUM ('IDLE', 'REQUESTED', 'INGESTING', 'EXPORTING');

-- CreateEnum
CREATE TYPE "BackfillTrigger" AS ENUM ('REAUTH', 'MANUAL');

-- CreateTable
CREATE TABLE "BackfillState" (
    "id" TEXT NOT NULL DEFAULT 'GLOBAL',
    "status" "BackfillStatus" NOT NULL DEFAULT 'IDLE',
    "trigger" "BackfillTrigger",
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "cursorDate" TIMESTAMP(3),
    "cursorAttempts" INTEGER NOT NULL DEFAULT 0,
    "daysTotal" INTEGER NOT NULL DEFAULT 0,
    "daysDone" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillState_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN     "aiAssisted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SuggestionJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT NOT NULL,
    "error" TEXT,
    "proposed" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SuggestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HighlightSuggestion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "jobId" TEXT,
    "segmentId" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "tagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "highlightId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighlightSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagSuggestion" (
    "highlightId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagSuggestion_pkey" PRIMARY KEY ("highlightId","tagId")
);

-- CreateIndex
CREATE INDEX "SuggestionJob_sourceId_createdAt_idx" ON "SuggestionJob"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "HighlightSuggestion_sourceId_status_idx" ON "HighlightSuggestion"("sourceId", "status");

-- CreateIndex
CREATE INDEX "HighlightSuggestion_segmentId_idx" ON "HighlightSuggestion"("segmentId");

-- CreateIndex
CREATE INDEX "TagSuggestion_tagId_idx" ON "TagSuggestion"("tagId");

-- AddForeignKey
ALTER TABLE "SuggestionJob" ADD CONSTRAINT "SuggestionJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightSuggestion" ADD CONSTRAINT "HighlightSuggestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightSuggestion" ADD CONSTRAINT "HighlightSuggestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SuggestionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightSuggestion" ADD CONSTRAINT "HighlightSuggestion_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagSuggestion" ADD CONSTRAINT "TagSuggestion_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagSuggestion" ADD CONSTRAINT "TagSuggestion_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

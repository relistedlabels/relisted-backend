-- Persist gallery order (0 = hero). Set from product attachment id array on create/update.
ALTER TABLE "Upload" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

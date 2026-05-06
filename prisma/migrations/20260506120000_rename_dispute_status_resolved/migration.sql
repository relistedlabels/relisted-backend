-- Rename typo enum value in PostgreSQL (existing rows keep the same logical status).
ALTER TYPE "DisputeStatus" RENAME VALUE 'RESELOVED' TO 'RESOLVED';

-- Profile: make businessName optional and add avatar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Profile'
      AND column_name = 'businessName'
  ) THEN
    ALTER TABLE "Profile" ADD COLUMN "businessName" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Profile'
      AND column_name = 'businessName'
  ) THEN
    ALTER TABLE "Profile" ALTER COLUMN "businessName" DROP NOT NULL;
  END IF;
END $$;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "avatar" TEXT;

-- Message: add sender -> User foreign key (was previously just a string column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Message_senderId_fkey'
  ) THEN
    ALTER TABLE "Message"
    ADD CONSTRAINT "Message_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Message <-> Upload: implicit many-to-many join table
CREATE TABLE IF NOT EXISTS "_MessageToUpload" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "_MessageToUpload_AB_unique" ON "_MessageToUpload"("A", "B");
CREATE INDEX IF NOT EXISTS "_MessageToUpload_B_index" ON "_MessageToUpload"("B");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '_MessageToUpload_A_fkey'
  ) THEN
    ALTER TABLE "_MessageToUpload"
    ADD CONSTRAINT "_MessageToUpload_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '_MessageToUpload_B_fkey'
  ) THEN
    ALTER TABLE "_MessageToUpload"
    ADD CONSTRAINT "_MessageToUpload_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

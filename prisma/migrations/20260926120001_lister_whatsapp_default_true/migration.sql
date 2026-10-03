ALTER TABLE "NotificationSettings" ALTER COLUMN "whatsappOptIn" SET DEFAULT true;
UPDATE "NotificationSettings" SET "whatsappOptIn" = true;

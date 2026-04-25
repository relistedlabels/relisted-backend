-- Profile: make businessName optional and add avatar
ALTER TABLE "Profile" ALTER COLUMN "businessName" DROP NOT NULL;
ALTER TABLE "Profile" ADD COLUMN "avatar" TEXT;

-- Message: add sender -> User foreign key (was previously just a string column)
ALTER TABLE "Message"
ADD CONSTRAINT "Message_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Message <-> Upload: implicit many-to-many join table
CREATE TABLE "_MessageToUpload" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_MessageToUpload_AB_unique" ON "_MessageToUpload"("A", "B");
CREATE INDEX "_MessageToUpload_B_index" ON "_MessageToUpload"("B");

ALTER TABLE "_MessageToUpload"
ADD CONSTRAINT "_MessageToUpload_A_fkey"
FOREIGN KEY ("A") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_MessageToUpload"
ADD CONSTRAINT "_MessageToUpload_B_fkey"
FOREIGN KEY ("B") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

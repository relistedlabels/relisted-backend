-- Add shop visibility and brand-removal deactivation tracking
ALTER TABLE "Brand" ADD COLUMN "isShopVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "deactivatedByBrandRemoval" BOOLEAN NOT NULL DEFAULT false;

-- Existing brands remain visible until an admin changes the allowlist
UPDATE "Brand" SET "isShopVisible" = true;

-- Merge duplicate brand names (case-insensitive), keep the oldest row
WITH ranked AS (
  SELECT
    id,
    LOWER(TRIM(name)) AS normalized_name,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name))
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Brand"
),
canonical AS (
  SELECT id AS canonical_id, normalized_name
  FROM ranked
  WHERE rn = 1
),
duplicates AS (
  SELECT r.id AS duplicate_id, c.canonical_id
  FROM ranked r
  JOIN canonical c ON c.normalized_name = r.normalized_name
  WHERE r.rn > 1
)
UPDATE "Product" p
SET "brandId" = d.canonical_id
FROM duplicates d
WHERE p."brandId" = d.duplicate_id;

DELETE FROM "Brand" b
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(name))
        ORDER BY "createdAt" ASC, id ASC
      ) AS rn
    FROM "Brand"
  ) ranked
  WHERE rn > 1
) dup
WHERE b.id = dup.id;

CREATE UNIQUE INDEX "Brand_name_lower_key" ON "Brand" (LOWER(TRIM(name)));

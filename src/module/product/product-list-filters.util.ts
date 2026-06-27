import { ListingType, Prisma } from '@prisma/client';

export type ProductListFilterInput = {
  category?: string | string[];
  brand?: string | string[];
  tags?: string;
  listingType?: string | string[];
  curatorId?: string | string[];
  color?: string;
  size?: string;
  condition?: string;
  material?: string;
  minPrice?: number;
  maxPrice?: number;
  inCloset?: boolean;
};

function normalizeCsv(value?: string | string[]): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(',');
  return raw.map((s) => s.trim()).filter(Boolean);
}

function pushAnd(where: Prisma.ProductWhereInput, clause: Prisma.ProductWhereInput) {
  if (!where.AND) {
    where.AND = [clause];
    return;
  }
  where.AND = Array.isArray(where.AND)
    ? [...where.AND, clause]
    : [where.AND, clause];
}

const LISTING_TYPES = new Set<string>(Object.values(ListingType));

export function applyProductListFilters(
  where: Prisma.ProductWhereInput,
  query: ProductListFilterInput,
): void {
  const categories = normalizeCsv(query.category);
  if (categories.length === 1) {
    where.categoryId = categories[0];
  } else if (categories.length > 1) {
    where.categoryId = { in: categories };
  }

  if (query.brand) {
    const brandNames = normalizeCsv(query.brand);
    where.brand = {
      name: { in: brandNames, mode: 'insensitive' },
    };
  }

  const listingTypes = normalizeCsv(query.listingType).filter((t) =>
    LISTING_TYPES.has(t),
  );
  if (listingTypes.length === 1) {
    where.listingType = listingTypes[0] as ListingType;
  } else if (listingTypes.length > 1) {
    where.listingType = { in: listingTypes as ListingType[] };
  }

  const curatorIds = normalizeCsv(query.curatorId);
  if (curatorIds.length === 1) {
    where.curatorId = curatorIds[0];
  } else if (curatorIds.length > 1) {
    where.curatorId = { in: curatorIds };
  }

  if (query.inCloset === true) {
    where.closetId = { not: null };
  } else if (query.inCloset === false) {
    where.closetId = null;
  }

  if (query.color) {
    const colors = normalizeCsv(query.color);
    where.color = { in: colors, mode: 'insensitive' };
  }

  if (query.size) {
    const sizes = normalizeCsv(query.size);
    where.measurement = { in: sizes, mode: 'insensitive' };
  }

  if (query.condition) {
    const conditionMap: Record<string, string[]> = {
      new: ['brand new', 'new', 'brand_new'],
      'like new': ['like new', 'like_new', 'like new'],
      good: ['good', 'great', 'gently used'],
      fair: ['fair', 'okay', 'used'],
      poor: ['poor', 'worn', 'heavily used'],
    };
    const inputConditions = normalizeCsv(query.condition).map((s) =>
      s.toLowerCase(),
    );
    const mappedConditions = inputConditions.flatMap(
      (c) => conditionMap[c] || [c],
    );
    where.condition = { in: mappedConditions, mode: 'insensitive' };
  }

  if (query.material) {
    const materials = normalizeCsv(query.material);
    where.material = { in: materials, mode: 'insensitive' };
  }

  if (query.tags) {
    const tags = normalizeCsv(query.tags);
    pushAnd(where, {
      tags: {
        some: {
          OR: tags.map((tag) => ({
            name: { contains: tag, mode: 'insensitive' },
          })),
        },
      },
    });
  }

  const minPrice =
    query.minPrice !== undefined && !Number.isNaN(query.minPrice)
      ? Number(query.minPrice)
      : undefined;
  const maxPrice =
    query.maxPrice !== undefined && !Number.isNaN(query.maxPrice)
      ? Number(query.maxPrice)
      : undefined;

  if (minPrice !== undefined || maxPrice !== undefined) {
    pushAnd(where, {
      OR: [
        {
          listingType: 'RENTAL',
          dailyPrice: {
            ...(minPrice !== undefined && { gte: minPrice }),
            ...(maxPrice !== undefined && { lte: maxPrice }),
          },
        },
        {
          listingType: 'RESALE',
          resalePrice: {
            ...(minPrice !== undefined && { gte: minPrice }),
            ...(maxPrice !== undefined && { lte: maxPrice }),
          },
        },
        {
          listingType: 'RENT_OR_RESALE',
          OR: [
            {
              dailyPrice: {
                ...(minPrice !== undefined && { gte: minPrice }),
                ...(maxPrice !== undefined && { lte: maxPrice }),
              },
            },
            {
              resalePrice: {
                ...(minPrice !== undefined && { gte: minPrice }),
                ...(maxPrice !== undefined && { lte: maxPrice }),
              },
            },
          ],
        },
      ],
    });
  }
}

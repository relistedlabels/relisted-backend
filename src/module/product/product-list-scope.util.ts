import { ListingType, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';

export type ProductListScopeInput = {
  sale?: string;
  closetId?: string;
  onlyWithCloset?: boolean;
  excludeStagingCurator?: boolean;
};

export const LIVE_SHOP_STATUSES: ProductStatus[] = [
  ProductStatus.AVAILABLE,
  ProductStatus.APPROVED,
  ProductStatus.RENTED,
];

/** Admin Active tab: live listings not currently out on rental. */
export const ADMIN_ACTIVE_LISTING_STATUSES: ProductStatus[] = [
  ProductStatus.AVAILABLE,
  ProductStatus.APPROVED,
];

export function buildAdminPickerScopeWhere(): Prisma.ProductWhereInput {
  return {
    status: { in: LIVE_SHOP_STATUSES },
    isActive: true,
  };
}

export async function buildProductListScopeWhere(
  prisma: PrismaService,
  query: ProductListScopeInput,
): Promise<Prisma.ProductWhereInput> {
  const saleSlug = query.sale?.trim();
  const inSaleContext = Boolean(saleSlug);
  const inClosetListContext = Boolean(query.closetId || query.onlyWithCloset);
  const inCampaignContext = inClosetListContext || inSaleContext;

  const where: Prisma.ProductWhereInput = {};

  if (inCampaignContext) {
    where.AND = [
      {
        OR: [
          { status: { in: LIVE_SHOP_STATUSES }, isActive: true },
          { status: ProductStatus.SOLD },
        ],
      },
    ];
  } else {
    where.status = { in: LIVE_SHOP_STATUSES };
    where.isActive = true;
  }

  if (saleSlug) {
    const sale = await prisma.shopSale.findUnique({
      where: { slug: saleSlug },
      select: {
        isEnabled: true,
        products: { select: { productId: true } },
      },
    });
    const saleProductIds =
      sale?.isEnabled === true
        ? sale.products.map((row) => row.productId)
        : [];
    where.id = {
      in: saleProductIds.length > 0 ? saleProductIds : ['__no_sale_items__'],
    };
  } else if (query.closetId) {
    where.closetId = query.closetId;
    if (query.excludeStagingCurator === true) {
      where.closet = { is: { isActive: true } };
    }
  } else if (query.onlyWithCloset) {
    if (query.excludeStagingCurator === true) {
      where.closet = { is: { isActive: true } };
    } else {
      where.closetId = { not: null };
    }
  } else {
    where.closetId = null;
  }

  return where;
}

const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  RENTAL: 'Rental',
  RESALE: 'Resale',
  RENT_OR_RESALE: 'Rent or resale',
};

export type ProductFilterOptionsResult = {
  colors: string[];
  sizes: string[];
  conditions: string[];
  materials: string[];
  listingTypes: Array<{ value: ListingType; label: string }>;
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  listers: Array<{ id: string; name: string }>;
};

async function distinctStringField(
  prisma: PrismaService,
  where: Prisma.ProductWhereInput,
  field: 'color' | 'measurement' | 'condition' | 'material',
): Promise<string[]> {
  const fieldWhere: Prisma.ProductWhereInput =
    field === 'material'
      ? {
          AND: [where, { material: { not: null } }, { NOT: { material: '' } }],
        }
      : {
          AND: [where, { NOT: { [field]: '' } }],
        };

  const rows = await prisma.product.findMany({
    where: fieldWhere,
    select: {
      color: true,
      measurement: true,
      condition: true,
      material: true,
    },
    distinct: [field],
    orderBy: { [field]: 'asc' },
  });

  return rows
    .map((row) => {
      switch (field) {
        case 'color':
          return row.color;
        case 'measurement':
          return row.measurement;
        case 'condition':
          return row.condition;
        case 'material':
          return row.material;
        default:
          return null;
      }
    })
    .filter((value): value is string => Boolean(value?.trim()));
}

export async function collectProductFilterOptions(
  prisma: PrismaService,
  where: Prisma.ProductWhereInput,
): Promise<ProductFilterOptionsResult> {
  const [
    colors,
    sizes,
    conditions,
    materials,
    listingTypeRows,
    brandRows,
    categoryRows,
    tags,
    listers,
  ] = await Promise.all([
    distinctStringField(prisma, where, 'color'),
    distinctStringField(prisma, where, 'measurement'),
    distinctStringField(prisma, where, 'condition'),
    distinctStringField(prisma, where, 'material'),
    prisma.product.groupBy({
      by: ['listingType'],
      where,
      orderBy: { listingType: 'asc' },
    }),
    prisma.product.findMany({
      where: { AND: [where, { brandId: { not: null } }] },
      select: { brand: { select: { id: true, name: true } } },
      distinct: ['brandId'],
      orderBy: { brand: { name: 'asc' } },
    }),
    prisma.product.findMany({
      where: { AND: [where, { categoryId: { not: null } }] },
      select: { category: { select: { id: true, name: true } } },
      distinct: ['categoryId'],
      orderBy: { category: { name: 'asc' } },
    }),
    prisma.tag.findMany({
      where: { products: { some: where } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { products: { some: where } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const brands = brandRows
    .map((row) => row.brand)
    .filter((brand): brand is { id: string; name: string } => Boolean(brand))
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories = categoryRows
    .map((row) => row.category)
    .filter(
      (category): category is { id: string; name: string } => Boolean(category),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    colors,
    sizes,
    conditions,
    materials,
    listingTypes: listingTypeRows.map((row) => ({
      value: row.listingType,
      label: LISTING_TYPE_LABELS[row.listingType],
    })),
    brands,
    categories,
    tags,
    listers: listers.map((user) => ({
      id: user.id,
      name: user.name || user.id.slice(0, 8),
    })),
  };
}

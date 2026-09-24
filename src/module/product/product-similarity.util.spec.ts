import { ListingType } from '@prisma/client';
import {
  buildSimilarProductCandidateWhere,
  rankProductsBySimilarity,
  scoreProductSimilarity,
  SimilarityProductInput,
} from './product-similarity.util';

const baseProduct = (
  overrides: Partial<SimilarityProductInput> = {},
): SimilarityProductInput => ({
  id: 'source-1',
  categoryId: 'cat-dresses',
  brandId: 'brand-zara',
  color: 'Black',
  measurement: 'M',
  condition: 'Excellent',
  material: 'Silk',
  listingType: ListingType.RENTAL,
  dailyPrice: 10000,
  resalePrice: null,
  originalValue: 50000,
  curatorId: 'lister-1',
  closetId: null,
  tags: [{ id: 'tag-evening' }, { id: 'tag-formal' }],
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('product similarity', () => {
  it('scores highest for products matching category, brand, tags, color, and size', () => {
    const source = baseProduct();
    const closeMatch = baseProduct({
      id: 'match-1',
      tags: [{ id: 'tag-evening' }, { id: 'tag-formal' }],
    });
    const weakMatch = baseProduct({
      id: 'match-2',
      categoryId: 'cat-shoes',
      brandId: 'brand-nike',
      color: 'White',
      measurement: '10',
      tags: [{ id: 'tag-casual' }],
      dailyPrice: 3000,
    });

    expect(scoreProductSimilarity(source, closeMatch)).toBeGreaterThan(
      scoreProductSimilarity(source, weakMatch),
    );
  });

  it('excludes the source product from scoring', () => {
    const source = baseProduct();
    expect(scoreProductSimilarity(source, source)).toBe(0);
  });

  it('ranks by score and recency', () => {
    const source = baseProduct();
    const ranked = rankProductsBySimilarity(
      source,
      [
        baseProduct({
          id: 'older',
          brandId: 'brand-other',
          createdAt: new Date('2025-01-01'),
        }),
        baseProduct({
          id: 'newer',
          brandId: 'brand-other',
          createdAt: new Date('2026-06-01'),
        }),
        baseProduct({ id: 'best', tags: [{ id: 'tag-evening' }] }),
      ],
      2,
    );

    expect(ranked.map((product) => product.id)).toEqual(['best', 'newer']);
  });

  it('builds candidate filters from source attributes', () => {
    const filters = buildSimilarProductCandidateWhere(baseProduct());

    expect(filters).toEqual(
      expect.arrayContaining([
        { categoryId: 'cat-dresses' },
        { brandId: 'brand-zara' },
        { tags: { some: { id: { in: ['tag-evening', 'tag-formal'] } } } },
        { color: { equals: 'Black', mode: 'insensitive' } },
        { measurement: { equals: 'M', mode: 'insensitive' } },
        { curatorId: 'lister-1' },
      ]),
    );
  });

  it('gives partial listing type credit for rent-or-resale overlap', () => {
    const source = baseProduct({ listingType: ListingType.RENTAL });
    const sharedOverrides = {
      categoryId: 'cat-other',
      brandId: 'brand-other',
      color: 'Blue',
      measurement: 'L',
      tags: [],
      condition: 'Good',
      material: 'Cotton',
      curatorId: 'lister-2',
      dailyPrice: 3000,
    };
    const hybrid = baseProduct({
      id: 'hybrid',
      listingType: ListingType.RENT_OR_RESALE,
      ...sharedOverrides,
    });
    const resaleOnly = baseProduct({
      id: 'resale',
      listingType: ListingType.RESALE,
      ...sharedOverrides,
    });

    expect(scoreProductSimilarity(source, hybrid)).toBeGreaterThan(
      scoreProductSimilarity(source, resaleOnly),
    );
  });
});

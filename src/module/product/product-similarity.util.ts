import { ListingType } from '@prisma/client';

export type SimilarityProductInput = {
  id: string;
  categoryId: string | null;
  brandId: string | null;
  color: string;
  measurement: string;
  condition: string;
  material?: string | null;
  listingType: ListingType;
  dailyPrice: number | null;
  resalePrice: number | null;
  originalValue: number;
  curatorId: string;
  closetId: string | null;
  tags?: Array<{ id: string }>;
  createdAt?: Date;
};

export const SIMILARITY_WEIGHTS = {
  category: 30,
  brand: 25,
  tags: 20,
  color: 10,
  size: 10,
  price: 10,
  closet: 8,
  condition: 5,
  material: 5,
  listingType: 5,
  lister: 5,
} as const;

function normalizeField(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function getComparablePrice(product: SimilarityProductInput): number | null {
  if (
    product.listingType === ListingType.RESALE &&
    product.resalePrice != null &&
    product.resalePrice > 0
  ) {
    return product.resalePrice;
  }

  if (product.dailyPrice != null && product.dailyPrice > 0) {
    return product.dailyPrice;
  }

  if (product.resalePrice != null && product.resalePrice > 0) {
    return product.resalePrice;
  }

  return null;
}

function scoreTagOverlap(
  sourceTags: Array<{ id: string }>,
  candidateTags: Array<{ id: string }>,
): number {
  if (sourceTags.length === 0 || candidateTags.length === 0) {
    return 0;
  }

  const sourceTagIds = new Set(sourceTags.map((tag) => tag.id));
  const sharedCount = candidateTags.filter((tag) =>
    sourceTagIds.has(tag.id),
  ).length;
  const unionSize = new Set([
    ...sourceTags.map((tag) => tag.id),
    ...candidateTags.map((tag) => tag.id),
  ]).size;

  if (unionSize === 0) return 0;
  return (sharedCount / unionSize) * SIMILARITY_WEIGHTS.tags;
}

function scorePriceProximity(
  source: SimilarityProductInput,
  candidate: SimilarityProductInput,
): number {
  const sourcePrice = getComparablePrice(source);
  const candidatePrice = getComparablePrice(candidate);

  if (sourcePrice == null || candidatePrice == null) {
    return 0;
  }

  const ratio =
    Math.min(sourcePrice, candidatePrice) / Math.max(sourcePrice, candidatePrice);

  if (ratio >= 0.8) return SIMILARITY_WEIGHTS.price;
  if (ratio >= 0.6) return SIMILARITY_WEIGHTS.price * 0.7;
  if (ratio >= 0.4) return SIMILARITY_WEIGHTS.price * 0.4;
  return 0;
}

function scoreListingType(
  source: ListingType,
  candidate: ListingType,
): number {
  if (source === candidate) {
    return SIMILARITY_WEIGHTS.listingType;
  }

  if (
    source === ListingType.RENT_OR_RESALE ||
    candidate === ListingType.RENT_OR_RESALE
  ) {
    return SIMILARITY_WEIGHTS.listingType * 0.4;
  }

  return 0;
}

export function scoreProductSimilarity(
  source: SimilarityProductInput,
  candidate: SimilarityProductInput,
): number {
  if (source.id === candidate.id) {
    return 0;
  }

  let score = 0;

  if (source.categoryId && source.categoryId === candidate.categoryId) {
    score += SIMILARITY_WEIGHTS.category;
  }

  if (source.brandId && source.brandId === candidate.brandId) {
    score += SIMILARITY_WEIGHTS.brand;
  }

  score += scoreTagOverlap(source.tags ?? [], candidate.tags ?? []);

  const sourceColor = normalizeField(source.color);
  const candidateColor = normalizeField(candidate.color);
  if (sourceColor && sourceColor === candidateColor) {
    score += SIMILARITY_WEIGHTS.color;
  }

  const sourceSize = normalizeField(source.measurement);
  const candidateSize = normalizeField(candidate.measurement);
  if (sourceSize && sourceSize === candidateSize) {
    score += SIMILARITY_WEIGHTS.size;
  }

  if (
    normalizeField(source.condition) === normalizeField(candidate.condition)
  ) {
    score += SIMILARITY_WEIGHTS.condition;
  }

  const sourceMaterial = normalizeField(source.material);
  const candidateMaterial = normalizeField(candidate.material);
  if (sourceMaterial && sourceMaterial === candidateMaterial) {
    score += SIMILARITY_WEIGHTS.material;
  }

  score += scoreListingType(source.listingType, candidate.listingType);
  score += scorePriceProximity(source, candidate);

  if (source.closetId && source.closetId === candidate.closetId) {
    score += SIMILARITY_WEIGHTS.closet;
  }

  if (source.curatorId === candidate.curatorId) {
    score += SIMILARITY_WEIGHTS.lister;
  }

  return score;
}

export function rankProductsBySimilarity<T extends SimilarityProductInput>(
  source: SimilarityProductInput,
  candidates: T[],
  limit: number,
): T[] {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreProductSimilarity(source, candidate),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const aCreated = a.candidate.createdAt?.getTime() ?? 0;
      const bCreated = b.candidate.createdAt?.getTime() ?? 0;
      return bCreated - aCreated;
    });

  return scored.slice(0, limit).map((entry) => entry.candidate);
}

export function buildSimilarProductCandidateWhere(
  source: SimilarityProductInput,
): Array<Record<string, unknown>> {
  const orFilters: Array<Record<string, unknown>> = [];
  const sourcePrice = getComparablePrice(source);

  if (source.categoryId) {
    orFilters.push({ categoryId: source.categoryId });
  }

  if (source.brandId) {
    orFilters.push({ brandId: source.brandId });
  }

  const tagIds = (source.tags ?? []).map((tag) => tag.id);
  if (tagIds.length > 0) {
    orFilters.push({ tags: { some: { id: { in: tagIds } } } });
  }

  const normalizedColor = normalizeField(source.color);
  if (normalizedColor) {
    orFilters.push({ color: { equals: source.color, mode: 'insensitive' } });
  }

  const normalizedSize = normalizeField(source.measurement);
  if (normalizedSize) {
    orFilters.push({
      measurement: { equals: source.measurement, mode: 'insensitive' },
    });
  }

  if (source.closetId) {
    orFilters.push({ closetId: source.closetId });
  }

  if (sourcePrice != null && sourcePrice > 0) {
    const minPrice = Math.floor(sourcePrice * 0.5);
    const maxPrice = Math.ceil(sourcePrice * 1.5);
    orFilters.push({
      OR: [
        { dailyPrice: { gte: minPrice, lte: maxPrice } },
        { resalePrice: { gte: minPrice, lte: maxPrice } },
      ],
    });
  }

  if (source.curatorId) {
    orFilters.push({ curatorId: source.curatorId });
  }

  return orFilters;
}

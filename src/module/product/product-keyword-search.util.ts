import { Prisma } from '@prisma/client';

export type ProductKeywordSearchOptions = {
  includeClosetFields?: boolean;
};

export function parseProductKeywordSearchTerms(search: string): string[] {
  return search
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function buildProductKeywordTokenOr(
  term: string,
  options?: ProductKeywordSearchOptions,
): Prisma.ProductWhereInput[] {
  const or: Prisma.ProductWhereInput[] = [
    { name: { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { subText: { contains: term, mode: 'insensitive' } },
    { brand: { name: { contains: term, mode: 'insensitive' } } },
    { category: { name: { contains: term, mode: 'insensitive' } } },
    {
      tags: {
        some: { name: { contains: term, mode: 'insensitive' } },
      },
    },
    { color: { contains: term, mode: 'insensitive' } },
    { composition: { contains: term, mode: 'insensitive' } },
  ];

  if (options?.includeClosetFields) {
    or.push(
      { closet: { is: { name: { contains: term, mode: 'insensitive' } } } },
      { closet: { is: { slug: { contains: term, mode: 'insensitive' } } } },
      {
        closet: {
          is: {
            description: { contains: term, mode: 'insensitive' },
          },
        },
      },
    );
  }

  return or;
}

export function buildProductKeywordSearchWhere(
  search: string,
  options?: ProductKeywordSearchOptions,
): Prisma.ProductWhereInput | null {
  const terms = parseProductKeywordSearchTerms(search);
  if (terms.length === 0) {
    return null;
  }

  if (terms.length === 1) {
    return { OR: buildProductKeywordTokenOr(terms[0], options) };
  }

  return {
    AND: terms.map((term) => ({
      OR: buildProductKeywordTokenOr(term, options),
    })),
  };
}

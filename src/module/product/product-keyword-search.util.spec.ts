import {
  buildProductKeywordSearchWhere,
  parseProductKeywordSearchTerms,
} from './product-keyword-search.util';

describe('product keyword search', () => {
  it('parses whitespace-separated terms', () => {
    expect(parseProductKeywordSearchTerms('  pink   dress  ')).toEqual([
      'pink',
      'dress',
    ]);
  });

  it('builds single-term OR filter', () => {
    expect(buildProductKeywordSearchWhere('pink')).toEqual({
      OR: expect.arrayContaining([
        { color: { contains: 'pink', mode: 'insensitive' } },
      ]),
    });
  });

  it('builds multi-term AND filter so each word can match different fields', () => {
    expect(buildProductKeywordSearchWhere('pink dress')).toEqual({
      AND: [
        {
          OR: expect.arrayContaining([
            { color: { contains: 'pink', mode: 'insensitive' } },
          ]),
        },
        {
          OR: expect.arrayContaining([
            { name: { contains: 'dress', mode: 'insensitive' } },
          ]),
        },
      ],
    });
  });

  it('includes closet fields only when requested', () => {
    const withCloset = buildProductKeywordSearchWhere('pink', {
      includeClosetFields: true,
    });
    const withoutCloset = buildProductKeywordSearchWhere('pink');

    expect(withCloset?.OR).toEqual(
      expect.arrayContaining([
        {
          closet: {
            is: { name: { contains: 'pink', mode: 'insensitive' } },
          },
        },
      ]),
    );
    expect(withoutCloset?.OR).not.toEqual(
      expect.arrayContaining([
        {
          closet: {
            is: { name: { contains: 'pink', mode: 'insensitive' } },
          },
        },
      ]),
    );
  });
});

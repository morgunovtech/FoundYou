import { describe, expect, it } from 'vitest';
import { googleMapsLink, streetViewLink } from '../mapLinks';

describe('googleMapsLink', () => {
  it('builds a search URL with lat,lon', () => {
    expect(googleMapsLink(41.3112, 69.2797)).toBe('https://www.google.com/maps/search/?api=1&query=41.3112,69.2797');
  });

  it('keeps negative coordinates and integers verbatim', () => {
    expect(googleMapsLink(-33.86882, 151.20929)).toBe('https://www.google.com/maps/search/?api=1&query=-33.86882,151.20929');
    expect(googleMapsLink(41, 69)).toBe('https://www.google.com/maps/search/?api=1&query=41,69');
  });

  it('is a valid https URL with the expected query parameters', () => {
    const url = new URL(googleMapsLink(41.3112, 69.2797));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('www.google.com');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('41.3112,69.2797');
  });
});

describe('streetViewLink', () => {
  const base = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.3112,69.2797';

  it('without heading returns the pano URL only', () => {
    expect(streetViewLink(41.3112, 69.2797)).toBe(base);
    expect(streetViewLink(41.3112, 69.2797, undefined)).toBe(base);
  });

  it('appends the heading when given', () => {
    expect(streetViewLink(41.3112, 69.2797, 90)).toBe(`${base}&heading=90`);
    expect(streetViewLink(41.3112, 69.2797, 359.5)).toBe(`${base}&heading=359.5`);
  });

  it('a heading of 0 (due north) is kept, not dropped as falsy', () => {
    expect(streetViewLink(41.3112, 69.2797, 0)).toBe(`${base}&heading=0`);
  });

  it('parses as a URL with map_action=pano', () => {
    const url = new URL(streetViewLink(41.3112, 69.2797, 45));
    expect(url.searchParams.get('map_action')).toBe('pano');
    expect(url.searchParams.get('viewpoint')).toBe('41.3112,69.2797');
    expect(url.searchParams.get('heading')).toBe('45');
  });
});

import { describe, expect, it } from 'vitest';
import { matchMessengerSize } from '../messengerFootprint';

describe('matchMessengerSize', () => {
  /*
   * The rule it replaces said «longest side ≤ 1600 px looks like social media», which fires on
   * every downscaled photograph and names nobody. Sitting exactly on a known cap is a far
   * narrower statement — and still only a hint, which is why every matching service is listed.
   */

  it('names the service whose cap the longest side sits on', () => {
    expect(matchMessengerSize(1600, 1200)?.platforms).toEqual(['WhatsApp']);
    expect(matchMessengerSize(1200, 1600)?.platforms).toEqual(['WhatsApp']);
  });

  it('leaves out a service whose cap is not on the longest side', () => {
    /*
     * Instagram caps the width at 1080, so a portrait post is 1080×1350 and its longest side is
     * 1350. Folding that into a longest-side table would make the check claim what it cannot
     * support, so Instagram is deliberately absent — this test is here to keep it that way.
     */
    expect(matchMessengerSize(1080, 1350)).toBeNull();
  });

  it('lists every service that shares a cap rather than picking one', () => {
    // 1280 is Telegram's and Viber's alike: naming one would be inventing certainty.
    expect(matchMessengerSize(1280, 960)?.platforms).toEqual(['Telegram', 'Viber']);
  });

  it('allows a pixel of rounding and no more', () => {
    expect(matchMessengerSize(1601, 1200)).not.toBeNull();
    expect(matchMessengerSize(1599, 1200)).not.toBeNull();
    // The whole point is that a size *on* the cap says something and a size *near* it does not.
    expect(matchMessengerSize(1590, 1200)).toBeNull();
    expect(matchMessengerSize(1610, 1200)).toBeNull();
  });

  it('says nothing about a picture that is not on a cap', () => {
    expect(matchMessengerSize(4032, 3024)).toBeNull(); // straight off an iPhone
    expect(matchMessengerSize(1920, 1080)).toBeNull(); // a screen, not a messenger
    expect(matchMessengerSize(800, 600)).toBeNull();
  });

  it('refuses sizes that are not sizes', () => {
    expect(matchMessengerSize(0, 1600)).toBeNull();
    expect(matchMessengerSize(1600, -1)).toBeNull();
    expect(matchMessengerSize(Number.NaN, 1600)).toBeNull();
  });

  it('reports the cap that matched, for the card to name it', () => {
    expect(matchMessengerSize(2560, 1440)?.cap).toBe(2560);
    expect(matchMessengerSize(4096, 3072)?.cap).toBe(4096);
  });
});

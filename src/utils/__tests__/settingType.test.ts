import { describe, expect, it } from 'vitest';
import { readSetting, SETTING_MIN_CONFIDENCE } from '../settingType';
import type { BoundingBox } from '../../types/detection';

const box = (label: string, score = 0.8): BoundingBox => ({
  label,
  score,
  x: 10,
  y: 10,
  width: 50,
  height: 50
});

describe('readSetting', () => {
  /*
   * The point of this reading is what a photograph gives away with no metadata at all: a geotag
   * can be stripped, a bed cannot. The point of the thresholds is that it refuses to answer far
   * more often than it answers — most photographs contain a person and nothing that says where.
   */

  it('says nothing about a photo of a person alone', () => {
    expect(readSetting([box('person'), box('person')])).toBeNull();
  });

  it('says nothing at all when there is nothing to read', () => {
    expect(readSetting([])).toBeNull();
  });

  it('a bed and a television are a home', () => {
    const reading = readSetting([box('bed'), box('tv'), box('person')]);
    expect(reading?.setting).toBe('home');
    expect(reading?.indoors).toBe(true);
    expect(reading?.evidence).toEqual(expect.arrayContaining(['bed', 'tv']));
  });

  it('a laptop, a keyboard and a mouse are a workplace', () => {
    expect(readSetting([box('laptop'), box('keyboard'), box('mouse')])?.setting).toBe('workplace');
  });

  it('a toilet is a bathroom even next to a sink that could be a kitchen', () => {
    const reading = readSetting([box('toilet'), box('sink')]);
    expect(reading?.setting).toBe('bathroom');
  });

  it('an oven and a refrigerator are a kitchen', () => {
    expect(readSetting([box('oven'), box('refrigerator')])?.setting).toBe('kitchen');
  });

  it('a traffic light and a car are a street, and not indoors', () => {
    const reading = readSetting([box('traffic light'), box('car')]);
    expect(reading?.setting).toBe('street');
    expect(reading?.indoors).toBe(false);
  });

  it('livestock is nature', () => {
    expect(readSetting([box('cow'), box('sheep')])?.setting).toBe('nature');
  });

  it('a chair on its own is not enough — chairs are everywhere', () => {
    // It votes for two settings at once, so neither clears the margin. That is the intended
    // answer: «кресло» told us nothing about the room in the case this was written for.
    expect(readSetting([box('chair'), box('chair')])).toBeNull();
  });

  it('refuses when two settings are neck and neck', () => {
    // A television (home 2) against a bus (street 3) is a difference of one: not a verdict.
    expect(readSetting([box('tv'), box('bus')])).toBeNull();
  });

  it('ignores a detection the scene narrative would call «возможно»', () => {
    const faint = SETTING_MIN_CONFIDENCE - 0.05;
    expect(readSetting([box('bed', faint), box('tv', faint)])).toBeNull();
    // The same objects, seen clearly, do answer.
    expect(readSetting([box('bed'), box('tv')])?.setting).toBe('home');
  });

  it('ignores labels it has no opinion about', () => {
    expect(readSetting([box('frisbee'), box('tie'), box('person')])).toBeNull();
  });

  it('reports only the evidence for the setting it named', () => {
    const reading = readSetting([box('bed'), box('couch'), box('traffic light')]);
    expect(reading?.setting).toBe('home');
    expect(reading?.evidence).not.toContain('traffic light');
  });
});

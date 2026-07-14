import { describe, it, expect } from 'vitest';
import { imageMime, toDataUrl } from './media';

describe('imageMime', () => {
  it('detects image extensions', () => {
    expect(imageMime('a/b/icon.png')).toBe('image/png');
    expect(imageMime('photo.JPG')).toBe('image/jpeg');
    expect(imageMime('logo.svg')).toBe('image/svg+xml');
  });
  it('returns null for non-images', () => {
    expect(imageMime('main.ts')).toBeNull();
    expect(imageMime('README')).toBeNull();
  });
});

describe('toDataUrl', () => {
  it('builds a base64 data URL', () => {
    const url = toDataUrl(new Uint8Array([104, 105]), 'text/plain'); // "hi"
    expect(url).toBe('data:text/plain;base64,aGk=');
  });
});

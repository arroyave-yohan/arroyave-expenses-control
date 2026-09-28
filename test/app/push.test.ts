import { describe, it, expect } from 'vitest';
import { deviceLabel, urlBase64ToUint8Array } from '../../src/app/push';

describe('deviceLabel', () => {
  it('reconoce Android/Chrome, Samsung, Windows/Edge, iOS/Safari y un fallback', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Safari/537.36')).toBe('Android · Samsung');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('iOS · Safari');
    expect(deviceLabel('curl/8.0')).toBe('Dispositivo · Navegador');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url sin relleno', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array('_-8'))).toEqual([255, 239]);
    expect(urlBase64ToUint8Array('')).toHaveLength(0);
  });
});

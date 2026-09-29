import { describe, expect, it } from 'vitest';

import MediaService from '../src/services/MediaService';

describe('MediaService URL normalization', () => {
    it('บันทึก relative media path ก่อน absolute URL', () => {
        expect(
            MediaService.getPreferredUrl({
                path: '/media/category.webp',
                url: 'http://old-host/media/category.webp'
            })
        ).toBe('/media/category.webp');
    });

    it('แก้ absolute media URL เก่าให้ใช้ API host และ port ปัจจุบัน', () => {
        const apiBase = String(import.meta.env.VITE_APP_API || '').replace(/\/$/, '');
        expect(MediaService.resolveUrl('http://old-host/media/category.webp')).toBe(
            apiBase ? `${apiBase}/media/category.webp` : '/media/category.webp'
        );
    });

    it('ไม่แก้ URL ภายนอกที่ไม่ใช่ media ของระบบ', () => {
        expect(MediaService.resolveUrl('https://cdn.example.com/banner.webp')).toBe(
            'https://cdn.example.com/banner.webp'
        );
    });
});

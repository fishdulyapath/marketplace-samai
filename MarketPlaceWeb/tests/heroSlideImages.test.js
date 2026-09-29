import { describe, expect, it } from 'vitest';
import { getHeroBackgroundImageUrl, heroHasVisibleText, shouldRenderHeroMedia, usesHeroFullImage } from '../src/utils/heroSlideImages';

describe('hero slide image rendering', () => {
    it('renders a text-and-image slide as separate media only while text is visible', () => {
        const slide = { mode: 'campaign', layout: 'split', textVisible: true, title: 'Promotion', imageUrl: '/media/promo.webp' };

        expect(heroHasVisibleText(slide)).toBe(true);
        expect(usesHeroFullImage(slide)).toBe(false);
        expect(shouldRenderHeroMedia(slide)).toBe(true);
    });

    it('does not render a second media layer when text is hidden', () => {
        const slide = {
            mode: 'campaign',
            layout: 'split',
            textVisible: false,
            imageUrl: '/media/buy-one-get-one.webp',
            backgroundImageUrl: '/media/old-background.webp'
        };

        expect(usesHeroFullImage(slide)).toBe(true);
        expect(shouldRenderHeroMedia(slide)).toBe(false);
        expect(getHeroBackgroundImageUrl(slide)).toBe('/media/buy-one-get-one.webp');
    });

    it('prefers the selected image for image-only mode even if an old background remains', () => {
        const slide = { mode: 'imageOnly', imageUrl: '/media/new.webp', backgroundImageUrl: '/media/old.webp' };

        expect(getHeroBackgroundImageUrl(slide)).toBe('/media/new.webp');
        expect(shouldRenderHeroMedia(slide)).toBe(false);
    });

    it('uses one background layer for background mode with visible text', () => {
        const slide = { mode: 'background', textVisible: true, title: 'Members', imageUrl: '/media/image.webp', backgroundImageUrl: '/media/background.webp' };

        expect(usesHeroFullImage(slide)).toBe(true);
        expect(getHeroBackgroundImageUrl(slide)).toBe('/media/background.webp');
        expect(shouldRenderHeroMedia(slide)).toBe(false);
    });
});

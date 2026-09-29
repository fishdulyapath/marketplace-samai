function isFilled(value) {
    return String(value || '').trim().length > 0;
}

export function heroHasVisibleText(slide) {
    if (!slide || slide.textVisible === false || slide.mode === 'imageOnly') return false;
    return [slide.eyebrow, slide.title, slide.subtitle, slide.ctaLabel, slide.badge, slide.discountText].some(isFilled);
}

export function usesHeroFullImage(slide) {
    if (!slide) return false;
    return slide.layout === 'background' || slide.mode === 'background' || slide.mode === 'imageOnly' || !heroHasVisibleText(slide);
}

export function getHeroBackgroundImageUrl(slide) {
    if (!slide) return '';

    // เมื่อเป็น image-only ให้รูปที่แอดมินเลือกใน Image URL ชนะ Background URL เก่าที่อาจค้างอยู่
    if (!heroHasVisibleText(slide) || slide.mode === 'imageOnly') {
        return String(slide.imageUrl || slide.backgroundImageUrl || '').trim();
    }

    if (usesHeroFullImage(slide)) {
        return String(slide.backgroundImageUrl || slide.imageUrl || '').trim();
    }

    return String(slide.backgroundImageUrl || '').trim();
}

export function shouldRenderHeroMedia(slide) {
    return heroHasVisibleText(slide) && !usesHeroFullImage(slide) && isFilled(slide?.imageUrl);
}

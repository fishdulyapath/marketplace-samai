import { supportedLocales } from '@/i18n/messages';

export const LANGUAGE_STORAGE_KEY = 'marketplace_locale';
export const FALLBACK_LOCALE = 'th';

function cleanText(value) {
    const text = String(value ?? '').trim();
    return text || '';
}

export function normalizeLocale(locale) {
    const value = String(locale || '').trim().toLowerCase();
    return supportedLocales.includes(value) ? value : FALLBACK_LOCALE;
}

export function getCurrentLocale() {
    const savedLocale = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return normalizeLocale(savedLocale || import.meta.env.VITE_DEFAULT_LOCALE || FALLBACK_LOCALE);
}

function firstText(...values) {
    return values.map(cleanText).find(Boolean) || '';
}

export function pickProductName(product = {}, locale = getCurrentLocale()) {
    const normalizedLocale = normalizeLocale(locale);
    const thaiName = firstText(product.item_name, product.name_1, product.name, product.itemName);

    if (normalizedLocale === 'en') {
        return firstText(product.name_eng_1, thaiName);
    }

    return thaiName;
}

export function pickMasterName(row = {}, locale = getCurrentLocale()) {
    const normalizedLocale = normalizeLocale(locale);
    const thaiName = firstText(row.name_1, row.name, row.categoryName, row.category_name);

    if (normalizedLocale === 'en') {
        return firstText(row.name_2, thaiName);
    }

    return thaiName;
}

export function withProductDisplay(product = {}, locale = getCurrentLocale()) {
    const displayName = pickProductName(product, locale);
    return {
        ...product,
        display_name: displayName,
        item_name_display: displayName,
        category_display: cleanText(product.category_display) || cleanText(product.category)
    };
}

export function withMasterDisplay(row = {}, locale = getCurrentLocale()) {
    const displayName = pickMasterName(row, locale);
    return {
        ...row,
        display_name: displayName,
        name_display: displayName
    };
}

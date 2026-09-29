import { localeOptions, messages } from '@/i18n/messages';
import { FALLBACK_LOCALE, LANGUAGE_STORAGE_KEY, normalizeLocale } from '@/utils/languageDisplay';
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

function getDefaultLocale() {
    return normalizeLocale(import.meta.env.VITE_DEFAULT_LOCALE || FALLBACK_LOCALE);
}

function getInitialLocale() {
    const savedLocale = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return savedLocale ? normalizeLocale(savedLocale) : getDefaultLocale();
}

function resolvePath(source, key) {
    return String(key || '')
        .split('.')
        .reduce((current, part) => (current && current[part] !== undefined ? current[part] : undefined), source);
}

export const useLanguageStore = defineStore('language', () => {
    const locale = ref(getInitialLocale());

    const options = computed(() => localeOptions);
    const currentOption = computed(() => localeOptions.find((option) => option.code === locale.value) || localeOptions[0]);
    const isEnglish = computed(() => locale.value === 'en');
    const dataLocale = computed(() => (locale.value === 'en' ? 'en' : 'th'));

    function setLocale(nextLocale) {
        const normalizedLocale = normalizeLocale(nextLocale);
        locale.value = normalizedLocale;
        localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedLocale);
        window.dispatchEvent(new CustomEvent('marketplace-language-changed', { detail: { locale: normalizedLocale } }));
    }

    function syncFromStorage() {
        locale.value = getInitialLocale();
    }

    function t(key, params = {}) {
        const template = resolvePath(messages[locale.value], key) ?? resolvePath(messages[FALLBACK_LOCALE], key) ?? key;
        return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), String(template));
    }

    return {
        locale,
        options,
        currentOption,
        isEnglish,
        dataLocale,
        setLocale,
        syncFromStorage,
        t
    };
});

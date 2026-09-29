<script setup>
import CategoryService from '@/services/CategoryService';
import ContentService from '@/services/ContentService';
import MediaService from '@/services/MediaService';
import ProductService from '@/services/ProductService';
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';

const confirm = useConfirm();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;
const siteName = import.meta.env.VITE_APP_NAME || 'MarketPlace';
const ALERT_TEXTS = {
    th: {
        ready: 'พร้อมแสดงบนหน้าแรก',
        readyDetail: 'เงื่อนไขพื้นฐานครบแล้ว ระบบจะแสดงตามความถี่และอุปกรณ์ที่ตั้งไว้',
        disabled: 'ปิดการแสดงผลอยู่',
        disabledDetail: 'Popup จะไม่แสดงจนกว่าจะเปิดใช้งาน',
        missingImage: 'ยังไม่มีรูป popup',
        missingImageDetail: 'ต้องเลือกรูปก่อนจึงจะแสดงบนหน้าแรกได้',
        invalid: 'ตั้งค่ายังไม่ถูกต้อง',
        invalidDetail: 'ตรวจ URL, link หรือช่วงวันที่ก่อนบันทึกใช้งานจริง',
        upcoming: 'ยังไม่ถึงเวลาแสดง',
        upcomingDetail: 'Popup จะเริ่มแสดงวันที่ {date}',
        expired: 'หมดช่วงเวลาแสดงแล้ว',
        expiredDetail: 'Popup จะไม่แสดงจนกว่าจะปรับวันสิ้นสุดหรือเคลียร์ช่วงเวลา',
        device: 'อุปกรณ์',
        frequency: 'ความถี่',
        window: 'ช่วงเวลา',
        link: 'ลิงก์',
        noLink: 'ไม่มีลิงก์',
        alwaysWindow: 'ไม่จำกัดช่วงเวลา',
        fromDate: 'ตั้งแต่ {date}',
        untilDate: 'ถึง {date}'
    },
    en: {
        ready: 'Ready to show on homepage',
        readyDetail: 'Basic conditions are complete. The popup will follow the selected frequency and device rules.',
        disabled: 'Display is disabled',
        disabledDetail: 'The popup will not show until it is enabled.',
        missingImage: 'Popup image is missing',
        missingImageDetail: 'Choose an image before showing this popup on the homepage.',
        invalid: 'Settings need attention',
        invalidDetail: 'Check the URL, link, or date range before publishing.',
        upcoming: 'Scheduled for later',
        upcomingDetail: 'The popup will start showing on {date}.',
        expired: 'Display window has ended',
        expiredDetail: 'The popup will not show until you update or clear the end date.',
        device: 'Device',
        frequency: 'Frequency',
        window: 'Window',
        link: 'Link',
        noLink: 'No link',
        alwaysWindow: 'No date limit',
        fromDate: 'From {date}',
        untilDate: 'Until {date}'
    }
};

const THEME_PRESETS = [
    {
        // ธีมเริ่มต้นสำหรับร้านใหม่: ใช้ขาวเป็นพื้นหลักและเขียวเป็นสีเน้น
        key: 'cleanGreen',
        label: 'Clean Green + White (แนะนำ)',
        colors: {
            primaryColor: '#0f9f6e',
            accentColor: '#f97316',
            headerBackground: '#ffffff',
            headerTextColor: '#064e3b',
            backgroundColor: '#f7f9f8',
            productCardBackground: '#ffffff',
            productImageBackground: '#ffffff',
            productCardBorder: '#dde8e3',
            footerBackground: '#ffffff',
            footerTextColor: '#1f2937'
        }
    },
    {
        // เก็บ Shop Green รุ่นเดิมไว้เพื่อไม่ให้ร้านที่เลือกธีมนี้เสียรูปแบบเดิม
        key: 'shopGreen',
        label: 'Shop Green (เดิม)',
        colors: {
            primaryColor: '#0f9f6e',
            accentColor: '#f97316',
            headerBackground: '#0a7d56',
            headerTextColor: '#ffffff',
            backgroundColor: '#f4f6f8',
            productCardBackground: '#ffffff',
            productImageBackground: '#ffffff',
            productCardBorder: '#e6ebef',
            footerBackground: '#ffffff',
            footerTextColor: '#1f2937'
        }
    },
    {
        key: 'warm',
        label: 'Warm Retail',
        colors: {
            primaryColor: '#0f9f6e',
            accentColor: '#f97316',
            headerBackground: '#f7ebcf',
            headerTextColor: '#5b4a27',
            backgroundColor: '#fff8ee',
            productCardBackground: '#ffffff',
            productImageBackground: '#fff7ed',
            productCardBorder: '#efe3c8',
            footerBackground: '#fff7e6',
            footerTextColor: '#2f2412'
        }
    },
    {
        key: 'blue',
        label: 'Modern Blue',
        colors: {
            primaryColor: '#2563eb',
            accentColor: '#f59e0b',
            headerBackground: '#eaf3ff',
            headerTextColor: '#172554',
            backgroundColor: '#f8fbff',
            productCardBackground: '#ffffff',
            productImageBackground: '#eff6ff',
            productCardBorder: '#dbeafe',
            footerBackground: '#eff6ff',
            footerTextColor: '#172554'
        }
    },
    {
        key: 'red',
        label: 'Retail Red',
        colors: {
            primaryColor: '#b91c1c',
            accentColor: '#f97316',
            headerBackground: '#fff1f2',
            headerTextColor: '#7f1d1d',
            backgroundColor: '#fff7f8',
            productCardBackground: '#ffffff',
            productImageBackground: '#fff1f2',
            productCardBorder: '#fecdd3',
            footerBackground: '#fff1f2',
            footerTextColor: '#7f1d1d'
        }
    },
    {
        key: 'green',
        label: 'Builder Green',
        colors: {
            primaryColor: '#15803d',
            accentColor: '#eab308',
            headerBackground: '#ecfdf5',
            headerTextColor: '#14532d',
            backgroundColor: '#f7fef9',
            productCardBackground: '#ffffff',
            productImageBackground: '#f0fdf4',
            productCardBorder: '#bbf7d0',
            footerBackground: '#f0fdf4',
            footerTextColor: '#14532d'
        }
    },
    {
        key: 'dark',
        label: 'Dark Premium',
        colors: {
            primaryColor: '#38bdf8',
            accentColor: '#f59e0b',
            headerBackground: '#111827',
            headerTextColor: '#f8fafc',
            backgroundColor: '#f8fafc',
            productCardBackground: '#ffffff',
            productImageBackground: '#f3f4f6',
            productCardBorder: '#d1d5db',
            footerBackground: '#111827',
            footerTextColor: '#f8fafc'
        }
    },
    {
        key: 'minimal',
        label: 'Minimal Shop',
        colors: {
            primaryColor: '#334155',
            accentColor: '#d97706',
            headerBackground: '#f8fafc',
            headerTextColor: '#0f172a',
            backgroundColor: '#f8fafc',
            productCardBackground: '#ffffff',
            productImageBackground: '#f8fafc',
            productCardBorder: '#e2e8f0',
            footerBackground: '#f1f5f9',
            footerTextColor: '#0f172a'
        }
    },
    {
        key: 'cleanWhite',
        label: 'Clean White',
        colors: {
            primaryColor: '#111827',
            accentColor: '#ef4444',
            headerBackground: '#ffffff',
            headerTextColor: '#111827',
            backgroundColor: '#ffffff',
            productCardBackground: '#ffffff',
            productImageBackground: '#ffffff',
            productCardBorder: '#e5e7eb',
            footerBackground: '#ffffff',
            footerTextColor: '#111827'
        }
    },
    {
        key: 'cleanMinimal',
        label: 'Clean Minimal',
        colors: {
            primaryColor: '#2563EB',
            accentColor: '#0F172A',
            headerBackground: '#FFFFFF',
            headerTextColor: '#0F172A',
            backgroundColor: '#FFFFFF',
            productCardBackground: '#FFFFFF',
            productImageBackground: '#F8FAFC',
            productCardBorder: '#E2E8F0',
            footerBackground: '#F8FAFC',
            footerTextColor: '#0F172A'
        }
    },
    {
        key: 'pureWhite',
        label: 'Pure White',
        colors: {
            primaryColor: '#000000',
            accentColor: '#555555',
            headerBackground: '#FFFFFF',
            headerTextColor: '#111111',
            backgroundColor: '#FFFFFF',
            productCardBackground: '#FFFFFF',
            productImageBackground: '#FFFFFF',
            productCardBorder: '#EEEEEE',
            footerBackground: '#FFFFFF',
            footerTextColor: '#111111'
        }
    },
    {
        key: 'whiteSoftBlue',
        label: 'White + Soft Blue',
        colors: {
            primaryColor: '#3B82F6',
            accentColor: '#22D3EE',
            headerBackground: '#FFFFFF',
            headerTextColor: '#1E293B',
            backgroundColor: '#F1F5F9',
            productCardBackground: '#FFFFFF',
            productImageBackground: '#EFF6FF',
            productCardBorder: '#93C5FD',
            footerBackground: '#F1F5F9',
            footerTextColor: '#1E293B'
        }
    },
    {
        key: 'whiteLuxuryGold',
        label: 'White + Luxury Gold',
        colors: {
            primaryColor: '#D4AF37',
            accentColor: '#111827',
            headerBackground: '#FFFFFF',
            headerTextColor: '#111827',
            backgroundColor: '#FAFAFA',
            productCardBackground: '#FFFFFF',
            productImageBackground: '#FFF7ED',
            productCardBorder: '#F7E7CE',
            footerBackground: '#FAFAFA',
            footerTextColor: '#111827'
        }
    },
    {
        key: 'tech',
        label: 'Tech Fresh',
        colors: {
            primaryColor: '#0ea5e9',
            accentColor: '#22c55e',
            headerBackground: '#e0f2fe',
            headerTextColor: '#082f49',
            backgroundColor: '#f0f9ff',
            productCardBackground: '#ffffff',
            productImageBackground: '#e0f2fe',
            productCardBorder: '#bae6fd',
            footerBackground: '#f0f9ff',
            footerTextColor: '#082f49'
        }
    },
    {
        key: 'fresh',
        label: 'Fresh Market',
        colors: {
            primaryColor: '#059669',
            accentColor: '#f43f5e',
            headerBackground: '#ecfdf5',
            headerTextColor: '#064e3b',
            backgroundColor: '#f7fef9',
            productCardBackground: '#ffffff',
            productImageBackground: '#ecfdf5',
            productCardBorder: '#a7f3d0',
            footerBackground: '#f0fdf4',
            footerTextColor: '#064e3b'
        }
    },
    {
        key: 'premiumGold',
        label: 'Premium Gold',
        colors: {
            primaryColor: '#92400e',
            accentColor: '#fbbf24',
            headerBackground: '#1f2937',
            headerTextColor: '#fef3c7',
            backgroundColor: '#f8fafc',
            productCardBackground: '#ffffff',
            productImageBackground: '#fffbeb',
            productCardBorder: '#fde68a',
            footerBackground: '#111827',
            footerTextColor: '#fef3c7'
        }
    },
    {
        key: 'pastel',
        label: 'Pastel Campaign',
        colors: {
            primaryColor: '#7c3aed',
            accentColor: '#fb7185',
            headerBackground: '#faf5ff',
            headerTextColor: '#3b0764',
            backgroundColor: '#fff7fb',
            productCardBackground: '#ffffff',
            productImageBackground: '#faf5ff',
            productCardBorder: '#e9d5ff',
            footerBackground: '#fff1f2',
            footerTextColor: '#3b0764'
        }
    }
];

const defaultTheme = () => ({
    preset: 'cleanGreen',
    basePreset: 'cleanGreen',
    ...THEME_PRESETS[0].colors
});

const HOME_LAYOUT_SECTIONS = computed(() => [
    { type: 'hero', label: 'Hero Slides', description: t('adminContent.heroDescription'), settings: { width: 'boxed', radius: 20, height: 'normal' } },
    { type: 'promoGrid', label: 'Promo Banner Grid', description: t('adminContent.promoDescription'), settings: { width: 'boxed', radius: 16, layout: 'mosaic', maxItems: 4, desktopColumns: 3, tabletColumns: 2, mobileColumns: 1, gap: 14 } },
    { type: 'categories', label: 'Popular Categories', description: t('adminContent.categoriesDescription'), settings: { width: 'boxed', radius: 16, maxItems: 6, density: 'comfortable' } },
    { type: 'productSections', label: 'Product Sections', description: t('adminContent.productSectionsDescription'), settings: { width: 'boxed', radius: 14 } },
    { type: 'footer', label: 'Footer', description: t('adminContent.footerDescription'), settings: { width: 'boxed', radius: 20 } }
]);

const defaultHomeLayout = () => HOME_LAYOUT_SECTIONS.value.map((section) => ({ type: section.type, enabled: true, settings: { ...section.settings } }));

const loading = ref(true);
const saving = ref(false);
const uploadingKey = ref('');
const content = ref(createDefaultContent());
const categories = ref([]);
const products = ref([]);
const mediaAssets = ref([]);
const productSearch = ref('');
const showProductPicker = ref(false);
const showMediaPicker = ref(false);
const showRenameMediaDialog = ref(false);
const activeSectionIndex = ref(-1);
const activeMediaTarget = ref(null);
const renameMediaAsset = ref(null);
const renameMediaName = ref('');
const dragLayoutFromIndex = ref(-1);
const dragLayoutOverIndex = ref(-1);
const livePreviewDevice = ref('desktop');
const livePreviewKey = ref(0);
const showAlertPopupTest = ref(false);

const enabledSlides = computed(() => content.value.slides.filter((slide) => slide.enabled !== false));
const enabledPromoBlocks = computed(() => content.value.promoBlocks.filter((block) => block.enabled !== false));
const previewHomeLayout = computed(() => normalizeHomeLayout(content.value.homeLayout).filter((section) => section.enabled !== false));
const livePreviewUrl = computed(() => import.meta.env.VITE_APP_BASE_URL || '/');
const themePresetCards = computed(() => {
    const theme = normalizeTheme(content.value.theme);
    return [
        ...THEME_PRESETS,
        {
            key: 'custom',
            label: 'Custom',
            virtual: true,
            colors: {
                primaryColor: theme.primaryColor,
                accentColor: theme.accentColor,
                backgroundColor: theme.backgroundColor,
                headerBackground: theme.headerBackground,
                productImageBackground: theme.productImageBackground
            }
        }
    ];
});
const alertPopupTestConfig = computed(() => normalizeAlertPopup(content.value.alertPopup));
const alertPopupTestImageUrl = computed(() => resolveContentImageUrl(alertPopupTestConfig.value.imageUrl));
const alertPopupTestStyle = computed(() => ({
    width: `min(${alertPopupTestConfig.value.desktopWidth}px, calc(100vw - 2rem))`,
    maxHeight: `${alertPopupTestConfig.value.maxHeightVh}vh`,
    borderRadius: `${alertPopupTestConfig.value.borderRadius}px`
}));
const alertPopupTestImageStyle = computed(() => ({
    maxHeight: `${alertPopupTestConfig.value.maxHeightVh}vh`
}));
const alertPopupRuntimeStatus = computed(() => getAlertPopupRuntimeStatus(content.value.alertPopup));

onMounted(async () => {
    await loadAdmin();
});

async function loadAdmin() {
    loading.value = true;
    try {
        const [home, categoryResult, mediaResult] = await Promise.all([ContentService.getHomeContent(), CategoryService.getCategories(), MediaService.getMedia()]);
        content.value = normalizeContent(home || createDefaultContent());
        categories.value = (categoryResult?.data || []).filter((cat) => !['all', 'promotions', 'productset'].includes(cat.code));
        mediaAssets.value = mediaResult || [];
        await loadProducts();
    } catch (error) {
        console.error('Error loading admin content:', error);
        toast.add({ severity: 'error', summary: t('adminContent.loadFailed'), detail: error.message, life: 2500 });
    } finally {
        loading.value = false;
    }
}

function createDefaultContent() {
    return {
        theme: defaultTheme(),
        homeLayout: defaultHomeLayout(),
        slides: [
            {
                eyebrow: 'ONLINE MARKETPLACE',
                title: siteName,
                subtitle: t('adminContent.defaultSlideSubtitle'),
                ctaLabel: t('adminContent.defaultCta'),
                href: '/marketplace',
                imageUrl: '',
                imageAlt: '',
                backgroundImageUrl: '',
                textColor: '',
                buttonColor: '',
                buttonTextColor: '',
                mode: 'campaign',
                textVisible: true,
                heightMode: 'preset',
                desktopHeight: 420,
                mobileHeight: 240,
                aspectRatio: '21/8',
                imageFit: 'cover',
                badge: t('adminContent.defaultBadge'),
                discountText: t('adminContent.defaultDiscount'),
                tone: 'teal',
                layout: 'split',
                contentPosition: 'left',
                imagePosition: 'right',
                enabled: true
            }
        ],
        promoBlocks: [],
        alertPopup: createDefaultAlertPopup(),
        categoryCodes: [],
        productSections: [
            createDefaultProductSection({ id: 'promotion', title: t('adminContent.defaultPromotionTitle'), subtitle: t('adminContent.defaultPromotionSubtitle'), mode: 'promotion' }),
            createDefaultProductSection({ id: 'new', title: 'สินค้าใหม่', subtitle: 'รายการมาใหม่จากร้าน', mode: 'new' }),
            createDefaultProductSection({ id: 'recommended', title: t('adminContent.defaultRecommendedTitle'), subtitle: t('adminContent.defaultRecommendedSubtitle'), mode: 'recommend' })
        ]
    };
}

function createDefaultAlertPopup(patch = {}) {
    return {
        enabled: false,
        name: '',
        imageUrl: '',
        imageAlt: '',
        href: '',
        target: '_self',
        startAt: '',
        endAt: '',
        frequency: 'oncePerSession',
        delayMs: 500,
        desktopWidth: 720,
        mobileWidth: 340,
        maxHeightVh: 86,
        borderRadius: 16,
        backdrop: true,
        closeOnBackdrop: true,
        showCloseButton: true,
        device: 'all',
        ...patch
    };
}

function createDefaultProductSection(patch = {}) {
    return {
        id: `section-${Date.now()}`,
        title: '',
        subtitle: '',
        mode: 'latest',
        categoryCode: '',
        productCodes: [],
        limit: 8,
        display: 'slider',
        gridColumns: 4,
        cardRadius: 14,
        imageHeight: 144,
        enabled: true,
        ...patch
    };
}

function createDefaultSlide(patch = {}) {
    return {
        eyebrow: '',
        title: '',
        subtitle: '',
        ctaLabel: '',
        href: '',
        imageUrl: '',
        imageAlt: '',
        backgroundImageUrl: '',
        textColor: '',
        buttonColor: '',
        buttonTextColor: '',
        mode: 'campaign',
        textVisible: true,
        heightMode: 'preset',
        desktopHeight: 420,
        mobileHeight: 240,
        aspectRatio: '21/8',
        imageFit: 'cover',
        badge: '',
        discountText: '',
        tone: 'teal',
        layout: 'split',
        contentPosition: 'left',
        imagePosition: 'right',
        enabled: true,
        ...patch
    };
}

function createDefaultPromoBlock(patch = {}) {
    return {
        title: '',
        value: '',
        description: '',
        href: '',
        tone: 'red',
        imageUrl: '',
        imageAlt: '',
        width: 1,
        height: 1,
        heightMode: 'ratio',
        desktopHeight: 180,
        mobileHeight: 120,
        aspectRatio: '16/5',
        imageFit: 'cover',
        textOverlay: true,
        textColor: '',
        enabled: true,
        ...patch
    };
}

function normalizeContent(value) {
    const fallback = createDefaultContent();
    const source = value || {};
    return {
        ...fallback,
        ...source,
        theme: normalizeTheme(source.theme || fallback.theme),
        homeLayout: normalizeHomeLayout(source.homeLayout || fallback.homeLayout),
        slides: Array.isArray(source.slides) ? source.slides.map((slide) => createDefaultSlide(slide)) : fallback.slides,
        promoBlocks: Array.isArray(source.promoBlocks) ? source.promoBlocks.map((block) => createDefaultPromoBlock(block)) : fallback.promoBlocks,
        alertPopup: normalizeAlertPopup(source.alertPopup || fallback.alertPopup),
        categoryCodes: Array.isArray(source.categoryCodes) ? source.categoryCodes : fallback.categoryCodes,
        productSections: Array.isArray(source.productSections) ? source.productSections.map(normalizeProductSection) : fallback.productSections
    };
}

function normalizeAlertPopup(value = {}) {
    const popup = createDefaultAlertPopup(value);
    popup.target = ['_self', '_blank'].includes(popup.target) ? popup.target : '_self';
    popup.frequency = ['always', 'oncePerSession', 'oncePerDay', 'onceForever'].includes(popup.frequency) ? popup.frequency : 'oncePerSession';
    popup.device = ['all', 'desktop', 'mobile'].includes(popup.device) ? popup.device : 'all';
    popup.delayMs = clampNumber(popup.delayMs, 0, 10000, 500);
    popup.desktopWidth = clampNumber(popup.desktopWidth, 320, 1200, 720);
    popup.mobileWidth = clampNumber(popup.mobileWidth, 280, 480, 340);
    popup.maxHeightVh = clampNumber(popup.maxHeightVh, 50, 95, 86);
    popup.borderRadius = clampNumber(popup.borderRadius, 0, 40, 16);
    if (!popup.showCloseButton && !popup.closeOnBackdrop) popup.closeOnBackdrop = true;
    return popup;
}

function ta(key, params = {}) {
    const locale = languageStore.locale === 'en' ? 'en' : 'th';
    const template = ALERT_TEXTS[locale]?.[key] || ALERT_TEXTS.th[key] || key;
    return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), template);
}

function getAlertPopupRuntimeStatus(value = {}) {
    const popup = normalizeAlertPopup(value);
    const startDate = parseAdminDate(popup.startAt);
    const endDate = parseAdminDate(popup.endAt);
    const base = {
        state: 'ready',
        icon: 'pi pi-check-circle',
        title: ta('ready'),
        detail: ta('readyDetail'),
        device: getAlertDeviceLabel(popup.device),
        frequency: getAlertFrequencyLabel(popup.frequency),
        window: getAlertDateWindowLabel(startDate, endDate),
        link: getAlertPopupHref(popup) ? popup.href : ta('noLink')
    };

    if (!popup.enabled) {
        return { ...base, state: 'disabled', icon: 'pi pi-pause-circle', title: ta('disabled'), detail: ta('disabledDetail') };
    }
    if (!isFilled(popup.imageUrl)) {
        return { ...base, state: 'invalid', icon: 'pi pi-image', title: ta('missingImage'), detail: ta('missingImageDetail') };
    }
    if (!isValidOptionalAssetUrl(popup.imageUrl) || !isValidOptionalHref(popup.href) || isInvalidDateValue(popup.startAt, startDate) || isInvalidDateValue(popup.endAt, endDate) || (startDate && endDate && startDate.getTime() > endDate.getTime())) {
        return { ...base, state: 'invalid', icon: 'pi pi-exclamation-triangle', title: ta('invalid'), detail: ta('invalidDetail') };
    }

    const now = Date.now();
    if (startDate && now < startDate.getTime()) {
        return { ...base, state: 'upcoming', icon: 'pi pi-clock', title: ta('upcoming'), detail: ta('upcomingDetail', { date: formatAdminDateTime(startDate) }) };
    }
    if (endDate && now > endDate.getTime()) {
        return { ...base, state: 'expired', icon: 'pi pi-calendar-times', title: ta('expired'), detail: ta('expiredDetail') };
    }

    return base;
}

function parseAdminDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isInvalidDateValue(rawValue, parsedValue) {
    return isFilled(rawValue) && !parsedValue;
}

function getAlertDeviceLabel(device) {
    if (device === 'desktop') return t('adminContent.alertDeviceDesktop');
    if (device === 'mobile') return t('adminContent.alertDeviceMobile');
    return t('adminContent.alertDeviceAll');
}

function getAlertFrequencyLabel(frequency) {
    if (frequency === 'always') return t('adminContent.alertFrequencyAlways');
    if (frequency === 'oncePerDay') return t('adminContent.alertFrequencyDay');
    if (frequency === 'onceForever') return t('adminContent.alertFrequencyForever');
    return t('adminContent.alertFrequencySession');
}

function formatAdminDateTime(value) {
    if (!value) return '-';
    try {
        return new Intl.DateTimeFormat(languageStore.locale === 'en' ? 'en-GB' : 'th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(value);
    } catch (error) {
        return value.toLocaleString();
    }
}

function getAlertDateWindowLabel(startDate, endDate) {
    if (!startDate && !endDate) return ta('alwaysWindow');
    if (startDate && endDate) return `${formatAdminDateTime(startDate)} - ${formatAdminDateTime(endDate)}`;
    if (startDate) return ta('fromDate', { date: formatAdminDateTime(startDate) });
    return ta('untilDate', { date: formatAdminDateTime(endDate) });
}

function openAlertPopupTest() {
    content.value.alertPopup = normalizeAlertPopup(content.value.alertPopup);
    if (!isFilled(content.value.alertPopup.imageUrl)) {
        toast.add({ severity: 'warn', summary: t('adminContent.alertTestNeedImage'), life: 2200 });
        return;
    }
    showAlertPopupTest.value = true;
}

function getAlertPopupHref(popup) {
    const href = String(popup?.href || '').trim();
    if (!href) return '';
    if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('/')) return href;
    return '';
}

function getAlertPopupStoragePrefix() {
    return 'marketplace-alert-popup:';
}

function resetAlertPopupHistory() {
    const prefix = getAlertPopupStoragePrefix();
    [localStorage, sessionStorage].forEach((storage) => {
        Object.keys(storage)
            .filter((key) => key.startsWith(prefix))
            .forEach((key) => storage.removeItem(key));
    });
    toast.add({ severity: 'success', summary: t('adminContent.alertResetDone'), life: 1800 });
}

function normalizeProductSection(section = {}) {
    const gridColumns = parseInt(section.gridColumns, 10);
    const cardRadius = parseInt(section.cardRadius, 10);
    const imageHeight = parseInt(section.imageHeight, 10);
    return {
        ...createDefaultProductSection(),
        ...section,
        display: ['slider', 'grid'].includes(section.display) ? section.display : 'slider',
        gridColumns: Number.isFinite(gridColumns) ? Math.max(1, Math.min(gridColumns, 8)) : 4,
        cardRadius: Number.isFinite(cardRadius) ? Math.max(0, Math.min(cardRadius, 40)) : 14,
        imageHeight: Number.isFinite(imageHeight) ? Math.max(80, Math.min(imageHeight, 360)) : 144,
        limit: Math.max(1, Math.min(parseInt(section.limit, 10) || 8, 24))
    };
}

function normalizeHomeLayout(value) {
    const validTypes = new Set(HOME_LAYOUT_SECTIONS.value.map((section) => section.type));
    const used = new Set();
    const rows = [];

    (Array.isArray(value) ? value : []).forEach((item) => {
        if (!validTypes.has(item?.type) || used.has(item.type)) return;
        used.add(item.type);
        rows.push({ type: item.type, enabled: item.enabled !== false, settings: normalizeLayoutSettings(item.type, item.settings) });
    });

    HOME_LAYOUT_SECTIONS.value.forEach((section) => {
        if (!used.has(section.type)) rows.push({ type: section.type, enabled: true, settings: { ...section.settings } });
    });

    return rows;
}

function getLayoutSection(type) {
    return HOME_LAYOUT_SECTIONS.value.find((section) => section.type === type) || { type, label: type, description: '' };
}

function normalizeLayoutSettings(type, settings) {
    const merged = {
        ...(getLayoutSection(type).settings || {}),
        ...(settings || {})
    };
    const radius = parseInt(merged.radius, 10);
    merged.radius = Number.isFinite(radius) ? Math.max(0, Math.min(radius, 40)) : getLayoutSection(type).settings?.radius || 0;
    if (type === 'promoGrid') {
        const defaults = getLayoutSection(type).settings || {};
        merged.desktopColumns = clampNumber(merged.desktopColumns, 2, 6, defaults.desktopColumns || 3);
        merged.tabletColumns = Math.min(clampNumber(merged.tabletColumns, 1, 4, defaults.tabletColumns || 2), merged.desktopColumns);
        merged.mobileColumns = Math.min(clampNumber(merged.mobileColumns, 1, 2, defaults.mobileColumns || 1), merged.desktopColumns);
        merged.gap = clampNumber(merged.gap, 0, 40, defaults.gap || 14);
    }
    return merged;
}

function normalizeTheme(value) {
    const presetKeys = new Set(THEME_PRESETS.map((item) => item.key));
    const requestedPreset = value?.preset || 'cleanGreen';
    const validPreset = requestedPreset === 'custom' || presetKeys.has(requestedPreset) ? requestedPreset : 'cleanGreen';
    const baseForCompare = validPreset === 'custom' ? value?.basePreset || 'cleanGreen' : validPreset;
    const selectedPreset = THEME_PRESETS.find((item) => item.key === baseForCompare) || THEME_PRESETS[0];
    const colorKeys = ['primaryColor', 'accentColor', 'headerBackground', 'headerTextColor', 'backgroundColor', 'productCardBackground', 'productImageBackground', 'productCardBorder', 'footerBackground', 'footerTextColor'];
    const hasCustomColors =
        validPreset !== 'custom' &&
        colorKeys.some((key) => Object.prototype.hasOwnProperty.call(value || {}, key) && value?.[key] && normalizeHexColor(value[key]) !== normalizeHexColor(selectedPreset.colors[key]));
    const preset = hasCustomColors ? 'custom' : validPreset;
    const requestedBasePreset = value?.basePreset || (preset === 'custom' ? baseForCompare : preset);
    const basePreset = presetKeys.has(requestedBasePreset) ? requestedBasePreset : 'cleanGreen';

    return {
        ...defaultTheme(),
        ...(value || {}),
        preset,
        basePreset
    };
}

function applyThemePreset(preset) {
    if (preset === 'custom') {
        const theme = normalizeTheme(content.value.theme);
        content.value.theme = {
            ...theme,
            preset: 'custom',
            basePreset: theme.basePreset || 'cleanGreen'
        };
        return;
    }

    const selected = THEME_PRESETS.find((item) => item.key === preset);
    if (!selected) return;
    content.value.theme = {
        preset,
        basePreset: preset,
        ...selected.colors
    };
}

function markThemeCustom() {
    const theme = normalizeTheme(content.value.theme);
    if (theme.preset === 'custom') {
        content.value.theme = theme;
        return;
    }
    content.value.theme = {
        ...theme,
        preset: 'custom',
        basePreset: theme.preset || theme.basePreset || 'cleanGreen'
    };
}

function updateThemeColor(field, value) {
    const theme = normalizeTheme(content.value.theme);
    content.value.theme = {
        ...theme,
        [field]: value,
        preset: 'custom',
        basePreset: theme.preset === 'custom' ? theme.basePreset || 'cleanGreen' : theme.preset || theme.basePreset || 'cleanGreen'
    };
}

function applyThemeToRoot(theme) {
    const merged = normalizeTheme(theme);
    const pairs = {
        '--market-primary': merged.primaryColor,
        '--market-accent': merged.accentColor,
        '--market-header-bg': merged.headerBackground,
        '--market-header-text': merged.headerTextColor,
        '--market-page-bg': merged.backgroundColor,
        '--market-card-bg': merged.productCardBackground,
        '--market-product-image-bg': merged.productImageBackground,
        '--market-card-border': merged.productCardBorder,
        '--market-footer-bg': merged.footerBackground,
        '--market-footer-text': merged.footerTextColor,
        '--market-text': merged.footerTextColor,
        '--market-surface': merged.productCardBackground,
        '--market-border': merged.productCardBorder,
        '--p-primary-color': merged.primaryColor,
        '--p-button-primary-background': merged.primaryColor,
        '--p-button-primary-border-color': merged.primaryColor,
        '--p-button-primary-hover-background': merged.primaryColor,
        '--p-button-primary-hover-border-color': merged.primaryColor,
        '--p-button-outlined-primary-color': merged.primaryColor,
        '--p-button-outlined-primary-border-color': merged.primaryColor,
        '--primary-color': merged.primaryColor
    };

    Object.entries(pairs).forEach(([key, value]) => {
        const color = normalizeHexColor(value);
        if (color) {
            document.documentElement.style.setProperty(key, color);
        }
    });
}

watch(
    () => content.value.theme,
    (theme) => applyThemeToRoot(theme),
    { deep: true }
);

function themePreviewStyle() {
    const theme = normalizeTheme(content.value.theme);
    return {
        '--theme-preview-primary': theme.primaryColor,
        '--theme-preview-accent': theme.accentColor,
        '--theme-preview-header-bg': theme.headerBackground,
        '--theme-preview-header-text': theme.headerTextColor,
        '--theme-preview-page-bg': theme.backgroundColor,
        '--theme-preview-card-bg': theme.productCardBackground,
        '--theme-preview-product-image-bg': theme.productImageBackground,
        '--theme-preview-card-border': theme.productCardBorder,
        '--theme-preview-footer-bg': theme.footerBackground,
        '--theme-preview-footer-text': theme.footerTextColor
    };
}

async function saveContent() {
    normalizePromoBlockSpans();
    content.value.alertPopup = normalizeAlertPopup(content.value.alertPopup);
    const errors = collectContentErrors();
    if (errors.length) {
        toast.add({ severity: 'error', summary: 'ยังบันทึกไม่ได้', detail: errors.slice(0, 3).join(' / '), life: 5000 });
        return;
    }

    const warnings = collectContentWarnings();
    if (warnings.length) {
        confirm.require({
            message: warnings.slice(0, 5).join(' / '),
            header: 'ตรวจพบจุดที่ควรเช็ค',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'บันทึกต่อ',
            rejectLabel: t('common.cancel'),
            accept: async () => {
                await performSaveContent();
            }
        });
        return;
    }

    await performSaveContent();
}

function normalizePromoBlockSpans() {
    const columns = clampNumber(promoGridSettings().desktopColumns, 2, 6, 3);
    content.value.promoBlocks.forEach((block) => {
        if (String(block.width || '').trim() !== 'full') block.width = clampPromoSpan(block.width, columns);
        block.height = clampPromoSpan(block.height, 2);
    });
}

async function performSaveContent() {
    saving.value = true;
    try {
        const saved = await ContentService.saveHomeContent(content.value);
        const normalizedSaved = normalizeContent(saved || content.value);
        content.value = normalizedSaved;
        livePreviewKey.value += 1;
        toast.add({ severity: 'success', summary: t('adminContent.saved'), detail: t('adminContent.savedDetail'), life: 1800 });
    } catch (error) {
        console.error('Error saving content:', error);
        toast.add({ severity: 'error', summary: t('adminContent.saveFailed'), detail: error.message, life: 2500 });
    } finally {
        saving.value = false;
    }
}

function collectContentErrors() {
    const errors = [];
    const theme = content.value.theme || {};
    const enabledLayout = normalizeHomeLayout(content.value.homeLayout).filter((section) => section.enabled !== false);
    const hasSection = (type) => enabledLayout.some((section) => section.type === type);
    const colorKeys = [
        ['primaryColor', 'Primary'],
        ['accentColor', 'Accent'],
        ['headerBackground', 'Header Background'],
        ['headerTextColor', 'Header Text'],
        ['backgroundColor', 'Page Background'],
        ['productCardBackground', 'Product Card Background'],
        ['productImageBackground', 'Product Image Background'],
        ['productCardBorder', 'Product Card Border'],
        ['footerBackground', 'Footer Background'],
        ['footerTextColor', 'Footer Text']
    ];

    colorKeys.forEach(([key, label]) => {
        if (!isValidHexColor(theme[key])) errors.push(`${label} ต้องเป็นสีรูปแบบ #RGB หรือ #RRGGBB`);
    });

    content.value.slides.forEach((slide, index) => {
        if (!isValidOptionalHref(slide.href)) errors.push(`Hero slide ${index + 1} link ต้องขึ้นต้นด้วย /, http:// หรือ https://`);
        if (!isValidOptionalAssetUrl(slide.imageUrl)) errors.push(`Hero slide ${index + 1} image URL ไม่ถูกต้อง`);
        if (!isValidOptionalAssetUrl(slide.backgroundImageUrl)) errors.push(`Hero slide ${index + 1} background URL ไม่ถูกต้อง`);
    });

    content.value.promoBlocks.forEach((block, index) => {
        if (!isValidOptionalHref(block.href)) errors.push(`Promo ${index + 1} link ต้องขึ้นต้นด้วย /, http:// หรือ https://`);
        if (!isValidOptionalAssetUrl(block.imageUrl)) errors.push(`Promo ${index + 1} image URL ไม่ถูกต้อง`);
        if (String(block.textColor || '').trim() && !isValidHexColor(block.textColor)) errors.push(`Promo ${index + 1} Text Color ต้องเป็นสีรูปแบบ #RGB หรือ #RRGGBB`);
    });

    const popup = normalizeAlertPopup(content.value.alertPopup);
    if (popup.enabled) {
        if (!isFilled(popup.imageUrl)) errors.push(t('adminContent.alertImageRequired'));
        if (!isValidOptionalAssetUrl(popup.imageUrl)) errors.push(t('adminContent.alertImageInvalid'));
        if (!isValidOptionalHref(popup.href)) errors.push(t('adminContent.alertLinkInvalid'));
        const startDate = popup.startAt ? new Date(popup.startAt) : null;
        const endDate = popup.endAt ? new Date(popup.endAt) : null;
        if (popup.startAt && (!startDate || Number.isNaN(startDate.getTime()))) errors.push(t('adminContent.alertStartInvalid'));
        if (popup.endAt && (!endDate || Number.isNaN(endDate.getTime()))) errors.push(t('adminContent.alertEndInvalid'));
        if (startDate && endDate && startDate.getTime() > endDate.getTime()) errors.push(t('adminContent.alertDateRangeInvalid'));
        if (!popup.showCloseButton && !popup.closeOnBackdrop) errors.push(t('adminContent.alertCloseRequired'));
    }

    if (hasSection('hero')) {
        const activeSlides = content.value.slides.filter((slide) => slide.enabled !== false);
        if (!activeSlides.length) errors.push('เปิด Hero อยู่ แต่ไม่มี slide ที่เปิดใช้งาน');
        activeSlides.forEach((slide, index) => {
            const hasImage = isFilled(slide.imageUrl) || isFilled(slide.backgroundImageUrl);
            const hasText = shouldShowHeroText(slide);
            if (!hasImage && !hasText) errors.push(`Hero slide ${index + 1} ต้องมีรูปหรือข้อความอย่างน้อยหนึ่งอย่าง`);
            if ((slide.mode === 'imageOnly' || slide.textVisible === false) && !hasImage) errors.push(`Hero slide ${index + 1} เป็น image-only ต้องใส่รูปก่อนบันทึก`);
        });
    }

    return errors;
}

function collectContentWarnings() {
    const warnings = [];
    const enabledLayout = normalizeHomeLayout(content.value.homeLayout).filter((section) => section.enabled !== false);
    const hasSection = (type) => enabledLayout.some((section) => section.type === type);
    if (hasSection('hero')) {
        const activeSlides = content.value.slides.filter((slide) => slide.enabled !== false);
        if (!activeSlides.length) warnings.push('เปิด Hero แต่ไม่มี slide ที่เปิดใช้งาน');
        activeSlides.forEach((slide, index) => {
            const hasImage = isFilled(slide.imageUrl) || isFilled(slide.backgroundImageUrl);
            const hasText = shouldShowHeroText(slide);
            if (!hasImage && !hasText) warnings.push(`Hero slide ${index + 1} ไม่มีรูปหรือข้อความ`);
            if ((slide.mode === 'imageOnly' || slide.textVisible === false) && !hasImage) warnings.push(`Hero slide ${index + 1} เป็น image-only แต่ยังไม่มีรูป`);
        });
    }
    if (hasSection('promoGrid')) {
        const activePromos = content.value.promoBlocks.filter((block) => block.enabled !== false);
        if (!activePromos.length) warnings.push('เปิด Promo Grid แต่ไม่มี banner ที่เปิดใช้งาน');
        activePromos.forEach((block, index) => {
            if (!isFilled(block.imageUrl) && !shouldShowPromoText(block)) warnings.push(`Promo ${index + 1} ไม่มีรูปหรือข้อความ`);
        });
    }
    if (hasSection('productSections') && !content.value.productSections.some((section) => section.enabled !== false)) warnings.push('เปิด Product Sections แต่ไม่มี section ย่อยที่เปิดใช้งาน');
    return warnings;
}

function addSlide() {
    content.value.slides.push(createDefaultSlide({
        eyebrow: 'PROMOTION',
        title: t('adminContent.newCampaign'),
        subtitle: t('adminContent.campaignDetail'),
        ctaLabel: t('adminContent.defaultCta'),
        href: '/marketplace',
        tone: 'red',
        layout: 'split'
    }));
}

function addPromoBlock() {
    content.value.promoBlocks.push(createDefaultPromoBlock({
        title: t('adminContent.defaultPromotionTitle'),
        value: t('adminContent.specialPrice'),
        description: t('adminContent.promoDetail'),
        href: '',
        tone: 'red',
        width: 1,
        height: 1,
        textOverlay: true
    }));
}

function addProductSection() {
    content.value.productSections.push(createDefaultProductSection({ title: t('adminContent.defaultRecommendedTitle') }));
}

function removeAt(list, index) {
    list.splice(index, 1);
}

function confirmRemoveAt(list, index, label) {
    confirm.require({
        message: `ต้องการลบ ${label || 'รายการนี้'} ใช่หรือไม่?`,
        header: 'ยืนยันการลบ',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'ลบ',
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: () => removeAt(list, index)
    });
}

function moveItem(list, index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(nextIndex, 0, item);
}

function onLayoutDragStart(event, index) {
    dragLayoutFromIndex.value = index;
    dragLayoutOverIndex.value = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
}

function onLayoutDragOver(event, index) {
    event.preventDefault();
    dragLayoutOverIndex.value = index;
    if (dragLayoutFromIndex.value === -1 || dragLayoutFromIndex.value === index) return;

    const rows = content.value.homeLayout;
    const [dragged] = rows.splice(dragLayoutFromIndex.value, 1);
    rows.splice(index, 0, dragged);
    dragLayoutFromIndex.value = index;
}

function onLayoutDrop(event) {
    event.preventDefault();
    onLayoutDragEnd();
}

function onLayoutDragEnd() {
    dragLayoutFromIndex.value = -1;
    dragLayoutOverIndex.value = -1;
}

function toggleCategory(code) {
    const list = content.value.categoryCodes;
    const index = list.indexOf(code);
    if (index >= 0) list.splice(index, 1);
    else list.push(code);
}

function getSelectedCategoryOrder(code) {
    const index = content.value.categoryCodes.indexOf(code);
    return index >= 0 ? index + 1 : 0;
}

function getCategoryName(code) {
    const category = categories.value.find((item) => item.code === code);
    return category?.name || category?.name_1 || category?.name_2 || code;
}

async function uploadImage(kind, index, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    uploadingKey.value = `${kind}-${index}`;
    try {
        const asset = await MediaService.uploadImage(file);
        const imageValue = MediaService.getPreferredUrl(asset);
        if (kind === 'slide') content.value.slides[index].imageUrl = imageValue;
        if (kind === 'slideBackground') content.value.slides[index].backgroundImageUrl = imageValue;
        if (kind === 'promo') content.value.promoBlocks[index].imageUrl = imageValue;
        if (kind === 'alertPopup') content.value.alertPopup.imageUrl = imageValue;
        await loadMediaAssets();
        toast.add({ severity: 'success', summary: t('adminContent.imageUploaded'), life: 1600 });
    } catch (error) {
        console.error('Error uploading image:', error);
        toast.add({ severity: 'error', summary: t('adminContent.uploadFailed'), detail: error.message, life: 2500 });
    } finally {
        uploadingKey.value = '';
        event.target.value = '';
    }
}

function openHomepagePreview() {
    window.open(import.meta.env.VITE_APP_BASE_URL || '/', '_blank', 'noopener,noreferrer');
}

async function loadMediaAssets() {
    try {
        mediaAssets.value = await MediaService.getMedia();
    } catch (error) {
        console.error('Error loading media assets:', error);
        toast.add({ severity: 'warn', summary: t('adminContent.mediaLoadFailed'), detail: error.message, life: 2200 });
    }
}

function openMediaPicker(kind, index) {
    activeMediaTarget.value = { kind, index };
    showMediaPicker.value = true;
    if (!mediaAssets.value.length) loadMediaAssets();
}

function selectMedia(asset) {
    if (!activeMediaTarget.value) return;
    const imageValue = MediaService.getPreferredUrl(asset);
    const { kind, index } = activeMediaTarget.value;
    if (kind === 'slide' && content.value.slides[index]) {
        content.value.slides[index].imageUrl = imageValue;
    }
    if (kind === 'slideBackground' && content.value.slides[index]) {
        content.value.slides[index].backgroundImageUrl = imageValue;
    }
    if (kind === 'promo' && content.value.promoBlocks[index]) {
        content.value.promoBlocks[index].imageUrl = imageValue;
    }
    if (kind === 'alertPopup') {
        content.value.alertPopup.imageUrl = imageValue;
    }
    showMediaPicker.value = false;
    activeMediaTarget.value = null;
}

function resolveMediaAssetUrl(asset) {
    return MediaService.resolveUrl(MediaService.getPreferredUrl(asset));
}

function openRenameMedia(asset, event) {
    event?.stopPropagation();
    renameMediaAsset.value = asset;
    renameMediaName.value = asset.name;
    showRenameMediaDialog.value = true;
}

async function renameMedia() {
    if (!renameMediaAsset.value || !renameMediaName.value.trim()) return;
    try {
        const oldAsset = renameMediaAsset.value;
        const result = await MediaService.renameImage(oldAsset.name, renameMediaName.value.trim());
        const nextAsset = result?.asset || result;
        if (nextAsset) replaceMediaReferences(oldAsset, nextAsset);
        await loadMediaAssets();
        showRenameMediaDialog.value = false;
        toast.add({ severity: 'success', summary: t('adminContent.renamed'), life: 1600 });
    } catch (error) {
        console.error('Error renaming media:', error);
        toast.add({ severity: 'error', summary: t('adminContent.renameFailed'), detail: error.message, life: 2500 });
    }
}

function confirmDeleteMedia(asset, event) {
    event?.stopPropagation();
    confirm.require({
        message: t('adminContent.deleteImageMessage', { name: asset.name }),
        header: t('adminContent.deleteImageHeader'),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: t('adminContent.deleteImageAccept'),
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: async () => {
            await deleteMedia(asset);
        }
    });
}

async function deleteMedia(asset) {
    try {
        await MediaService.deleteImage(asset.name);
        const clearedCount = clearMediaReferences(asset);
        const repairedCount = repairBlankHeroAfterMediaDelete();
        const errors = collectContentErrors();
        if (errors.length) {
            toast.add({ severity: 'error', summary: 'ลบรูปแล้ว แต่ยังไม่บันทึกหน้าแรก', detail: errors.slice(0, 3).join(' / '), life: 6000 });
            await loadMediaAssets();
            return;
        } else if (clearedCount > 0 || repairedCount > 0) {
            const saved = await ContentService.saveHomeContent(content.value);
            content.value = normalizeContent(saved || content.value);
            livePreviewKey.value += 1;
        }
        await loadMediaAssets();
        const detail = repairedCount > 0 ? 'ล้าง reference และปิด hero/slide ที่ว่างแล้ว' : clearedCount > 0 ? 'ล้าง reference และบันทึกหน้าแรกแล้ว' : '';
        toast.add({ severity: 'success', summary: t('adminContent.imageDeleted'), detail, life: 2400 });
    } catch (error) {
        console.error('Error deleting media:', error);
        toast.add({ severity: 'error', summary: t('adminContent.deleteImageFailed'), detail: error.message, life: 2500 });
    }
}

function mediaReferenceSet(asset) {
    return new Set([asset?.url, asset?.path, asset?.name ? `/media/${asset.name}` : ''].filter(Boolean));
}

function replaceMediaReferences(oldAsset, nextAsset) {
    const oldReferences = mediaReferenceSet(oldAsset);
    const nextValue = nextAsset.url || nextAsset.path || '';
    content.value.slides.forEach((slide) => {
        if (oldReferences.has(slide.imageUrl)) slide.imageUrl = nextValue;
        if (oldReferences.has(slide.backgroundImageUrl)) slide.backgroundImageUrl = nextValue;
    });
    content.value.promoBlocks.forEach((block) => {
        if (oldReferences.has(block.imageUrl)) block.imageUrl = nextValue;
    });
    if (oldReferences.has(content.value.alertPopup?.imageUrl)) content.value.alertPopup.imageUrl = nextValue;
}

function clearMediaReferences(asset) {
    const references = mediaReferenceSet(asset);
    let clearedCount = 0;
    content.value.slides.forEach((slide) => {
        if (references.has(slide.imageUrl)) {
            slide.imageUrl = '';
            clearedCount += 1;
        }
        if (references.has(slide.backgroundImageUrl)) {
            slide.backgroundImageUrl = '';
            clearedCount += 1;
        }
    });
    content.value.promoBlocks.forEach((block) => {
        if (references.has(block.imageUrl)) {
            block.imageUrl = '';
            clearedCount += 1;
        }
    });
    if (references.has(content.value.alertPopup?.imageUrl)) {
        content.value.alertPopup.imageUrl = '';
        clearedCount += 1;
    }
    return clearedCount;
}

function repairBlankHeroAfterMediaDelete() {
    const heroSection = content.value.homeLayout.find((section) => section.type === 'hero');
    if (!heroSection || heroSection.enabled === false) return 0;

    let repairedCount = 0;
    content.value.slides.forEach((slide) => {
        if (slide.enabled === false) return;
        const hasImage = isFilled(slide.imageUrl) || isFilled(slide.backgroundImageUrl);
        const hasText = shouldShowHeroText(slide);
        if (!hasImage && !hasText) {
            slide.enabled = false;
            repairedCount += 1;
        }
    });

    if (!content.value.slides.some((slide) => slide.enabled !== false)) {
        heroSection.enabled = false;
        repairedCount += 1;
    }

    return repairedCount;
}

function resolveContentImageUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/media/')) {
        const apiBase = String(import.meta.env.VITE_APP_API || '').replace(/\/$/, '');
        if (apiBase) return `${apiBase}${url}`;
    }
    return url;
}

function isFilled(value) {
    return String(value || '').trim().length > 0;
}

function isValidHexColor(value) {
    return Boolean(normalizeHexColor(value));
}

function isValidOptionalHref(value) {
    const href = String(value || '').trim();
    return !href || href.startsWith('/') || href.startsWith('https://') || href.startsWith('http://');
}

function isValidOptionalAssetUrl(value) {
    const url = String(value || '').trim();
    return !url || url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://');
}

function normalizeHexColor(value) {
    const color = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(color)) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
    return '';
}

function shouldShowHeroText(slide) {
    if (!slide || slide.textVisible === false || slide.mode === 'imageOnly') return false;
    return [slide.eyebrow, slide.title, slide.subtitle, slide.ctaLabel, slide.badge, slide.discountText].some(isFilled);
}

function shouldShowHeroPrimaryAction(slide) {
    return shouldShowHeroText(slide) && isFilled(slide?.ctaLabel) && isFilled(slide?.href);
}

function heroPreviewLabel(slide) {
    if (!slide) return 'No active slide';
    if (slide.mode === 'imageOnly' || !shouldShowHeroText(slide)) return 'Image only';
    if (slide.layout === 'background' || slide.mode === 'background') return 'Background campaign';
    return 'Text + image';
}

function heightSummary(item, fallback = 'preset') {
    const mode = item?.heightMode || fallback;
    if (mode === 'fixed') return `Fixed ${item?.desktopHeight || '-'}px / mobile ${item?.mobileHeight || '-'}px`;
    if (mode === 'ratio') return `Ratio ${item?.aspectRatio || 'auto'}`;
    if (mode === 'auto') return 'Auto image height';
    return 'Layout preset';
}

function linkSummary(href) {
    return isFilled(href) ? 'Clickable' : 'Display only';
}

function heroPreviewStyle(slide) {
    const useImageAsBackground = slide?.layout === 'background' || slide?.mode === 'imageOnly' || !shouldShowHeroText(slide);
    const rawBackgroundUrl = slide?.backgroundImageUrl || (useImageAsBackground ? slide?.imageUrl : '');
    const style = {};
    if (slide?.heightMode === 'ratio' && slide?.aspectRatio && slide.aspectRatio !== 'auto') style['--mini-hero-aspect-ratio'] = String(slide.aspectRatio).replace('/', ' / ');
    if (slide?.heightMode === 'fixed') style['--mini-hero-fixed-height'] = `${Math.round(clampNumber(slide.desktopHeight, 120, 900, 420) / 3)}px`;
    if (slide?.textColor) style['--hero-custom-text'] = slide.textColor;
    if (!rawBackgroundUrl) return style;
    style.backgroundImage = shouldShowHeroText(slide) ? `linear-gradient(90deg, rgba(18,13,4,.66), rgba(18,13,4,.18)), url(${resolveContentImageUrl(rawBackgroundUrl)})` : `url(${resolveContentImageUrl(rawBackgroundUrl)})`;
    style.backgroundSize = slide?.imageFit === 'contain' ? 'contain' : 'cover';
    return style;
}

function heroPreviewButtonStyle(slide) {
    const style = {};
    if (slide?.buttonColor) {
        style.background = slide.buttonColor;
        style.backgroundColor = slide.buttonColor;
        style.backgroundImage = 'none';
        style.borderColor = slide.buttonColor;
    }
    if (slide?.buttonTextColor) style.color = slide.buttonTextColor;
    return style;
}

function clampNumber(value, min, max, fallback) {
    const numberValue = parseInt(value, 10);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(numberValue, max));
}

function previewSectionStyle(section) {
    const radius = clampNumber(section?.settings?.radius, 0, 40, 16);
    const style = { '--mini-section-radius': `${radius}px` };
    if (section?.type === 'promoGrid') {
        const settings = normalizeLayoutSettings('promoGrid', section.settings);
        style['--mini-promo-grid-columns'] = clampNumber(settings.desktopColumns, 2, 6, 3);
        style['--mini-promo-grid-gap'] = `${Math.max(2, Math.round(clampNumber(settings.gap, 0, 40, 14) / 2))}px`;
    }
    return style;
}

function previewPromoBlocks(section) {
    const maxItems = clampNumber(section?.settings?.maxItems, 1, 8, 4);
    return enabledPromoBlocks.value.slice(0, maxItems);
}

function previewCategorySummary(section) {
    const maxItems = clampNumber(section?.settings?.maxItems, 1, 12, 6);
    const selectedCodes = content.value.categoryCodes?.length ? content.value.categoryCodes : [];
    if (!selectedCodes.length) return t('adminContent.autoCategories', { count: maxItems });
    return selectedCodes.slice(0, maxItems).join(', ');
}

function productSectionLayoutSummary(section) {
    const normalized = normalizeProductSection(section || {});
    const image = `image ${normalized.imageHeight}px`;
    if (normalized.display === 'grid') return `Grid / ${normalized.gridColumns} columns / radius ${normalized.cardRadius}px / ${image}`;
    return `Horizontal slider / radius ${normalized.cardRadius}px / ${image}`;
}

function colorPickerValue(value, fallback = '#ffffff') {
    return normalizeHexColor(value) || fallback;
}

function setColorValue(target, key, event) {
    target[key] = event.target.value;
}

function promoGridSettings() {
    return normalizeLayoutSettings('promoGrid', content.value.homeLayout?.find((section) => section.type === 'promoGrid')?.settings || {});
}

function promoColumnOptions() {
    const columns = clampNumber(promoGridSettings().desktopColumns, 2, 6, 3);
    return Array.from({ length: columns }, (_, index) => index + 1);
}

function promoWidthSummary(block) {
    return String(block?.width || '').trim() === 'full' ? 'Full row' : `${clampPromoSpan(block?.width, promoGridSettings().desktopColumns)} / ${promoGridSettings().desktopColumns} columns`;
}

function clampPromoSpan(value, max = 6) {
    if (String(value || '').trim() === 'full') return max;
    return Math.max(1, Math.min(max, parseInt(value, 10) || 1));
}

function shouldShowPromoText(block) {
    return block?.textOverlay !== false && Boolean(block?.title || block?.value || block?.description);
}

function promoPreviewLabel(block) {
    if (!block) return 'Promo';
    const contentType = shouldShowPromoText(block) ? 'Text overlay' : 'Image only';
    return `${contentType} / ${linkSummary(block.href)}`;
}

function promoPreviewStyle(block) {
    const columns = clampNumber(promoGridSettings().desktopColumns, 2, 6, 3);
    const style = {
        '--promo-col-span': clampPromoSpan(block?.width, columns),
        '--promo-row-span': clampPromoSpan(block?.height, 2)
    };
    if (block?.heightMode === 'fixed') style['--promo-preview-fixed-height'] = `${Math.round(clampNumber(block.desktopHeight, 80, 720, 180) / 2)}px`;
    if (block?.heightMode === 'ratio' && block?.aspectRatio && block.aspectRatio !== 'auto') style['--promo-preview-aspect-ratio'] = String(block.aspectRatio).replace('/', ' / ');
    if (isValidHexColor(block?.textColor)) style['--promo-preview-text-color'] = normalizeHexColor(block.textColor);

    if (block?.imageUrl) {
        const imageUrl = resolveContentImageUrl(block.imageUrl);
        style.backgroundImage = shouldShowPromoText(block)
            ? `linear-gradient(90deg, rgba(20, 14, 6, 0.55), rgba(20, 14, 6, 0.12)), url("${imageUrl}")`
            : `url("${imageUrl}")`;
        style.backgroundSize = block.imageFit === 'contain' ? 'contain' : 'cover';
    }

    return style;
}

async function loadProducts() {
    const result = await ProductService.getProducts({ search: productSearch.value, category: '', favorite: 0, includeAllPattern: true }, 0);
    products.value = result?.data || [];
}

function openProductPicker(index) {
    activeSectionIndex.value = index;
    showProductPicker.value = true;
    if (!products.value.length) loadProducts();
}

function toggleSectionProduct(productCode, sectionIndex = activeSectionIndex.value) {
    const section = content.value.productSections[sectionIndex];
    if (!section) return;
    if (!Array.isArray(section.productCodes)) section.productCodes = [];
    const index = section.productCodes.indexOf(productCode);
    if (index >= 0) section.productCodes.splice(index, 1);
    else section.productCodes.push(productCode);
}

function removeSectionProduct(sectionIndex, productCode) {
    const section = content.value.productSections[sectionIndex];
    if (!section || !Array.isArray(section.productCodes)) return;
    section.productCodes = section.productCodes.filter((code) => code !== productCode);
}

function isProductSelected(productCode) {
    const section = content.value.productSections[activeSectionIndex.value];
    return section?.productCodes?.includes(productCode);
}

function handleImageError(event) {
    event.target.src = ProductService.getPlaceholderImage();
}
</script>

<template>
    <main class="admin-content-page">
        <div class="admin-head">
            <div>
                <p>{{ t('adminContent.eyebrow') }}</p>
                <h1>{{ t('adminContent.title') }}</h1>
                <span>{{ t('adminContent.subtitle') }}</span>
            </div>
            <div class="admin-actions">
                <RouterLink to="/admin" class="admin-link-button">
                    <i class="pi pi-arrow-left"></i>
                    <span>{{ t('common.mainMenu') }}</span>
                </RouterLink>
                <Button :label="t('adminContent.openHomepage')" icon="pi pi-external-link" outlined @click="openHomepagePreview" />
                <Button :label="t('common.reload')" icon="pi pi-refresh" text :disabled="loading || saving" @click="loadAdmin" />
                <Button :label="t('common.save')" icon="pi pi-save" :loading="saving" @click="saveContent" />
            </div>
        </div>

        <div v-if="loading" class="admin-loading">
            <ProgressSpinner />
            <span>{{ t('adminContent.loading') }}</span>
        </div>

        <div v-else class="admin-grid">
            <section class="admin-panel">
                <TabView>
                    <TabPanel header="Layout">
                        <div class="panel-title-row">
                            <div>
                                <h2>Homepage Layout</h2>
                                <span>{{ t('adminContent.layoutSubtitle') }}</span>
                            </div>
                        </div>

                        <div class="layout-section-list">
                            <article
                                v-for="(section, index) in content.homeLayout"
                                :key="section.type"
                                :class="['layout-section-card', { dragging: dragLayoutFromIndex === index, 'drop-target': dragLayoutOverIndex === index && dragLayoutFromIndex !== index }]"
                                @dragover="onLayoutDragOver($event, index)"
                                @drop="onLayoutDrop"
                                @dragend="onLayoutDragEnd"
                            >
                                <button
                                    type="button"
                                    class="layout-drag-handle"
                                    draggable="true"
                                    :title="t('adminContent.dragTitle')"
                                    :aria-label="`${t('adminContent.dragTitle')} ${getLayoutSection(section.type).label}`"
                                    @dragstart="onLayoutDragStart($event, index)"
                                    @dragend="onLayoutDragEnd"
                                >
                                    <i class="pi pi-bars"></i>
                                </button>
                                <div class="layout-section-index">{{ index + 1 }}</div>
                                <div class="layout-section-info">
                                    <strong>{{ getLayoutSection(section.type).label }}</strong>
                                    <span>{{ getLayoutSection(section.type).description }}</span>
                                </div>
                                <div class="layout-section-actions">
                                    <label class="switch-line"><ToggleSwitch v-model="section.enabled" /> {{ t('adminContent.show') }}</label>
                                    <Button icon="pi pi-arrow-up" text rounded :aria-label="`Move ${getLayoutSection(section.type).label} up`" :disabled="index === 0" @click="moveItem(content.homeLayout, index, -1)" />
                                    <Button icon="pi pi-arrow-down" text rounded :aria-label="`Move ${getLayoutSection(section.type).label} down`" :disabled="index === content.homeLayout.length - 1" @click="moveItem(content.homeLayout, index, 1)" />
                                </div>
                                <div class="layout-section-settings">
                                    <label>
                                        Width
                                        <select v-model="section.settings.width">
                                            <option value="boxed">Boxed</option>
                                            <option value="wide">Wide</option>
                                            <option value="full">Full width</option>
                                        </select>
                                    </label>
                                    <label>
                                        Border Radius (px)
                                        <input v-model.number="section.settings.radius" type="number" min="0" max="40" />
                                    </label>

                                    <template v-if="section.type === 'hero'">
                                        <label>
                                            Hero Height
                                            <select v-model="section.settings.height">
                                                <option value="compact">Compact</option>
                                                <option value="normal">Normal</option>
                                                <option value="tall">Tall campaign</option>
                                            </select>
                                        </label>
                                    </template>

                                    <template v-else-if="section.type === 'promoGrid'">
                                        <label>
                                            Layout
                                            <select v-model="section.settings.layout">
                                                <option value="mosaic">Mosaic</option>
                                                <option value="equal">Equal cards</option>
                                                <option value="row">Single row</option>
                                            </select>
                                        </label>
                                        <label>
                                            Max Items
                                            <input v-model.number="section.settings.maxItems" type="number" min="1" max="8" />
                                        </label>
                                        <label>
                                            Desktop Columns
                                            <select v-model.number="section.settings.desktopColumns" @change="normalizePromoBlockSpans">
                                                <option :value="2">2 columns</option>
                                                <option :value="3">3 columns</option>
                                                <option :value="4">4 columns</option>
                                                <option :value="5">5 columns</option>
                                                <option :value="6">6 columns</option>
                                            </select>
                                        </label>
                                        <label>
                                            Tablet Columns
                                            <select v-model.number="section.settings.tabletColumns">
                                                <option :value="1">1 column</option>
                                                <option :value="2">2 columns</option>
                                                <option :value="3">3 columns</option>
                                                <option :value="4">4 columns</option>
                                            </select>
                                        </label>
                                        <label>
                                            Mobile Columns
                                            <select v-model.number="section.settings.mobileColumns">
                                                <option :value="1">1 column</option>
                                                <option :value="2">2 columns</option>
                                            </select>
                                        </label>
                                        <label>
                                            Gap (px)
                                            <input v-model.number="section.settings.gap" type="number" min="0" max="40" />
                                        </label>
                                    </template>

                                    <template v-else-if="section.type === 'categories'">
                                        <label>
                                            Max Items
                                            <input v-model.number="section.settings.maxItems" type="number" min="1" max="12" />
                                        </label>
                                        <label>
                                            Density
                                            <select v-model="section.settings.density">
                                                <option value="comfortable">Comfortable</option>
                                                <option value="compact">Compact</option>
                                            </select>
                                        </label>
                                    </template>


                                </div>
                            </article>
                        </div>
                        <p class="layout-drag-hint">{{ t('adminContent.dragHint') }}</p>
                    </TabPanel>

                    <TabPanel header="Theme">
                        <div class="panel-title-row">
                            <div>
                                <h2>Theme Settings</h2>
                                <span>{{ t('adminContent.themeSubtitle') }}</span>
                            </div>
                        </div>

                        <div class="theme-preset-grid">
                            <button
                                v-for="preset in themePresetCards"
                                :key="preset.key"
                                type="button"
                                :class="['theme-preset-card', content.theme.preset === preset.key ? 'active' : '']"
                                :aria-label="`Apply ${preset.label} theme preset`"
                                :aria-pressed="content.theme.preset === preset.key"
                                @click="applyThemePreset(preset.key)"
                            >
                                <span class="theme-preset-swatches">
                                    <i :style="{ background: preset.colors.primaryColor }"></i>
                                    <i :style="{ background: preset.colors.accentColor }"></i>
                                    <i :style="{ background: preset.colors.backgroundColor }"></i>
                                    <i :style="{ background: preset.colors.headerBackground }"></i>
                                    <i :style="{ background: preset.colors.productImageBackground }"></i>
                                </span>
                                <strong>{{ preset.label }}</strong>
                            </button>
                        </div>

                        <div class="editor-card">
                            <div class="editor-card-head">
                                <strong>{{ t('adminContent.customColors') }}</strong>
                                <span class="muted-text">{{ t('adminContent.customColorsHint') }}</span>
                            </div>
                            <div class="theme-color-grid">
                                <label>
                                    Primary
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.primaryColor, '#0f9f6e')" type="color" aria-label="Primary color picker" @input="updateThemeColor('primaryColor', $event.target.value)" />
                                        <InputText :modelValue="content.theme.primaryColor" aria-label="Primary color hex" @update:modelValue="updateThemeColor('primaryColor', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Accent
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.accentColor, '#f97316')" type="color" aria-label="Accent color picker" @input="updateThemeColor('accentColor', $event.target.value)" />
                                        <InputText :modelValue="content.theme.accentColor" aria-label="Accent color hex" @update:modelValue="updateThemeColor('accentColor', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Page Background
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.backgroundColor, '#fff8ee')" type="color" aria-label="Page background color picker" @input="updateThemeColor('backgroundColor', $event.target.value)" />
                                        <InputText :modelValue="content.theme.backgroundColor" aria-label="Page background color hex" @update:modelValue="updateThemeColor('backgroundColor', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Header Background
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.headerBackground, '#f7ebcf')" type="color" aria-label="Header background color picker" @input="updateThemeColor('headerBackground', $event.target.value)" />
                                        <InputText :modelValue="content.theme.headerBackground" aria-label="Header background color hex" @update:modelValue="updateThemeColor('headerBackground', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Header Text
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.headerTextColor, '#5b4a27')" type="color" aria-label="Header text color picker" @input="updateThemeColor('headerTextColor', $event.target.value)" />
                                        <InputText :modelValue="content.theme.headerTextColor" aria-label="Header text color hex" @update:modelValue="updateThemeColor('headerTextColor', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Product Card Background
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.productCardBackground, '#ffffff')" type="color" aria-label="Product card background color picker" @input="updateThemeColor('productCardBackground', $event.target.value)" />
                                        <InputText :modelValue="content.theme.productCardBackground" aria-label="Product card background color hex" @update:modelValue="updateThemeColor('productCardBackground', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Product Image Background
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.productImageBackground, '#fff7ed')" type="color" aria-label="Product image background color picker" @input="updateThemeColor('productImageBackground', $event.target.value)" />
                                        <InputText :modelValue="content.theme.productImageBackground" aria-label="Product image background color hex" @update:modelValue="updateThemeColor('productImageBackground', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Product Card Border
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.productCardBorder, '#efe3c8')" type="color" aria-label="Product card border color picker" @input="updateThemeColor('productCardBorder', $event.target.value)" />
                                        <InputText :modelValue="content.theme.productCardBorder" aria-label="Product card border color hex" @update:modelValue="updateThemeColor('productCardBorder', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Footer Background
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.footerBackground, '#fff7e6')" type="color" aria-label="Footer background color picker" @input="updateThemeColor('footerBackground', $event.target.value)" />
                                        <InputText :modelValue="content.theme.footerBackground" aria-label="Footer background color hex" @update:modelValue="updateThemeColor('footerBackground', $event)" />
                                    </span>
                                </label>
                                <label>
                                    Footer Text
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(content.theme.footerTextColor, '#2f2412')" type="color" aria-label="Footer text color picker" @input="updateThemeColor('footerTextColor', $event.target.value)" />
                                        <InputText :modelValue="content.theme.footerTextColor" aria-label="Footer text color hex" @update:modelValue="updateThemeColor('footerTextColor', $event)" />
                                    </span>
                                </label>
                            </div>
                        </div>

                        <div class="theme-preview" :style="themePreviewStyle()">
                            <div class="theme-preview-header">
                                <strong>{{ siteName }}</strong>
                                <button type="button">Cart</button>
                            </div>
                            <div class="theme-preview-body">
                                <article class="theme-preview-card">
                                    <div></div>
                                    <strong>Product Card</strong>
                                    <span>฿1,250.00</span>
                                </article>
                                <button type="button" class="theme-preview-primary">Primary action</button>
                                <button type="button" class="theme-preview-accent">Accent badge</button>
                            </div>
                            <div class="theme-preview-footer">Footer contact & company information</div>
                        </div>
                    </TabPanel>

                    <TabPanel header="Hero Slides">
                        <div class="panel-title-row">
                            <h2>Hero Slides</h2>
                            <Button :label="t('adminContent.addSlide')" icon="pi pi-plus" size="small" @click="addSlide" />
                        </div>

                        <div v-for="(slide, index) in content.slides" :key="`slide-${index}`" class="editor-card">
                            <div class="editor-card-head">
                                <strong>Slide {{ index + 1 }}</strong>
                                <div class="editor-card-actions">
                                    <Button icon="pi pi-arrow-up" text rounded :aria-label="`Move Slide ${index + 1} up`" :disabled="index === 0" @click="moveItem(content.slides, index, -1)" />
                                    <Button icon="pi pi-arrow-down" text rounded :aria-label="`Move Slide ${index + 1} down`" :disabled="index === content.slides.length - 1" @click="moveItem(content.slides, index, 1)" />
                                    <label class="switch-line"><ToggleSwitch v-model="slide.enabled" /> {{ t('adminContent.show') }}</label>
                                    <Button icon="pi pi-trash" severity="danger" text rounded :aria-label="`Delete Slide ${index + 1}`" @click="confirmRemoveAt(content.slides, index, `Slide ${index + 1}`)" />
                                </div>
                            </div>

                            <div class="form-grid">
                                <label>Mode
                                    <select v-model="slide.mode">
                                        <option value="campaign">Campaign with text</option>
                                        <option value="imageOnly">Image only</option>
                                        <option value="background">Background image</option>
                                    </select>
                                    <small class="field-hint">Image only ไม่บังคับกรอกข้อความหรือปุ่ม</small>
                                </label>
                                <label class="switch-line"><ToggleSwitch v-model="slide.textVisible" :disabled="slide.mode === 'imageOnly'" /> Show text</label>
                                <label>Height Mode
                                    <select v-model="slide.heightMode">
                                        <option value="preset">Use layout preset</option>
                                        <option value="ratio">Aspect ratio</option>
                                        <option value="fixed">Fixed height</option>
                                        <option value="auto">Auto</option>
                                    </select>
                                </label>
                                <label v-if="slide.heightMode === 'ratio'">Aspect Ratio
                                    <select v-model="slide.aspectRatio">
                                        <option value="21/8">21:8 campaign</option>
                                        <option value="21/6">21:6 wide</option>
                                        <option value="16/5">16:5 banner</option>
                                        <option value="2/1">2:1</option>
                                        <option value="1/1">1:1</option>
                                    </select>
                                </label>
                                <label v-if="slide.heightMode === 'fixed'">Desktop Height (px)
                                    <input v-model.number="slide.desktopHeight" type="number" min="120" max="900" />
                                    <small class="field-hint">ช่วงที่รับ: 120 - 900 px</small>
                                </label>
                                <label v-if="slide.heightMode === 'fixed'">Mobile Height (px)
                                    <input v-model.number="slide.mobileHeight" type="number" min="100" max="640" />
                                    <small class="field-hint">ช่วงที่รับ: 100 - 640 px</small>
                                </label>
                                <label>Image Fit
                                    <select v-model="slide.imageFit">
                                        <option value="cover">Cover</option>
                                        <option value="contain">Contain</option>
                                    </select>
                                </label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">Eyebrow<InputText v-model="slide.eyebrow" /></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">Title<InputText v-model="slide.title" /></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'" class="span-2">Subtitle<Textarea v-model="slide.subtitle" rows="3" /></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">{{ t('adminContent.ctaButton') }}<InputText v-model="slide.ctaLabel" /></label>
                                <label>Link<InputText v-model="slide.href" placeholder="/marketplace หรือ https://..." /><small class="field-hint">เว้นว่างได้ ถ้าไม่ต้องการให้ปุ่ม/แบนเนอร์คลิกได้</small></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">Badge<InputText v-model="slide.badge" /></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">{{ t('adminContent.promoText') }}<InputText v-model="slide.discountText" /></label>
                                <label v-show="slide.textVisible && slide.mode !== 'imageOnly'">{{ t('adminContent.textPosition') }}
                                    <select v-model="slide.contentPosition">
                                        <option value="left">{{ t('adminContent.left') }}</option>
                                        <option value="center">{{ t('adminContent.center') }}</option>
                                        <option value="right">{{ t('adminContent.right') }}</option>
                                    </select>
                                </label>
                                <label v-show="slide.mode !== 'imageOnly'">Layout
                                    <select v-model="slide.layout">
                                        <option value="split">{{ t('adminContent.textImage') }}</option>
                                        <option value="image-focus">{{ t('adminContent.imageFocus') }}</option>
                                        <option value="background">{{ t('adminContent.fullBannerImage') }}</option>
                                    </select>
                                </label>
                                <label v-show="slide.mode !== 'imageOnly' && slide.layout !== 'background'">{{ t('adminContent.imagePosition') }}
                                    <select v-model="slide.imagePosition">
                                        <option value="right">{{ t('adminContent.right') }}</option>
                                        <option value="left">{{ t('adminContent.left') }}</option>
                                    </select>
                                </label>
                                <label>Tone
                                    <select v-model="slide.tone">
                                        <option value="teal">Teal</option>
                                        <option value="red">Red</option>
                                        <option value="blue">Blue</option>
                                        <option value="gold">Gold</option>
                                        <option value="green">Green</option>
                                        <option value="rose">Rose</option>
                                        <option value="dark">Dark</option>
                                    </select>
                                </label>
                                <div class="span-2 color-grid">
                                    <label>Text Color
                                        <div class="color-control">
                                            <input type="color" :value="colorPickerValue(slide.textColor, '#ffffff')" @input="setColorValue(slide, 'textColor', $event)" />
                                            <InputText v-model="slide.textColor" placeholder="#ffffff" />
                                        </div>
                                    </label>
                                    <label>Button Color
                                        <div class="color-control">
                                            <input type="color" :value="colorPickerValue(slide.buttonColor, '#10b981')" @input="setColorValue(slide, 'buttonColor', $event)" />
                                            <InputText v-model="slide.buttonColor" placeholder="#10b981" />
                                        </div>
                                    </label>
                                    <label>Button Text
                                        <div class="color-control">
                                            <input type="color" :value="colorPickerValue(slide.buttonTextColor, '#ffffff')" @input="setColorValue(slide, 'buttonTextColor', $event)" />
                                            <InputText v-model="slide.buttonTextColor" placeholder="#ffffff" />
                                        </div>
                                    </label>
                                    <Button :label="t('adminContent.clearColor')" icon="pi pi-times" size="small" severity="secondary" text @click="slide.textColor = ''; slide.buttonColor = ''; slide.buttonTextColor = ''" />
                                </div>
                                <label class="span-2">Image URL<InputText v-model="slide.imageUrl" placeholder="/media/banner.webp" /></label>
                                <div class="span-2 image-tools">
                                    <Button :label="t('adminContent.chooseFromLibrary')" icon="pi pi-images" size="small" outlined @click="openMediaPicker('slide', index)" />
                                    <span v-if="slide.imageUrl">{{ slide.imageUrl }}</span>
                                </div>
                                <label class="span-2 upload-line">
                                    <span>{{ t('adminContent.uploadImage') }}</span>
                                    <input type="file" accept="image/*" @change="uploadImage('slide', index, $event)" />
                                    <small v-if="uploadingKey === `slide-${index}`">{{ t('adminContent.uploading') }}</small>
                                </label>
                                <label class="span-2">Background Image URL<InputText v-model="slide.backgroundImageUrl" placeholder="/media/hero-bg.webp" /></label>
                                <div class="span-2 image-tools">
                                    <Button :label="t('adminContent.chooseBackgroundFromLibrary')" icon="pi pi-images" size="small" outlined @click="openMediaPicker('slideBackground', index)" />
                                    <span v-if="slide.backgroundImageUrl">{{ slide.backgroundImageUrl }}</span>
                                    <Button v-if="slide.backgroundImageUrl" :label="t('adminContent.clearBackground')" icon="pi pi-times" size="small" severity="secondary" text @click="slide.backgroundImageUrl = ''" />
                                </div>
                                <label class="span-2 upload-line">
                                    <span>{{ t('adminContent.uploadBackground') }}</span>
                                    <input type="file" accept="image/*" @change="uploadImage('slideBackground', index, $event)" />
                                    <small v-if="uploadingKey === `slideBackground-${index}`">{{ t('adminContent.uploading') }}</small>
                                </label>
                            </div>
                        </div>
                    </TabPanel>

                    <TabPanel header="Promo Grid">
                        <div class="panel-title-row">
                            <h2>Promo Banner Grid</h2>
                            <Button :label="t('adminContent.addPromo')" icon="pi pi-plus" size="small" @click="addPromoBlock" />
                        </div>

                        <div v-for="(block, index) in content.promoBlocks" :key="`promo-${index}`" class="editor-card">
                            <div class="editor-card-head">
                                <strong>Promo {{ index + 1 }}</strong>
                                <div class="editor-card-actions">
                                    <Button icon="pi pi-arrow-up" text rounded :aria-label="`Move Promo ${index + 1} up`" :disabled="index === 0" @click="moveItem(content.promoBlocks, index, -1)" />
                                    <Button icon="pi pi-arrow-down" text rounded :aria-label="`Move Promo ${index + 1} down`" :disabled="index === content.promoBlocks.length - 1" @click="moveItem(content.promoBlocks, index, 1)" />
                                    <label class="switch-line"><ToggleSwitch v-model="block.enabled" /> {{ t('adminContent.show') }}</label>
                                    <Button icon="pi pi-trash" severity="danger" text rounded :aria-label="`Delete Promo ${index + 1}`" @click="confirmRemoveAt(content.promoBlocks, index, `Promo ${index + 1}`)" />
                                </div>
                            </div>
                            <div class="form-grid">
                                <label>Title<InputText v-model="block.title" /></label>
                                <label>Value<InputText v-model="block.value" /></label>
                                <label class="span-2">Description<Textarea v-model="block.description" rows="2" /></label>
                                <label>Link<InputText v-model="block.href" placeholder="/marketplace หรือ https://..." /><small class="field-hint">เว้นว่างได้ ถ้าไม่ใส่ลิงก์ banner จะเป็นรูป/กล่องแสดงผลเฉยๆ</small></label>
                                <label>Tone
                                    <select v-model="block.tone">
                                        <option value="red">Red</option>
                                        <option value="teal">Teal</option>
                                        <option value="blue">Blue</option>
                                    </select>
                                </label>
                                <label>Image URL<InputText v-model="block.imageUrl" placeholder="/media/promo.jpg" /></label>
                                <label>Image Alt<InputText v-model="block.imageAlt" /></label>
                                <div class="span-2 image-tools">
                                    <Button :label="t('adminContent.chooseFromLibrary')" icon="pi pi-images" size="small" outlined @click="openMediaPicker('promo', index)" />
                                    <label class="upload-line">
                                        <span>{{ t('adminContent.uploadNewImage') }}</span>
                                        <input type="file" accept="image/*" @change="uploadImage('promo', index, $event)" />
                                        <small v-if="uploadingKey === `promo-${index}`">{{ t('adminContent.uploading') }}</small>
                                    </label>
                                    <Button v-if="block.imageUrl" :label="t('adminContent.clearImage')" icon="pi pi-times" size="small" severity="secondary" text @click="block.imageUrl = ''" />
                                </div>
                                <label>Column Span
                                    <select v-model="block.width">
                                        <option value="full">Full row</option>
                                        <option v-for="column in promoColumnOptions()" :key="column" :value="column">{{ column }} column{{ column > 1 ? 's' : '' }}</option>
                                    </select>
                                    <small class="field-hint">Desktop: {{ promoWidthSummary(block) }}. Tablet/mobile จะลด span ให้อัตโนมัติถ้าคอลัมน์น้อยกว่า</small>
                                </label>
                                <label>Row Span
                                    <select v-model.number="block.height">
                                        <option :value="1">{{ t('adminContent.oneRow') }}</option>
                                        <option :value="2">{{ t('adminContent.twoRows') }}</option>
                                    </select>
                                    <small class="field-hint">ใช้กับ Mosaic เพื่อทำ banner สูงสองแถว</small>
                                </label>
                                <label>Image Fit
                                    <select v-model="block.imageFit">
                                        <option value="cover">Cover</option>
                                        <option value="contain">Contain</option>
                                    </select>
                                </label>
                                <label>Text Color
                                    <span class="color-input-row">
                                        <input :value="colorPickerValue(block.textColor, '#ffffff')" type="color" @input="block.textColor = $event.target.value" />
                                        <InputText v-model="block.textColor" placeholder="#FFFFFF" />
                                    </span>
                                    <small class="field-hint">เว้นว่างได้ ถ้าไม่กำหนดจะใช้สีตาม banner/theme เดิม</small>
                                </label>
                                <label>Height Mode
                                    <select v-model="block.heightMode">
                                        <option value="ratio">Aspect ratio</option>
                                        <option value="fixed">Fixed height</option>
                                        <option value="auto">Auto image height</option>
                                    </select>
                                    <small class="field-hint">Auto เหมาะกับรูปโปรโมชั่นสำเร็จรูปที่ไม่ต้องครอบภาพ</small>
                                </label>
                                <label v-if="block.heightMode === 'ratio'">Aspect Ratio
                                    <select v-model="block.aspectRatio">
                                        <option value="16/5">16:5 banner</option>
                                        <option value="21/6">21:6 wide</option>
                                        <option value="21/8">21:8 campaign</option>
                                        <option value="2/1">2:1</option>
                                        <option value="1/1">1:1</option>
                                    </select>
                                </label>
                                <label v-if="block.heightMode === 'fixed'">Desktop Height (px)
                                    <input v-model.number="block.desktopHeight" type="number" min="80" max="720" />
                                    <small class="field-hint">ช่วงที่รับ: 80 - 720 px</small>
                                </label>
                                <label v-if="block.heightMode === 'fixed'">Mobile Height (px)
                                    <input v-model.number="block.mobileHeight" type="number" min="60" max="480" />
                                    <small class="field-hint">ช่วงที่รับ: 60 - 480 px</small>
                                </label>
                                <label class="switch-line promo-overlay-switch"><ToggleSwitch v-model="block.textOverlay" /> {{ t('adminContent.showTextOverlay') }}</label>
                            </div>
                        </div>
                    </TabPanel>

                    <TabPanel :header="t('adminContent.alertDialog')">
                        <div class="panel-title-row">
                            <div>
                                <h2>{{ t('adminContent.alertDialog') }}</h2>
                                <span>{{ t('adminContent.alertDialogSubtitle') }}</span>
                            </div>
                            <div class="panel-actions">
                                <Button :label="t('adminContent.alertTestPopup')" icon="pi pi-eye" size="small" outlined @click="openAlertPopupTest" />
                                <Button :label="t('adminContent.alertResetHistory')" icon="pi pi-refresh" size="small" severity="secondary" text @click="resetAlertPopupHistory" />
                                <label class="switch-line"><ToggleSwitch v-model="content.alertPopup.enabled" /> {{ t('adminContent.show') }}</label>
                            </div>
                        </div>

                        <div class="alert-popup-status-card" :class="`alert-status-${alertPopupRuntimeStatus.state}`">
                            <div class="alert-status-main">
                                <i :class="alertPopupRuntimeStatus.icon"></i>
                                <div>
                                    <strong>{{ alertPopupRuntimeStatus.title }}</strong>
                                    <span>{{ alertPopupRuntimeStatus.detail }}</span>
                                </div>
                            </div>
                            <div class="alert-status-grid">
                                <span><b>{{ ta('device') }}</b>{{ alertPopupRuntimeStatus.device }}</span>
                                <span><b>{{ ta('frequency') }}</b>{{ alertPopupRuntimeStatus.frequency }}</span>
                                <span><b>{{ ta('window') }}</b>{{ alertPopupRuntimeStatus.window }}</span>
                                <span><b>{{ ta('link') }}</b>{{ alertPopupRuntimeStatus.link }}</span>
                            </div>
                        </div>

                        <div class="editor-card">
                            <div class="form-grid">
                                <label>{{ t('adminContent.alertName') }}<InputText v-model="content.alertPopup.name" placeholder="summer-campaign" /></label>
                                <label>{{ t('adminContent.alertDevice') }}
                                    <select v-model="content.alertPopup.device">
                                        <option value="all">{{ t('adminContent.alertDeviceAll') }}</option>
                                        <option value="desktop">{{ t('adminContent.alertDeviceDesktop') }}</option>
                                        <option value="mobile">{{ t('adminContent.alertDeviceMobile') }}</option>
                                    </select>
                                </label>
                                <label class="span-2">{{ t('adminContent.alertImageUrl') }}<InputText v-model="content.alertPopup.imageUrl" placeholder="/media/popup.jpg" /></label>
                                <div class="span-2 image-tools">
                                    <Button :label="t('adminContent.chooseFromLibrary')" icon="pi pi-images" size="small" outlined @click="openMediaPicker('alertPopup', -1)" />
                                    <label class="upload-line">
                                        <span>{{ t('adminContent.uploadNewImage') }}</span>
                                        <input type="file" accept="image/*" @change="uploadImage('alertPopup', -1, $event)" />
                                        <small v-if="uploadingKey === 'alertPopup--1'">{{ t('adminContent.uploading') }}</small>
                                    </label>
                                    <Button v-if="content.alertPopup.imageUrl" :label="t('adminContent.clearImage')" icon="pi pi-times" size="small" severity="secondary" text @click="content.alertPopup.imageUrl = ''" />
                                </div>
                                <label>{{ t('adminContent.alertImageAlt') }}<InputText v-model="content.alertPopup.imageAlt" /></label>
                                <label>{{ t('adminContent.alertLinkUrl') }}
                                    <InputText v-model="content.alertPopup.href" placeholder="/marketplace หรือ https://..." />
                                    <small class="field-hint">{{ t('adminContent.alertLinkHint') }}</small>
                                </label>
                                <label>{{ t('adminContent.alertTarget') }}
                                    <select v-model="content.alertPopup.target">
                                        <option value="_self">{{ t('adminContent.alertTargetSelf') }}</option>
                                        <option value="_blank">{{ t('adminContent.alertTargetBlank') }}</option>
                                    </select>
                                </label>
                                <label>{{ t('adminContent.alertFrequency') }}
                                    <select v-model="content.alertPopup.frequency">
                                        <option value="always">{{ t('adminContent.alertFrequencyAlways') }}</option>
                                        <option value="oncePerSession">{{ t('adminContent.alertFrequencySession') }}</option>
                                        <option value="oncePerDay">{{ t('adminContent.alertFrequencyDay') }}</option>
                                        <option value="onceForever">{{ t('adminContent.alertFrequencyForever') }}</option>
                                    </select>
                                </label>
                                <label>{{ t('adminContent.alertStartAt') }}<input v-model="content.alertPopup.startAt" type="datetime-local" /></label>
                                <label>{{ t('adminContent.alertEndAt') }}<input v-model="content.alertPopup.endAt" type="datetime-local" /></label>
                                <label>{{ t('adminContent.alertDelayMs') }}<input v-model.number="content.alertPopup.delayMs" type="number" min="0" max="10000" /><small class="field-hint">0 - 10000 ms</small></label>
                                <label>{{ t('adminContent.alertDesktopWidth') }}<input v-model.number="content.alertPopup.desktopWidth" type="number" min="320" max="1200" /><small class="field-hint">320 - 1200 px</small></label>
                                <label>{{ t('adminContent.alertMobileWidth') }}<input v-model.number="content.alertPopup.mobileWidth" type="number" min="280" max="480" /><small class="field-hint">280 - 480 px</small></label>
                                <label>{{ t('adminContent.alertMaxHeight') }}<input v-model.number="content.alertPopup.maxHeightVh" type="number" min="50" max="95" /><small class="field-hint">50 - 95 vh</small></label>
                                <label>{{ t('adminContent.alertBorderRadius') }}<input v-model.number="content.alertPopup.borderRadius" type="number" min="0" max="40" /><small class="field-hint">0 - 40 px</small></label>
                                <label class="switch-line"><ToggleSwitch v-model="content.alertPopup.backdrop" /> {{ t('adminContent.alertBackdrop') }}</label>
                                <label class="switch-line"><ToggleSwitch v-model="content.alertPopup.closeOnBackdrop" /> {{ t('adminContent.alertCloseOnBackdrop') }}</label>
                                <label class="switch-line"><ToggleSwitch v-model="content.alertPopup.showCloseButton" /> {{ t('adminContent.alertShowCloseButton') }}</label>
                            </div>
                        </div>

                        <div class="alert-popup-preview">
                            <div class="alert-popup-preview-head">
                                <strong>{{ t('adminContent.alertPreview') }}</strong>
                                <span>{{ content.alertPopup.enabled ? t('adminContent.show') : '-' }}</span>
                            </div>
                            <div class="alert-popup-preview-stage" :style="{ borderRadius: `${normalizeAlertPopup(content.alertPopup).borderRadius}px` }">
                                <button v-if="content.alertPopup.showCloseButton" type="button" class="alert-popup-preview-close">×</button>
                                <img v-if="content.alertPopup.imageUrl" :src="resolveContentImageUrl(content.alertPopup.imageUrl)" :alt="content.alertPopup.imageAlt || ''" @error="handleImageError" />
                                <div v-else class="empty-media">{{ t('adminContent.alertNoImage') }}</div>
                            </div>
                        </div>
                    </TabPanel>

                    <TabPanel header="Categories">
                        <div class="panel-title-row">
                            <h2>{{ t('adminContent.popularCategories') }}</h2>
                            <span>{{ t('adminContent.selectedCategories', { count: content.categoryCodes.length }) }}</span>
                        </div>
                        <div class="category-picker-grid">
                            <button
                                v-for="cat in categories"
                                :key="cat.code"
                                type="button"
                                :class="['pick-chip', content.categoryCodes.includes(cat.code) ? 'active' : '']"
                                :aria-label="`${content.categoryCodes.includes(cat.code) ? 'Remove category' : 'Select category'} ${cat.name}`"
                                :aria-pressed="content.categoryCodes.includes(cat.code)"
                                @click="toggleCategory(cat.code)"
                            >
                                <i class="pi" :class="content.categoryCodes.includes(cat.code) ? 'pi-check-circle' : 'pi-circle'"></i>
                                <span class="pick-chip-label">{{ cat.name }}</span>
                                <span v-if="getSelectedCategoryOrder(cat.code)" class="pick-chip-order">#{{ getSelectedCategoryOrder(cat.code) }}</span>
                            </button>
                        </div>
                        <div v-if="content.categoryCodes.length" class="selected-category-order-list">
                            <div v-for="(code, index) in content.categoryCodes" :key="code" class="selected-category-order-row">
                                <span class="selected-category-order-no">{{ index + 1 }}</span>
                                <div>
                                    <strong>{{ getCategoryName(code) }}</strong>
                                    <small>{{ code }}</small>
                                </div>
                            </div>
                        </div>
                    </TabPanel>

                    <TabPanel header="Product Sections">
                        <div class="panel-title-row">
                            <h2>Product Sections</h2>
                            <Button :label="t('adminContent.addSection')" icon="pi pi-plus" size="small" @click="addProductSection" />
                        </div>

                        <div v-for="(section, index) in content.productSections" :key="section.id || index" class="editor-card">
                            <div class="editor-card-head">
                                <strong>{{ section.title || `Section ${index + 1}` }}</strong>
                                <div class="editor-card-actions">
                                    <Button icon="pi pi-arrow-up" text rounded :aria-label="`Move ${section.title || `Section ${index + 1}`} up`" :disabled="index === 0" @click="moveItem(content.productSections, index, -1)" />
                                    <Button icon="pi pi-arrow-down" text rounded :aria-label="`Move ${section.title || `Section ${index + 1}`} down`" :disabled="index === content.productSections.length - 1" @click="moveItem(content.productSections, index, 1)" />
                                    <label class="switch-line"><ToggleSwitch v-model="section.enabled" /> {{ t('adminContent.show') }}</label>
                                    <Button icon="pi pi-trash" severity="danger" text rounded :aria-label="`Delete ${section.title || `Section ${index + 1}`}`" @click="confirmRemoveAt(content.productSections, index, section.title || `Section ${index + 1}`)" />
                                </div>
                            </div>

                            <div class="form-grid">
                                <label>Title<InputText v-model="section.title" /></label>
                                <label>Mode
                                    <select v-model="section.mode">
                                        <option value="new">New products (Sales Settings)</option>
                                        <option value="recommend">Recommended (Sales Settings)</option>
                                        <option value="latest">Latest (legacy)</option>
                                        <option value="promotion">Promotion</option>
                                        <option value="category">Category</option>
                                        <option value="manual">Manual</option>
                                    </select>
                                </label>
                                <label class="span-2">Subtitle<InputText v-model="section.subtitle" /></label>
                                <label class="limit-field">Limit<input v-model.number="section.limit" class="limit-input" type="number" min="1" max="24" /></label>
                                <label>Display
                                    <select v-model="section.display">
                                        <option value="slider">Horizontal slider</option>
                                        <option value="grid">Grid</option>
                                    </select>
                                </label>
                                <label>Grid Columns
                                    <input v-model.number="section.gridColumns" type="number" min="1" max="8" />
                                </label>
                                <label>Product Card Radius (px)
                                    <input v-model.number="section.cardRadius" type="number" min="0" max="40" />
                                </label>
                                <label>Image Height (px)
                                    <input v-model.number="section.imageHeight" type="number" min="80" max="360" />
                                    <small class="field-hint">ช่วงที่รับ: 80 - 360 px</small>
                                </label>
                                <label v-if="section.mode === 'category'">{{ t('adminContent.category') }}
                                    <select v-model="section.categoryCode">
                                        <option value="">{{ t('adminContent.selectCategory') }}</option>
                                        <option v-for="cat in categories" :key="cat.code" :value="cat.code">{{ cat.name }}</option>
                                    </select>
                                </label>
                                <div v-if="section.mode === 'manual'" class="span-2 manual-products">
                                    <Button :label="t('adminContent.selectProducts')" icon="pi pi-search" size="small" @click="openProductPicker(index)" />
                                    <div class="selected-products">
                                        <Chip v-for="code in section.productCodes" :key="code" :label="code" removable @remove="removeSectionProduct(index, code)" />
                                        <span v-if="!section.productCodes?.length">{{ t('adminContent.noProductsSelected') }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabPanel>

                    <TabPanel header="Media Library">
                        <div class="panel-title-row">
                            <div>
                                <h2>Media Library</h2>
                                <span>{{ t('adminContent.files', { count: mediaAssets.length }) }}</span>
                            </div>
                            <Button :label="t('common.reload')" icon="pi pi-refresh" text @click="loadMediaAssets" />
                        </div>

                        <label class="library-upload">
                            <span>{{ t('adminContent.uploadToLibrary') }}</span>
                            <input type="file" accept="image/*" @change="uploadImage('library', -1, $event)" />
                            <small v-if="uploadingKey === 'library--1'">{{ t('adminContent.uploading') }}</small>
                        </label>

                        <div v-if="mediaAssets.length" class="media-library-grid">
                            <article v-for="asset in mediaAssets" :key="asset.name" class="media-library-card">
                                <img :src="resolveMediaAssetUrl(asset)" :alt="asset.name" @error="handleImageError" />
                                <strong>{{ asset.name }}</strong>
                                <span>{{ Math.round((asset.size || 0) / 1024) }} KB</span>
                                <div class="media-card-actions">
                                    <Button icon="pi pi-pencil" text rounded :aria-label="`${t('adminContent.rename')} ${asset.name}`" v-tooltip.top="t('adminContent.rename')" @click="openRenameMedia(asset, $event)" />
                                    <Button icon="pi pi-trash" severity="danger" text rounded :aria-label="`${t('adminContent.deleteImage')} ${asset.name}`" v-tooltip.top="t('adminContent.deleteImage')" @click="confirmDeleteMedia(asset, $event)" />
                                </div>
                            </article>
                        </div>
                        <div v-else class="empty-media">{{ t('adminContent.emptyMedia') }}</div>
                    </TabPanel>
                </TabView>
            </section>

            <!-- <aside class="preview-panel">
                <div class="preview-head">
                    <div>
                        <h2>Preview</h2>
                        <span>Mini preview ใช้ดู draft ปัจจุบัน</span>
                    </div>
                </div>
                <div class="mini-layout-preview">
                    <div v-for="layoutSection in previewHomeLayout" :key="layoutSection.type" class="mini-layout-section" :class="`mini-layout-width-${layoutSection.settings?.width || 'boxed'}`" :data-section="layoutSection.type" :style="previewSectionStyle(layoutSection)">
                        <div
                            v-if="layoutSection.type === 'hero'"
                            class="mini-hero"
                            :class="{
                                'mini-hero-background': enabledSlides[0]?.backgroundImageUrl || (enabledSlides[0]?.layout === 'background' && enabledSlides[0]?.imageUrl) || enabledSlides[0]?.mode === 'imageOnly' || !shouldShowHeroText(enabledSlides[0]),
                                'mini-hero-image-only': enabledSlides[0]?.mode === 'imageOnly' || !shouldShowHeroText(enabledSlides[0]),
                                'mini-hero-ratio': enabledSlides[0]?.heightMode === 'ratio',
                                'mini-hero-fixed': enabledSlides[0]?.heightMode === 'fixed'
                            }"
                            :style="heroPreviewStyle(enabledSlides[0])"
                        >
                            <div class="mini-preview-badges">
                                <span>{{ heroPreviewLabel(enabledSlides[0]) }}</span>
                                <span>{{ heightSummary(enabledSlides[0]) }}</span>
                                <span>{{ linkSummary(enabledSlides[0]?.href) }}</span>
                            </div>
                            <div v-if="shouldShowHeroText(enabledSlides[0])">
                                <p v-if="enabledSlides[0]?.eyebrow">{{ enabledSlides[0]?.eyebrow }}</p>
                                <h3 v-if="enabledSlides[0]?.title">{{ enabledSlides[0]?.title }}</h3>
                                <span v-if="enabledSlides[0]?.subtitle">{{ enabledSlides[0]?.subtitle }}</span>
                                <button v-if="shouldShowHeroPrimaryAction(enabledSlides[0])" class="mini-hero-button" type="button" :style="heroPreviewButtonStyle(enabledSlides[0])">{{ enabledSlides[0]?.ctaLabel }}</button>
                            </div>
                            <img v-if="enabledSlides[0]?.imageUrl && enabledSlides[0]?.layout !== 'background' && enabledSlides[0]?.mode !== 'imageOnly' && shouldShowHeroText(enabledSlides[0])" :src="resolveContentImageUrl(enabledSlides[0].imageUrl)" alt="" @error="handleImageError" />
                            <div v-if="!enabledSlides.length" class="mini-empty">No hero slide enabled</div>
                        </div>

                        <div v-else-if="layoutSection.type === 'promoGrid'" class="mini-promo-grid" :class="`mini-promo-layout-${layoutSection.settings?.layout || 'mosaic'}`">
                            <div
                                v-for="(block, index) in previewPromoBlocks(layoutSection)"
                                :key="`${block.title || 'promo'}-${index}`"
                                :class="['mini-promo-tile', `mini-promo-height-${block.heightMode || 'ratio'}`, { 'mini-promo-image': block.imageUrl, 'mini-promo-clean': !shouldShowPromoText(block), 'mini-promo-linked': block.href }]"
                                :style="promoPreviewStyle(block)"
                            >
                                <div class="mini-promo-meta">
                                    <span>{{ promoPreviewLabel(block) }}</span>
                                    <span>{{ heightSummary(block, 'ratio') }}</span>
                                </div>
                                <img v-if="block.imageUrl && !shouldShowPromoText(block) && block.heightMode === 'auto'" :src="resolveContentImageUrl(block.imageUrl)" alt="" @error="handleImageError" />
                                <template v-if="shouldShowPromoText(block)">
                                    <span>{{ block.title }}</span>
                                    <strong>{{ block.value }}</strong>
                                </template>
                            </div>
                            <div v-if="!previewPromoBlocks(layoutSection).length" class="mini-list mini-empty">{{ t('adminContent.noPromoBlocks') }}</div>
                        </div>

                        <div v-else-if="layoutSection.type === 'categories'" class="mini-list">
                            <strong>{{ t('adminContent.popularCategories') }}</strong>
                            <span>{{ previewCategorySummary(layoutSection) }}</span>
                        </div>

                        <div v-else-if="layoutSection.type === 'productSections'" class="mini-list">
                            <strong>Product Sections</strong>
                            <span v-for="section in content.productSections.filter((item) => item.enabled !== false)" :key="section.id">{{ section.title }} / {{ section.mode }} / {{ productSectionLayoutSummary(section) }}</span>
                            <span v-if="!content.productSections.some((item) => item.enabled !== false)">{{ t('adminContent.noEnabledSections') }}</span>
                        </div>

                        <div v-else-if="layoutSection.type === 'footer'" class="mini-list mini-footer-preview">
                            <strong>Footer</strong>
                            <span>{{ siteName }} / {{ t('adminContent.footerPreview') }}</span>
                        </div>
                    </div>
                </div>

            </aside> -->
        </div>

        <Dialog v-model:visible="showProductPicker" modal :header="t('adminContent.productDialog')" :style="{ width: 'min(920px, 96vw)' }">
            <div class="picker-search">
                <InputText v-model="productSearch" :placeholder="t('adminContent.productSearchPlaceholder')" :aria-label="t('adminContent.productSearchPlaceholder')" @keydown.enter="loadProducts" />
                <Button icon="pi pi-search" :label="t('adminContent.search')" @click="loadProducts" />
            </div>
            <div class="product-picker-grid">
                <button
                    v-for="product in products"
                    :key="product.item_code"
                    type="button"
                    :class="['product-pick-card', isProductSelected(product.item_code) ? 'active' : '']"
                    :aria-label="`${isProductSelected(product.item_code) ? 'Remove product' : 'Select product'} ${product.item_name || product.item_code}`"
                    :aria-pressed="isProductSelected(product.item_code)"
                    @click="toggleSectionProduct(product.item_code)"
                >
                    <img :src="product.image" :alt="product.item_name" @error="handleImageError" />
                    <span>{{ product.item_name }}</span>
                    <small>{{ product.item_code }}</small>
                </button>
            </div>
        </Dialog>

        <Dialog v-model:visible="showMediaPicker" modal :header="t('adminContent.mediaDialog')" :style="{ width: 'min(980px, 96vw)' }">
            <div class="media-dialog-head">
                <span>{{ t('adminContent.files', { count: mediaAssets.length }) }}</span>
                <Button :label="t('common.reload')" icon="pi pi-refresh" text @click="loadMediaAssets" />
            </div>
            <div v-if="mediaAssets.length" class="media-picker-grid">
                <button v-for="asset in mediaAssets" :key="asset.name" type="button" class="media-pick-card" :aria-label="`${t('adminContent.chooseFromLibrary')} ${asset.name}`" @click="selectMedia(asset)">
                    <img :src="resolveMediaAssetUrl(asset)" :alt="asset.name" @error="handleImageError" />
                    <span>{{ asset.name }}</span>
                    <small>{{ Math.round((asset.size || 0) / 1024) }} KB</small>
                    <div class="media-card-actions" @click.stop>
                        <Button icon="pi pi-pencil" text rounded size="small" :aria-label="`${t('adminContent.rename')} ${asset.name}`" v-tooltip.top="t('adminContent.rename')" @click="openRenameMedia(asset, $event)" />
                        <Button icon="pi pi-trash" severity="danger" text rounded size="small" :aria-label="`${t('adminContent.deleteImage')} ${asset.name}`" v-tooltip.top="t('adminContent.deleteImage')" @click="confirmDeleteMedia(asset, $event)" />
                    </div>
                </button>
            </div>
            <div v-else class="empty-media">
                {{ t('adminContent.emptyMediaUploadHint') }}
            </div>
        </Dialog>

        <Dialog v-model:visible="showRenameMediaDialog" modal :header="t('adminContent.renameDialog')" :style="{ width: 'min(520px, 94vw)' }">
            <div class="rename-dialog-body">
                <label>
                    {{ t('adminContent.newFileName') }}
                    <InputText v-model="renameMediaName" :aria-label="t('adminContent.newFileName')" autofocus />
                </label>
                <small>{{ t('adminContent.renameHint') }}</small>
            </div>
            <template #footer>
                <Button :label="t('common.cancel')" text @click="showRenameMediaDialog = false" />
                <Button :label="t('adminContent.saveNewName')" icon="pi pi-save" @click="renameMedia" />
            </template>
        </Dialog>

        <Dialog v-model:visible="showAlertPopupTest" modal :showHeader="false" contentClass="alert-test-dialog-content" :style="alertPopupTestStyle">
            <button v-if="alertPopupTestConfig.showCloseButton" type="button" class="alert-test-close" aria-label="Close" @click="showAlertPopupTest = false">
                <i class="pi pi-times"></i>
            </button>
            <a
                v-if="getAlertPopupHref(alertPopupTestConfig)"
                class="alert-test-image-link"
                :href="getAlertPopupHref(alertPopupTestConfig)"
                :target="alertPopupTestConfig.target"
                :rel="alertPopupTestConfig.target === '_blank' ? 'noopener noreferrer' : null"
                @click="showAlertPopupTest = false"
            >
                <img :src="alertPopupTestImageUrl" :alt="alertPopupTestConfig.imageAlt || alertPopupTestConfig.name || ''" :style="alertPopupTestImageStyle" @error="handleImageError" />
            </a>
            <img v-else :src="alertPopupTestImageUrl" :alt="alertPopupTestConfig.imageAlt || alertPopupTestConfig.name || ''" :style="alertPopupTestImageStyle" @error="handleImageError" />
        </Dialog>
    </main>
</template>

<style scoped>
.admin-content-page {
    min-height: 100vh;
    padding: 1rem 0 2rem;
    color: var(--market-text, #2f2412);
}

.admin-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-end;
    margin-bottom: 1rem;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    padding: 1rem;
    background: linear-gradient(135deg, var(--market-card-bg, #fffdf8) 0%, var(--market-surface-soft, #fff4d8) 100%);
}

.admin-head p {
    margin: 0;
    color: var(--market-primary, #b28b46);
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.admin-head h1 {
    margin: 0.15rem 0;
    font-size: clamp(1.55rem, 3vw, 2.3rem);
}

.admin-head span {
    color: var(--market-muted, #8b7a5c);
}

.admin-actions {
    display: flex;
    gap: 0.5rem;
}

.admin-link-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--p-button-outlined-primary-border-color, #0f9f6e);
    border-radius: var(--p-button-border-radius, 6px);
    color: var(--p-button-outlined-primary-color, #0f9f6e);
    background: transparent;
    font-weight: 700;
    text-decoration: none;
}

.admin-link-button:hover {
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 8%, transparent);
}

.admin-loading {
    display: grid;
    place-items: center;
    gap: 1rem;
    min-height: 20rem;
}

.admin-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
}

.admin-panel {
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    background: var(--market-card-bg, #fffdf8);
    padding: 1rem;
    /* กล่องนี้เป็นลูกของ .admin-grid ซึ่งเป็น grid — grid item มี min-width: auto เป็นค่าเริ่มต้น
       แปลว่ามันจะไม่ยอมหดต่ำกว่าความกว้างเนื้อหาข้างใน แถบแท็บด้านในกว้างรวม 883px
       จึงดันทั้งหน้าให้กว้างตาม (วัดได้ล้น 430px ที่จอ 414) และ overflow-x: auto
       ของแถบแท็บก็ไม่ทำงานเพราะตัวมันเองไม่เคยแคบกว่าเนื้อหา */
    min-width: 0;
}

.panel-title-row,
.editor-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}

.panel-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
}

.alert-popup-status-card {
    display: grid;
    gap: 0.8rem;
    margin-bottom: 1rem;
    border: 1px solid color-mix(in srgb, var(--market-card-border, #efe3c8) 76%, var(--market-primary, #0f9f6e));
    border-radius: 0.9rem;
    padding: 0.9rem;
    background: color-mix(in srgb, var(--market-card-bg, #fffdf8) 90%, var(--market-primary, #0f9f6e) 10%);
}

.alert-status-main {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
}

.alert-status-main i {
    margin-top: 0.1rem;
    color: var(--market-primary, #0f9f6e);
    font-size: 1.35rem;
}

.alert-status-main strong {
    display: block;
    color: var(--market-text, #2f2412);
}

.alert-status-main span,
.alert-status-grid span {
    color: var(--market-muted, #8b7a5c);
    line-height: 1.45;
}

.alert-status-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
}

.alert-status-grid b {
    display: block;
    color: var(--market-text, #2f2412);
    font-size: 0.74rem;
    text-transform: uppercase;
}

.alert-status-disabled {
    background: #f8fafc;
}

.alert-status-upcoming {
    background: #eff6ff;
}

.alert-status-expired,
.alert-status-invalid {
    background: #fff1f2;
}

.alert-status-expired .alert-status-main i,
.alert-status-invalid .alert-status-main i {
    color: #e11d48;
}

.muted-text {
    color: var(--market-muted, #8b7a5c);
    font-size: 0.82rem;
}

.layout-section-list {
    display: grid;
    gap: 0.75rem;
}

.layout-section-card {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    gap: 0.85rem;
    align-items: center;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fffdf8);
    padding: 0.85rem;
    transition:
        border-color 150ms ease,
        box-shadow 150ms ease,
        opacity 150ms ease,
        transform 150ms ease;
}

.layout-section-card.dragging {
    opacity: 0.7;
    transform: scale(0.995);
}

.layout-section-card.drop-target {
    border-color: var(--p-primary-color, #0f9f6e);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color, #0f9f6e) 15%, transparent);
}

.layout-drag-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.7rem;
    background: var(--market-card-bg, #ffffff);
    color: var(--market-muted, #8b7a5c);
    cursor: grab;
}

.layout-drag-handle:active {
    cursor: grabbing;
}

.layout-drag-handle:hover {
    border-color: var(--p-primary-color, #0f9f6e);
    color: var(--p-primary-color, #0f9f6e);
}

.layout-section-index {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    background: var(--market-primary-soft, #fff3d6);
    color: var(--market-primary, #9a6b18);
    font-weight: 900;
}

.layout-section-info {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
}

.layout-section-info strong {
    color: var(--market-text, #2f2412);
}

.layout-section-info span {
    color: var(--market-muted, #8b7a5c);
}

.layout-section-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
}

.layout-section-settings {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--market-card-border, #eadcbc);
}

.layout-section-settings label {
    display: grid;
    gap: 0.35rem;
    color: var(--market-text, #5b4a27);
    font-size: 0.82rem;
    font-weight: 800;
}

.layout-section-settings select,
.layout-section-settings input {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--market-card-border, #e5d6b8);
    border-radius: 0.6rem;
    background: var(--market-card-bg, #fff);
    padding: 0.58rem 0.65rem;
    color: var(--market-text, #2f2412);
}

.layout-drag-hint {
    margin: 0.75rem 0 0;
    color: var(--market-muted, #8b7a5c);
    font-size: 0.85rem;
}

.theme-preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.theme-preset-card {
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 0.85rem;
    background: var(--market-card-bg, #fffdf8);
    padding: 0.85rem;
    text-align: left;
    cursor: pointer;
    transition:
        border-color 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
}

.theme-preset-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 20px var(--market-shadow, rgba(126, 87, 31, 0.12));
}

.theme-preset-card.active {
    border-color: var(--p-primary-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color) 20%, transparent);
}

.theme-preset-swatches {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
}

.theme-preset-swatches i {
    width: 1.45rem;
    height: 1.45rem;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 999px;
}

.theme-color-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
}

.theme-color-grid label {
    display: grid;
    gap: 0.35rem;
    color: var(--market-text, #5b4a27);
    font-weight: 800;
}

.color-input-row {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 0.45rem;
    align-items: center;
}

.color-input-row input[type='color'] {
    width: 3rem;
    height: 2.55rem;
    border: 1px solid var(--market-card-border, #e5d6b8);
    border-radius: 0.55rem;
    background: var(--market-card-bg, #fff);
    padding: 0.15rem;
}

.theme-preview {
    overflow: hidden;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    background: var(--theme-preview-page-bg, var(--market-page-bg, #fff8ee));
}

.theme-preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.85rem 1rem;
    background: var(--theme-preview-header-bg);
    color: var(--theme-preview-header-text);
}

.theme-preview-header button,
.theme-preview-primary,
.theme-preview-accent {
    border: 0;
    border-radius: 999px;
    padding: 0.5rem 0.8rem;
    color: #fff;
    font-weight: 800;
}

.theme-preview-header button,
.theme-preview-primary {
    background: var(--theme-preview-primary);
}

.theme-preview-body {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    padding: 1rem;
    background: var(--theme-preview-page-bg, #fff8ee);
}

.theme-preview-card {
    width: 11rem;
    border: 1px solid var(--theme-preview-card-border);
    border-radius: 0.8rem;
    background: var(--theme-preview-card-bg);
    padding: 0.7rem;
}

.theme-preview-card div {
    height: 4rem;
    border-radius: 0.6rem;
    background: var(--theme-preview-product-image-bg, color-mix(in srgb, var(--theme-preview-primary) 13%, #fff));
}

.theme-preview-card strong,
.theme-preview-card span {
    display: block;
    margin-top: 0.45rem;
}

.theme-preview-card span {
    color: var(--theme-preview-primary);
    font-weight: 900;
}

.theme-preview-accent {
    background: var(--theme-preview-accent);
}

.theme-preview-footer {
    padding: 0.85rem 1rem;
    background: var(--theme-preview-footer-bg);
    color: var(--theme-preview-footer-text);
    font-weight: 700;
}

.panel-title-row h2 {
    margin: 0;
    font-size: 1.2rem;
}

.preview-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}

.preview-head span,
.live-preview-toolbar span {
    color: var(--market-muted, #8b7a5c);
    font-size: 0.78rem;
}

.preview-device-toggle {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 999px;
    background: var(--market-card-bg, #fff);
}

.preview-device-toggle button {
    border: 0;
    background: transparent;
    color: var(--market-muted, #8b7a5c);
    cursor: pointer;
    padding: 0.38rem 0.65rem;
    font-size: 0.76rem;
    font-weight: 800;
}

.preview-device-toggle button.active {
    background: var(--market-primary, #10b981);
    color: #fff;
}

.mini-layout-preview {
    display: grid;
    gap: 0.75rem;
}

.live-preview-card {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.85rem;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    padding: 0.65rem;
}

.live-preview-frame-scroll {
    overflow: auto;
    max-width: 100%;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 0.7rem;
    background: #fff;
}

.live-preview-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
}

.live-preview-card iframe {
    display: block;
    width: 1200px;
    max-width: none;
    height: 31rem;
    border: 0;
    background: #fff;
}

.live-preview-mobile iframe {
    width: 390px;
    height: 36rem;
}

.mini-layout-section {
    --mini-section-radius: 16px;
}

.mini-layout-width-wide {
    margin-right: -0.35rem;
    margin-left: -0.35rem;
}

.mini-layout-width-full {
    margin-right: -1rem;
    margin-left: -1rem;
}

.mini-layout-width-full .mini-hero,
.mini-layout-width-full .mini-list {
    border-right: 0;
    border-left: 0;
}

.editor-card {
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 0.9rem;
    background: var(--market-surface-soft, #fffaf0);
    padding: 0.85rem;
    margin-bottom: 0.85rem;
}

.editor-card-actions,
.switch-line {
    display: flex;
    align-items: center;
    gap: 0.55rem;
}

.editor-card-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
}

.switch-line {
    color: var(--market-muted, #8b7a5c);
    font-size: 0.85rem;
}

.form-grid .switch-line {
    display: flex;
    align-items: center;
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
}

.form-grid label,
.upload-line {
    display: grid;
    gap: 0.32rem;
    color: var(--market-text, #6f6046);
    font-size: 0.82rem;
    font-weight: 700;
}

.form-grid input,
.form-grid textarea,
.form-grid select {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--market-card-border, #d9c99e);
    border-radius: 0.55rem;
    background: var(--market-card-bg, #fff);
    padding: 0.62rem 0.7rem;
    color: var(--market-text, #2f2412);
}

.field-hint {
    color: var(--market-muted, #8b7a5c);
    font-size: 0.74rem;
    font-weight: 600;
    line-height: 1.35;
}

.color-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 0.65rem;
    align-items: end;
}

.color-control {
    display: grid;
    grid-template-columns: 3.25rem minmax(0, 1fr);
    gap: 0.45rem;
    align-items: center;
}

.form-grid .color-control input[type='color'] {
    width: 3.25rem;
    height: 2.55rem;
    padding: 0.2rem;
}

.limit-input {
    max-width: 100%;
}

.span-2 {
    grid-column: 1 / -1;
}

.image-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
}

.image-tools span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    color: var(--market-muted, #8b7a5c);
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.promo-overlay-switch {
    display: flex !important;
    align-items: center;
    align-self: end;
    min-height: 2.75rem;
}

.library-upload {
    display: grid;
    gap: 0.35rem;
    margin-bottom: 1rem;
    border: 1px dashed var(--market-card-border, #d9c99e);
    border-radius: 0.85rem;
    background: var(--market-surface-soft, #fffaf0);
    padding: 0.8rem;
    color: var(--market-text, #6f6046);
    font-size: 0.86rem;
    font-weight: 700;
}

.category-picker-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
}

.pick-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 999px;
    background: var(--market-card-bg, #fff);
    color: var(--market-text, #6f6046);
    padding: 0.5rem 0.75rem;
    cursor: pointer;
}

.pick-chip-label {
    min-width: 0;
}

.pick-chip-order {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.65rem;
    height: 1.35rem;
    border-radius: 999px;
    background: var(--market-primary, #10b981);
    color: #fff;
    padding: 0 0.42rem;
    font-size: 0.72rem;
    font-weight: 900;
    line-height: 1;
}

.pick-chip.active {
    border-color: var(--market-primary, #10b981);
    background: var(--market-primary-soft, #ecfdf5);
    color: var(--market-primary, #047857);
}

.selected-category-order-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.55rem;
    margin-top: 0.9rem;
}

.selected-category-order-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: var(--market-radius, 0.9rem);
    background: color-mix(in srgb, var(--market-card-bg, #fff) 88%, var(--market-primary-soft, #ecfdf5));
    padding: 0.65rem 0.75rem;
}

.selected-category-order-no {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: var(--market-primary, #10b981);
    color: #fff;
    font-size: 0.82rem;
    font-weight: 900;
}

.selected-category-order-row strong,
.selected-category-order-row small {
    display: block;
}

.selected-category-order-row strong {
    color: var(--market-heading, #1f2937);
    font-size: 0.9rem;
}

.selected-category-order-row small {
    margin-top: 0.08rem;
    color: var(--market-muted, #8b7a5c);
    font-size: 0.75rem;
}

.manual-products {
    display: grid;
    gap: 0.55rem;
    justify-items: start;
}

.selected-products {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.selected-products span {
    color: var(--market-muted, #8b7a5c);
}

.mini-hero {
    display: grid;
    gap: 0.8rem;
    border-radius: var(--mini-section-radius, 0.9rem);
    padding: 1rem;
    background: linear-gradient(135deg, #fff2c9 0%, #f9c76d 100%);
    background-position: center;
    background-size: cover;
}

.mini-preview-badges,
.mini-promo-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    position: relative;
    z-index: 2;
}

.mini-preview-badges span,
.mini-promo-meta span {
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e5d4ad) 72%, transparent);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.78);
    color: var(--market-muted, #6f6046);
    padding: 0.18rem 0.45rem;
    font-size: 0.66rem;
    font-weight: 800;
    line-height: 1.1;
}

.mini-hero-ratio {
    aspect-ratio: var(--mini-hero-aspect-ratio, 21 / 8);
    min-height: 0;
}

.mini-hero-fixed {
    min-height: var(--mini-hero-fixed-height, 140px);
}

.mini-hero-image-only {
    padding: 0;
    background-color: #fff;
    background-repeat: no-repeat;
}

.mini-hero p {
    margin: 0;
    color: var(--hero-custom-text, #8b5e13);
    font-size: 0.72rem;
    font-weight: 900;
}

.mini-hero h3 {
    margin: 0.15rem 0;
    color: var(--hero-custom-text, #2f2412);
    font-size: 1.35rem;
}

.mini-hero span {
    display: -webkit-box;
    overflow: hidden;
    color: var(--hero-custom-text, #6f6046);
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
}

.mini-hero-button {
    width: fit-content;
    margin-top: 0.65rem;
    border: 1px solid #10b981;
    border-radius: 999px;
    background: #10b981;
    color: #fff;
    padding: 0.45rem 0.8rem;
    font-weight: 800;
}

.mini-hero img {
    width: 100%;
    max-height: 9rem;
    border-radius: max(0px, calc(var(--mini-section-radius, 14px) - 4px));
    object-fit: cover;
}

.mini-hero-background {
    min-height: 12rem;
    align-content: center;
}

.mini-hero-image-only.mini-hero-background {
    min-height: 8rem;
}

.mini-hero-background p,
.mini-hero-background h3,
.mini-hero-background span {
    color: var(--hero-custom-text, #fff);
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.32);
}

.mini-promo-grid {
    display: grid;
    grid-template-columns: repeat(var(--mini-promo-grid-columns, 3), minmax(0, 1fr));
    grid-auto-flow: dense;
    grid-auto-rows: auto;
    gap: var(--mini-promo-grid-gap, 0.55rem);
    margin-top: 0;
}

.mini-promo-layout-equal .mini-promo-tile,
.mini-promo-layout-row .mini-promo-tile {
    grid-column: span 1;
    grid-row: span 1;
}

.mini-promo-layout-row {
    grid-auto-flow: column;
    grid-auto-columns: minmax(7.5rem, 1fr);
    grid-template-columns: none;
    overflow-x: auto;
    padding-bottom: 0.25rem;
}

.mini-promo-tile,
.mini-list {
    border: 1px solid #efe3c8;
    border-radius: var(--mini-section-radius, 0.75rem);
    background: #fffaf0;
    padding: 0.75rem;
}

.mini-promo-tile {
    grid-column: span var(--promo-col-span, 1);
    grid-row: span var(--promo-row-span, 1);
    min-height: calc(4.75rem * var(--promo-row-span, 1));
    overflow: hidden;
    background-position: center;
    background-repeat: no-repeat;
    display: grid;
    align-content: start;
    gap: 0.35rem;
}

.mini-promo-height-fixed {
    min-height: var(--promo-preview-fixed-height, 90px);
    height: var(--promo-preview-fixed-height, 90px);
}

.mini-promo-height-ratio {
    min-height: auto;
    aspect-ratio: var(--promo-preview-aspect-ratio, 16 / 5);
}

.mini-promo-height-auto {
    min-height: auto;
}

.mini-promo-tile img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: inherit;
}

.mini-promo-linked {
    box-shadow: inset 0 0 0 2px rgba(16, 185, 129, 0.18);
}

.mini-promo-clean .mini-promo-meta {
    padding: 0.4rem;
}

.mini-promo-image {
    color: #fff;
}

.mini-promo-clean {
    padding: 0;
    background-color: #fff;
}

.mini-promo-grid span,
.mini-list span {
    display: block;
    color: var(--promo-preview-text-color, #8b7a5c);
    font-size: 0.82rem;
}

.mini-promo-image span,
.mini-promo-image strong {
    color: var(--promo-preview-text-color, #fff);
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
}

.mini-promo-tile strong {
    color: var(--promo-preview-text-color, var(--market-text, #5b4a27));
}

.mini-list {
    display: grid;
    gap: 0.35rem;
    margin-top: 0;
}

.mini-empty {
    grid-column: 1 / -1;
}

.mini-footer-preview {
    background: var(--market-footer-bg, #fff7e6);
}

.picker-search {
    display: flex;
    gap: 0.55rem;
    margin-bottom: 0.85rem;
}

.picker-search .p-inputtext {
    flex: 1;
}

.product-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.65rem;
    max-height: 62vh;
    overflow: auto;
}

.product-pick-card {
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 0.8rem;
    background: var(--market-card-bg, #fff);
    padding: 0.6rem;
    text-align: left;
    cursor: pointer;
}

.product-pick-card.active {
    border-color: #10b981;
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.14);
}

.product-pick-card img {
    width: 100%;
    height: 6.5rem;
    border-radius: 0.55rem;
    background: #fffaf0;
    object-fit: contain;
}

.product-pick-card span {
    display: -webkit-box;
    min-height: 2.5rem;
    margin-top: 0.45rem;
    overflow: hidden;
    font-weight: 700;
    line-height: 1.25;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.product-pick-card small {
    color: #8b7a5c;
}

.media-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
    color: #8b7a5c;
}

.media-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
    max-height: 65vh;
    overflow: auto;
}

.media-library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.75rem;
}

.media-library-card {
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 0.85rem;
    background: var(--market-card-bg, #fff);
    padding: 0.6rem;
    min-width: 0;
}

.media-pick-card {
    border: 1px solid #e5d4ad;
    border-radius: 0.85rem;
    background: #fff;
    padding: 0.55rem;
    text-align: left;
    cursor: pointer;
    transition: transform 160ms ease, box-shadow 160ms ease;
}

.media-pick-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px var(--market-shadow, rgba(126, 87, 31, 0.14));
}

.media-pick-card img {
    width: 100%;
    height: 7rem;
    border-radius: 0.65rem;
    background: var(--market-surface-soft, #fffaf0);
    object-fit: cover;
}

.media-library-card img {
    width: 100%;
    height: 7rem;
    border-radius: 0.65rem;
    background: var(--market-surface-soft, #fffaf0);
    object-fit: cover;
}

.media-pick-card span,
.media-library-card strong {
    display: block;
    margin-top: 0.45rem;
    overflow: hidden;
    color: var(--market-text, #2f2412);
    font-size: 0.82rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.media-pick-card small,
.media-library-card span,
.empty-media {
    color: var(--market-muted, #8b7a5c);
}

.media-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.2rem;
    margin-top: 0.35rem;
}

.rename-dialog-body {
    display: grid;
    gap: 0.65rem;
}

.rename-dialog-body label {
    display: grid;
    gap: 0.35rem;
    color: #6f6046;
    font-size: 0.86rem;
    font-weight: 700;
}

.rename-dialog-body small {
    color: #8b7a5c;
    line-height: 1.45;
}

.empty-media {
    border: 1px dashed #ddc48c;
    border-radius: 0.85rem;
    padding: 1.2rem;
    background: #fffaf0;
    text-align: center;
}

.alert-popup-preview {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
    border: 1px solid var(--market-card-border, #e5d4ad);
    border-radius: 0.9rem;
    padding: 1rem;
    background: color-mix(in srgb, var(--market-card-bg, #fffdf8) 88%, var(--market-primary, #0f9f6e) 12%);
}

.alert-popup-preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--market-text, #2f2412);
}

.alert-popup-preview-head span {
    color: var(--market-muted, #8b7a5c);
    font-size: 0.82rem;
    font-weight: 700;
}

.alert-popup-preview-stage {
    position: relative;
    width: min(100%, 34rem);
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e5d4ad) 70%, transparent);
    background: rgba(15, 23, 42, 0.08);
}

.alert-popup-preview-stage img {
    display: block;
    width: 100%;
    max-height: 22rem;
    object-fit: contain;
}

.alert-popup-preview-close {
    position: absolute;
    top: 0.55rem;
    right: 0.55rem;
    z-index: 1;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.72);
    color: #fff;
    cursor: default;
    font-size: 1.35rem;
    line-height: 1;
}

:deep(.alert-test-dialog-content) {
    position: relative;
    overflow: visible;
    padding: 0;
    border-radius: inherit;
    background: transparent;
    box-shadow: none;
}

.alert-test-image-link,
:deep(.alert-test-dialog-content) img {
    display: block;
}

.alert-test-image-link {
    color: inherit;
    text-decoration: none;
}

:deep(.alert-test-dialog-content) img {
    width: 100%;
    height: auto;
    object-fit: contain;
    border-radius: inherit;
}

.alert-test-close {
    position: absolute;
    top: -0.85rem;
    right: -0.85rem;
    z-index: 2;
    width: 2.4rem;
    height: 2.4rem;
    border: 1px solid rgba(226, 232, 240, 0.96);
    border-radius: 999px;
    background: #fff;
    color: #0f172a;
    cursor: pointer;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.22);
}

@media (max-width: 980px) {
    .admin-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .admin-head,
    .panel-title-row,
    .editor-card-head,
    .admin-actions,
    .picker-search {
        align-items: stretch;
        flex-direction: column;
    }

    .form-grid {
        grid-template-columns: 1fr;
    }

    .alert-status-grid {
        grid-template-columns: 1fr;
    }

    .color-grid {
        grid-template-columns: 1fr;
    }

    .layout-section-card {
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.65rem;
    }

    .layout-section-index {
        grid-column: 1;
        grid-row: 2;
    }

    .layout-section-info {
        grid-column: 2;
        grid-row: 1 / span 2;
    }

    .layout-section-actions {
        grid-column: 1 / -1;
        justify-content: flex-start;
        flex-wrap: wrap;
        white-space: normal;
    }

    .layout-section-settings {
        grid-template-columns: 1fr;
    }

    .live-preview-card iframe {
        width: 960px;
    }

    .live-preview-mobile iframe {
        width: 390px;
    }
}
</style>

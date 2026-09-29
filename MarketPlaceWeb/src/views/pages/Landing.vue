<script setup>
import ProductCard from '@/components/product/ProductCard.vue';
import CategoryService from '@/services/CategoryService';
import CompanyService from '@/services/CompanyService';
import ContentService from '@/services/ContentService';
import ProductService from '@/services/ProductService';
import lineQrImage from '@/assets/line.png';
import returnIcon from '@/assets/retun.png';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import { useLanguageStore } from '@/stores/languageStore';
import { getHeroBackgroundImageUrl, heroHasVisibleText as shouldShowHeroText, shouldRenderHeroMedia } from '@/utils/heroSlideImages';
import { pickMasterName, pickProductName } from '@/utils/languageDisplay';
import { resolveHomeProductSections } from '@/utils/homeSections';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const languageStore = useLanguageStore();
const t = languageStore.t;
const siteName = import.meta.env.VITE_APP_NAME || 'MarketPlace';

const loading = ref(true);
const content = ref(null);
const categories = ref([]);
const categoryRows = ref([]);
const productRows = ref([]);
const companyProfile = ref({
    company_name: import.meta.env.VITE_APP_COMPANY_NAME || '',
    address: import.meta.env.VITE_APP_ADDRESS || '',
    telephone_number: import.meta.env.VITE_APP_PHONE || ''
});
const activeSlide = ref(0);
const heroTimer = ref(null);
const alertPopupTimer = ref(null);
const alertPopupVisible = ref(false);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);
const selectedProductCode = ref('');
let priceLoadToken = 0;

const appLogo = computed(() => resolvePublicAsset(import.meta.env.VITE_APP_LOGO || ''));
const lineContactUrl = computed(() => import.meta.env.VITE_APP_LINE_URL || '');
const displayCompanyName = computed(() => import.meta.env.VITE_APP_COMPANY_NAME || companyProfile.value.company_name || companyProfile.value.company_name_1 || siteName);
const displayCompanyAddress = computed(() => companyProfile.value.address || companyProfile.value.address_1 || '');
const displayCompanyPhone = computed(() => import.meta.env.VITE_APP_PHONE || companyProfile.value.telephone_number || companyProfile.value.tel || companyProfile.value.phone || '');
const currentYear = new Date().getFullYear();

const fallbackContent = {
    // ⚠️ ต้องตรงกับ styles.scss (:root) และ AppLayout.vue (defaultTheme) เป๊ะทั้ง 3 ที่
    theme: {
        preset: 'cleanGreen',
        basePreset: 'cleanGreen',
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
    },
    homeLayout: [
        { type: 'hero', enabled: true, settings: { width: 'boxed', radius: 20, height: 'normal' } },
        { type: 'promoGrid', enabled: true, settings: { width: 'boxed', radius: 16, layout: 'mosaic', maxItems: 4, desktopColumns: 3, tabletColumns: 2, mobileColumns: 1, gap: 14 } },
        { type: 'categories', enabled: true, settings: { width: 'boxed', radius: 16, maxItems: 6, density: 'comfortable' } },
        { type: 'productSections', enabled: true, settings: { width: 'boxed', radius: 14, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144 } },
        { type: 'footer', enabled: true, settings: { width: 'boxed', radius: 20 } }
    ],
    slides: [
        {
            eyebrow: 'ONLINE MARKETPLACE',
            title: siteName,
            subtitle: 'เลือกสินค้า ตรวจราคา เพิ่มลงตะกร้า และส่งคำสั่งซื้อได้สะดวกผ่านหน้าร้านออนไลน์',
            ctaLabel: 'ดูสินค้า',
            href: '/marketplace',
            imageUrl: '',
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
            badge: 'พร้อมสั่งซื้อ',
            discountText: 'สินค้าและราคาจากระบบจริง',
            tone: 'teal',
            layout: 'split',
            contentPosition: 'left',
            imagePosition: 'right',
            enabled: true
        }
    ],
    promoBlocks: [],
    alertPopup: {
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
        device: 'all'
    },
    categoryCodes: [],
    productSections: [
        { id: 'promotion', title: 'โปรโมชัน', subtitle: 'สินค้าร่วมโปรที่น่าสนใจ', mode: 'promotion', limit: 8, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144, enabled: true },
        { id: 'new', title: 'สินค้าใหม่', subtitle: 'รายการมาใหม่จากร้าน', mode: 'new', limit: 8, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144, enabled: true },
        { id: 'recommended', title: 'สินค้าแนะนำ', subtitle: 'รายการที่พร้อมให้เลือกซื้อ', mode: 'recommend', limit: 8, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144, enabled: true }
    ]
};

const homeContent = computed(() => content.value || fallbackContent);
const homeLayout = computed(() => normalizeHomeLayout(homeContent.value.homeLayout));
const heroLayoutSettings = computed(() => getLayoutSettings('hero'));
const promoLayoutSettings = computed(() => getLayoutSettings('promoGrid'));
const categoryLayoutSettings = computed(() => getLayoutSettings('categories'));
const productLayoutSettings = computed(() => getLayoutSettings('productSections'));
const slides = computed(() => (homeContent.value.slides || []).filter((slide) => slide.enabled !== false));
// (เดิมมี currentSlide สำหรับ render สไลด์ทีละใบ — ตอนนี้ render ทุกใบในแถบเลื่อนแล้ว
//  ตำแหน่งปัจจุบันใช้ activeSlide ตัวเดียวพอ)
const promoBlocks = computed(() => (homeContent.value.promoBlocks || []).filter((block) => block.enabled !== false).slice(0, clampNumber(promoLayoutSettings.value.maxItems, 1, 8, 4)));
const alertPopupConfig = computed(() => normalizeAlertPopup(homeContent.value.alertPopup));
const alertPopupImageUrl = computed(() => resolveContentImageUrl(alertPopupConfig.value.imageUrl));
const activeAlertPopup = computed(() => (isAlertPopupEligible(alertPopupConfig.value) ? alertPopupConfig.value : null));
const alertPopupDialogStyle = computed(() => {
    const popup = alertPopupConfig.value;
    const width = isMobileViewport() ? popup.mobileWidth : popup.desktopWidth;
    return {
        width: `min(${width}px, calc(100vw - 2rem))`,
        maxHeight: `${popup.maxHeightVh}vh`,
        borderRadius: `${popup.borderRadius}px`
    };
});
const alertPopupImageStyle = computed(() => ({
    maxHeight: `${alertPopupConfig.value.maxHeightVh}vh`
}));
const isAuthenticated = computed(() => !!localStorage.getItem('_token'));
const numberLocale = computed(() => (languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'));
// ── สไตล์ของสไลด์ hero ───────────────────────────────────────────────────
//
// เดิมทุกตัวเป็น computed ที่อ่าน currentSlide เพราะหน้าแรก render ทีละสไลด์
// พอเปลี่ยนเป็นแถบเลื่อน (scroll-snap) ที่ render ทุกสไลด์พร้อมกัน จึงต้องคำนวณต่อสไลด์
// ⚠️ คงตัว computed เดิมไว้ทั้งหมดในรูปตัวห่อบางๆ — ค่าที่แอดมินตั้ง (--hero-*) ยังทำงานเหมือนเดิม
function heroMobileFullImageUrlFor(slide) {
    const s = slide || {};
    if (!isMobileViewport() || shouldShowHeroText(s)) return '';
    return resolveContentImageUrl(getHeroBackgroundImageUrl(s));
}
function useMobileFullHeroImageFor(slide) {
    return isFilled(heroMobileFullImageUrlFor(slide));
}
function heroBackgroundStyleFor(slide) {
    const s = slide || {};
    const rawBackgroundUrl = getHeroBackgroundImageUrl(s);
    const mobileFull = useMobileFullHeroImageFor(s);
    const style = {};
    if (!mobileFull) applyHeroSizing(style, s);
    if (s?.textColor) style['--hero-custom-text'] = s.textColor;
    if (!rawBackgroundUrl || mobileFull) return style;
    const imageUrl = resolveContentImageUrl(rawBackgroundUrl);
    style.backgroundImage = shouldShowHeroText(s) ? `linear-gradient(90deg, rgba(18, 13, 4, 0.66) 0%, rgba(18, 13, 4, 0.32) 48%, rgba(18, 13, 4, 0.08) 100%), url("${imageUrl}")` : `url("${imageUrl}")`;
    style.backgroundSize = s.imageFit === 'contain' ? 'contain' : 'cover';
    return style;
}
function heroPrimaryButtonStyleFor(slide) {
    const s = slide || {};
    const style = {};
    if (s.buttonColor) {
        style.background = s.buttonColor;
        style.backgroundColor = s.buttonColor;
        style.backgroundImage = 'none';
        style.borderColor = s.buttonColor;
        style['--p-button-primary-background'] = s.buttonColor;
        style['--p-button-primary-border-color'] = s.buttonColor;
        style['--p-button-primary-hover-background'] = s.buttonColor;
        style['--p-button-primary-hover-border-color'] = s.buttonColor;
    }
    if (s.buttonTextColor) style.color = s.buttonTextColor;
    return style;
}

// (เดิมมี computed ตัวห่อที่อ่าน currentSlide ไว้เผื่อ call site เก่า — เทมเพลตย้ายไปใช้
//  ฟังก์ชัน ...For(slide) หมดแล้ว จึงไม่เหลือใครเรียก ลบทิ้งไม่ให้เป็นโค้ดตาย)

const defaultLandingText = {
    heroSubtitle: 'เลือกสินค้า ตรวจราคา เพิ่มลงตะกร้า และส่งคำสั่งซื้อได้สะดวกผ่านหน้าร้านออนไลน์',
    viewProducts: 'ดูสินค้า',
    readyToOrder: 'พร้อมสั่งซื้อ',
    realProductsAndPrices: 'สินค้าและราคาจากระบบจริง',
    promotionTitle: 'โปรโมชัน',
    promotionSubtitle: 'สินค้าร่วมโปรที่น่าสนใจ',
    newProductTitle: 'สินค้าใหม่',
    newProductSubtitle: 'รายการมาใหม่จากร้าน',
    recommendedTitle: 'สินค้าแนะนำ',
    recommendedSubtitle: 'รายการที่พร้อมให้เลือกซื้อ'
};

function localizeDefaultText(value, fallbackKey) {
    if (!value) return t(`landing.${fallbackKey}`);
    return value === defaultLandingText[fallbackKey] ? t(`landing.${fallbackKey}`) : value;
}

function isFilled(value) {
    return String(value || '').trim().length > 0;
}

function getSlideSubtitle(slide) {
    if (!isFilled(slide?.subtitle)) return '';
    return localizeDefaultText(slide?.subtitle, 'heroSubtitle');
}

function getSlideCtaLabel(slide) {
    if (!isFilled(slide?.ctaLabel)) return '';
    return localizeDefaultText(slide?.ctaLabel, 'viewProducts');
}

function getSlideBadge(slide) {
    if (!isFilled(slide?.badge)) return '';
    return localizeDefaultText(slide?.badge, 'readyToOrder');
}

function getSlideDiscountText(slide) {
    if (!isFilled(slide?.discountText)) return '';
    return localizeDefaultText(slide?.discountText, 'realProductsAndPrices');
}

function shouldShowHeroPrimaryAction(slide) {
    return shouldShowHeroText(slide) && isFilled(slide?.ctaLabel) && isFilled(slide?.href);
}

function applyHeroSizing(style, slide = {}) {
    const mode = slide.heightMode || 'preset';
    if (mode === 'fixed') {
        style['--hero-fixed-height'] = `${clampNumber(slide.desktopHeight, 120, 900, 420)}px`;
        style['--hero-fixed-height-mobile'] = `${clampNumber(slide.mobileHeight, 100, 640, 240)}px`;
    }
    if (mode === 'ratio' && isFilled(slide.aspectRatio) && slide.aspectRatio !== 'auto') {
        style['--hero-aspect-ratio'] = String(slide.aspectRatio).replace('/', ' / ');
    }
}

function getSectionTitle(section) {
    if (section?.id === 'promotion' || section?.mode === 'promotion') return localizeDefaultText(section?.title, 'promotionTitle');
    if (section?.id === 'recommended' || section?.mode === 'recommend') return localizeDefaultText(section?.title, 'recommendedTitle');
    if (section?.id === 'new' || section?.mode === 'new') return localizeDefaultText(section?.title, 'newProductTitle');
    return section?.title || '';
}

function getSectionSubtitle(section) {
    if (section?.id === 'promotion' || section?.mode === 'promotion') return localizeDefaultText(section?.subtitle, 'promotionSubtitle');
    if (section?.id === 'recommended' || section?.mode === 'recommend') return localizeDefaultText(section?.subtitle, 'recommendedSubtitle');
    if (section?.id === 'new' || section?.mode === 'new') return localizeDefaultText(section?.subtitle, 'newProductSubtitle');
    return section?.subtitle || '';
}

function getCategoryDisplayName(cat) {
    return pickMasterName(cat, languageStore.locale) || cat?.display_name || cat?.name || cat?.name_1 || '';
}

function getProductDisplayName(product) {
    return pickProductName(product, languageStore.locale) || product?.display_name || product?.item_name || product?.name || '';
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

function resolvePublicAsset(value) {
    const asset = String(value || '').trim();
    if (!asset) return '';
    if (/^(https?:|data:|blob:)/i.test(asset)) return asset;
    if (asset.startsWith('/')) return asset;
    return `${import.meta.env.BASE_URL || '/'}${asset}`;
}

function normalizeHomeLayout(value) {
    const defaultLayout = fallbackContent.homeLayout;
    const validTypes = new Set(defaultLayout.map((section) => section.type));
    const used = new Set();
    const rows = [];

    (Array.isArray(value) ? value : []).forEach((item) => {
        if (!validTypes.has(item?.type) || used.has(item.type)) return;
        used.add(item.type);
        rows.push({ type: item.type, enabled: item.enabled !== false, settings: normalizeLayoutSettings(item.type, item.settings) });
    });

    defaultLayout.forEach((item) => {
        if (!used.has(item.type)) rows.push({ ...item, settings: { ...item.settings } });
    });

    return rows.filter((item) => item.enabled !== false);
}

function normalizeLayoutSettings(type, settings) {
    const defaults = fallbackContent.homeLayout.find((item) => item.type === type)?.settings || {};
    const merged = { ...defaults, ...(settings || {}) };
    const radius = parseInt(merged.radius, 10);
    merged.radius = Number.isFinite(radius) ? Math.max(0, Math.min(radius, 40)) : defaults.radius || 0;
    if (type === 'productSections') {
        const gridColumns = parseInt(merged.gridColumns, 10);
        const cardRadius = parseInt(merged.cardRadius, 10);
        const imageHeight = parseInt(merged.imageHeight, 10);
        merged.display = ['slider', 'grid'].includes(merged.display) ? merged.display : 'slider';
        merged.gridColumns = Number.isFinite(gridColumns) ? Math.max(1, Math.min(gridColumns, 8)) : defaults.gridColumns || 4;
        merged.cardRadius = Number.isFinite(cardRadius) ? Math.max(0, Math.min(cardRadius, 40)) : defaults.cardRadius || 14;
        merged.imageHeight = Number.isFinite(imageHeight) ? Math.max(80, Math.min(imageHeight, 360)) : defaults.imageHeight || 144;
    }
    if (type === 'promoGrid') {
        merged.desktopColumns = clampNumber(merged.desktopColumns, 2, 6, defaults.desktopColumns || 3);
        merged.tabletColumns = Math.min(clampNumber(merged.tabletColumns, 1, 4, defaults.tabletColumns || 2), merged.desktopColumns);
        merged.mobileColumns = Math.min(clampNumber(merged.mobileColumns, 1, 2, defaults.mobileColumns || 1), merged.desktopColumns);
        merged.gap = clampNumber(merged.gap, 0, 40, defaults.gap || 14);
    }
    return merged;
}

function getLayoutSettings(type) {
    return homeLayout.value.find((item) => item.type === type)?.settings || normalizeLayoutSettings(type, {});
}

function clampNumber(value, min, max, fallback) {
    const numberValue = parseInt(value, 10);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(numberValue, max));
}

function normalizeAlertPopup(value = {}) {
    const defaults = fallbackContent.alertPopup || {};
    const popup = { ...defaults, ...(value || {}) };
    popup.target = ['_self', '_blank'].includes(popup.target) ? popup.target : '_self';
    popup.frequency = ['always', 'oncePerSession', 'oncePerDay', 'onceForever'].includes(popup.frequency) ? popup.frequency : 'oncePerSession';
    popup.device = ['all', 'desktop', 'mobile'].includes(popup.device) ? popup.device : 'all';
    popup.delayMs = clampNumber(popup.delayMs, 0, 10000, defaults.delayMs || 500);
    popup.desktopWidth = clampNumber(popup.desktopWidth, 320, 1200, defaults.desktopWidth || 720);
    popup.mobileWidth = clampNumber(popup.mobileWidth, 280, 480, defaults.mobileWidth || 340);
    popup.maxHeightVh = clampNumber(popup.maxHeightVh, 50, 95, defaults.maxHeightVh || 86);
    popup.borderRadius = clampNumber(popup.borderRadius, 0, 40, defaults.borderRadius || 16);
    popup.enabled = popup.enabled === true;
    popup.backdrop = popup.backdrop !== false;
    popup.closeOnBackdrop = popup.closeOnBackdrop !== false;
    popup.showCloseButton = popup.showCloseButton !== false;
    if (!popup.showCloseButton && !popup.closeOnBackdrop) popup.closeOnBackdrop = true;
    return popup;
}

function isMobileViewport() {
    return viewportWidth.value <= 640;
}

function isAlertPopupEligible(popup) {
    if (!popup?.enabled || !isFilled(popup.imageUrl)) return false;
    if (popup.device === 'mobile' && !isMobileViewport()) return false;
    if (popup.device === 'desktop' && isMobileViewport()) return false;

    const now = Date.now();
    const startTime = parseOptionalDate(popup.startAt);
    const endTime = parseOptionalDate(popup.endAt);
    if (startTime && now < startTime) return false;
    if (endTime && now > endTime) return false;
    return true;
}

function parseOptionalDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const timestamp = new Date(raw).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function scheduleAlertPopup() {
    clearAlertPopupTimer();
    alertPopupVisible.value = false;

    const popup = activeAlertPopup.value;
    if (!popup || hasSeenAlertPopup(popup)) return;

    alertPopupTimer.value = setTimeout(() => {
        if (activeAlertPopup.value && !hasSeenAlertPopup(activeAlertPopup.value)) {
            alertPopupVisible.value = true;
        }
    }, popup.delayMs);
}

function clearAlertPopupTimer() {
    if (alertPopupTimer.value) clearTimeout(alertPopupTimer.value);
    alertPopupTimer.value = null;
}

function getAlertPopupSignature(popup) {
    const key = [popup.name, popup.imageUrl, popup.href, popup.startAt, popup.endAt].map((item) => String(item || '').trim()).join('|');
    return encodeURIComponent(key || 'default');
}

function getAlertPopupStorageKey(popup) {
    return `marketplace-alert-popup:${popup.frequency}:${getAlertPopupSignature(popup)}`;
}

function getBangkokDateKey() {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    } catch (error) {
        return new Date().toISOString().slice(0, 10);
    }
}

function hasSeenAlertPopup(popup) {
    if (popup.frequency === 'always') return false;
    const key = getAlertPopupStorageKey(popup);
    if (popup.frequency === 'oncePerSession') return sessionStorage.getItem(key) === '1';
    if (popup.frequency === 'oncePerDay') return localStorage.getItem(key) === getBangkokDateKey();
    return localStorage.getItem(key) === '1';
}

function markAlertPopupSeen(popup) {
    if (!popup || popup.frequency === 'always') return;
    const key = getAlertPopupStorageKey(popup);
    if (popup.frequency === 'oncePerSession') {
        sessionStorage.setItem(key, '1');
        return;
    }
    localStorage.setItem(key, popup.frequency === 'oncePerDay' ? getBangkokDateKey() : '1');
}

function closeAlertPopup() {
    const popup = activeAlertPopup.value;
    alertPopupVisible.value = false;
    markAlertPopupSeen(popup);
}

function handleAlertBackdropClick() {
    if (activeAlertPopup.value?.closeOnBackdrop) closeAlertPopup();
}

function handleAlertPopupImageError() {
    alertPopupVisible.value = false;
}

function getAlertPopupHref(popup) {
    const href = String(popup?.href || '').trim();
    if (!href) return '';
    if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('/')) return href;
    return '';
}

function handleAlertPopupLinkClick(popup, event) {
    const href = getAlertPopupHref(popup);
    if (!href) {
        event.preventDefault();
        return;
    }
    markAlertPopupSeen(popup);
    alertPopupVisible.value = false;
    if (href.startsWith('/')) {
        event.preventDefault();
        goToHref(href);
    }
}

function handleViewportResize() {
    viewportWidth.value = window.innerWidth || viewportWidth.value;
}

function layoutSectionStyle(layoutSection) {
    const radius = clampNumber(layoutSection?.settings?.radius, 0, 40, 16);
    return { '--home-section-radius': `${radius}px` };
}

function getProductSectionSettings(section = {}) {
    const fallback = normalizeLayoutSettings('productSections', productLayoutSettings.value || {});
    const display = ['slider', 'grid'].includes(section.display) ? section.display : fallback.display || 'slider';
    const gridColumns = clampNumber(section.gridColumns ?? fallback.gridColumns, 1, 8, fallback.gridColumns || 4);
    const cardRadius = clampNumber(section.cardRadius ?? fallback.cardRadius, 0, 40, fallback.cardRadius || 14);
    const imageHeight = clampNumber(section.imageHeight ?? fallback.imageHeight, 80, 360, fallback.imageHeight || 144);
    return { display, gridColumns, cardRadius, imageHeight };
}

function productDisplayClass(section) {
    return `product-display-${getProductSectionSettings(section).display}`;
}

function productStripStyle(section) {
    const settings = getProductSectionSettings(section);
    const columns = clampNumber(settings.gridColumns, 1, 8, 4);
    return {
        '--product-grid-columns': columns,
        '--product-grid-columns-tablet': Math.min(columns, 3),
        '--product-grid-columns-mobile': Math.min(columns, 2),
        '--product-card-radius': `${settings.cardRadius}px`,
        '--product-image-height': `${settings.imageHeight}px`
    };
}

function clampPromoSpan(value, max = 6) {
    if (String(value || '').trim() === 'full') return max;
    return Math.max(1, Math.min(max, parseInt(value, 10) || 1));
}

function promoGridStyle() {
    const settings = promoLayoutSettings.value || {};
    const columns = clampNumber(settings.desktopColumns, 2, 6, 3);
    return {
        '--promo-grid-columns': columns,
        '--promo-grid-columns-tablet': Math.min(clampNumber(settings.tabletColumns, 1, 4, 2), columns),
        '--promo-grid-columns-mobile': Math.min(clampNumber(settings.mobileColumns, 1, 2, 1), columns),
        '--promo-grid-gap': `${clampNumber(settings.gap, 0, 40, 14)}px`
    };
}

function shouldShowPromoText(block) {
    return block?.textOverlay !== false && Boolean(block?.title || block?.value || block?.description);
}

function promoTileStyle(block) {
    const settings = promoLayoutSettings.value || {};
    const desktopColumns = clampNumber(settings.desktopColumns, 2, 6, 3);
    const tabletColumns = Math.min(clampNumber(settings.tabletColumns, 1, 4, 2), desktopColumns);
    const mobileColumns = Math.min(clampNumber(settings.mobileColumns, 1, 2, 1), desktopColumns);
    const style = {
        '--promo-col-span': clampPromoSpan(block?.width, desktopColumns),
        '--promo-col-span-tablet': clampPromoSpan(block?.width, tabletColumns),
        '--promo-col-span-mobile': clampPromoSpan(block?.width, mobileColumns),
        '--promo-row-span': clampPromoSpan(block?.height, 2)
    };
    const heightMode = block?.heightMode || 'ratio';

    if (heightMode === 'fixed') {
        style['--promo-fixed-height'] = `${clampNumber(block?.desktopHeight, 80, 720, 180)}px`;
        style['--promo-fixed-height-mobile'] = `${clampNumber(block?.mobileHeight, 60, 480, 120)}px`;
    }

    if (heightMode === 'ratio' && isFilled(block?.aspectRatio) && block.aspectRatio !== 'auto') {
        style['--promo-aspect-ratio'] = String(block.aspectRatio).replace('/', ' / ');
    }

    const textColor = normalizeHexColor(block?.textColor);
    if (textColor) style['--promo-text-color'] = textColor;

    if (block?.imageUrl && !shouldRenderPromoImage(block)) {
        const imageUrl = resolveContentImageUrl(block.imageUrl);
        style.backgroundImage = shouldShowPromoText(block) ? `linear-gradient(90deg, rgba(20, 14, 6, 0.55), rgba(20, 14, 6, 0.12)), url("${imageUrl}")` : `url("${imageUrl}")`;
        style.backgroundSize = block.imageFit === 'contain' ? 'contain' : 'cover';
    }

    return style;
}

function hasContentHref(value) {
    return isFilled(value);
}

function isExternalHref(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function promoTileTag(block) {
    return hasContentHref(block?.href) ? 'a' : 'div';
}

function promoTileHref(block) {
    return hasContentHref(block?.href) ? block.href : null;
}

function shouldRenderPromoImage(block) {
    return Boolean(block?.imageUrl && !shouldShowPromoText(block) && block?.heightMode === 'auto');
}

function handlePromoTileClick(block, event) {
    if (!hasContentHref(block?.href)) return;
    event.preventDefault();
    goToHref(block.href);
}

function applyThemeToRoot(theme = {}) {
    const source = { ...(fallbackContent.theme || {}), ...(theme || {}) };
    const pairs = {
        '--market-primary': source.primaryColor,
        '--market-accent': source.accentColor,
        '--market-header-bg': source.headerBackground,
        '--market-header-text': source.headerTextColor,
        '--market-page-bg': source.backgroundColor,
        '--market-card-bg': source.productCardBackground,
        '--market-product-image-bg': source.productImageBackground,
        '--market-card-border': source.productCardBorder,
        '--market-footer-bg': source.footerBackground,
        '--market-footer-text': source.footerTextColor,
        // เดิมตกหล่นคีย์นี้ ทำให้สีข้อความค้างจากหน้าที่เข้าก่อนหน้า (AppLayout เซ็ตให้แต่ตัวนี้ไม่เซ็ต)
        '--market-text': source.footerTextColor,
        '--market-surface': source.productCardBackground,
        '--market-border': source.productCardBorder,
        '--p-primary-color': source.primaryColor,
        '--primary-color': source.primaryColor
    };

    Object.entries(pairs).forEach(([key, value]) => {
        const color = normalizeHexColor(value);
        if (color) {
            document.documentElement.style.setProperty(key, color);
        }
    });
}

function normalizeHexColor(value) {
    const color = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(color)) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
    return '';
}

watch(
    () => homeContent.value.theme,
    (theme) => applyThemeToRoot(theme),
    { deep: true, immediate: true }
);

watch(
    [() => loading.value, alertPopupConfig, () => viewportWidth.value],
    () => {
        if (!loading.value) scheduleAlertPopup();
    },
    { deep: true }
);

onMounted(async () => {
    window.addEventListener('resize', handleViewportResize, { passive: true });
    await loadLanding();
    startHeroTimer();
    scheduleAlertPopup();
});

onBeforeUnmount(() => {
    stopHeroTimer();
    clearAlertPopupTimer();
    window.removeEventListener('resize', handleViewportResize);
});

async function loadLanding() {
    loading.value = true;
    try {
        const [home, categoryResult] = await Promise.all([ContentService.getHomeContent(), CategoryService.getCategories(), loadCompanyProfile()]);
        content.value = home || fallbackContent;
        categories.value = (categoryResult?.data || []).filter((cat) => !['all', 'promotions', 'productset'].includes(cat.code));
        await Promise.all([loadCategoryPreview(), loadProductSections()]);
    } catch (error) {
        console.error('Error loading landing:', error);
        content.value = fallbackContent;
    } finally {
        loading.value = false;
    }
}

async function loadCompanyProfile() {
    try {
        const profile = await CompanyService.getCompanyProfile();
        if (!profile) return;
        companyProfile.value = {
            ...companyProfile.value,
            ...profile,
            company_name: profile.company_name_1 || profile.company_name || profile.name || companyProfile.value.company_name,
            address: profile.address_1 || profile.address || companyProfile.value.address,
            telephone_number: profile.telephone_number || profile.tel || profile.phone || companyProfile.value.telephone_number
        };
    } catch (error) {
        console.warn('Unable to load company profile for homepage footer:', error);
    }
}

async function loadCategoryPreview() {
    const selectedCodes = homeContent.value.categoryCodes?.length ? homeContent.value.categoryCodes : categories.value.slice(0, 6).map((cat) => cat.code);
    const maxItems = clampNumber(categoryLayoutSettings.value.maxItems, 1, 12, 6);
    const selectedCategories = selectedCodes
        .map((code) => categories.value.find((cat) => cat.code === code))
        .filter(Boolean)
        .slice(0, maxItems);

    categoryRows.value = await Promise.all(
        selectedCategories.map(async (cat) => {
            const products = await getProductsForMode({ mode: 'category', categoryCode: cat.code, limit: 4 });
            return { ...cat, products };
        })
    );
}

async function loadProductSections() {
    const sections = getHomeProductSections()
        .filter((section) => section.enabled !== false)
        .slice(0, 6);
    const rows = await Promise.all(
        sections.map(async (section) => ({
            section,
            products: await getProductsForMode(section)
        }))
    );
    productRows.value = rows;
    loadProductPrices(productRows.value.flatMap((row) => row.products));
}

function createDefaultFeatureSection(featureType) {
    if (featureType === 'new') {
        return { id: 'new', title: defaultLandingText.newProductTitle, subtitle: defaultLandingText.newProductSubtitle, mode: 'new', limit: 8, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144, enabled: true };
    }
    return { id: 'recommended', title: defaultLandingText.recommendedTitle, subtitle: defaultLandingText.recommendedSubtitle, mode: 'recommend', limit: 8, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144, enabled: true };
}

function getFeatureTypeForSection(section = {}) {
    if (section.id === 'recommended' || section.mode === 'recommend') return 'recommend';
    if (section.id === 'new' || section.mode === 'new') return 'new';
    return '';
}

function getHomeProductSections() {
    return resolveHomeProductSections(homeContent.value.productSections, createDefaultFeatureSection);
}

async function getProductsForMode(section) {
    const limit = Math.max(1, Math.min(parseInt(section.limit, 10) || 8, 24));

    try {
        const featureType = getFeatureTypeForSection(section);
        if (featureType) {
            const result = await ProductService.getProducts({ premium: 1, featureType, includeAllPattern: true, limit }, 0);
            return (result?.data || []).slice(0, limit);
        }

        if (section.mode === 'manual' && Array.isArray(section.productCodes) && section.productCodes.length) {
            const manualResults = await Promise.allSettled(
                section.productCodes.slice(0, limit).map(async (code) => {
                    const result = await ProductService.getProducts({ search: code, category: '', favorite: 0, includeAllPattern: true }, 0);
                    return (result?.data || []).find((product) => product.item_code === code || product.code === code) || null;
                })
            );
            return manualResults.map((item) => item.value).filter(Boolean);
        }

        const filters = {
            category: section.mode === 'category' ? section.categoryCode || '' : '',
            isPromotion: section.mode === 'promotion' ? 1 : 0,
            search: ''
        };
        const result = await ProductService.getProducts(filters, 0);
        return (result?.data || []).slice(0, limit);
    } catch (error) {
        console.error('Error loading section products:', section, error);
        return [];
    }
}

function getProductSaleUnit(product) {
    return product?.online_sale_unit || product?.unit_code || product?.start_sale_unit || product?.unit_standard || product?.unit_cost || '';
}

function hasSalePrice(value) {
    const price = parseFloat(value);
    return Number.isFinite(price) && price > 0;
}

function toProductNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getUnitStandValue(unit) {
    const standValue = toProductNumber(unit?.stand_value, NaN);
    return Number.isFinite(standValue) && standValue > 0 ? standValue : Number.POSITIVE_INFINITY;
}

function pickSmallestStandValueUnit(productDetail) {
    const units = [productDetail, ...(productDetail?.otherUnits || [])].filter((unit) => unit?.unit_code);
    if (!units.length) return productDetail;
    return [...units].sort((a, b) => {
        const standDiff = getUnitStandValue(a) - getUnitStandValue(b);
        if (standDiff !== 0) return standDiff;
        return String(a.unit_code || '').localeCompare(String(b.unit_code || ''), 'th');
    })[0];
}

async function resolveProductPrice(product) {
    const itemCode = product.item_code || product.code;
    if (!product.online_sale_unit) {
        try {
            const detailResult = await ProductService.getProductByItemCode(itemCode);
            const selectedUnit = pickSmallestStandValueUnit(detailResult?.data);
            if (selectedUnit?.unit_code) {
                return {
                    price: hasSalePrice(selectedUnit.price) ? selectedUnit.price : 0,
                    unit_code: selectedUnit.unit_code,
                    barcode: selectedUnit.barcode || product.barcode || ''
                };
            }
        } catch (error) {
            console.warn(`Unable to resolve visible home product sale unit for ${itemCode}`, error);
        }
    }

    const unitCode = getProductSaleUnit(product);

    const priceResult = await ProductService.getProductPrice(itemCode, unitCode, '1', localStorage.getItem('_userCode') || '', {
        barcode: product.barcode || ''
    });

    return {
        price: hasSalePrice(priceResult?.price) ? priceResult.price : 0,
        unit_code: unitCode,
        barcode: product.barcode || priceResult?.barcode || ''
    };
}

async function loadProductPrices(targetProducts) {
    if (!isAuthenticated.value || !Array.isArray(targetProducts) || !targetProducts.length) return;

    const currentToken = ++priceLoadToken;
    const productsToPrice = targetProducts.filter((product) => product.item_code || product.code);

    productsToPrice.forEach((product) => {
        product._priceLoading = true;
        product._priceError = false;
        product.price_unit_code = getProductSaleUnit(product);
    });
    refreshProductRows();

    const batchSize = 6;
    for (let index = 0; index < productsToPrice.length; index += batchSize) {
        if (currentToken !== priceLoadToken) return;
        const batch = productsToPrice.slice(index, index + batchSize);

        await Promise.all(
            batch.map(async (product) => {
                try {
                    const priceResult = await resolveProductPrice(product);
                    if (currentToken !== priceLoadToken) return;

                    if (priceResult) {
                        product.price = priceResult.price;
                        product.price_unit_code = priceResult.unit_code || getProductSaleUnit(product);
                        product.barcode = priceResult.barcode || product.barcode || '';
                        product._priceLoaded = true;
                    } else {
                        product._priceError = true;
                    }
                } catch (error) {
                    if (currentToken !== priceLoadToken) return;
                    product._priceError = true;
                    console.warn(`Unable to load home product price for ${product.item_code || product.code}`, error);
                } finally {
                    if (currentToken === priceLoadToken) product._priceLoading = false;
                }
            })
        );
        refreshProductRows();
    }
}

function refreshProductRows() {
    productRows.value = productRows.value.map((row) => ({
        ...row,
        products: [...(row.products || [])]
    }));
}

// ── แถบสไลด์ hero ────────────────────────────────────────────────────────
//
// เดิมสลับสไลด์ด้วยการเปลี่ยน index แล้ว render ใหม่ทีละใบ (fade)
// ตอนนี้ render ทุกใบเรียงกันในแถบที่มี scroll-snap แล้วเลื่อนไปหา
// ได้ปัดนิ้วบนมือถือแบบ native + เห็นใบถัดไปโผล่ข้างเป็นตัวบอกว่ายังมีต่อ
const heroTrack = ref(null);
// ล็อกไม่ให้ scroll handler ไปสู้กับการเลื่อนที่เราสั่งเอง (ไม่งั้น activeSlide กระพริบ)
let heroScrollLock = 0;

// ⚠️ แถบ hero อยู่ใน v-for ของ homeLayout — Vue 3 จึงเก็บ ref เป็น "อาร์เรย์" ไม่ใช่ element เดี่ยว
// ถ้าใช้ heroTrack.value ตรงๆ จะได้ array แล้ว .children เป็น undefined → ฟังก์ชันเลื่อนเงียบไปทั้งตัว
function heroTrackEl() {
    const raw = heroTrack.value;
    return (Array.isArray(raw) ? raw[0] : raw) || null;
}

// ตำแหน่งซ้ายของสไลด์เทียบกับจุดเริ่มของแถบ (ไม่ใช้ clientWidth เป็นตัวหาร
// เพราะสไลด์กว้าง 96% ไม่เท่าแถบ ถ้าหารตรงๆ index จะเพี้ยนสะสมเมื่อมีสไลด์เยอะ)
function heroSlideOffset(track, child) {
    return child.offsetLeft - track.offsetLeft;
}

function scrollHeroTo(index, behavior = 'smooth') {
    const track = heroTrackEl();
    const target = track?.children?.[index];
    if (!track || !target) return;
    heroScrollLock = Date.now();
    // จัดให้อยู่กึ่งกลางแถบ ให้ตรงกับ scroll-snap-align: center
    const left = heroSlideOffset(track, target) - (track.clientWidth - target.clientWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior });
}

// ผู้ใช้ปัดเอง → อัปเดตจุดบอกตำแหน่งให้ตรง โดยหาใบที่จุดกึ่งกลางใกล้กลางแถบที่สุด
function onHeroScroll() {
    const track = heroTrackEl();
    if (!track || Date.now() - heroScrollLock < 600) return;
    const viewCenter = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    Array.from(track.children).forEach((child, index) => {
        const distance = Math.abs(heroSlideOffset(track, child) + child.clientWidth / 2 - viewCenter);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    if (best !== activeSlide.value) activeSlide.value = best;
}

function startHeroTimer() {
    stopHeroTimer();
    heroTimer.value = setInterval(() => {
        if (slides.value.length <= 1) return;
        // ไม่เลื่อนตอนแท็บถูกซ่อน — ประหยัดงาน render และกันสไลด์วิ่งทิ้งไว้
        if (document.visibilityState === 'hidden') return;
        const next = (activeSlide.value + 1) % slides.value.length;
        activeSlide.value = next;
        scrollHeroTo(next);
    }, 5500);
}

function stopHeroTimer() {
    if (heroTimer.value) clearInterval(heroTimer.value);
    heroTimer.value = null;
}

function setSlide(index) {
    activeSlide.value = index;
    scrollHeroTo(index);
    startHeroTimer();
}

function goToHref(href) {
    const target = String(href || '').trim();
    if (!target) return;
    if (isExternalHref(target)) {
        window.open(target, '_blank', 'noopener,noreferrer');
        return;
    }
    router.push(target);
}

function goToProduct(product) {
    const code = product?.item_code || product?.code;
    if (!code) return;
    selectedProductCode.value = code;
    showProductFullDetail.value = false;
    if (String(product?.item_type || '') === '3') {
        showProductDetail.value = false;
        showProductSetDetail.value = true;
        return;
    }

    showProductSetDetail.value = false;
    showProductDetail.value = true;
}

function openFullProductDetail(itemCode) {
    selectedProductCode.value = itemCode;
    showProductDetail.value = false;
    showProductSetDetail.value = false;
    showProductFullDetail.value = true;
}

function handleAddedToCart() {}

function handleFavoriteChanged(data) {
    const updateFavorite = (product) => {
        if ((product.item_code || product.code) === data.itemCode) {
            product.favorite_item = data.isFavorite ? '1' : '0';
        }
    };

    productRows.value.forEach((row) => row.products.forEach(updateFavorite));
    categoryRows.value.forEach((row) => row.products.forEach(updateFavorite));
}

function getProductImage(product) {
    const code = product?.item_code || product?.code;
    if (code && ProductService.shouldBypassProductImageCache(product)) {
        return ProductService.getProductImageUrl(code, product);
    }
    return product?.image || (code ? ProductService.getProductImageUrl(code, product) : ProductService.getPlaceholderImage());
}

function formatPrice(product) {
    const price = parseFloat(product?.price_confirm || product?.price || 0);
    if (!price) return '';
    return price.toLocaleString(numberLocale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function handleImageError(event) {
    event.target.src = ProductService.getPlaceholderImage();
}

// ProductCard จัดการ error ของรูปเอง จึงรับเป็นค่ารูปสำรองแทน event handler
const productImagePlaceholder = ProductService.getPlaceholderImage();
</script>

<template>
    <main class="home-page">
        <div
            v-for="layoutSection in homeLayout"
            :key="layoutSection.type"
            class="home-layout-slot"
            :class="`home-layout-width-${layoutSection.settings?.width || 'boxed'}`"
            :data-section="layoutSection.type"
            :style="layoutSectionStyle(layoutSection)"
        >
            <!-- hero: แถบเลื่อนที่ render ทุกสไลด์เรียงกัน แล้วใช้ scroll-snap ยึดทีละใบ
                 ได้ปัดนิ้วบนมือถือแบบ native และเห็นใบถัดไปโผล่ข้างเป็นตัวบอกว่ายังมีต่อ
                 (เดิม render ทีละใบแล้วสลับ index ด้วย setInterval)
                 มีสไลด์เดียว = แถบไม่มีอะไรให้เลื่อน หน้าตาจึงเท่าเดิมทุกประการ -->
            <div v-if="layoutSection.type === 'hero' && (loading || slides.length)" class="hero-viewport">
                <section v-if="loading" class="hero-shell">
                    <div class="hero-skeleton">
                        <Skeleton height="2rem" width="12rem" />
                        <Skeleton height="4rem" />
                        <Skeleton height="12rem" />
                    </div>
                </section>

                <template v-else>
                    <div ref="heroTrack" class="hero-track" :class="{ 'is-single': slides.length <= 1 }" @scroll.passive="onHeroScroll">
                        <section
                            v-for="(slide, slideIndex) in slides"
                            :key="slideIndex"
                            class="hero-shell hero-slide"
                            :class="[
                                `hero-tone-${slide.tone || 'teal'}`,
                                `hero-layout-${slide.layout || 'split'}`,
                                `hero-height-${heroLayoutSettings.height || 'normal'}`,
                                `hero-custom-height-${slide.heightMode || 'preset'}`,
                                {
                                    'hero-has-background': getHeroBackgroundImageUrl(slide),
                                    'hero-image-only': slide.mode === 'imageOnly' || !shouldShowHeroText(slide),
                                    'hero-text-hidden': !shouldShowHeroText(slide),
                                    'hero-mobile-full-image-shell': useMobileFullHeroImageFor(slide)
                                }
                            ]"
                            :style="heroBackgroundStyleFor(slide)"
                            :aria-hidden="slideIndex !== activeSlide ? 'true' : null"
                        >
                            <img v-if="useMobileFullHeroImageFor(slide)" class="hero-mobile-full-image" :src="heroMobileFullImageUrlFor(slide)" :alt="slide.imageAlt || slide.title || siteName" @error="handleImageError" />

                            <div v-if="shouldShowHeroText(slide)" class="hero-copy" :class="`hero-copy-${slide.contentPosition || 'left'}`">
                                <p v-if="slide.eyebrow" class="hero-eyebrow">{{ slide.eyebrow }}</p>
                                <h1 v-if="slide.title">{{ slide.title }}</h1>
                                <p v-if="getSlideSubtitle(slide)" class="hero-subtitle">{{ getSlideSubtitle(slide) }}</p>
                                <!-- ผูกกับปุ่มหลักอย่างเดียว: เดิมมีเงื่อนไข shouldShowHeroSecondaryAction() ร่วมด้วย
                                     ซึ่งเป็นจริงกับสไลด์ที่มีข้อความแทบทุกใบ ทำให้สไลด์ที่แอดมินไม่ได้ตั้งปุ่ม
                                     ยัง render กล่องเปล่าทิ้งช่องว่าง 18.2px (ปุ่มรองไม่เคยถูกสร้างจริง) -->
                                <div v-if="shouldShowHeroPrimaryAction(slide)" class="hero-actions">
                                    <Button :label="getSlideCtaLabel(slide)" icon="pi pi-shopping-bag" :style="heroPrimaryButtonStyleFor(slide)" @click="goToHref(slide.href)" />
                                </div>
                                <div v-if="getSlideBadge(slide) || getSlideDiscountText(slide)" class="hero-badges">
                                    <span v-if="getSlideBadge(slide)">{{ getSlideBadge(slide) }}</span>
                                    <strong v-if="getSlideDiscountText(slide)">{{ getSlideDiscountText(slide) }}</strong>
                                </div>
                            </div>

                            <div v-if="!useMobileFullHeroImageFor(slide) && shouldRenderHeroMedia(slide)" class="hero-media" :class="{ 'hero-media-left': slide.imagePosition === 'left' }">
                                <img :src="resolveContentImageUrl(slide.imageUrl)" :alt="slide.imageAlt || slide.title" :loading="slideIndex === 0 ? 'eager' : 'lazy'" @error="handleImageError" />
                            </div>
                            <img
                                v-else-if="!useMobileFullHeroImageFor(slide) && slide.imageUrl && slide.mode === 'imageOnly' && slide.heightMode === 'auto'"
                                class="hero-image-only-auto-image"
                                :src="resolveContentImageUrl(slide.imageUrl)"
                                :alt="slide.imageAlt || slide.title || siteName"
                                :loading="slideIndex === 0 ? 'eager' : 'lazy'"
                                @error="handleImageError"
                            />
                            <div v-else-if="slide.layout !== 'background' && slide.mode !== 'imageOnly' && shouldShowHeroText(slide)" class="hero-media hero-media-placeholder">
                                <i class="pi pi-shopping-bag"></i>
                                <span>{{ siteName }}</span>
                            </div>
                        </section>
                    </div>

                    <div v-if="slides.length > 1" class="hero-dots">
                        <button v-for="(_, index) in slides" :key="index" :class="{ active: index === activeSlide }" type="button" :aria-label="`${t('landing.slideAria')} ${index + 1}`" @click="setSlide(index)" />
                    </div>
                </template>
            </div>

            <section v-if="layoutSection.type === 'promoGrid' && promoBlocks.length" class="promo-grid" :class="`promo-layout-${promoLayoutSettings.layout || 'mosaic'}`" :style="promoGridStyle()">
                <component
                    :is="promoTileTag(block)"
                    v-for="(block, index) in promoBlocks"
                    :key="`${block.title || 'promo'}-${index}`"
                    class="promo-tile"
                    :class="[
                        `promo-tone-${block.tone || 'red'}`,
                        `promo-height-${block.heightMode || 'ratio'}`,
                        {
                            'promo-tile-image': block.imageUrl,
                            'promo-tile-clean': !shouldShowPromoText(block),
                            'promo-tile-clickable': hasContentHref(block.href),
                            'promo-tile-static': !hasContentHref(block.href)
                        }
                    ]"
                    :style="promoTileStyle(block)"
                    :href="promoTileHref(block)"
                    :target="isExternalHref(block.href) ? '_blank' : null"
                    :rel="isExternalHref(block.href) ? 'noopener noreferrer' : null"
                    @click="handlePromoTileClick(block, $event)"
                >
                    <img v-if="shouldRenderPromoImage(block)" class="promo-tile-auto-image" :src="resolveContentImageUrl(block.imageUrl)" :alt="block.imageAlt || block.title || 'Promotion'" @error="handleImageError" />
                    <template v-if="shouldShowPromoText(block)">
                        <span v-if="block.title">{{ block.title }}</span>
                        <strong v-if="block.value">{{ block.value }}</strong>
                        <small v-if="block.description">{{ block.description }}</small>
                    </template>
                    <span v-else class="sr-only">{{ block.imageAlt || block.title || 'Promotion' }}</span>
                </component>
            </section>

            <!-- RULE: hide-empty-section — render เฉพาะตอนกำลังโหลด หรือมีข้อมูลจริง -->
            <section v-if="layoutSection.type === 'categories' && (loading || categoryRows.length)" class="home-section">
                <div class="section-heading">
                    <div>
                        <p>{{ t('landing.popularCategoriesEyebrow') }}</p>
                        <h2>
                            <b>{{ t('landing.popularCategories') }}</b>
                        </h2>
                    </div>
                    <Button :label="t('landing.allProducts')" icon="pi pi-arrow-right" text @click="goToHref('/marketplace')" />
                </div>

                <div v-if="loading" class="category-grid" :class="`category-density-${categoryLayoutSettings.density || 'comfortable'}`">
                    <Skeleton v-for="i in 4" :key="i" height="12rem" />
                </div>
                <div v-else-if="categoryRows.length" class="category-grid" :class="`category-density-${categoryLayoutSettings.density || 'comfortable'}`">
                    <button v-for="cat in categoryRows" :key="cat.code" class="category-card" type="button" @click="goToHref(`/marketplace?category=${encodeURIComponent(cat.code)}`)">
                        <div>
                            <span>{{ getCategoryDisplayName(cat) }}</span>
                        </div>
                        <div class="category-preview">
                            <img v-for="product in cat.products.slice(0, 3)" :key="product.item_code" :src="getProductImage(product)" :alt="getProductDisplayName(product)" loading="lazy" decoding="async" @error="handleImageError" />
                        </div>
                    </button>
                </div>
            </section>

            <template v-if="layoutSection.type === 'productSections'">
                <!-- RULE: hide-empty-section — productRows ถูกเติมหลัง await เสร็จ จึงไม่มีสถานะ "โหลดอยู่แต่ว่าง" -->
                <template v-for="row in productRows" :key="row.section.id">
                <section v-if="row.products.length" class="home-section">
                    <div class="section-heading">
                        <div>
                            <h2>
                                <b>{{ getSectionTitle(row.section) }}</b>
                            </h2>
                            <span v-if="getSectionSubtitle(row.section)">{{ getSectionSubtitle(row.section) }}</span>
                        </div>
                        <Button :label="t('landing.seeMore')" icon="pi pi-arrow-right" text @click="goToHref('/marketplace')" />
                    </div>

                    <div v-if="row.products.length" class="product-strip" :class="productDisplayClass(row.section)" :style="productStripStyle(row.section)">
                        <ProductCard
                            v-for="product in row.products"
                            :key="`${row.section.id}-${product.item_code || product.code}`"
                            class="home-product-card"
                            :name="getProductDisplayName(product)"
                            :image="getProductImage(product)"
                            :fallback-image="productImagePlaceholder"
                            @select="goToProduct(product)"
                        >
                            <!-- ราคาส่งผ่าน slot เพราะหน้านี้ formatPrice() รับ product ทั้งก้อน
                                 และมีสถานะ "กำลังตรวจราคา"/"เข้าสู่ระบบเพื่อดูราคา" เฉพาะของหน้าแรก -->
                            <template #price>
                                <div class="home-product-price-row">
                                    <small v-if="product._priceLoading">{{ t('landing.checkingPrice') }}</small>
                                    <strong v-else-if="formatPrice(product)"
                                        >฿{{ formatPrice(product) }} <em v-if="product.price_unit_code || getProductSaleUnit(product)">/ {{ product.price_unit_code || getProductSaleUnit(product) }}</em></strong
                                    >
                                    <small v-else-if="!isAuthenticated">{{ t('landing.loginForPrice') }}</small>
                                    <small v-else>{{ t('landing.viewProductDetail') }}</small>
                                    <img v-if="product.is_return === '1'" :src="returnIcon" :alt="t('productDetail.returnAlt')" class="home-product-return-icon" />
                                </div>
                            </template>
                        </ProductCard>
                    </div>
                </section>
                </template>
            </template>

            <footer v-if="layoutSection.type === 'footer'" class="home-footer">
                <div class="footer-main">
                    <section class="footer-brand">
                        <div class="footer-brand-head">
                            <img v-if="appLogo" :src="appLogo" :alt="displayCompanyName" class="footer-brand-logo" @error="$event.target.style.display = 'none'" />
                            <h2 :class="{ 'sr-only': appLogo }">{{ displayCompanyName }}</h2>
                        </div>
                        <div class="footer-contact-list">
                            <p>🚚 จัดส่งฟรีตามพื้นที่ (ข้ามเขต/ข้ามจังหวัด)ยอดซื้อ 5,001 บาทขึ้นไป</p>
                            <p>จัดส่งฟรีในพื้นที่ จังหวัดลำพูน, จังหวัดเชียงใหม่, ลำปาง และเชียงราย </p>
                            <div v-if="displayCompanyAddress" class="footer-contact-item">
                                <i class="pi pi-map-marker"></i>
                                <span>{{ displayCompanyAddress }}</span>
                            </div>
                            <div v-if="displayCompanyPhone" class="footer-contact-item">
                                <i class="pi pi-phone"></i>
                                <a :href="`tel:${displayCompanyPhone}`">{{ displayCompanyPhone }}</a>
                            </div>
                        </div>
                    </section>

                    <section class="footer-links">
                        <h3>{{ t('landing.quickLinks') }}</h3>
                        <button type="button" @click="goToHref('/marketplace')">{{ t('catalog.allProducts') }}</button>
                        <button type="button" @click="goToHref('/cart')">{{ t('cart.cart') }}</button>
                        <button type="button" @click="goToHref('/orders-history')">{{ t('nav.orderHistory') }}</button>
                        <button type="button" @click="goToHref('/auth/login')">{{ t('nav.login') }}</button>
                    </section>

                    <section class="footer-line">
                        <h3>{{ t('landing.contactLine') }}</h3>
                        <a v-if="lineContactUrl" :href="lineContactUrl" target="_blank" rel="noopener" class="footer-line-card">
                            <img :src="lineQrImage" alt="LINE QR Code" loading="lazy" decoding="async" />
                            <span>{{ t('landing.lineCaption') }}</span>
                        </a>
                        <div v-else class="footer-line-card">
                            <img :src="lineQrImage" alt="LINE QR Code" loading="lazy" decoding="async" />
                            <span>{{ t('landing.lineCaption') }}</span>
                        </div>
                    </section>
                </div>
                <div class="footer-bottom">
                    <span>© {{ currentYear }} {{ displayCompanyName }}</span>
                    <span>Powered by NextStep</span>
                </div>
            </footer>
        </div>

        <Teleport to="body">
            <div
                v-if="alertPopupVisible && activeAlertPopup"
                class="home-alert-backdrop"
                :class="{ 'home-alert-backdrop-soft': activeAlertPopup.backdrop, 'home-alert-backdrop-clear': !activeAlertPopup.backdrop }"
                @click.self="handleAlertBackdropClick"
            >
                <div class="home-alert-dialog" :style="alertPopupDialogStyle" role="dialog" aria-modal="true" :aria-label="activeAlertPopup.imageAlt || activeAlertPopup.name || siteName">
                    <button v-if="activeAlertPopup.showCloseButton" type="button" class="home-alert-close" aria-label="Close" @click="closeAlertPopup">
                        <i class="pi pi-times"></i>
                    </button>

                    <a
                        v-if="getAlertPopupHref(activeAlertPopup)"
                        class="home-alert-image-link"
                        :href="getAlertPopupHref(activeAlertPopup)"
                        :target="activeAlertPopup.target"
                        :rel="activeAlertPopup.target === '_blank' ? 'noopener noreferrer' : null"
                        @click="handleAlertPopupLinkClick(activeAlertPopup, $event)"
                    >
                        <img class="home-alert-image" :src="alertPopupImageUrl" :alt="activeAlertPopup.imageAlt || activeAlertPopup.name || ''" :style="alertPopupImageStyle" @error="handleAlertPopupImageError" />
                    </a>
                    <img v-else class="home-alert-image" :src="alertPopupImageUrl" :alt="activeAlertPopup.imageAlt || activeAlertPopup.name || ''" :style="alertPopupImageStyle" @error="handleAlertPopupImageError" />
                </div>
            </div>
        </Teleport>

        <ProductDetailDialog
            :visible="showProductDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <ProductSetDialog
            :visible="showProductSetDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductSetDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <ProductFullDetailDialog :visible="showProductFullDetail" :item-code="selectedProductCode" @update:visible="showProductFullDetail = $event" @added-to-cart="handleAddedToCart" @favorite-changed="handleFavoriteChanged" />
    </main>
</template>

<style scoped>
.home-page {
    --home-text: var(--market-footer-text, #2f2412);
    --home-muted: color-mix(in srgb, var(--market-footer-text, #2f2412) 62%, #fff);
    --home-border: var(--market-card-border, #efe3c8);
    min-height: 100vh;
    padding: 1rem 0 2.5rem;
}

.home-layout-slot {
    --home-section-radius: 20px;
    width: min(1280px, calc(100% - 2rem));
    margin: 0 auto;
}

.home-layout-width-wide {
    width: min(1480px, calc(100% - 1rem));
}

.home-layout-width-full {
    width: 100%;
}

.home-layout-width-full .hero-shell,
.home-layout-width-full .home-footer {
    border-right: 0;
    border-left: 0;
}

/* ── แถบสไลด์ hero ──────────────────────────────────────────────────────
   viewport = กล่องนอกที่ครอบจุดบอกตำแหน่ง (dots) ไว้
   track    = แถบเลื่อนแนวนอนที่มีสไลด์เรียงกัน ยึดทีละใบด้วย scroll-snap */
.hero-viewport {
    position: relative;
}

.hero-track {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    /* ซ่อนแถบเลื่อน — ใช้จุดด้านล่างกับการปัดนิ้วแทน */
    scrollbar-width: none;
    -ms-overflow-style: none;
    overscroll-behavior-x: contain;
}

.hero-track::-webkit-scrollbar {
    display: none;
}

/* ใบละ 96% ของแถบ ทำให้ใบถัดไปโผล่มาให้เห็นนิดหนึ่ง = สัญญาณว่าปัดต่อได้
   มีใบเดียวก็เต็ม 100% ไปเลย ไม่ต้องเว้นที่เผื่อใบที่ไม่มี */
.hero-slide {
    flex: 0 0 96%;
    scroll-snap-align: center;
    /* margin ของ .hero-shell ใช้กับกล่องนอกแทน ไม่งั้นทุกใบจะเว้นซ้อนกันในแถบ */
    margin-left: 0;
    margin-right: 0;
}

.hero-track.is-single .hero-slide {
    flex-basis: 100%;
}

/* ปัดนิ้วบนมือถือให้เต็มจอกว่า — จอแคบพื้นที่เหลือน้อย โผล่แค่พอเห็นขอบ */
@media (max-width: 575.98px) {
    .hero-slide {
        flex-basis: 93%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .hero-track {
        scroll-behavior: auto;
    }
}

.hero-shell {
    margin-top: 10px;
    margin-bottom: 10px;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.85fr);
    gap: 1.25rem;
    min-height: 25rem;
    overflow: hidden;
    border: 1px solid var(--home-border);
    border-radius: var(--home-section-radius, 1.25rem);
    padding: clamp(1.1rem, 3vw, 2.4rem);
    background: linear-gradient(120deg, color-mix(in srgb, var(--market-accent, #f97316) 16%, #fff) 0%, color-mix(in srgb, var(--market-accent, #f97316) 38%, #fff) 48%, var(--market-primary, #0f9f6e) 100%);
    box-shadow: 0 18px 36px rgba(126, 87, 31, 0.16);
}

.hero-tone-red {
    background: linear-gradient(120deg, #fff0e6 0%, #ffb199 50%, #ef4444 100%);
}
.hero-tone-blue {
    background: linear-gradient(120deg, #e6f5ff 0%, #8cc7ff 52%, #2563eb 100%);
}
.hero-tone-teal {
    background: linear-gradient(120deg, #fff7df 0%, #fed785 48%, #0fba93 100%);
}
.hero-tone-gold {
    background: linear-gradient(120deg, #fff7d6 0%, #facc15 48%, #f97316 100%);
}
.hero-tone-green {
    background: linear-gradient(120deg, #f0fdf4 0%, #86efac 48%, #16a34a 100%);
}
.hero-tone-rose {
    background: linear-gradient(120deg, #fff1f2 0%, #fda4af 48%, #e11d48 100%);
}
.hero-tone-dark {
    background: linear-gradient(120deg, #f8fafc 0%, #94a3b8 42%, #111827 100%);
}

.hero-height-compact {
    --hero-preset-height: 20rem;
}

.hero-height-tall {
    --hero-preset-height: clamp(30rem, 52vw, 40rem);
}

.hero-custom-height-preset {
    min-height: var(--hero-preset-height, 25rem);
}

.hero-custom-height-fixed {
    min-height: var(--hero-fixed-height, var(--hero-preset-height, 25rem));
}

.hero-custom-height-ratio {
    aspect-ratio: var(--hero-aspect-ratio, 21 / 8);
    min-height: 0;
}

.hero-custom-height-auto {
    min-height: 0;
}

.hero-image-only {
    grid-template-columns: 1fr;
    padding: 0;
    background-color: var(--market-card-bg, #fff);
    background-position: center;
    background-repeat: no-repeat;
}

.hero-image-only.hero-custom-height-auto {
    min-height: 0;
    background-image: none !important;
}

.hero-image-only-auto-image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: inherit;
    object-fit: contain;
}

.hero-mobile-full-image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: inherit;
    object-fit: contain;
}

.hero-text-hidden {
    place-items: stretch;
}

.hero-skeleton {
    grid-column: 1 / -1;
    display: grid;
    gap: 1rem;
}

.hero-copy {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    max-width: 42rem;
}

.hero-copy-center {
    align-items: center;
    text-align: center;
    justify-self: center;
}
.hero-copy-right {
    align-items: flex-end;
    text-align: right;
    justify-self: end;
}

.hero-eyebrow {
    margin: 0 0 0.5rem;
    color: var(--hero-custom-text, rgba(47, 36, 18, 0.72));
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.hero-copy h1 {
    margin: 0;
    max-width: 14ch;
    color: var(--hero-custom-text, var(--home-text));
    font-size: clamp(2.2rem, 6vw, 4.8rem);
    line-height: 0.98;
    letter-spacing: 0;
}

.hero-subtitle {
    max-width: 40rem;
    margin: 1rem 0 0;
    color: var(--hero-custom-text, rgba(47, 36, 18, 0.78));
    font-size: clamp(1rem, 2vw, 1.2rem);
    line-height: 1.65;
}

.hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.3rem;
}

.hero-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-top: 1rem;
}

.hero-badges span,
.hero-badges strong {
    border-radius: 999px;
    padding: 0.42rem 0.7rem;
    background: rgba(255, 255, 255, 0.75);
    color: var(--market-header-text, #6b3b08);
    font-size: 0.84rem;
}

.hero-media {
    position: relative;
    z-index: 1;
    height: clamp(14rem, 28vw, 20rem);
    min-height: 17rem;
    border-radius: max(0px, calc(var(--home-section-radius, 16px) * 0.8));
    overflow: hidden;
    background: rgba(255, 255, 255, 0.32);
}

.hero-media-left {
    grid-row: 1;
    grid-column: 1;
}

.hero-media-left + .hero-copy,
.hero-media-left ~ .hero-copy {
    grid-column: 2;
}

.hero-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.hero-media-placeholder {
    display: grid;
    place-items: center;
    color: rgba(47, 36, 18, 0.65);
    font-weight: 900;
    font-size: 1.2rem;
}

.hero-media-placeholder i {
    font-size: 5rem;
}

.hero-layout-background {
    grid-template-columns: 1fr;
    min-height: clamp(22rem, 44vw, 34rem);
    background-position: center;
    background-size: cover;
}

.hero-layout-background .hero-copy {
    max-width: min(46rem, 92%);
}

.hero-layout-background .hero-copy h1,
.hero-layout-background .hero-subtitle,
.hero-layout-background .hero-eyebrow {
    color: var(--hero-custom-text, #fff);
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.28);
}

.hero-has-background {
    background-position: center;
    background-size: cover;
}

.hero-has-background .hero-copy h1,
.hero-has-background .hero-subtitle,
.hero-has-background .hero-eyebrow {
    color: var(--hero-custom-text, #fff);
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.3);
}

.hero-layout-background .hero-badges span,
.hero-layout-background .hero-badges strong {
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(10px);
}

/* จุดบอกตำแหน่งอยู่บน .hero-viewport (ไม่ได้อยู่ในสไลด์แล้ว) จะได้ไม่เลื่อนตามแถบไปด้วย */
.hero-dots {
    position: absolute;
    left: 50%;
    bottom: 1.6rem;
    z-index: 2;
    display: flex;
    gap: 0.4rem;
    transform: translateX(-50%);
}

.hero-dots button {
    width: 0.55rem;
    height: 0.55rem;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    cursor: pointer;
}

.hero-dots button.active {
    width: 1.8rem;
    background: #2f2412;
}

.promo-grid {
    display: grid;
    grid-template-columns: repeat(var(--promo-grid-columns, 3), minmax(0, 1fr));
    grid-auto-flow: dense;
    grid-auto-rows: auto;
    gap: var(--promo-grid-gap, 14px);
    margin-top: 1rem;
}

.promo-layout-equal .promo-tile,
.promo-layout-row .promo-tile {
    grid-column: span 1;
    grid-row: span 1;
}

.promo-layout-row {
    grid-auto-flow: column;
    grid-auto-columns: minmax(16rem, 1fr);
    grid-template-columns: none;
    overflow-x: auto;
    padding-bottom: 0.4rem;
}

.promo-layout-row .promo-tile {
    min-width: 16rem;
}

.promo-tile {
    grid-column: span var(--promo-col-span, 1);
    grid-row: span var(--promo-row-span, 1);
    min-height: calc(clamp(7rem, 10vw, 9rem) * var(--promo-row-span, 1));
    border: 1px solid var(--home-border);
    border-radius: var(--home-section-radius, 1rem);
    padding: 1rem;
    background: var(--market-card-bg, #fffaf0);
    background-position: center;
    background-repeat: no-repeat;
    color: inherit;
    display: block;
    text-align: left;
    text-decoration: none;
    transition:
        transform 160ms ease,
        box-shadow 160ms ease;
}

.promo-tile-clickable {
    cursor: pointer;
}

.promo-tile-static {
    cursor: default;
}

.promo-height-fixed {
    min-height: var(--promo-fixed-height, 11rem);
    height: var(--promo-fixed-height, 11rem);
}

.promo-height-ratio {
    min-height: auto;
    aspect-ratio: var(--promo-aspect-ratio, 16 / 5);
}

.promo-height-auto {
    min-height: unset;
}

.promo-tile-image {
    overflow: hidden;
    color: #fff;
    box-shadow: inset 0 -48px 72px rgba(0, 0, 0, 0.08);
}

.promo-tile-clean {
    padding: 0;
    background-color: #fff;
}

.promo-tile-clickable:hover,
.home-product-card:hover,
.category-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 24px rgba(126, 87, 31, 0.12);
}

.promo-tile-auto-image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: inherit;
    object-fit: contain;
}

@media (max-width: 560px) {
    .hero-custom-height-fixed {
        min-height: var(--hero-fixed-height-mobile, var(--hero-fixed-height, var(--hero-preset-height, 25rem)));
    }

    .promo-height-fixed {
        min-height: var(--promo-fixed-height-mobile, var(--promo-fixed-height, 11rem));
        height: var(--promo-fixed-height-mobile, var(--promo-fixed-height, 11rem));
    }
}

.promo-tile span,
.section-heading p {
    color: var(--promo-text-color, var(--home-muted));
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
}

.promo-tile-image span,
.promo-tile-image strong,
.promo-tile-image small {
    color: var(--promo-text-color, #fff);
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
}

.promo-tile strong {
    display: block;
    margin-top: 0.4rem;
    color: var(--promo-text-color, var(--home-text));
    font-size: 1.65rem;
}

.promo-tile small {
    display: block;
    margin-top: 0.35rem;
    color: var(--promo-text-color, #6f6046);
    line-height: 1.4;
}

.promo-tone-red {
    background: linear-gradient(135deg, #fff4f0 0%, #ffe0d6 100%);
}
.promo-tone-blue {
    background: linear-gradient(135deg, #eef7ff 0%, #dbeafe 100%);
}
.promo-tone-teal {
    background: linear-gradient(135deg, #eefff9 0%, #d1fae5 100%);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
}

.home-section {
    margin-top: 1.45rem;
}

.section-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1rem;
    margin-bottom: 0.8rem;
}

.section-heading h2 {
    margin: 0.1rem 0;
    color: var(--home-text);
    font-size: clamp(1.35rem, 3vw, 2rem);
}

.section-heading span {
    color: var(--home-muted);
}

.category-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
}

.category-density-compact {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.category-density-compact .category-card {
    grid-template-columns: minmax(0, 1fr) 7rem;
    min-height: 7.8rem;
    padding: 0.75rem;
}

.category-density-compact .category-preview img {
    width: 3.2rem;
    height: 3.2rem;
}

.category-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 9rem;
    min-height: 9.4rem;
    border: 1px solid var(--home-border);
    border-radius: var(--home-section-radius, 1rem);
    padding: 1rem;
    background: var(--market-card-bg, #fffdf8);
    text-align: left;
    cursor: pointer;
}

.category-card span {
    color: var(--home-text);
    font-size: 1.05rem;
    font-weight: 800;
}

.category-card small {
    display: block;
    margin-top: 0.35rem;
    color: var(--home-muted);
}

.category-preview {
    display: flex;
    justify-content: flex-end;
    align-items: center;
}

.category-preview img {
    width: 4rem;
    height: 4rem;
    margin-left: -1.2rem;
    border: 2px solid var(--market-card-bg, #fff);
    border-radius: max(0px, calc(var(--home-section-radius, 16px) - 4px));
    background: var(--market-card-bg, #fff);
    object-fit: contain;
}

.product-strip {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(11rem, 13rem);
    gap: 0.85rem;
    overflow-x: auto;
    padding: 0.1rem 0.1rem 0.6rem;
    scroll-snap-type: x proximity;
}

.product-display-grid {
    grid-auto-flow: row;
    grid-template-columns: repeat(var(--product-grid-columns, 4), minmax(0, 1fr));
    overflow: visible;
    padding-bottom: 0;
    scroll-snap-type: none;
}

.product-strip::-webkit-scrollbar {
    height: 0.45rem;
}

.product-strip::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: #ddc48c;
}

/* โครงการ์ดมาจาก ProductCard + shop-card.scss แล้ว เหลือเฉพาะสิ่งที่หน้าแรกกำหนดเอง */
.home-product-card {
    border-color: var(--home-border);
    /* รัศมีมุมเป็นค่าที่แอดมินตั้งได้ต่อ section — ต้องทับค่าจาก shop-card */
    border-radius: var(--product-card-radius, var(--home-section-radius, 0.9rem));
    background: var(--market-card-bg, #fff);
    scroll-snap-align: start;
}

/* ⚠️ --product-image-height เป็นค่าที่แอดมินตั้งได้ในหน้าจัดการเนื้อหา
   ProductCard ใช้ aspect-ratio 1/1 เป็นค่าเริ่มต้น จึงต้องปิดแล้วใช้ความสูงจริงที่ตั้งไว้
   ไม่งั้น preview ในหน้าแอดมินจะไม่ตรงกับหน้าจริง */
.home-product-card :deep(.shop-card-media) {
    aspect-ratio: auto;
    height: var(--product-image-height, 9rem);
    border-radius: max(0px, calc(var(--product-card-radius, var(--home-section-radius, 14px)) - 4px));
    background: var(--market-product-image-bg, color-mix(in srgb, var(--market-accent, #f97316) 9%, var(--market-card-bg, #fffaf0)));
}

.home-product-card :deep(.shop-card-name) {
    color: var(--home-text);
    font-weight: 700;
    line-height: 1.35;
}

.home-product-card strong {
    display: block;
    margin-top: 0.45rem;
    color: var(--market-primary, #0f9f6e);
    font-size: 1.1rem;
}

.home-product-card strong em {
    color: #8b7a5c;
    font-size: 0.76rem;
    font-style: normal;
    font-weight: 700;
}

.home-product-card small {
    display: block;
    margin-top: 0.45rem;
    color: var(--home-muted);
}

.home-product-price-row {
    min-height: 2rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.45rem;
}

.home-product-price-row strong,
.home-product-price-row small {
    margin-top: 0;
}

.home-product-return-icon {
    width: 2rem;
    height: 2rem;
    object-fit: contain;
    flex: 0 0 auto;
    margin-left: auto;
}

.home-footer {
    margin-top: 2rem;
    overflow: hidden;
    border: 1px solid var(--home-border);
    border-radius: var(--home-section-radius, 1.25rem);
    background: var(--market-footer-bg, #fff7e6);
    color: var(--market-footer-text, var(--home-text));
    box-shadow: 0 14px 28px rgba(126, 87, 31, 0.1);
}

.footer-main {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(11rem, 0.65fr) minmax(13rem, 0.8fr);
    gap: 1.4rem;
    padding: clamp(1.1rem, 3vw, 1.7rem);
}

.footer-brand-head {
    display: flex;
    align-items: center;
    gap: 0.9rem;
}

.footer-brand-logo {
    width: clamp(9.5rem, 14vw, 12rem);
    height: 3.5rem;
    flex: 0 0 auto;
    object-fit: contain;
}

.footer-brand h2,
.footer-links h3,
.footer-line h3 {
    margin: 0;
    color: var(--market-footer-text, #5b4a27);
}

.footer-brand p {
    margin: 0.35rem 0 0;
    color: var(--home-muted);
    line-height: 1.6;
}

.footer-contact-list {
    display: grid;
    gap: 0.55rem;
    margin-top: 1rem;
}

.footer-contact-item {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    color: color-mix(in srgb, var(--market-footer-text, #6b5a37) 82%, #fff);
    line-height: 1.55;
}

.footer-contact-item i {
    margin-top: 0.16rem;
    color: var(--market-primary, #0f9f6e);
}

.footer-contact-item a {
    color: inherit;
    text-decoration: none;
}

.footer-links,
.footer-line {
    display: grid;
    align-content: start;
    gap: 0.65rem;
}

.footer-links button {
    width: fit-content;
    border: 0;
    background: transparent;
    color: var(--market-footer-text, #6b5a37);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0;
    text-align: left;
}

.footer-links button:hover,
.footer-contact-item a:hover {
    color: var(--market-primary, #0f9f6e);
}

.footer-line-card {
    display: grid;
    gap: 0.55rem;
    max-width: 11rem;
    color: var(--home-muted);
    text-align: center;
    text-decoration: none;
}

.footer-line-card img {
    width: 9.5rem;
    height: 9.5rem;
    border: 1px solid #efe3c8;
    border-radius: max(0px, calc(var(--home-section-radius, 20px) - 4px));
    background: #fff;
    object-fit: contain;
    padding: 0.45rem;
}

.footer-line-card span {
    font-size: 0.82rem;
    line-height: 1.45;
}

.footer-bottom {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid #efe3c8;
    background: color-mix(in srgb, var(--market-footer-bg, #fff7e6) 82%, #fff);
    padding: 0.85rem clamp(1.1rem, 3vw, 1.7rem);
    color: var(--home-muted);
    font-size: 0.86rem;
}

.home-alert-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2200;
    display: grid;
    place-items: center;
    padding: 1rem;
}

.home-alert-backdrop-soft {
    background: rgba(8, 13, 22, 0.58);
    backdrop-filter: blur(5px);
}

.home-alert-backdrop-clear {
    background: transparent;
}

.home-alert-dialog {
    position: relative;
    overflow: visible;
    background: transparent;
    box-shadow: 0 24px 80px rgba(15, 23, 42, 0.32);
}

.home-alert-image-link,
.home-alert-image {
    display: block;
}

.home-alert-image-link {
    color: inherit;
    text-decoration: none;
}

.home-alert-image {
    width: 100%;
    height: auto;
    object-fit: contain;
    border-radius: inherit;
}

.home-alert-close {
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

.home-alert-close:hover {
    color: var(--market-primary, #0f9f6e);
}

@media (max-width: 900px) {
    .hero-shell {
        grid-template-columns: 1fr;
        min-height: unset;
    }

    .hero-mobile-full-image-shell {
        min-height: 0 !important;
        aspect-ratio: auto !important;
        padding: 0;
        background-image: none !important;
        background-color: transparent;
    }

    .hero-media {
        height: 15rem;
        min-height: 15rem;
    }

    .promo-grid,
    .category-grid {
        grid-template-columns: repeat(var(--promo-grid-columns-tablet, 2), minmax(0, 1fr));
    }

    .promo-tile {
        grid-column: span var(--promo-col-span-tablet, 1);
        grid-row: span 1;
    }

    .category-grid {
        grid-template-columns: 1fr 1fr;
    }

    .footer-main {
        grid-template-columns: 1fr 1fr;
    }

    .footer-brand {
        grid-column: 1 / -1;
    }

    .product-display-grid {
        grid-template-columns: repeat(var(--product-grid-columns-tablet, 3), minmax(0, 1fr));
    }
}

@media (max-width: 560px) {
    .home-page {
        padding-top: 0.45rem;
    }

    .hero-shell {
    }

    .hero-copy h1 {
        font-size: 2.25rem;
    }

    .hero-media {
        height: 11.5rem;
        min-height: 11.5rem;
    }

    .hero-actions,
    .section-heading {
        align-items: stretch;
        flex-direction: column;
    }

    .promo-grid,
    .category-grid {
        grid-template-columns: repeat(var(--promo-grid-columns-mobile, 1), minmax(0, 1fr));
    }

    .category-grid {
        grid-template-columns: 1fr;
    }

    .promo-tile {
        grid-column: span var(--promo-col-span-mobile, 1);
    }

    .category-card {
        grid-template-columns: 1fr 7rem;
    }

    .product-strip {
        grid-auto-columns: minmax(9.5rem, 10.5rem);
    }

    .product-display-grid {
        grid-template-columns: repeat(var(--product-grid-columns-mobile, 2), minmax(0, 1fr));
        grid-auto-columns: unset;
    }

    /* กล่องรูปย้ายไปอยู่ใน ProductCard (.shop-card-media) แล้ว จึงต้องใช้ :deep
       ถ้าปล่อยเป็น .home-product-image เดิมจะไม่ match อะไรเลย รูปบนมือถือจะสูงเท่าเดสก์ท็อป */
    .home-product-card :deep(.shop-card-media) {
        height: 7.5rem;
    }

    .footer-main {
        grid-template-columns: 1fr;
    }

    .footer-brand-head {
        align-items: flex-start;
    }

    .footer-bottom {
        flex-direction: column;
    }
}
</style>

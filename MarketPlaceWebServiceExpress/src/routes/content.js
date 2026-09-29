const express = require('express');
const { requireAdmin } = require('../auth/requireAdmin');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const DATA_DIR = process.env.MARKETPLACE_DATA_DIR || path.join(__dirname, '../../data');
const CONTENT_DIR = process.env.MARKETPLACE_CONTENT_DIR || path.join(DATA_DIR, 'content');
const LEGACY_CONTENT_FILE = path.join(DATA_DIR, 'marketplace-content.json');
const CONTENT_SCOPE = process.env.MARKETPLACE_CONTENT_SCOPE || 'database';
const SITE_NAME = process.env.MARKETPLACE_SITE_NAME || process.env.NEXT_PUBLIC_SITE_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'MarketPlace';

function getContentFile() {
  const cleanScope = (value, fallback = 'default') => String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;

  if (CONTENT_SCOPE === 'global') {
    return path.join(CONTENT_DIR, 'marketplace-content.json');
  }

  if (CONTENT_SCOPE && CONTENT_SCOPE !== 'database') {
    return path.join(CONTENT_DIR, `marketplace-content.${cleanScope(CONTENT_SCOPE)}.json`);
  }

  const dbName = cleanScope(process.env.DB_NAME, 'default');

  return path.join(CONTENT_DIR, `marketplace-content.${dbName}.json`);
}

// ⚠️ นี่คือค่าที่ชนะที่สุด — ร้านที่ยังไม่มีไฟล์ content ของตัวเองจะได้ชุดนี้ผ่าน API
//    แล้ว frontend เขียนเป็น inline style บน <html> ทับ CSS ทั้งหมด
//    ต้องตรงกับ MarketPlaceWeb: styles.scss (:root), AppLayout.defaultTheme, Landing fallbackContent.theme
const defaultTheme = {
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
  footerTextColor: '#1f2937',
};

// Shop Green รุ่นเดิมยังเลือกได้จากหลังบ้าน ร้านที่เคยบันทึกไว้จึงไม่เปลี่ยนสีอัตโนมัติ
const shopGreenTheme = {
  preset: 'shopGreen',
  basePreset: 'shopGreen',
  primaryColor: '#0f9f6e',
  accentColor: '#f97316',
  headerBackground: '#0a7d56',
  headerTextColor: '#ffffff',
  backgroundColor: '#f4f6f8',
  productCardBackground: '#ffffff',
  productImageBackground: '#ffffff',
  productCardBorder: '#e6ebef',
  footerBackground: '#ffffff',
  footerTextColor: '#1f2937',
};

// ธีมครีม-ทองชุดเดิม เก็บไว้ให้ร้านที่ยังอยากใช้เลือกได้จากหน้าแอดมิน
const warmTheme = {
  preset: 'warm',
  basePreset: 'warm',
  primaryColor: '#0f9f6e',
  accentColor: '#f97316',
  headerBackground: '#f7ebcf',
  headerTextColor: '#5b4a27',
  backgroundColor: '#fff8ee',
  productCardBackground: '#ffffff',
  productImageBackground: '#fff7ed',
  productCardBorder: '#efe3c8',
  footerBackground: '#fff7e6',
  footerTextColor: '#2f2412',
};

const themePresets = {
  cleanGreen: defaultTheme,
  shopGreen: shopGreenTheme,
  warm: warmTheme,
  blue: {
    preset: 'blue',
    primaryColor: '#2563eb',
    accentColor: '#f59e0b',
    headerBackground: '#eaf3ff',
    headerTextColor: '#172554',
    backgroundColor: '#f8fbff',
    productCardBackground: '#ffffff',
    productImageBackground: '#eff6ff',
    productCardBorder: '#dbeafe',
    footerBackground: '#eff6ff',
    footerTextColor: '#172554',
  },
  red: {
    preset: 'red',
    primaryColor: '#b91c1c',
    accentColor: '#f97316',
    headerBackground: '#fff1f2',
    headerTextColor: '#7f1d1d',
    backgroundColor: '#fff7f8',
    productCardBackground: '#ffffff',
    productImageBackground: '#fff1f2',
    productCardBorder: '#fecdd3',
    footerBackground: '#fff1f2',
    footerTextColor: '#7f1d1d',
  },
  green: {
    preset: 'green',
    primaryColor: '#15803d',
    accentColor: '#eab308',
    headerBackground: '#ecfdf5',
    headerTextColor: '#14532d',
    backgroundColor: '#f7fef9',
    productCardBackground: '#ffffff',
    productImageBackground: '#f0fdf4',
    productCardBorder: '#bbf7d0',
    footerBackground: '#f0fdf4',
    footerTextColor: '#14532d',
  },
  dark: {
    preset: 'dark',
    primaryColor: '#38bdf8',
    accentColor: '#f59e0b',
    headerBackground: '#111827',
    headerTextColor: '#f8fafc',
    backgroundColor: '#f8fafc',
    productCardBackground: '#ffffff',
    productImageBackground: '#f3f4f6',
    productCardBorder: '#d1d5db',
    footerBackground: '#111827',
    footerTextColor: '#f8fafc',
  },
  minimal: {
    preset: 'minimal',
    primaryColor: '#334155',
    accentColor: '#d97706',
    headerBackground: '#f8fafc',
    headerTextColor: '#0f172a',
    backgroundColor: '#f8fafc',
    productCardBackground: '#ffffff',
    productImageBackground: '#f8fafc',
    productCardBorder: '#e2e8f0',
    footerBackground: '#f1f5f9',
    footerTextColor: '#0f172a',
  },
  cleanWhite: {
    preset: 'cleanWhite',
    primaryColor: '#111827',
    accentColor: '#ef4444',
    headerBackground: '#ffffff',
    headerTextColor: '#111827',
    backgroundColor: '#ffffff',
    productCardBackground: '#ffffff',
    productImageBackground: '#ffffff',
    productCardBorder: '#e5e7eb',
    footerBackground: '#ffffff',
    footerTextColor: '#111827',
  },
  cleanMinimal: {
    preset: 'cleanMinimal',
    primaryColor: '#2563EB',
    accentColor: '#0F172A',
    headerBackground: '#FFFFFF',
    headerTextColor: '#0F172A',
    backgroundColor: '#FFFFFF',
    productCardBackground: '#FFFFFF',
    productImageBackground: '#F8FAFC',
    productCardBorder: '#E2E8F0',
    footerBackground: '#F8FAFC',
    footerTextColor: '#0F172A',
  },
  pureWhite: {
    preset: 'pureWhite',
    primaryColor: '#000000',
    accentColor: '#555555',
    headerBackground: '#FFFFFF',
    headerTextColor: '#111111',
    backgroundColor: '#FFFFFF',
    productCardBackground: '#FFFFFF',
    productImageBackground: '#FFFFFF',
    productCardBorder: '#EEEEEE',
    footerBackground: '#FFFFFF',
    footerTextColor: '#111111',
  },
  whiteSoftBlue: {
    preset: 'whiteSoftBlue',
    primaryColor: '#3B82F6',
    accentColor: '#22D3EE',
    headerBackground: '#FFFFFF',
    headerTextColor: '#1E293B',
    backgroundColor: '#F1F5F9',
    productCardBackground: '#FFFFFF',
    productImageBackground: '#EFF6FF',
    productCardBorder: '#93C5FD',
    footerBackground: '#F1F5F9',
    footerTextColor: '#1E293B',
  },
  whiteLuxuryGold: {
    preset: 'whiteLuxuryGold',
    primaryColor: '#D4AF37',
    accentColor: '#111827',
    headerBackground: '#FFFFFF',
    headerTextColor: '#111827',
    backgroundColor: '#FAFAFA',
    productCardBackground: '#FFFFFF',
    productImageBackground: '#FFF7ED',
    productCardBorder: '#F7E7CE',
    footerBackground: '#FAFAFA',
    footerTextColor: '#111827',
  },
  tech: {
    preset: 'tech',
    primaryColor: '#0ea5e9',
    accentColor: '#22c55e',
    headerBackground: '#e0f2fe',
    headerTextColor: '#082f49',
    backgroundColor: '#f0f9ff',
    productCardBackground: '#ffffff',
    productImageBackground: '#e0f2fe',
    productCardBorder: '#bae6fd',
    footerBackground: '#f0f9ff',
    footerTextColor: '#082f49',
  },
  fresh: {
    preset: 'fresh',
    primaryColor: '#059669',
    accentColor: '#f43f5e',
    headerBackground: '#ecfdf5',
    headerTextColor: '#064e3b',
    backgroundColor: '#f7fef9',
    productCardBackground: '#ffffff',
    productImageBackground: '#ecfdf5',
    productCardBorder: '#a7f3d0',
    footerBackground: '#f0fdf4',
    footerTextColor: '#064e3b',
  },
  premiumGold: {
    preset: 'premiumGold',
    primaryColor: '#92400e',
    accentColor: '#fbbf24',
    headerBackground: '#1f2937',
    headerTextColor: '#fef3c7',
    backgroundColor: '#f8fafc',
    productCardBackground: '#ffffff',
    productImageBackground: '#fffbeb',
    productCardBorder: '#fde68a',
    footerBackground: '#111827',
    footerTextColor: '#fef3c7',
  },
  pastel: {
    preset: 'pastel',
    primaryColor: '#7c3aed',
    accentColor: '#fb7185',
    headerBackground: '#faf5ff',
    headerTextColor: '#3b0764',
    backgroundColor: '#fff7fb',
    productCardBackground: '#ffffff',
    productImageBackground: '#faf5ff',
    productCardBorder: '#e9d5ff',
    footerBackground: '#fff1f2',
    footerTextColor: '#3b0764',
  },
};

const defaultHomeLayout = [
  { type: 'hero', enabled: true, settings: { width: 'boxed', radius: 20, height: 'normal' } },
  { type: 'promoGrid', enabled: true, settings: { width: 'boxed', radius: 16, layout: 'mosaic', maxItems: 4, desktopColumns: 3, tabletColumns: 2, mobileColumns: 1, gap: 14 } },
  { type: 'categories', enabled: true, settings: { width: 'boxed', radius: 16, maxItems: 6, density: 'comfortable' } },
  { type: 'productSections', enabled: true, settings: { width: 'boxed', radius: 14, display: 'slider', gridColumns: 4, cardRadius: 14, imageHeight: 144 } },
  { type: 'footer', enabled: true, settings: { width: 'boxed', radius: 20 } },
];

const defaultAlertPopup = {
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
};

const homeLayoutTypes = new Set(defaultHomeLayout.map((item) => item.type));
const sectionWidths = new Set(['boxed', 'wide', 'full']);
const heroHeights = new Set(['compact', 'normal', 'tall']);
const promoLayouts = new Set(['mosaic', 'equal', 'row']);
const categoryDensities = new Set(['compact', 'comfortable']);
const productDisplays = new Set(['slider', 'grid']);
const slideModes = new Set(['campaign', 'imageOnly', 'background']);
const heightModes = new Set(['preset', 'fixed', 'ratio', 'auto']);
const aspectRatios = new Set(['auto', '16/5', '21/8', '21/6', '2/1', '1/1']);
const alertTargets = new Set(['_self', '_blank']);
const alertFrequencies = new Set(['always', 'oncePerSession', 'oncePerDay', 'onceForever']);
const alertDevices = new Set(['all', 'desktop', 'mobile']);

const defaultContent = {
  theme: defaultTheme,
  homeLayout: defaultHomeLayout,
  hero: {
    eyebrow: 'ONLINE MARKETPLACE',
    title: SITE_NAME,
    subtitle:
      '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 \u0e15\u0e23\u0e27\u0e08\u0e23\u0e32\u0e04\u0e32 \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e25\u0e07\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32 \u0e41\u0e25\u0e30\u0e2a\u0e31\u0e48\u0e07\u0e0b\u0e37\u0e49\u0e2d\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e44\u0e14\u0e49\u0e2a\u0e30\u0e14\u0e27\u0e01\u0e1c\u0e48\u0e32\u0e19\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e49\u0e32\u0e19\u0e2d\u0e2d\u0e19\u0e44\u0e25\u0e19\u0e4c',
    primaryLabel: '\u0e14\u0e39\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32',
    secondaryLabel: '\u0e14\u0e39\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32'
  },
  highlights: [],
  featuredProductCodes: [],
  slides: [
    {
      eyebrow: 'ONLINE MARKETPLACE',
      title: SITE_NAME,
      subtitle:
        '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 \u0e15\u0e23\u0e27\u0e08\u0e23\u0e32\u0e04\u0e32 \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e25\u0e07\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32 \u0e41\u0e25\u0e30\u0e2a\u0e31\u0e48\u0e07\u0e0b\u0e37\u0e49\u0e2d\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e44\u0e14\u0e49\u0e2a\u0e30\u0e14\u0e27\u0e01\u0e1c\u0e48\u0e32\u0e19\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e49\u0e32\u0e19\u0e2d\u0e2d\u0e19\u0e44\u0e25\u0e19\u0e4c',
      ctaLabel: '\u0e14\u0e39\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32',
      href: '/marketplace',
      imageUrl: '/assets/shop-preview.png',
      imageAlt: '\u0e20\u0e32\u0e1e\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e49\u0e32\u0e19',
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
      badge: '\u0e41\u0e04\u0e21\u0e40\u0e1b\u0e0d\u0e40\u0e14\u0e48\u0e19',
      priceText: '',
      discountText: '',
      expiresAt: '',
      layout: 'split',
      contentPosition: 'left',
      imagePosition: 'right',
      tone: 'teal',
      enabled: true,
    },
    {
      eyebrow: 'PROMOTION',
      title: '\u0e25\u0e14\u0e41\u0e23\u0e07\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e42\u0e1b\u0e23',
      subtitle:
        '\u0e23\u0e27\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e23\u0e48\u0e27\u0e21\u0e42\u0e1b\u0e23\u0e44\u0e27\u0e49\u0e43\u0e19\u0e1a\u0e25\u0e47\u0e2d\u0e01\u0e40\u0e14\u0e35\u0e22\u0e27 \u0e04\u0e25\u0e34\u0e01\u0e14\u0e39\u0e23\u0e32\u0e04\u0e32\u0e41\u0e25\u0e30\u0e2b\u0e19\u0e48\u0e27\u0e22\u0e02\u0e32\u0e22\u0e44\u0e14\u0e49\u0e17\u0e31\u0e19\u0e17\u0e35',
      ctaLabel: '\u0e0a\u0e49\u0e2d\u0e1b\u0e40\u0e25\u0e22',
      href: '/marketplace?promo=1',
      imageUrl: '/assets/store-hero.jpg',
      imageAlt: '\u0e41\u0e1a\u0e19\u0e40\u0e19\u0e2d\u0e23\u0e4c\u0e42\u0e1b\u0e23\u0e42\u0e21\u0e0a\u0e31\u0e19',
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
      badge: '\u0e42\u0e1b\u0e23\u0e42\u0e21\u0e0a\u0e31\u0e19',
      priceText: '\u0e23\u0e32\u0e04\u0e32\u0e1e\u0e34\u0e40\u0e28\u0e29',
      discountText: '\u0e23\u0e32\u0e04\u0e32\u0e1e\u0e34\u0e40\u0e28\u0e29',
      expiresAt: '',
      layout: 'image-focus',
      contentPosition: 'left',
      imagePosition: 'right',
      tone: 'red',
      enabled: true,
    },
    {
      eyebrow: 'FAST ORDER',
      title: '\u0e04\u0e49\u0e19\u0e2b\u0e32 \u0e40\u0e25\u0e37\u0e2d\u0e01 \u0e2a\u0e31\u0e48\u0e07\u0e0b\u0e37\u0e49\u0e2d',
      subtitle:
        '\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e49\u0e32\u0e19\u0e40\u0e19\u0e49\u0e19\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19\u0e08\u0e23\u0e34\u0e07 \u0e14\u0e39\u0e23\u0e32\u0e04\u0e32 \u0e2b\u0e19\u0e48\u0e27\u0e22\u0e02\u0e32\u0e22 \u0e41\u0e25\u0e30\u0e40\u0e02\u0e49\u0e32\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32\u0e44\u0e14\u0e49\u0e17\u0e31\u0e19\u0e17\u0e35',
      ctaLabel: '\u0e0a\u0e49\u0e2d\u0e1b\u0e40\u0e25\u0e22',
      href: '/marketplace',
      imageUrl: '/assets/shop-preview.png',
      imageAlt: '\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e49\u0e32\u0e19',
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
      badge: '\u0e2a\u0e31\u0e48\u0e07\u0e44\u0e27',
      priceText: '',
      discountText: '\u0e2a\u0e15\u0e47\u0e2d\u0e01\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e02\u0e32\u0e22',
      expiresAt: '',
      layout: 'split',
      contentPosition: 'left',
      imagePosition: 'right',
      tone: 'blue',
      enabled: true,
    },
  ],
  promoBlocks: [
    {
      title: '\u0e0b\u0e37\u0e49\u0e2d\u0e04\u0e23\u0e1a 5,000',
      value: '\u0e25\u0e14 100',
      description: '\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e1e\u0e34\u0e40\u0e28\u0e29\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e22\u0e2d\u0e14\u0e0b\u0e37\u0e49\u0e2d\u0e16\u0e36\u0e07\u0e40\u0e01\u0e13\u0e11\u0e4c',
      href: '/marketplace?promo=1',
      tone: 'red',
      imageUrl: '',
      imageAlt: '',
      width: 2,
      height: 1,
      heightMode: 'ratio',
      desktopHeight: 180,
      mobileHeight: 120,
      aspectRatio: '16/5',
      imageFit: 'cover',
      textOverlay: true,
      textColor: '',
      enabled: true,
    },
    {
      title: '\u0e42\u0e1b\u0e23\u0e42\u0e21\u0e0a\u0e31\u0e19\u0e23\u0e32\u0e04\u0e32',
      value: '\u0e23\u0e32\u0e04\u0e32\u0e14\u0e35',
      description: '\u0e23\u0e27\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e23\u0e48\u0e27\u0e21\u0e42\u0e1b\u0e23\u0e44\u0e27\u0e49\u0e43\u0e2b\u0e49\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e07\u0e48\u0e32\u0e22',
      href: '/marketplace?promo=1',
      tone: 'teal',
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
    },
    {
      title: '\u0e08\u0e31\u0e14\u0e2a\u0e48\u0e07',
      value: '\u0e17\u0e31\u0e48\u0e27\u0e44\u0e1b',
      description: '\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e15\u0e48\u0e2d\u0e22\u0e2d\u0e14\u0e41\u0e08\u0e49\u0e07\u0e40\u0e15\u0e37\u0e2d\u0e19\u0e23\u0e2d\u0e1a\u0e2a\u0e48\u0e07',
      href: '/checkout',
      tone: 'blue',
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
    },
  ],
  alertPopup: defaultAlertPopup,
  categoryCodes: [],
  productSections: [
    {
      id: 'promotion',
      title: '\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e42\u0e1b\u0e23\u0e42\u0e21\u0e0a\u0e31\u0e19',
      subtitle: '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e23\u0e48\u0e27\u0e21\u0e42\u0e1b\u0e23\u0e17\u0e35\u0e48\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e14\u0e39\u0e23\u0e32\u0e04\u0e32\u0e41\u0e25\u0e30\u0e2b\u0e19\u0e48\u0e27\u0e22\u0e02\u0e32\u0e22',
      mode: 'promotion',
      categoryCode: '',
      productCodes: [],
      limit: 8,
      display: 'slider',
      gridColumns: 4,
      cardRadius: 14,
      imageHeight: 144,
      enabled: true,
    },
    {
      id: 'recommended',
      title: '\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e41\u0e19\u0e30\u0e19\u0e33',
      subtitle: '\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e19\u0e48\u0e32\u0e2a\u0e19\u0e43\u0e08\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e40\u0e23\u0e34\u0e48\u0e21\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e0b\u0e37\u0e49\u0e2d',
      mode: 'latest',
      categoryCode: '',
      productCodes: [],
      limit: 8,
      display: 'slider',
      gridColumns: 4,
      cardRadius: 14,
      imageHeight: 144,
      enabled: true,
    },
  ],
};

const tones = new Set(['teal', 'red', 'blue', 'gold', 'green', 'rose', 'dark']);
const slideLayouts = new Set(['split', 'image-focus', 'background']);
const slideContentPositions = new Set(['left', 'center', 'right']);
const slideImagePositions = new Set(['left', 'right']);
const promoImageFits = new Set(['cover', 'contain']);
const sectionModes = new Set(['promotion', 'latest', 'category', 'manual']);

async function readContent() {
  try {
    const raw = await fs.readFile(getContentFile(), 'utf8');
    const stored = JSON.parse(stripJsonBom(raw));
    return mergeContent(stored);
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (CONTENT_SCOPE === 'global') return readLegacyContent();
      return defaultContent;
    }
    throw error;
  }
}

async function writeContent(content) {
  await fs.mkdir(CONTENT_DIR, { recursive: true });
  await fs.writeFile(getContentFile(), JSON.stringify(content, null, 2), 'utf8');
}

async function readLegacyContent() {
  try {
    const raw = await fs.readFile(LEGACY_CONTENT_FILE, 'utf8');
    const stored = JSON.parse(stripJsonBom(raw));
    return mergeContent(stored);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultContent;
    throw error;
  }
}

function stripJsonBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function mergeContent(stored = {}) {
  const hero = { ...defaultContent.hero, ...(stored.hero || {}) };
  if (!stored.hero?.title || stored.hero.title === 'MarketPlace') {
    hero.title = SITE_NAME;
  }

  return {
    ...defaultContent,
    ...stored,
    hero,
    theme: cleanTheme(stored.theme || defaultTheme),
    homeLayout: cleanHomeLayout(stored.homeLayout || defaultHomeLayout),
    slides: Array.isArray(stored.slides) ? cleanSlides(stored.slides) : defaultContent.slides,
    promoBlocks: Array.isArray(stored.promoBlocks) ? cleanPromoBlocks(stored.promoBlocks) : defaultContent.promoBlocks,
    alertPopup: cleanAlertPopup(stored.alertPopup || defaultAlertPopup),
    categoryCodes: Array.isArray(stored.categoryCodes) ? stored.categoryCodes : defaultContent.categoryCodes,
    productSections: Array.isArray(stored.productSections) ? cleanProductSections(stored.productSections) : defaultContent.productSections,
    highlights: Array.isArray(stored.highlights) ? stored.highlights : defaultContent.highlights,
    featuredProductCodes: Array.isArray(stored.featuredProductCodes)
      ? stored.featuredProductCodes
      : defaultContent.featuredProductCodes,
  };
}

// ── ตรวจชนิดของ payload ก่อน merge ──────────────────────────────────────
//
// 🚨 mergeForSave ใช้ spread { ...existing, ...source } ค่าที่ผิดชนิดจึงทับของเดิม
//    แล้ว mergeContent เห็นว่าไม่ใช่ array ก็ตกไปใช้ defaultContent
//    ผลคือส่ง slides: null มา ได้ 200 แล้วสไลด์ที่แอดมินตั้งไว้กลายเป็นค่า factory default
//
// การ "ไม่ส่ง key" ปลอดภัยอยู่แล้วเพราะ spread ไม่รวม key ที่ไม่มี
// ปัญหาเกิดเฉพาะเมื่อส่ง key มาพร้อมชนิดที่ผิด จึงปฏิเสธเฉพาะกรณีนั้น
const CONTENT_ARRAY_FIELDS = ['slides', 'promoBlocks', 'productSections', 'homeLayout', 'categoryCodes', 'highlights', 'featuredProductCodes'];
const CONTENT_OBJECT_FIELDS = ['hero', 'theme', 'alertPopup'];
// อาร์เรย์ที่สมาชิกต้องเป็น object — ตัว clean*() ของฟิลด์พวกนี้อ่าน property ตรงๆ
// ส่ง [null] เข้าไปจึงพังเป็น 500 พร้อม error ดิบของ JS แทนที่จะเป็น 400 ภาษาไทย
// (categoryCodes / featuredProductCodes เป็นอาร์เรย์ของสตริง ตัว clean รับค่าอะไรก็ได้อยู่แล้ว)
// homeLayout ก็อ่าน item?.type ตรงๆ ใน cleanHomeLayout ส่ง [null] มาจึงตกไปใช้ layout เริ่มต้น
// ทั้งชุดแบบเงียบๆ (ตอบ 200) = ค่าที่แอดมินจัดลำดับไว้หายหมด อาการเดียวกับ slides
const CONTENT_OBJECT_ITEM_FIELDS = ['slides', 'promoBlocks', 'productSections', 'highlights', 'homeLayout'];

function assertContentShape(body) {
  const source = body || {};
  const bad = [];

  for (const key of CONTENT_ARRAY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (!Array.isArray(source[key])) {
      bad.push(`${key} ต้องเป็นรายการ (array)`);
      continue;
    }
    if (!CONTENT_OBJECT_ITEM_FIELDS.includes(key)) continue;
    const badIndex = source[key].findIndex((item) => item === null || typeof item !== 'object' || Array.isArray(item));
    if (badIndex >= 0) bad.push(`${key} รายการที่ ${badIndex + 1} ต้องเป็นชุดข้อมูล (object)`);
  }

  for (const key of CONTENT_OBJECT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) bad.push(`${key} ต้องเป็นชุดข้อมูล (object)`);
  }

  return bad;
}

function mergeForSave(existing, body) {
  const source = body || {};
  const themePatch = source.theme || null;
  const themePreset = cleanString(themePatch?.preset || '', 20);
  const shouldReplaceTheme =
    themePatch &&
    themePreset &&
    themePreset !== 'custom' &&
    themePresets[themePreset] &&
    !hasExplicitThemeColorOverride(themePatch, themePreset);

  return {
    ...existing,
    ...source,
    hero: {
      ...(existing.hero || {}),
      ...(source.hero || {}),
    },
    theme: shouldReplaceTheme
      ? { ...themePatch }
      : {
          ...(existing.theme || {}),
          ...(source.theme || {}),
        },
  };
}

function hasExplicitThemeColorOverride(theme, preset) {
  const presetTheme = themePresets[preset] || defaultTheme;
  const colorKeys = [
    'primaryColor',
    'accentColor',
    'headerBackground',
    'headerTextColor',
    'backgroundColor',
    'productCardBackground',
    'productImageBackground',
    'productCardBorder',
    'footerBackground',
    'footerTextColor',
  ];

  return colorKeys.some((key) => Object.prototype.hasOwnProperty.call(theme || {}, key) && cleanColor(theme[key]) && cleanColor(theme[key]) !== cleanColor(presetTheme[key]));
}

function cleanContent(body, existing = defaultContent) {
  const merged = mergeContent(mergeForSave(existing, body || {}));
  const hero = merged.hero || {};
  return {
    hero: {
      eyebrow: cleanString(hero.eyebrow, 80),
      title: cleanString(hero.title, 120),
      subtitle: cleanString(hero.subtitle, 500),
      primaryLabel: cleanString(hero.primaryLabel, 60),
      secondaryLabel: cleanString(hero.secondaryLabel, 60),
    },
    theme: cleanTheme(merged.theme),
    homeLayout: cleanHomeLayout(merged.homeLayout),
    highlights: cleanHighlights(merged.highlights),
    featuredProductCodes: cleanStringList(merged.featuredProductCodes, 24),
    slides: cleanSlides(merged.slides),
    promoBlocks: cleanPromoBlocks(merged.promoBlocks),
    alertPopup: cleanAlertPopup(merged.alertPopup),
    categoryCodes: cleanStringList(merged.categoryCodes, 24),
    productSections: cleanProductSections(merged.productSections),
  };
}

function validateContent(content) {
  const errors = [];
  validateAlertPopup(content.alertPopup, errors);

  const heroEnabled = (content.homeLayout || []).some((section) => section.type === 'hero' && section.enabled !== false);
  if (!heroEnabled) return errors;

  const activeSlides = Array.isArray(content.slides) ? content.slides.filter((slide) => slide.enabled !== false) : [];
  if (!activeSlides.length) {
    errors.push('เปิด Hero อยู่ แต่ไม่มี slide ที่เปิดใช้งาน');
    return errors;
  }

  activeSlides.forEach((slide, index) => {
    const hasImage = Boolean(cleanString(slide.imageUrl, 500) || cleanString(slide.backgroundImageUrl, 500));
    const hasText = slideHasVisibleText(slide);
    if (!hasImage && !hasText) errors.push(`Hero slide ${index + 1} ต้องมีรูปหรือข้อความอย่างน้อยหนึ่งอย่าง`);
    if ((slide.mode === 'imageOnly' || slide.textVisible === false) && !hasImage) errors.push(`Hero slide ${index + 1} เป็น image-only ต้องใส่รูปก่อนบันทึก`);
  });

  return errors;
}

function validateAlertPopup(popup, errors) {
  if (!popup?.enabled) return;
  if (!popup.imageUrl) errors.push('Alert Dialog ต้องมีรูปก่อนบันทึก');
  const startDate = popup.startAt ? new Date(popup.startAt) : null;
  const endDate = popup.endAt ? new Date(popup.endAt) : null;
  if (popup.startAt && (!startDate || Number.isNaN(startDate.getTime()))) errors.push('วันเริ่มแสดงของ Alert Dialog ไม่ถูกต้อง');
  if (popup.endAt && (!endDate || Number.isNaN(endDate.getTime()))) errors.push('วันสิ้นสุดของ Alert Dialog ไม่ถูกต้อง');
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) errors.push('วันเริ่มแสดงต้องไม่มากกว่าวันสิ้นสุด');
  if (!popup.showCloseButton && !popup.closeOnBackdrop) errors.push('Alert Dialog ต้องมีวิธีปิดอย่างน้อยหนึ่งวิธี');
}

function slideHasVisibleText(slide) {
  if (!slide || slide.textVisible === false || slide.mode === 'imageOnly') return false;
  return [slide.eyebrow, slide.title, slide.subtitle, slide.ctaLabel, slide.badge, slide.discountText].some((value) => cleanString(value, 500));
}

function cleanHomeLayout(value) {
  const source = Array.isArray(value) ? value : defaultHomeLayout;
  const used = new Set();
  const cleaned = [];

  source.forEach((item) => {
    const type = cleanString(item?.type, 40);
    if (!homeLayoutTypes.has(type) || used.has(type)) return;
    used.add(type);
    cleaned.push({ type, enabled: item?.enabled !== false, settings: cleanLayoutSettings(type, item?.settings) });
  });

  defaultHomeLayout.forEach((item) => {
    if (!used.has(item.type)) cleaned.push({ ...item });
  });

  return cleaned;
}

function cleanLayoutSettings(type, value) {
  const defaults = defaultHomeLayout.find((item) => item.type === type)?.settings || {};
  const settings = value || {};
  const width = sectionWidths.has(settings.width) ? settings.width : defaults.width || 'boxed';
  const radiusValue = parseInt(settings.radius, 10);
  const radius = Math.max(0, Math.min(Number.isFinite(radiusValue) ? radiusValue : defaults.radius || 0, 40));

  if (type === 'hero') {
    return {
      width,
      radius,
      height: heroHeights.has(settings.height) ? settings.height : defaults.height || 'normal',
    };
  }

  if (type === 'promoGrid') {
    const desktopColumns = clampInteger(settings.desktopColumns, 2, 6, defaults.desktopColumns || 3);
    return {
      width,
      radius,
      layout: promoLayouts.has(settings.layout) ? settings.layout : defaults.layout || 'mosaic',
      maxItems: Math.max(1, Math.min(parseInt(settings.maxItems, 10) || defaults.maxItems || 4, 8)),
      desktopColumns,
      tabletColumns: Math.min(clampInteger(settings.tabletColumns, 1, 4, defaults.tabletColumns || 2), desktopColumns),
      mobileColumns: Math.min(clampInteger(settings.mobileColumns, 1, 2, defaults.mobileColumns || 1), desktopColumns),
      gap: clampInteger(settings.gap, 0, 40, defaults.gap || 14),
    };
  }

  if (type === 'categories') {
    return {
      width,
      radius,
      maxItems: Math.max(1, Math.min(parseInt(settings.maxItems, 10) || defaults.maxItems || 6, 12)),
      density: categoryDensities.has(settings.density) ? settings.density : defaults.density || 'comfortable',
    };
  }

  if (type === 'productSections') {
    return {
      width,
      radius,
      display: productDisplays.has(settings.display) ? settings.display : defaults.display || 'slider',
      gridColumns: clampInteger(settings.gridColumns, 1, 8, defaults.gridColumns || 4),
      cardRadius: clampInteger(settings.cardRadius, 0, 40, defaults.cardRadius || 14),
      imageHeight: clampInteger(settings.imageHeight, 80, 360, defaults.imageHeight || 144),
    };
  }

  return { width, radius };
}

function cleanTheme(value) {
  const requestedPreset = cleanString(value?.preset || defaultTheme.preset, 20);
  const validPreset = requestedPreset === 'custom' || themePresets[requestedPreset] ? requestedPreset : defaultTheme.preset;
  const comparePreset = validPreset === 'custom' ? cleanString(value?.basePreset || defaultTheme.basePreset, 20) : validPreset;
  const compareTheme = themePresets[comparePreset] || defaultTheme;
  const colorKeys = [
    'primaryColor',
    'accentColor',
    'headerBackground',
    'headerTextColor',
    'backgroundColor',
    'productCardBackground',
    'productImageBackground',
    'productCardBorder',
    'footerBackground',
    'footerTextColor',
  ];
  const hasCustomColors =
    validPreset !== 'custom' &&
    colorKeys.some((key) => Object.prototype.hasOwnProperty.call(value || {}, key) && value?.[key] && cleanColor(value[key]) !== cleanColor(compareTheme[key]));
  const preset = hasCustomColors ? 'custom' : validPreset;
  const requestedBasePreset = cleanString(value?.basePreset || (preset === 'custom' ? comparePreset : preset), 20);
  const basePreset = themePresets[requestedBasePreset] ? requestedBasePreset : defaultTheme.basePreset;
  const presetTheme = themePresets[preset === 'custom' ? basePreset : preset] || defaultTheme;

  return {
    preset,
    basePreset,
    primaryColor: cleanColor(value?.primaryColor) || presetTheme.primaryColor,
    accentColor: cleanColor(value?.accentColor) || presetTheme.accentColor,
    headerBackground: cleanColor(value?.headerBackground) || presetTheme.headerBackground,
    headerTextColor: cleanColor(value?.headerTextColor) || presetTheme.headerTextColor,
    backgroundColor: cleanColor(value?.backgroundColor) || presetTheme.backgroundColor,
    productCardBackground: cleanColor(value?.productCardBackground) || presetTheme.productCardBackground,
    productImageBackground: cleanColor(value?.productImageBackground) || presetTheme.productImageBackground || defaultTheme.productImageBackground,
    productCardBorder: cleanColor(value?.productCardBorder) || presetTheme.productCardBorder,
    footerBackground: cleanColor(value?.footerBackground) || presetTheme.footerBackground,
    footerTextColor: cleanColor(value?.footerTextColor) || presetTheme.footerTextColor,
  };
}

function cleanString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanStringList(value, maxItems) {
  return Array.isArray(value)
    ? value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, maxItems)
    : [];
}

function cleanHighlights(value) {
  return Array.isArray(value)
    ? value.slice(0, 6).map((item) => ({
        title: cleanString(item.title, 120),
        description: cleanString(item.description, 300),
      }))
    : [];
}

function cleanSlides(value) {
  return Array.isArray(value)
    ? value.slice(0, 8).map((item, index) => ({
        eyebrow: cleanString(Object.prototype.hasOwnProperty.call(item, 'eyebrow') ? item.eyebrow : `SLIDE ${index + 1}`, 80),
        title: cleanString(item.title === 'MarketPlace' ? SITE_NAME : item.title, 120),
        subtitle: cleanString(item.subtitle, 500),
        ctaLabel: cleanString(item.ctaLabel, 60),
        href: cleanOptionalHref(item.href),
        imageUrl: cleanAssetUrl(item.imageUrl || ''),
        imageAlt: cleanString(item.imageAlt || '', 120),
        backgroundImageUrl: cleanAssetUrl(item.backgroundImageUrl || ''),
        textColor: cleanColor(item.textColor),
        buttonColor: cleanColor(item.buttonColor),
        buttonTextColor: cleanColor(item.buttonTextColor),
        mode: slideModes.has(item.mode) ? item.mode : 'campaign',
        textVisible: item.textVisible !== false,
        heightMode: heightModes.has(item.heightMode) ? item.heightMode : 'preset',
        desktopHeight: clampInteger(item.desktopHeight, 120, 900, 420),
        mobileHeight: clampInteger(item.mobileHeight, 100, 640, 240),
        aspectRatio: aspectRatios.has(item.aspectRatio) ? item.aspectRatio : '21/8',
        imageFit: promoImageFits.has(item.imageFit) ? item.imageFit : 'cover',
        badge: cleanString(item.badge || '', 80),
        priceText: cleanString(item.priceText || '', 80),
        discountText: cleanString(item.discountText || '', 120),
        expiresAt: cleanString(item.expiresAt || '', 80),
        layout: slideLayouts.has(item.layout) ? item.layout : 'split',
        contentPosition: slideContentPositions.has(item.contentPosition) ? item.contentPosition : 'left',
        imagePosition: slideImagePositions.has(item.imagePosition) ? item.imagePosition : 'right',
        tone: tones.has(item.tone) ? item.tone : 'teal',
        enabled: item.enabled !== false,
      }))
    : defaultContent.slides;
}

function cleanPromoBlocks(value) {
  return Array.isArray(value)
    ? value.slice(0, 8).map((item) => ({
        title: cleanString(item.title, 100),
        value: cleanString(item.value, 80),
        description: cleanString(item.description, 260),
        href: cleanOptionalHref(item.href),
        tone: tones.has(item.tone) ? item.tone : 'red',
        imageUrl: cleanAssetUrl(item.imageUrl || ''),
        imageAlt: cleanString(item.imageAlt || '', 120),
        width: cleanGridSpan(item.width, 6),
        height: cleanGridSpan(item.height, 2),
        heightMode: heightModes.has(item.heightMode) ? item.heightMode : 'ratio',
        desktopHeight: clampInteger(item.desktopHeight, 80, 720, 180),
        mobileHeight: clampInteger(item.mobileHeight, 60, 480, 120),
        aspectRatio: aspectRatios.has(item.aspectRatio) ? item.aspectRatio : '16/5',
        imageFit: promoImageFits.has(item.imageFit) ? item.imageFit : 'cover',
        textOverlay: item.textOverlay !== false,
        textColor: cleanColor(item.textColor) || '',
        enabled: item.enabled !== false,
      }))
    : defaultContent.promoBlocks;
}

function cleanAlertPopup(value = {}) {
  const source = value || {};
  const popup = {
    enabled: source.enabled === true,
    name: cleanString(source.name || '', 80),
    imageUrl: cleanAssetUrl(source.imageUrl || ''),
    imageAlt: cleanString(source.imageAlt || '', 120),
    href: cleanOptionalHref(source.href || ''),
    target: alertTargets.has(source.target) ? source.target : '_self',
    startAt: cleanString(source.startAt || '', 40),
    endAt: cleanString(source.endAt || '', 40),
    frequency: alertFrequencies.has(source.frequency) ? source.frequency : 'oncePerSession',
    delayMs: clampInteger(source.delayMs, 0, 10000, 500),
    desktopWidth: clampInteger(source.desktopWidth, 320, 1200, 720),
    mobileWidth: clampInteger(source.mobileWidth, 280, 480, 340),
    maxHeightVh: clampInteger(source.maxHeightVh, 50, 95, 86),
    borderRadius: clampInteger(source.borderRadius, 0, 40, 16),
    backdrop: source.backdrop !== false,
    closeOnBackdrop: source.closeOnBackdrop !== false,
    showCloseButton: source.showCloseButton !== false,
    device: alertDevices.has(source.device) ? source.device : 'all',
  };

  if (!popup.showCloseButton && !popup.closeOnBackdrop) popup.closeOnBackdrop = true;
  return popup;
}

function cleanGridSpan(value, max = 2) {
  if (String(value || '').trim() === 'full') return 'full';
  return Math.max(1, Math.min(max, parseInt(value, 10) || 1));
}

function clampInteger(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function cleanProductSections(value) {
  return Array.isArray(value)
    ? value.slice(0, 6).map((item, index) => ({
        id: cleanString(item.id || `section-${index + 1}`, 40),
        title: cleanString(item.title, 100),
        subtitle: cleanString(item.subtitle, 240),
        mode: sectionModes.has(item.mode) ? item.mode : 'latest',
        categoryCode: cleanString(item.categoryCode, 80),
        productCodes: cleanStringList(item.productCodes, 24),
        limit: Math.max(1, Math.min(24, parseInt(item.limit, 10) || 8)),
        display: productDisplays.has(item.display) ? item.display : 'slider',
        gridColumns: clampInteger(item.gridColumns, 1, 8, 4),
        cardRadius: clampInteger(item.cardRadius, 0, 40, 14),
        imageHeight: clampInteger(item.imageHeight, 80, 360, 144),
        enabled: item.enabled !== false,
      }))
    : defaultContent.productSections;
}

function cleanHref(value) {
  const href = cleanString(value, 200);
  return href.startsWith('/') ? href : '/marketplace';
}

function cleanOptionalHref(value) {
  const href = cleanString(value, 200);
  if (!href) return '';
  return href.startsWith('/') || href.startsWith('https://') || href.startsWith('http://') ? href : '';
}

function cleanAssetUrl(value) {
  const url = cleanString(value, 500);
  if (!url) return '';
  if (url.startsWith('/')) return url;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  return '';
}

function cleanColor(value) {
  const color = cleanString(value, 20);
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
  }
  return '';
}

router.get('/content/home', async (req, res) => {
  try {
    const content = await readContent();
    return res.json({ success: true, data: content });
  } catch (error) {
    return res.status(500).json({ success: false, ERROR: error.message });
  }
});

router.post('/content/home', requireAdmin('admin.content'), async (req, res) => {
  try {
    // ตรวจชนิดก่อนแตะของเดิม — ค่าผิดชนิดเคยทำให้เนื้อหาหน้าแรกกลายเป็นค่า factory default
    const shapeErrors = assertContentShape(req.body);
    if (shapeErrors.length) {
      return res.status(400).json({ success: false, message: shapeErrors.join(' / '), errors: shapeErrors });
    }

    const existing = await readContent();
    const content = cleanContent(req.body || {}, existing);
    const errors = validateContent(content);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(' / '), errors });
    }
    await writeContent(content);
    return res.json({ success: true, data: content });
  } catch (error) {
    return res.status(500).json({ success: false, ERROR: error.message });
  }
});

module.exports = router;

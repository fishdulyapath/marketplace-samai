const SAMPLE_SIZE = 5;
const loggedSignatures = new Set();

const isEnabled = () => import.meta.env.VITE_I18N_API_COVERAGE === 'true';

function asArray(rows) {
    if (!rows) return [];
    return Array.isArray(rows) ? rows : [rows];
}

function text(value) {
    return String(value ?? '').trim();
}

function hasAnyText(row, fields) {
    return fields.some((field) => text(row?.[field]));
}

function getRowKey(row) {
    return row?.item_code || row?.code || row?.guid_code || row?.barcode || row?.doc_no || row?.name_1 || row?.name || '(no key)';
}

function warnMissingFields(endpoint, rows, options) {
    if (!isEnabled()) return;

    const list = asArray(rows).filter(Boolean);
    if (!list.length) return;

    const missing = list.filter((row) => hasAnyText(row, options.thaiFields) && !text(row?.[options.englishField]));
    if (!missing.length) return;

    const samples = missing.slice(0, SAMPLE_SIZE).map((row) => ({
        key: getRowKey(row),
        thaiName: options.thaiFields.map((field) => text(row?.[field])).find(Boolean) || '',
        englishValue: row?.[options.englishField] ?? ''
    }));
    const signature = `${endpoint}:${options.englishField}:${missing.length}:${samples.map((sample) => sample.key).join('|')}`;

    if (loggedSignatures.has(signature)) return;
    loggedSignatures.add(signature);

    console.warn(`[i18n-api] ${endpoint}: ${missing.length}/${list.length} ${options.kind} rows missing ${options.englishField}`, samples);
}

export function auditProductLanguageFields(endpoint, rows, options = {}) {
    warnMissingFields(endpoint, rows, {
        kind: 'product',
        englishField: 'name_eng_1',
        thaiFields: ['item_name', 'name_1', 'name', 'display_name'],
        ...options
    });
}

export function auditMasterLanguageFields(endpoint, rows, options = {}) {
    warnMissingFields(endpoint, rows, {
        kind: 'master',
        englishField: 'name_2',
        thaiFields: ['name_1', 'name', 'categoryName', 'category_name'],
        ...options
    });
}

export function auditProductLanguageTree(endpoint, rows, childField = 'sub_item') {
    const list = asArray(rows);
    auditProductLanguageFields(endpoint, list);
    list.forEach((row) => auditProductLanguageFields(`${endpoint}.${childField}`, row?.[childField] || []));
}

import ProductService from '@/services/ProductService';

export function getProductSaleUnit(product) {
    return product.online_sale_unit || product.unit_code || product.start_sale_unit || product.unit_standard || product.unit_cost || '';
}

export function toCatalogNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function formatPrice(value) {
    const price = toCatalogNumber(value, NaN);
    if (!Number.isFinite(price) || price <= 0) return '';
    return price.toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function hasSalePrice(value) {
    const price = toCatalogNumber(value, NaN);
    return Number.isFinite(price) && price > 0;
}

function getUnitStandValue(unit) {
    const standValue = toCatalogNumber(unit?.stand_value, NaN);
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

function getSetDetailSaleUnit(productDetail, listProduct) {
    const preferredUnit = listProduct?.online_sale_unit || '';
    const units = [productDetail, ...(productDetail?.otherUnits || [])].filter((unit) => unit?.unit_code);
    return units.find((unit) => unit.unit_code === preferredUnit) || pickSmallestStandValueUnit(productDetail);
}

export async function resolveProductListPrice(product) {
    if (isSetProduct(product)) {
        const setResult = await ProductService.getProductSetByItemCode(product.item_code);
        const selectedUnit = getSetDetailSaleUnit(setResult?.data, product);

        return {
            price: hasSalePrice(selectedUnit?.price) ? selectedUnit.price : 0,
            unit_code: selectedUnit?.unit_code || getProductSaleUnit(product),
            barcode: selectedUnit?.barcode || product.barcode || '',
            wh_code: selectedUnit?.wh_code || product.wh_code || '',
            shelf_code: selectedUnit?.shelf_code || product.shelf_code || '',
            ratio: selectedUnit?.ratio || product.ratio || '1',
            stand_value: selectedUnit?.stand_value || product.stand_value || '1',
            divide_value: selectedUnit?.divide_value || product.divide_value || '1'
        };
    }

    if (!product.online_sale_unit) {
        try {
            const detailResult = await ProductService.getProductByItemCode(product.item_code);
            const selectedUnit = pickSmallestStandValueUnit(detailResult?.data);
            if (selectedUnit?.unit_code) {
                return {
                    price: hasSalePrice(selectedUnit.price) ? selectedUnit.price : 0,
                    unit_code: selectedUnit.unit_code,
                    barcode: selectedUnit.barcode || product.barcode || '',
                    wh_code: selectedUnit.wh_code || product.wh_code || '',
                    shelf_code: selectedUnit.shelf_code || product.shelf_code || '',
                    ratio: selectedUnit.ratio || product.ratio || '1',
                    stand_value: selectedUnit.stand_value || product.stand_value || '1',
                    divide_value: selectedUnit.divide_value || product.divide_value || '1'
                };
            }
        } catch (error) {
            console.warn(`Unable to resolve visible sale unit for ${product.item_code}`, error);
        }
    }

    const unitCode = getProductSaleUnit(product);

    const priceResult = await ProductService.getProductPrice(product.item_code, unitCode, '1', localStorage.getItem('_userCode') || '', {
        barcode: product.barcode || ''
    });

    return {
        price: hasSalePrice(priceResult?.price) ? priceResult.price : 0,
        unit_code: unitCode,
        barcode: product.barcode || priceResult?.barcode || ''
    };
}

export function isSetProduct(product) {
    return String(product?.item_type || '') === '3';
}

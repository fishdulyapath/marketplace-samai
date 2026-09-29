import { auditMasterLanguageFields, auditProductLanguageFields } from '@/utils/languageApiCoverage';
import { createApiClient } from '@/api/http';

const api = createApiClient({
    baseURL: import.meta.env.VITE_APP_API
});

const servicePath = (path) => `service/v1${path}`;

export function getProductImageUrl(code) {
    const baseUrl = import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;
    return `${baseUrl}/service/v1/images?item_code=${encodeURIComponent(code)}`;
}

export function getProductImageGuidUrl(guidCode) {
    const baseUrl = import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;
    return `${baseUrl}/service/v1/imagesguid?guid_code=${encodeURIComponent(guidCode)}`;
}

async function loadList(endpoint, search = '') {
    const { data } = await api.get(servicePath(endpoint), { params: { search } });
    auditMasterLanguageFields(`service/v1${endpoint}`, data.data || []);
    return data;
}

export const getProductGroupList = (s = '') => loadList('/getProductGroupList', s);
export const getProductGroupSubList = (s = '') => loadList('/getProductGroupSubList', s);
export const getProductGroupSub2List = (s = '') => loadList('/getProductGroupSub2List', s);
export const getProductBrandList = (s = '') => loadList('/getProductBrandList', s);
export const getProductCategoryList = (s = '') => loadList('/getProductCategoryList', s);
export const getProductDesignList = (s = '') => loadList('/getProductDesignList', s);
export const getProductModelList = (s = '') => loadList('/getProductModelList', s);
export const getProductPatternList = (s = '') => loadList('/getProductPatternList', s);
export const getProductGradeList = (s = '') => loadList('/getProductGradeList', s);
export const getCustomerGroupList = (s = '') => loadList('/getCustomerGroupList', s);
export const getCustomerGroupSubList = (s = '') => loadList('/getCustomerGroupSubList', s);
export const getUnitManageList = (s = '') => loadList('/getUnitManageList', s);

export async function getProductManageList(params) {
    const { data } = await api.get(servicePath('/getProductManageList'), { params });
    auditProductLanguageFields('service/v1/getProductManageList', data.data || []);
    return { data: data.data || [], totalCount: data.totalCount || 0 };
}

export async function exportProductData() {
    const { data } = await api.get(servicePath('/exportProductData'), { responseType: 'blob' });
    return data;
}

export async function getProductImportTemplate() {
    const { data } = await api.get(servicePath('/getProductImportTemplate'), { responseType: 'blob' });
    return data;
}

export async function verifyProductImportData(csvText) {
    const { data } = await api.post(servicePath('/verifyProductImportData'), { csv_text: csvText });
    return data;
}

export async function importProductData(csvText) {
    const { data } = await api.post(servicePath('/importProductData'), { csv_text: csvText });
    return data;
}

export async function getProductMarketplaceParticipation(params) {
    const { data } = await api.get(servicePath('/getProductMarketplaceParticipation'), { params });
    auditProductLanguageFields('service/v1/getProductMarketplaceParticipation:not_joined', data.data?.not_joined || []);
    auditProductLanguageFields('service/v1/getProductMarketplaceParticipation:joined', data.data?.joined || []);
    return data.data || { not_joined: [], joined: [], not_joined_count: 0, joined_count: 0 };
}

export async function setProductMarketplaceParticipation(body) {
    const { data } = await api.post(servicePath('/setProductMarketplaceParticipation'), body);
    auditProductLanguageFields('service/v1/setProductMarketplaceParticipation', data.data || data);
    return data;
}

export async function getProductItemDetail(code) {
    const { data } = await api.get(servicePath('/getProductItemDetail'), { params: { code } });
    auditProductLanguageFields('service/v1/getProductItemDetail', data.data || data);
    return data;
}

export async function getProductRelatedItems(ic_code, kind) {
    const { data } = await api.get(servicePath('/getProductRelatedItems'), { params: { ic_code, kind } });
    auditProductLanguageFields('service/v1/getProductRelatedItems', data.data || []);
    return data;
}

export async function saveProductRelatedItem(body) {
    const { data } = await api.post(servicePath('/saveProductRelatedItem'), body);
    return data;
}

export async function deleteProductRelatedItem(body) {
    const { data } = await api.post(servicePath('/deleteProductRelatedItem'), body);
    return data;
}

export async function updateProductItemMain(body) {
    const { data } = await api.post(servicePath('/updateProductItemMain'), body);
    return data;
}

export async function createProductItemMain(body) {
    const { data } = await api.post(servicePath('/createProductItemMain'), body);
    return data;
}

export async function getProductItemBarcodes(ic_code) {
    const { data } = await api.get(servicePath('/getProductItemBarcodes'), { params: { ic_code } });
    return data;
}

export async function checkBarcodeInUse(ic_code, barcode) {
    const { data } = await api.get(servicePath('/checkBarcodeInUse'), { params: { ic_code, barcode } });
    return data;
}

export async function createProductItemBarcode(body) {
    const { data } = await api.post(servicePath('/createProductItemBarcode'), body);
    return data;
}

export async function updateProductItemBarcode(body) {
    const { data } = await api.post(servicePath('/updateProductItemBarcode'), body);
    return data;
}

export async function deleteProductItemBarcode(body) {
    const { data } = await api.post(servicePath('/deleteProductItemBarcode'), body);
    return data;
}

export async function getProductItemUnitUse(ic_code) {
    const { data } = await api.get(servicePath('/getProductItemUnitUse'), { params: { ic_code } });
    return data;
}

export async function checkUnitUseInUse(ic_code, unit_code) {
    const { data } = await api.get(servicePath('/checkUnitUseInUse'), { params: { ic_code, unit_code } });
    return data;
}

export async function createProductItemUnitUse(body) {
    const { data } = await api.post(servicePath('/createProductItemUnitUse'), body);
    return data;
}

export async function updateProductItemUnitUse(body) {
    const { data } = await api.post(servicePath('/updateProductItemUnitUse'), body);
    return data;
}

export async function deleteProductItemUnitUse(body) {
    const { data } = await api.post(servicePath('/deleteProductItemUnitUse'), body);
    return data;
}

export async function getProductImages(item_code) {
    const { data } = await api.get(servicePath('/getProductImages'), { params: { item_code } });
    return data;
}

export async function saveProductImage(item_code, image_file) {
    const { data } = await api.post(servicePath('/saveProductImage'), { item_code, image_file });
    return data;
}

export async function deleteProductImage(guid_code) {
    const { data } = await api.post(servicePath('/deleteProductImage'), { guid_code });
    return data;
}

export async function reorderProductImages(item_code, orders) {
    const { data } = await api.post(servicePath('/reorderProductImages'), { item_code, orders });
    return data;
}

export async function getProductPriceFormulas(ic_code) {
    const { data } = await api.get(servicePath('/getProductPriceFormulas'), { params: { ic_code } });
    return data;
}

export async function saveProductPriceFormula(body) {
    const { data } = await api.post(servicePath('/saveProductPriceFormula'), body);
    return data;
}

export async function deleteProductPriceFormula(body) {
    const { data } = await api.post(servicePath('/deleteProductPriceFormula'), body);
    return data;
}

export async function getProductSalePrices(ic_code) {
    const { data } = await api.get(servicePath('/getProductSalePrices'), { params: { ic_code } });
    return data;
}

export async function saveProductSalePrice(body) {
    const { data } = await api.post(servicePath('/saveProductSalePrice'), body);
    return data;
}

export async function deleteProductSalePrice(body) {
    const { data } = await api.post(servicePath('/deleteProductSalePrice'), body);
    return data;
}

export async function getProductDiscountConditions(ic_code) {
    const { data } = await api.get(servicePath('/getProductDiscountConditions'), { params: { ic_code } });
    return data;
}

export async function saveProductDiscountCondition(body) {
    const { data } = await api.post(servicePath('/saveProductDiscountCondition'), body);
    return data;
}

export async function deleteProductDiscountCondition(body) {
    const { data } = await api.post(servicePath('/deleteProductDiscountCondition'), body);
    return data;
}

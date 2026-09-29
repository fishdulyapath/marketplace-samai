<script setup>
import CategoryService from '@/services/CategoryService';
import MediaService from '@/services/MediaService';
import ProductService from '@/services/ProductService';
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';

const confirm = useConfirm();
const router = useRouter();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const uploadingCode = ref('');
const categories = ref([]);
const filterText = ref('');
const editing = ref(createEmptyCategory());
const categoryImageInput = ref(null);
let categoryLoadSeq = 0;

const filteredCategories = computed(() => {
    const term = filterText.value.trim().toLowerCase();
    if (!term) return categories.value;
    return categories.value.filter((cat) => [cat.code, cat.name_1, cat.name_2].some((value) => String(value || '').toLowerCase().includes(term)));
});
const isUploading = computed(() => Boolean(uploadingCode.value));
const isCategoryActionBusy = computed(() => loading.value || saving.value || deleting.value || isUploading.value);
const isCategoryFormDisabled = computed(() => saving.value || deleting.value || isUploading.value);
const canSaveCategory = computed(() => {
    if (isCategoryFormDisabled.value) return false;
    if (!String(editing.value.code || '').trim()) return false;
    if (editing.value.is_virtual) return true;
    if (!String(editing.value.name_1 || '').trim()) return false;
    return true;
});

function createEmptyCategory() {
    return {
        code: '',
        name_1: '',
        name_2: '',
        image_url: '',
        is_virtual: false,
        isNew: true
    };
}

function normalizeForm(category) {
    return {
        code: category.code || '',
        name_1: category.name_1 || category.name || '',
        name_2: category.name_2 || '',
        image_url: category.image_url || category.imageUrl || '',
        is_virtual: category.is_virtual === true,
        isNew: false
    };
}

async function loadCategories(force = false) {
    const shouldForce = force === true;
    if (!shouldForce && loading.value) return;
    const requestId = ++categoryLoadSeq;
    loading.value = true;
    try {
        const result = await CategoryService.getManageCategories();
        if (requestId !== categoryLoadSeq) return;
        categories.value = result.data || [];
    } catch (error) {
        if (requestId !== categoryLoadSeq) return;
        toast.add({ severity: 'error', summary: t('adminCategory.loadFailed'), detail: error.message, life: 2500 });
    } finally {
        if (requestId === categoryLoadSeq) loading.value = false;
    }
}

function newCategory(force = false) {
    if (!force && isCategoryActionBusy.value) return;
    editing.value = createEmptyCategory();
}

function editCategory(category) {
    if (isCategoryActionBusy.value) return;
    editing.value = normalizeForm(category);
}

async function saveCategory() {
    if (isCategoryActionBusy.value) return;

    if (!editing.value.code.trim() || !editing.value.name_1.trim()) {
        toast.add({ severity: 'warn', summary: t('adminCategory.incomplete'), detail: t('adminCategory.requiredCodeName'), life: 2200 });
        return;
    }

    saving.value = true;
    try {
        if (editing.value.isNew) await CategoryService.createCategory(editing.value);
        else await CategoryService.updateCategory(editing.value);
        toast.add({ severity: 'success', summary: t('adminCategory.saved'), life: 1600 });
        await loadCategories(true);
        newCategory(true);
    } catch (error) {
        toast.add({ severity: 'error', summary: t('adminCategory.saveFailed'), detail: error.response?.data?.ERROR || error.message, life: 2800 });
    } finally {
        saving.value = false;
    }
}

function confirmDeleteCategory(category) {
    if (isCategoryActionBusy.value || !category?.code || category.is_virtual) return;

    confirm.require({
        message: t('adminCategory.deleteMessage', { name: category.name_1 || category.code }),
        header: t('adminCategory.deleteHeader'),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: t('adminCategory.deleteAccept'),
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: async () => {
            await deleteCategory(category);
        }
    });
}

async function deleteCategory(category) {
    if (deleting.value || !category?.code) return;

    deleting.value = true;
    try {
        await CategoryService.deleteCategory(category.code);
        toast.add({ severity: 'success', summary: t('adminCategory.deleted'), life: 1600 });
        await loadCategories(true);
        if (editing.value.code === category.code) newCategory(true);
    } catch (error) {
        const data = error.response?.data;
        const detail = data?.used_count ? t('adminCategory.deleteBlockedDetail', { count: data.used_count }) : data?.ERROR || error.message;
        toast.add({ severity: 'warn', summary: t('adminCategory.deleteBlocked'), detail, life: 3200 });
    } finally {
        deleting.value = false;
    }
}

async function uploadCategoryImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isCategoryActionBusy.value) {
        event.target.value = '';
        return;
    }
    uploadingCode.value = editing.value.code || 'new';
    try {
        const asset = await MediaService.uploadImage(file);
        editing.value.image_url = MediaService.getPreferredUrl(asset);
        toast.add({ severity: 'success', summary: t('adminCategory.imageUploaded'), detail: t('adminCategory.imageUploadedDetail'), life: 2200 });
    } catch (error) {
        toast.add({ severity: 'error', summary: t('adminCategory.uploadFailed'), detail: error.message, life: 2500 });
    } finally {
        uploadingCode.value = '';
        event.target.value = '';
    }
}

function openCategoryImagePicker() {
    if (isCategoryActionBusy.value) return;
    categoryImageInput.value?.click();
}

function resolveImageUrl(value) {
    return MediaService.resolveUrl(value);
}

function handleImageError(event) {
    event.target.onerror = null;
    event.target.src = ProductService.getPlaceholderImage();
}

onMounted(loadCategories);
</script>

<template>
    <main class="admin-category-page">
        <Toast position="top-right" />

        <header class="admin-category-head">
            <div>
                <p>{{ t('adminCategory.eyebrow') }}</p>
                <h1>{{ t('adminCategory.title') }}</h1>
                <span>{{ t('adminCategory.subtitle') }}</span>
            </div>
            <div class="admin-category-actions">
                <Button :label="t('common.mainMenu')" icon="pi pi-arrow-left" outlined :disabled="saving || deleting || isUploading" @click="router.push('/admin')" />
                <Button :label="t('common.reload')" icon="pi pi-refresh" text :disabled="isCategoryActionBusy" @click="loadCategories()" />
                <Button :label="t('adminCategory.addNew')" icon="pi pi-plus" :disabled="isCategoryActionBusy" @click="newCategory" />
            </div>
        </header>

        <div class="category-layout">
            <section class="category-list-panel">
                <div class="panel-title-row">
                    <h2>{{ t('adminCategory.listTitle') }}</h2>
                    <InputText v-model="filterText" :placeholder="t('adminCategory.searchPlaceholder')" :aria-label="t('adminCategory.searchPlaceholder')" :disabled="isCategoryActionBusy" />
                </div>

                <div v-if="loading" class="loading-box">
                    <ProgressSpinner />
                    <span>{{ t('adminCategory.loading') }}</span>
                </div>

                <div v-else class="category-table">
                    <button v-for="cat in filteredCategories" :key="cat.code" type="button" class="category-row" :class="{ active: editing.code === cat.code }" :disabled="isCategoryActionBusy" :aria-pressed="editing.code === cat.code" :aria-label="`เลือกหมวดหมู่ ${cat.code} ${cat.name_1 || cat.name || ''}`" @click="editCategory(cat)">
                        <div class="category-thumb" :style="{ backgroundImage: cat.image_url ? `url(${resolveImageUrl(cat.image_url)})` : '' }">
                            <i v-if="!cat.image_url" class="pi pi-tags"></i>
                        </div>
                        <div>
                            <strong>{{ cat.name_1 || cat.name }}</strong>
                            <span>{{ cat.code }}</span>
                            <small v-if="cat.name_2">{{ cat.name_2 }}</small>
                        </div>
                    </button>
                </div>
            </section>

            <section class="category-editor-panel">
                <div class="panel-title-row">
                    <h2>{{ editing.isNew ? t('adminCategory.addNew') : t('adminCategory.editTitle') }}</h2>
                    <Button v-if="!editing.isNew && !editing.is_virtual" icon="pi pi-trash" :label="t('adminCategory.delete')" severity="danger" outlined :loading="deleting" :disabled="isCategoryActionBusy" @click="confirmDeleteCategory(editing)" />
                </div>

                <div class="form-grid">
                    <label>
                        {{ t('adminCategory.categoryCode') }}
                        <InputText v-model.trim="editing.code" :disabled="!editing.isNew || isCategoryFormDisabled" :placeholder="t('adminCategory.codePlaceholder')" />
                    </label>
                    <label>
                        {{ t('adminCategory.thaiName') }}
                        <InputText v-model="editing.name_1" :disabled="editing.is_virtual || isCategoryFormDisabled" placeholder="name_1" />
                    </label>
                    <label>
                        {{ t('adminCategory.englishName') }}
                        <InputText v-model="editing.name_2" :disabled="editing.is_virtual || isCategoryFormDisabled" placeholder="name_2" />
                    </label>
                    <label>
                        Image URL
                        <InputText v-model="editing.image_url" placeholder="/media/category.png" :disabled="isCategoryFormDisabled" />
                    </label>
                </div>

                <div class="image-editor">
                    <div class="image-preview">
                        <img v-if="editing.image_url" :src="resolveImageUrl(editing.image_url)" :alt="editing.name_1" @error="handleImageError" />
                        <i v-else class="pi pi-image"></i>
                    </div>
                    <div class="image-actions">
                        <Button type="button" :label="uploadingCode ? t('adminCategory.uploading') : t('adminCategory.uploadImage')" icon="pi pi-upload" outlined rounded :loading="isUploading" :disabled="isCategoryActionBusy" @click="openCategoryImagePicker" />
                        <input ref="categoryImageInput" class="upload-input" type="file" accept="image/*" :disabled="isCategoryActionBusy" @change="uploadCategoryImage" />
                        <Button :label="t('adminCategory.clearImage')" icon="pi pi-times" text :disabled="isCategoryFormDisabled || !editing.image_url" @click="editing.image_url = ''" />
                    </div>
                </div>

                <div class="editor-actions">
                    <Button :label="t('common.cancel')" icon="pi pi-undo" text :disabled="isCategoryActionBusy" @click="newCategory" />
                    <Button :label="t('adminCategory.saveCategory')" icon="pi pi-save" :loading="saving" :disabled="!canSaveCategory" @click="saveCategory" />
                </div>
            </section>
        </div>
    </main>
</template>

<style scoped>
.admin-category-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 1.75rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #4b3a1d);
}

.admin-category-head,
.category-layout {
    width: min(1180px, 100%);
    margin: 0 auto;
}

.admin-category-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
}

.admin-category-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.admin-category-head h1 {
    margin: 0.15rem 0;
    color: var(--market-text, #4b3a1d);
}

.admin-category-head span {
    color: var(--market-muted, #8a7650);
}

.admin-category-actions,
.panel-title-row,
.editor-actions,
.image-actions {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
}

.category-layout {
    display: grid;
    grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.2fr);
    gap: 1rem;
}

.category-list-panel,
.category-editor-panel {
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.09));
    padding: 1rem;
}

.panel-title-row {
    justify-content: space-between;
    margin-bottom: 0.85rem;
}

.panel-title-row h2 {
    margin: 0;
    color: var(--market-text, #4b3a1d);
    font-size: 1.05rem;
}

.category-table {
    display: grid;
    gap: 0.55rem;
    max-height: 68vh;
    overflow: auto;
    padding-right: 0.25rem;
}

.category-row {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    border: 1px solid var(--market-card-border, #f0e3c9);
    border-radius: 0.7rem;
    background: var(--market-card-bg, #fffdf8);
    padding: 0.55rem;
    color: var(--market-text, #4b3a1d);
    cursor: pointer;
    text-align: left;
}

.category-row.active {
    border-color: var(--market-primary, #0f9f6e);
    background: var(--market-primary-soft, #ecfdf5);
}

.category-row:disabled {
    cursor: wait;
    opacity: 0.68;
}

.category-row strong,
.category-row span,
.category-row small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.category-row span,
.category-row small {
    color: var(--market-muted, #8a7650);
    font-size: 0.78rem;
}

.category-thumb {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    background: var(--market-surface-soft, #f2ead8) center / cover no-repeat;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--market-primary, #0f9f6e);
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
}

.form-grid label {
    display: grid;
    gap: 0.35rem;
    color: var(--market-text, #5b4a27);
    font-weight: 700;
}

.image-editor {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    margin-top: 1rem;
    padding: 1rem;
    border: 1px dashed var(--market-card-border, #dfcfa9);
    border-radius: 0.8rem;
    background: var(--market-surface-soft, #fffaf0);
}

.image-preview {
    width: 9rem;
    aspect-ratio: 1;
    border-radius: 0.8rem;
    background: var(--market-surface-soft, #f2ead8);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--market-muted, #9b8a67);
    font-size: 1.5rem;
}

.image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.upload-input {
    display: none;
}

.editor-actions {
    justify-content: flex-end;
    margin-top: 1rem;
}

.loading-box {
    display: grid;
    place-items: center;
    gap: 0.75rem;
    padding: 2rem;
    color: var(--market-muted, #8a7650);
}

@media (max-width: 820px) {
    .admin-category-head,
    .category-layout,
    .image-editor,
    .form-grid {
        grid-template-columns: 1fr;
    }

    .admin-category-head {
        display: grid;
    }
}
</style>

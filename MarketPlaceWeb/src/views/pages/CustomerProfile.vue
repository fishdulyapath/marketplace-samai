<script setup>
import CustomerService from '@/services/CustomerService';
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';

const router = useRouter();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

const loading = ref(false);
const saving = ref(false);
const form = ref({
    code: '',
    name_1: '',
    telephone: '',
    email: '',
    tax_id: '',
    address: '',
    password: '',
    confirm_password: ''
});

const hasCustomer = computed(() => Boolean(form.value.code));
const nameError = computed(() => (!form.value.name_1.trim() ? t('profile.missingName') : ''));
const passwordError = computed(() => {
    if (form.value.password && form.value.password.length < 4) return t('profile.shortPassword');
    if (form.value.password && form.value.password !== form.value.confirm_password) return t('profile.passwordMismatch');
    return '';
});
const canSaveProfile = computed(() => hasCustomer.value && !nameError.value && !passwordError.value && !loading.value && !saving.value);

function safeParse(value) {
    try {
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}

function fillForm(customer = {}) {
    form.value = {
        code: customer.code || customer.user_code || '',
        name_1: customer.name_1 || customer.name || customer.user_name || '',
        telephone: customer.telephone || '',
        email: customer.email || '',
        tax_id: customer.tax_id || '',
        address: customer.address || '',
        password: '',
        confirm_password: ''
    };
}

async function loadProfile() {
    if (loading.value || saving.value) return;

    loading.value = true;
    try {
        const localCustomer = safeParse(localStorage.getItem('_userData'));
        const code = localCustomer?.user_code || localCustomer?.code || localStorage.getItem('_userCode') || '';
        if (!code) {
            fillForm({});
            return;
        }

        const detail = await CustomerService.getCustomerDetail(code);
        fillForm(detail || localCustomer || {});
    } catch (error) {
        toast.add({ severity: 'error', summary: t('profile.loadFailed'), detail: error.response?.data?.ERROR || error.message, life: 3000 });
    } finally {
        loading.value = false;
    }
}

function validateProfile() {
    if (!form.value.code) return t('profile.missingCode');
    if (nameError.value) return nameError.value;
    if (passwordError.value) return passwordError.value;
    return '';
}

async function saveProfile() {
    if (saving.value || loading.value) return;

    const error = validateProfile();
    if (error) {
        toast.add({ severity: 'warn', summary: error, life: 2400 });
        return;
    }

    saving.value = true;
    try {
        const payload = {
            ...form.value,
            password: form.value.password ? form.value.password : undefined,
            confirm_password: undefined
        };
        const updated = await CustomerService.updateCustomerProfile(payload);
        const userData = {
            user_code: updated.code,
            user_name: updated.name,
            address: updated.address,
            telephone: updated.telephone,
            email: updated.email,
            tax_id: updated.tax_id
        };
        localStorage.setItem('_userCode', updated.code);
        localStorage.setItem('_userData', JSON.stringify(userData));
        window.dispatchEvent(new Event('marketplace-auth-updated'));
        fillForm(updated);
        toast.add({ severity: 'success', summary: t('profile.saved'), life: 1800 });
    } catch (error) {
        toast.add({ severity: 'error', summary: t('profile.saveFailed'), detail: error.response?.data?.message || error.response?.data?.ERROR || error.message, life: 3200 });
    } finally {
        saving.value = false;
    }
}

onMounted(() => {
    loadProfile();
});
</script>

<template>
    <main class="profile-page">
        <section class="profile-shell">
            <header class="profile-head">
                <div>
                    <p>{{ t('profile.eyebrow') }}</p>
                    <h1>{{ t('profile.title') }}</h1>
                    <span>{{ t('profile.subtitle') }}</span>
                </div>
                <Button :label="t('common.backHome')" icon="pi pi-arrow-left" outlined @click="router.push('/')" />
            </header>

            <div v-if="loading" class="profile-card loading-box">
                <ProgressSpinner />
                <span>{{ t('profile.loading') }}</span>
            </div>

            <div v-else-if="!hasCustomer" class="profile-card empty-state">
                <i class="pi pi-user"></i>
                <strong>{{ t('profile.noCustomerTitle') }}</strong>
                <span>{{ t('profile.noCustomerHint') }}</span>
                <Button :label="t('nav.login')" icon="pi pi-sign-in" @click="router.push('/auth/login?redirect=/profile')" />
            </div>

            <div v-else class="profile-card">
                <div class="profile-code-box">
                    <span>{{ t('profile.customerCode') }}</span>
                    <strong>{{ form.code }}</strong>
                </div>

                <div class="profile-form-grid">
                    <div class="profile-field span-2">
                        <label for="profile-name">{{ t('profile.customerName') }}</label>
                        <InputText id="profile-name" v-model="form.name_1" :placeholder="t('profile.customerNamePlaceholder')" :aria-invalid="Boolean(nameError)" aria-describedby="profile-name-error" autocomplete="name" />
                        <small v-if="nameError" id="profile-name-error" class="profile-field-error">{{ nameError }}</small>
                    </div>

                    <div class="profile-field">
                        <label for="profile-phone">{{ t('profile.phone') }}</label>
                        <InputText id="profile-phone" v-model="form.telephone" :placeholder="t('profile.phonePlaceholder')" autocomplete="tel" />
                    </div>

                    <div class="profile-field">
                        <label for="profile-email">Email</label>
                        <InputText id="profile-email" v-model="form.email" placeholder="customer@example.com" autocomplete="email" />
                    </div>

                    <div class="profile-field span-2">
                        <label for="profile-tax-id">{{ t('profile.taxId') }}</label>
                        <InputText id="profile-tax-id" v-model="form.tax_id" :placeholder="t('profile.taxId')" />
                    </div>

                    <div class="profile-field">
                        <label for="profile-password">{{ t('profile.newPassword') }}</label>
                        <Password inputId="profile-password" v-model="form.password" :placeholder="t('profile.newPasswordPlaceholder')" :feedback="false" toggleMask fluid autocomplete="new-password" :aria-invalid="Boolean(passwordError)" aria-describedby="profile-password-error" />
                    </div>

                    <div class="profile-field">
                        <label for="profile-confirm-password">{{ t('profile.confirmPassword') }}</label>
                        <Password inputId="profile-confirm-password" v-model="form.confirm_password" :placeholder="t('profile.confirmPasswordPlaceholder')" :feedback="false" toggleMask fluid autocomplete="new-password" :aria-invalid="Boolean(passwordError)" aria-describedby="profile-password-error" />
                        <small v-if="passwordError" id="profile-password-error" class="profile-field-error">{{ passwordError }}</small>
                    </div>

                    <div class="profile-field span-2">
                        <label for="profile-address">{{ t('profile.address') }}</label>
                        <Textarea id="profile-address" v-model="form.address" rows="5" :placeholder="t('profile.addressPlaceholder')" autocomplete="street-address" />
                    </div>
                </div>

                <div class="profile-actions">
                    <Button :label="t('common.reload')" icon="pi pi-refresh" text :disabled="saving || loading" @click="loadProfile" />
                    <Button :label="t('profile.saveProfile')" icon="pi pi-save" :loading="saving" :disabled="!canSaveProfile" @click="saveProfile" />
                </div>
            </div>
        </section>
    </main>
</template>

<style scoped>
.profile-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 1.75rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #4b3a1d);
}

.profile-shell {
    width: min(840px, 100%);
    margin: 0 auto;
}

.profile-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
}

.profile-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.profile-head h1 {
    margin: 0.15rem 0;
    color: var(--market-text, #4b3a1d);
}

.profile-head span {
    color: var(--market-muted, #8a7650);
}

.profile-card {
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 1rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.09));
    padding: clamp(1rem, 3vw, 1.35rem);
}

.profile-code-box {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.9rem 1rem;
    border-radius: 0.9rem;
    background: var(--market-primary-soft, #ecfdf5);
    color: var(--market-primary, #0f9f6e);
}

.profile-code-box span {
    color: var(--market-muted, #8a7650);
    font-weight: 700;
}

.profile-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem;
}

.profile-field {
    display: grid;
    gap: 0.35rem;
}

.profile-field label {
    color: var(--market-text, #5b4a27);
    font-weight: 700;
}

.profile-field-error {
    color: #dc2626;
    font-size: 0.82rem;
    font-weight: 700;
}

.span-2 {
    grid-column: span 2;
}

.profile-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1.1rem;
}

.loading-box,
.empty-state {
    display: grid;
    place-items: center;
    gap: 0.75rem;
    text-align: center;
    color: var(--market-muted, #8a7650);
}

.empty-state i {
    font-size: 2.4rem;
    color: var(--market-primary, #0f9f6e);
}

@media (max-width: 700px) {
    .profile-head,
    .profile-form-grid {
        grid-template-columns: 1fr;
    }

    .profile-head {
        display: grid;
    }

    .span-2 {
        grid-column: span 1;
    }

    .profile-code-box,
    .profile-actions {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>

<script setup>
import { getStoredAdminPermissions } from '@/utils/adminPermissions';
import { computed } from 'vue';
import { useAuthenStore } from '@/stores/authen';
import { useLanguageStore } from '@/stores/languageStore';

const auth = useAuthenStore();
const language = useLanguageStore();
const t = key => language.t(key);
const customer = computed(() => auth.userData || {});
const identity = computed(() => (auth.isEmployee ? auth.empData : customer.value) || {});
const displayName = computed(() => identity.value.user_name || identity.value.name || identity.value.user_code || identity.value.code || (auth.isEmployee ? auth.empCode : auth.userCode) || t('nav.accountShort'));
const links = [
    ['/orders-history', 'pi-shopping-bag', 'nav.myOrders'],
    ['/favorites', 'pi-heart', 'nav.myFavorites'],
    ['/profile', 'pi-user', 'nav.profile'],
    ['/doc-history', 'pi-file', 'nav.documentHistory'],
    ['/advance-payment-history', 'pi-wallet', 'nav.advancePaymentHistory']
];
</script>

<template>
    <section class="account">
        <div class="identity">
            <span class="avatar" aria-hidden="true">{{ Array.from(displayName || '•')[0].toUpperCase() }}</span>
            <div><h1>{{ displayName }}</h1><small>{{ t(auth.isEmployee ? 'auth.employee' : 'auth.customer') }}</small>
                <small v-if="!auth.isEmployee">{{ customer.user_code || customer.code }}</small>
            </div>
        </div>
        <div v-if="auth.isEmployee" class="selected">
            <i class="pi pi-shop" aria-hidden="true"></i>
            <div><small>{{ t('auth.selectedCustomerLabel') }}</small>
                <strong>{{ customer.user_code || customer.code || t('auth.noCustomer') }}</strong>
                <span>{{ customer.user_name || customer.name }}</span>
            </div>
            <RouterLink class="switch" :to="{ path: '/auth/login', query: { mode: 'employee', selectCustomer: '1', redirect: '/marketplace' } }">
                <i class="pi pi-sync"></i>{{ t('auth.changeCustomer') }}
            </RouterLink>
        </div>
        <div class="menu-list">
            <RouterLink v-for="[path, icon, label] in links" :key="path" :to="path"><i :class="['pi', icon]"></i>{{ t(label) }}<i class="pi pi-chevron-right arrow" aria-hidden="true"></i></RouterLink>
            <RouterLink v-if="auth.isEmployee && getStoredAdminPermissions().length" to="/admin"><i class="pi pi-cog"></i>{{ t('nav.admin') }}<i class="pi pi-chevron-right arrow" aria-hidden="true"></i></RouterLink>
        </div>
        <div class="secondary">
            <RouterLink to="/"><i class="pi pi-home"></i>{{ t('nav.home') }}</RouterLink>
            <RouterLink to="/marketplace"><i class="pi pi-list"></i>{{ t('nav.catalog') }}</RouterLink>
        </div>
        <button type="button" class="logout" @click="auth.logout()"><i class="pi pi-sign-out"></i>{{ t('nav.logout') }}</button>
    </section>
</template>

<style scoped>
.account { max-width: 42rem; margin: 0 auto; padding: 0 .65rem 1.25rem; color: var(--market-text); color-scheme: only light; }
.account h1 { margin: 0; font-size: clamp(1.65rem, 6vw, 2rem); line-height: 1.25; font-weight: 700; color: var(--market-text); }
.selected, .account a, .logout { border: 1px solid var(--market-card-border); border-radius: .85rem; background: var(--market-card-bg); color: inherit; }
.identity, .selected { display: flex; align-items: center; gap: .85rem; padding: 1rem; margin-bottom: .8rem; overflow-wrap: anywhere; }
.selected strong, .account small { display: block; }
.identity { padding-inline: .25rem; }
.identity > div { min-width: 0; }
.account small { color: var(--market-muted); }
.avatar { display: grid; flex: none; place-items: center; width: 3.25rem; height: 3.25rem; border-radius: 50%; background: linear-gradient(135deg,var(--market-primary),color-mix(in srgb,var(--market-primary) 75%,black)); color: white; font-size: 1.5rem; font-weight: 700; }
.selected { flex-wrap: wrap; background: linear-gradient(115deg,var(--market-primary-soft),var(--market-card-bg)); }
.selected > div { flex: 1 1 9rem; min-width: 0; }
.account a, .logout { display: flex; align-items: center; gap: .6rem; padding: .8rem; min-height: 44px; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.account .switch { color: var(--market-primary); background: var(--market-card-bg); border-color: var(--market-primary); }
.menu-list i:first-child, .secondary i { color: var(--market-primary); background: var(--market-primary-soft); }
.menu-list, .secondary { display: grid; grid-template-columns: minmax(0,1fr); gap: .55rem; margin-bottom: .9rem; }
.secondary { grid-template-columns: repeat(2,minmax(0,1fr)); }
.menu-list .arrow { margin-inline-start: auto; color: var(--market-muted); font-size: .85rem; }
.menu-list i:first-child, .secondary i { border-radius: .65rem; padding: .6rem; }
.menu-list a { min-height: 3.4rem; }
.logout { width: 100%; cursor: pointer; }
.account :is(button,a):focus-visible { outline: 2px solid var(--market-primary); outline-offset: 2px; }
</style>

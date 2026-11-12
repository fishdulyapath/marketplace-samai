import { watch } from 'vue';

// Reserve the actual footer height when labels wrap or the viewport changes.
export function useCheckoutFooter(element) {
    watch(element, (footer, _, onCleanup) => {
        if (!footer) return;
        const shell = footer.closest('.cart-step-shell, .confirmation-shell');
        const measure = () => shell?.style.setProperty('--checkout-footer-height', footer.offsetHeight + 'px');
        const observer = new ResizeObserver(measure);
        measure();
        observer.observe(footer);
        onCleanup(() => observer.disconnect());
    }, { flush: 'post' });
}

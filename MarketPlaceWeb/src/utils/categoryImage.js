export function resolveCategoryImage(cat) {
    const url = String(cat?.imageUrl || cat?.image_url || '').trim();
    if (!url) return '';
    if (url.startsWith('/media/')) {
        const apiBase = String(import.meta.env.VITE_APP_API || '').replace(/\/$/, '');
        return `${apiBase}${url}`;
    }
    return url;
}

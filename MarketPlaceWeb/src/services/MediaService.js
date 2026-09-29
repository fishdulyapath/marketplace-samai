import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getPreferredUrl(asset) {
    return asset?.path || asset?.url || '';
}

function resolveUrl(value) {
    const rawUrl = String(value || '').trim();
    if (!rawUrl) return '';

    let mediaPath = rawUrl.startsWith('/media/') ? rawUrl : '';
    if (!mediaPath && /^https?:\/\//i.test(rawUrl)) {
        try {
            const parsed = new URL(rawUrl);
            if (parsed.pathname.startsWith('/media/')) {
                mediaPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
        } catch {
            return rawUrl;
        }
    }

    if (!mediaPath) return rawUrl;
    const apiBase = String(import.meta.env.VITE_APP_API || '').replace(/\/$/, '');
    return apiBase ? `${apiBase}${mediaPath}` : mediaPath;
}

export default {
    getPreferredUrl,
    resolveUrl,

    async getMedia() {
        const response = await apiClient.get('service/v1/media');
        return response.data?.data || [];
    },

    async uploadMedia(file) {
        const dataUrl = await fileToDataUrl(file);
        const response = await apiClient.post('service/v1/media/upload', {
            dataUrl,
            fileName: file.name
        });
        return response.data?.data || null;
    },

    async uploadImage(file) {
        return this.uploadMedia(file);
    },

    async renameImage(name, newName) {
        const response = await apiClient.post('service/v1/media/rename', {
            name,
            newName
        });
        return response.data?.data || null;
    },

    async deleteImage(name) {
        const response = await apiClient.post('service/v1/media/delete', {
            name
        });
        return response.data?.data || null;
    }
};

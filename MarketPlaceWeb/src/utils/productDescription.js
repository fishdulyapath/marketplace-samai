function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isSafeUrl(value) {
    const url = String(value || '').trim().toLowerCase();
    return !url || url.startsWith('#') || url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:') || url.startsWith('tel:');
}

function sanitizeStyle(value) {
    const allowedProps = new Set(['color', 'background-color', 'text-align']);
    return String(value || '')
        .split(';')
        .map((rule) => rule.trim())
        .filter(Boolean)
        .map((rule) => {
            const [rawProp, ...rawValue] = rule.split(':');
            const prop = String(rawProp || '').trim().toLowerCase();
            const styleValue = rawValue.join(':').trim();
            if (!allowedProps.has(prop)) return '';
            if (/url\s*\(|expression\s*\(|javascript:|behavior\s*:/i.test(styleValue)) return '';
            return `${prop}: ${styleValue}`;
        })
        .filter(Boolean)
        .join('; ');
}

export function sanitizeProductDescription(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (!/<[a-z][\s\S]*>/i.test(raw)) {
        return escapeHtml(raw).replace(/\r?\n/g, '<br>');
    }

    if (typeof document === 'undefined') {
        return raw;
    }

    const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link', 'base']);
    const template = document.createElement('template');
    template.innerHTML = raw;

    template.content.querySelectorAll('*').forEach((el) => {
        const tagName = el.tagName.toLowerCase();
        if (blockedTags.has(tagName)) {
            el.remove();
            return;
        }

        [...el.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            const attrValue = attr.value;

            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                return;
            }

            if ((name === 'href' || name === 'src') && !isSafeUrl(attrValue)) {
                el.removeAttribute(attr.name);
                return;
            }

            if (name === 'style') {
                const style = sanitizeStyle(attrValue);
                if (style) el.setAttribute('style', style);
                else el.removeAttribute('style');
            }
        });

        if (tagName === 'a') {
            el.setAttribute('rel', 'noopener noreferrer');
        }
    });

    return template.innerHTML;
}

export function productDescriptionText(value) {
    const raw = String(value || '');
    if (!raw) return '';

    const withBreaks = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ');

    if (typeof document === 'undefined') {
        return withBreaks.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    }

    const template = document.createElement('template');
    template.innerHTML = withBreaks;
    return (template.content.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

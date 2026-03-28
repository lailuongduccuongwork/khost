export const PASSWORD_DIGEST_VERSION = 'v1';
const PASSWORD_DIGEST_SALT = 'khost::digest::2026';
const PASSWORD_VIEW_SALT = 'khost::view::2026';

export const digestPassword = (plain: string = ''): string => {
    const value = `${PASSWORD_DIGEST_SALT}:${plain}`;
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x01000193 >>> 0;

    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        h1 ^= code;
        h1 = Math.imul(h1, 16777619) >>> 0;

        h2 ^= code + i;
        h2 = Math.imul(h2, 2246822519) >>> 0;
    }

    return `${PASSWORD_DIGEST_VERSION}$${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};

export const verifyPassword = (
    plain: string,
    credential?: { password?: string; passwordHash?: string }
): boolean => {
    if (!credential) return false;
    const { password, passwordHash } = credential;
    if (passwordHash) {
        return digestPassword(plain) === passwordHash;
    }
    return !!password && password === plain;
};

export const encodePasswordForView = (plain: string = ''): string => {
    if (!plain) return '';
    let encoded = '';
    for (let i = 0; i < plain.length; i += 1) {
        const keyCode = PASSWORD_VIEW_SALT.charCodeAt(i % PASSWORD_VIEW_SALT.length);
        const cipher = plain.charCodeAt(i) ^ keyCode;
        encoded += cipher.toString(16).padStart(2, '0');
    }
    return encoded;
};

export const decodePasswordForView = (encoded: string = ''): string => {
    if (!encoded || encoded.length % 2 !== 0) return '';
    try {
        let plain = '';
        for (let i = 0; i < encoded.length; i += 2) {
            const chunk = encoded.slice(i, i + 2);
            const cipher = parseInt(chunk, 16);
            if (!Number.isFinite(cipher)) return '';
            const keyIndex = (i / 2) % PASSWORD_VIEW_SALT.length;
            const keyCode = PASSWORD_VIEW_SALT.charCodeAt(keyIndex);
            plain += String.fromCharCode(cipher ^ keyCode);
        }
        return plain;
    } catch (error) {
        return '';
    }
};

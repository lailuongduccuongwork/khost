import { Room } from '../types';

const normalizeBucketText = (value?: string | null) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();

export const isArchiveBucketRoom = (room?: Pick<Room, 'number'> | null) => {
    const normalized = normalizeBucketText(room?.number);
    if (!normalized) return false;
    return normalized.includes('huy/bao luu') || (normalized.includes('huy') && normalized.includes('bao luu'));
};

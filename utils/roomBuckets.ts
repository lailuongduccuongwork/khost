import { Room } from '../types';

export const isArchiveBucketRoom = (_room?: Pick<Room, 'number'> | null) => false;

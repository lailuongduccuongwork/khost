import { Property, Room } from '../types';

const isOperationallyHidden = (item?: { hiddenFromOperations?: boolean; isOperationalActive?: boolean } | null) =>
  item?.hiddenFromOperations === true || item?.isOperationalActive === false;

export const isPropertyOperational = (property?: Property | null) =>
  Boolean(property) && !isOperationallyHidden(property);

export const isRoomOperational = (
  room?: Room | null,
  propertyById?: Map<string, Property> | Record<string, Property | undefined>
) => {
  if (!room || isOperationallyHidden(room)) return false;
  if (!propertyById) return true;
  const property = propertyById instanceof Map ? propertyById.get(room.propertyId) : propertyById[room.propertyId];
  return property ? isPropertyOperational(property) : true;
};

export const filterOperationalProperties = (properties: Property[]) =>
  properties.filter(isPropertyOperational);

export const filterOperationalRooms = (rooms: Room[], properties?: Property[]) => {
  const propertyById = properties ? new Map(properties.map((property) => [property.id, property])) : undefined;
  return rooms.filter((room) => isRoomOperational(room, propertyById));
};

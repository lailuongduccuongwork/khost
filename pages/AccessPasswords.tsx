import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Check, KeyRound, Loader2, Search } from 'lucide-react';
import { DataService } from '../services/dataService';
import { PERMISSIONS, Property, Room, RoomType, User, UserRole } from '../types';

interface AccessPasswordsProps {
  properties: Property[];
  rooms: Room[];
  roomTypes: RoomType[];
  currentUser: User;
  onRefresh: () => void;
}

const AccessPasswords: React.FC<AccessPasswordsProps> = ({
  properties,
  rooms,
  roomTypes,
  currentUser,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [gateDrafts, setGateDrafts] = useState<Record<string, string>>({});
  const [roomDrafts, setRoomDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canEdit = currentUser.role === UserRole.ADMIN || currentUser.permissions?.includes(PERMISSIONS.CAN_EDIT_ACCESS_PASSWORDS);
  const allowedPropertyIds = useMemo(() => new Set(currentUser.allowedPropertyIds || []), [currentUser.allowedPropertyIds]);
  const visibleProperties = useMemo(
    () => properties
      .filter(property => currentUser.role === UserRole.ADMIN || allowedPropertyIds.has(property.id))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [allowedPropertyIds, currentUser.role, properties]
  );
  const visiblePropertyIds = useMemo(() => new Set(visibleProperties.map(property => property.id)), [visibleProperties]);
  const roomTypeById = useMemo(() => new Map(roomTypes.map(type => [type.id, type.name])), [roomTypes]);

  useEffect(() => {
    setGateDrafts(Object.fromEntries(visibleProperties.map(property => [property.id, property.gatePassword || ''])));
  }, [visibleProperties]);

  useEffect(() => {
    setRoomDrafts(Object.fromEntries(
      rooms.filter(room => visiblePropertyIds.has(room.propertyId)).map(room => [room.id, room.roomPassword || ''])
    ));
  }, [rooms, visiblePropertyIds]);

  const normalizedQuery = query.trim().toLocaleLowerCase('vi');
  const propertyMatches = (property: Property) => {
    if (!normalizedQuery) return true;
    if (property.name.toLocaleLowerCase('vi').includes(normalizedQuery)) return true;
    return rooms.some(room =>
      room.propertyId === property.id && (
        room.number.toLocaleLowerCase('vi').includes(normalizedQuery) ||
        (roomTypeById.get(room.typeId) || '').toLocaleLowerCase('vi').includes(normalizedQuery)
      )
    );
  };

  const saveGatePassword = async (property: Property) => {
    const key = `property:${property.id}`;
    setSavingKey(key);
    setMessage(null);
    try {
      await DataService.updatePropertyGatePassword(property.id, gateDrafts[property.id] || '');
      setMessage({ type: 'success', text: `Đã lưu mật khẩu cửa cơ sở ${property.name}.` });
      onRefresh();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể lưu mật khẩu cửa cơ sở.' });
    } finally {
      setSavingKey('');
    }
  };

  const saveRoomPassword = async (room: Room) => {
    const key = `room:${room.id}`;
    setSavingKey(key);
    setMessage(null);
    try {
      await DataService.updateRoomPassword(room.id, roomDrafts[room.id] || '');
      setMessage({ type: 'success', text: `Đã lưu mật khẩu cửa phòng ${room.number}.` });
      onRefresh();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể lưu mật khẩu cửa phòng.' });
    } finally {
      setSavingKey('');
    }
  };

  if (!canEdit) return null;

  return (
    <div className="katka-liquid-page animate-fade-in space-y-5">
      <header className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <KeyRound size={20} />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-gray-950">Mật khẩu ra vào</h1>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Cập nhật mật khẩu cửa cổng cơ sở và cửa phòng trong phạm vi bạn được phân quyền.
            </p>
          </div>
          <label className="relative block w-full md:w-80">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Tìm cơ sở, hạng hoặc số phòng"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm font-semibold outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
            />
          </label>
        </div>
      </header>

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
          message.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`} role="status">
          {message.text}
        </div>
      )}

      {visibleProperties.filter(propertyMatches).map(property => {
        const propertyRooms = rooms
          .filter(room => room.propertyId === property.id)
          .filter(room => !normalizedQuery ||
            property.name.toLocaleLowerCase('vi').includes(normalizedQuery) ||
            room.number.toLocaleLowerCase('vi').includes(normalizedQuery) ||
            (roomTypeById.get(room.typeId) || '').toLocaleLowerCase('vi').includes(normalizedQuery)
          )
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const propertySaveKey = `property:${property.id}`;

        return (
          <section key={property.id} className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gray-50/70 p-4 md:p-5">
              <div className="flex items-center gap-2 text-base font-black text-gray-900">
                <Building2 size={18} className="text-blue-600" />
                Cơ sở {property.name}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Mật khẩu cửa cổng cơ sở</span>
                  <div className="relative">
                    <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                    <input
                      value={gateDrafts[property.id] ?? ''}
                      onChange={event => setGateDrafts(previous => ({ ...previous, [property.id]: event.target.value }))}
                      onKeyDown={event => { if (event.key === 'Enter') saveGatePassword(property); }}
                      placeholder="Để trống nếu cơ sở không dùng mật khẩu"
                      autoComplete="off"
                      className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 font-mono text-sm font-bold text-gray-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => saveGatePassword(property)}
                  disabled={Boolean(savingKey)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingKey === propertySaveKey ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Lưu mật khẩu cơ sở
                </button>
              </div>
            </div>

            <div className="p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-black text-gray-900">Mật khẩu cửa phòng</h2>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">{propertyRooms.length} phòng</span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-gray-200">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Số phòng</th>
                      <th className="px-4 py-3">Hạng phòng</th>
                      <th className="px-4 py-3">Mật khẩu cửa phòng</th>
                      <th className="w-28 px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {propertyRooms.map(room => {
                      const roomSaveKey = `room:${room.id}`;
                      return (
                        <tr key={room.id} className="transition-colors hover:bg-blue-50/30">
                          <td className="px-4 py-3 font-black text-gray-900">{room.number}</td>
                          <td className="px-4 py-3 font-semibold text-gray-500">{roomTypeById.get(room.typeId) || 'Chưa xác định'}</td>
                          <td className="px-4 py-2">
                            <div className="relative">
                              <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                              <input
                                value={roomDrafts[room.id] ?? ''}
                                onChange={event => setRoomDrafts(previous => ({ ...previous, [room.id]: event.target.value }))}
                                onKeyDown={event => { if (event.key === 'Enter') saveRoomPassword(room); }}
                                placeholder="Chưa cài"
                                autoComplete="off"
                                aria-label={`Mật khẩu cửa phòng ${room.number}`}
                                className="w-full rounded-lg border border-transparent bg-gray-50 py-2 pl-9 pr-3 font-mono text-sm font-bold text-gray-900 outline-none transition hover:border-gray-200 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-50"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => saveRoomPassword(room)}
                              disabled={Boolean(savingKey)}
                              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 text-xs font-bold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingKey === roomSaveKey ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              Lưu
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {propertyRooms.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm font-semibold text-gray-400">Không có phòng phù hợp.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}

      {visibleProperties.filter(propertyMatches).length === 0 && (
        <div className="rounded-3xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-sm font-semibold text-gray-400">
          Không có cơ sở hoặc phòng phù hợp với phạm vi được cấp quyền.
        </div>
      )}
    </div>
  );
};

export default AccessPasswords;

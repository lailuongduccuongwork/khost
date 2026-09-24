type Listener<T> = { next: (value: T) => void; error?: (error: unknown) => void };

// Keep a live, up-to-date subscription briefly across route changes. Never reuse a
// disconnected snapshot as authoritative data, and clear the pool on logout.
export function createRealtimePool<T>(graceMs = 15_000) {
    type Entry = {
        listeners: Set<Listener<T>>;
        stop?: () => void;
        timer?: ReturnType<typeof setTimeout>;
        value?: T;
        ready: boolean;
    };
    const entries = new Map<string, Entry>();
    const dispose = (key: string, entry: Entry) => {
        if (entry.timer) clearTimeout(entry.timer);
        entries.delete(key);
        entry.stop?.();
        entry.listeners.clear();
    };
    return {
        subscribe(
            key: string,
            start: (next: (value: T) => void, error: (error: unknown) => void) => () => void,
            next: (value: T) => void,
            error?: (error: unknown) => void
        ) {
            let entry = entries.get(key);
            const isNew = !entry;
            if (!entry) {
                entry = { listeners: new Set(), ready: false };
                entries.set(key, entry);
            }
            const current = entry;
            if (current.timer) clearTimeout(current.timer);
            current.timer = undefined;
            const listener = { next, error };
            current.listeners.add(listener);
            if (current.ready) next(current.value!);
            if (isNew) {
                try {
                    const stop = start(value => {
                        if (entries.get(key) !== current) return;
                        current.value = value;
                        current.ready = true;
                        [...current.listeners].forEach(item => item.next(value));
                    }, failure => {
                        if (entries.get(key) !== current) return;
                        const listeners = [...current.listeners];
                        dispose(key, current);
                        listeners.forEach(item => item.error?.(failure));
                    });
                    current.stop = stop;
                    if (entries.get(key) !== current) stop();
                } catch (failure) {
                    dispose(key, current);
                    throw failure;
                }
            }
            return () => {
                current.listeners.delete(listener);
                if (current.listeners.size || current.timer || entries.get(key) !== current) return;
                current.timer = setTimeout(() => dispose(key, current), graceMs);
            };
        },
        clear() {
            [...entries].forEach(([key, entry]) => dispose(key, entry));
        },
    };
}

type SnapshotSyncOptions<T> = {
  listen: (onSnapshot: (snapshot: T) => void) => Promise<() => void>;
  read: () => Promise<T>;
  apply: (snapshot: T) => void;
  onError: (error: unknown) => void;
};

// Subscribe before reading. A slow initial/reveal read must not replace a newer
// event, and a listener that finishes registering after unmount must be removed.
export function startWindowSnapshotSync<T>(options: SnapshotSyncOptions<T>) {
  let active = true;
  let eventRevision = 0;
  let readRevision = 0;
  let unlisten: (() => void) | undefined;

  const refresh = async () => {
    if (!active) return;
    const eventAtStart = eventRevision;
    const readAtStart = ++readRevision;
    try {
      const snapshot = await options.read();
      if (active && eventAtStart === eventRevision && readAtStart === readRevision) {
        options.apply(snapshot);
      }
    } catch (error) {
      if (active) options.onError(error);
    }
  };

  const ready = (async () => {
    try {
      const stop = await options.listen((snapshot) => {
        if (!active) return;
        eventRevision += 1;
        options.apply(snapshot);
      });
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    } catch (error) {
      if (active) options.onError(error);
    }
    if (active) await refresh();
  })();

  return {
    ready,
    refresh,
    stop: () => {
      active = false;
      unlisten?.();
    },
  };
}

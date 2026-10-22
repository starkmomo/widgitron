import type { AppConfig } from "../types/config";

type AppConfigPatch = Partial<AppConfig>;

// Native window commands own these fields, even when a UI snapshot contains
// older values from before a pin, show or hide operation.
const WINDOW_OWNED_FIELDS = new Set<keyof AppConfig>(["active_widgets", "widgets_hidden", "sidebar_axis_geometry"]);

export function appConfigPatch(base: AppConfig, edited: AppConfig): AppConfigPatch {
  const patch: AppConfigPatch = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(edited)] as (keyof AppConfig)[]);
  for (const key of keys) {
    if (!WINDOW_OWNED_FIELDS.has(key)
      && JSON.stringify(base[key] ?? null) !== JSON.stringify(edited[key] ?? null)) {
      Object.assign(patch, { [key]: edited[key] });
    }
  }
  return patch;
}

type ConfigEdit = {
  id: number;
  patch: AppConfigPatch;
  state: "pending" | "saved" | "failed";
};

type AppConfigWriterOptions = {
  initial: AppConfig;
  save: (config: AppConfig, baseConfig: AppConfig) => Promise<void>;
  read: () => Promise<AppConfig>;
  apply: (config: AppConfig) => void;
  onError: (error: unknown) => void;
};

/** Serialize UI edits and project them over snapshots received from other windows. */
export function createAppConfigWriter(options: AppConfigWriterOptions) {
  let confirmed = options.initial;
  let current = options.initial;
  let revision = 0;
  let snapshotRevision = 0;
  let queue: Promise<void> = Promise.resolve();
  const edits = new Map<number, ConfigEdit>();

  const project = (config: AppConfig) => {
    let next = config;
    for (const edit of edits.values()) {
      if (edit.state !== "failed") next = { ...next, ...edit.patch };
    }
    return next;
  };

  const publish = () => {
    const next = project(confirmed);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      current = next;
      options.apply(current);
    }
    return current;
  };

  const receive = (config: AppConfig) => {
    snapshotRevision += 1;
    confirmed = config;
    return publish();
  };

  const reconcile = async (through: number) => {
    const snapshotAtStart = snapshotRevision;
    try {
      const saved = await options.read();
      // A native pin/layout update arriving during this read is newer than its
      // snapshot. Keep that update and only retire this batch of local edits.
      if (snapshotAtStart === snapshotRevision) confirmed = saved;
    } catch (error) {
      // A failed read must not strand optimistic edits forever. Retain writes
      // known to have succeeded and discard failed ones before clearing them.
      for (const edit of edits.values()) {
        if (edit.id <= through && edit.state === "saved") confirmed = { ...confirmed, ...edit.patch };
      }
      options.onError(error);
    } finally {
      for (const id of edits.keys()) if (id <= through) edits.delete(id);
      publish();
    }
  };

  const save = (baseConfig: AppConfig, config: AppConfig): Promise<void> => {
    // Diff against the props used by the input handler, not against current:
    // another input may have updated current before React refreshed those props.
    const patch = appConfigPatch(baseConfig, config);
    if (Object.keys(patch).length === 0) return Promise.resolve();
    const edit: ConfigEdit = { id: ++revision, patch, state: "pending" };
    edits.set(edit.id, edit);
    publish();

    const operation = queue.then(async () => {
      try {
        await options.save(config, baseConfig);
        edit.state = "saved";
      } catch (error) {
        edit.state = "failed";
        options.onError(error);
        throw error;
      } finally {
        if (edit.id === revision) await reconcile(edit.id);
        else if (edit.state === "failed") publish();
      }
    });
    // One failed write cannot prevent later settings from being saved.
    queue = operation.catch(() => {});
    return operation;
  };

  return { receive, save, current: () => current };
}

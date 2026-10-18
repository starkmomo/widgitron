import { useEffect, useState } from "react";

export function useResearchSelection<T>(items: T[], key: (item: T) => string, scope: string) {
  const [state, setState] = useState({ scope, enabled: false, ids: new Set<string>() });
  useEffect(() => { setState(previous => previous.scope === scope ? previous : { scope, enabled: false, ids: new Set<string>() }); }, [scope]);
  const enabled = state.scope === scope && state.enabled;
  const chosen = enabled ? items.filter(item => state.ids.has(key(item))) : [];
  return {
    enabled, chosen,
    has: (item: T) => enabled && state.ids.has(key(item)),
    toggleMode: () => setState({ scope, enabled: !enabled, ids: new Set() }),
    finish: () => setState({ scope, enabled: false, ids: new Set() }),
    clear: () => setState({ scope, enabled, ids: new Set() }),
    toggle: (item: T) => setState(previous => {
      const ids = new Set(previous.scope === scope ? previous.ids : []);
      const id = key(item); if (ids.has(id)) ids.delete(id); else ids.add(id);
      return { scope, enabled: true, ids };
    }),
    toggleAll: () => setState({ scope, enabled: true, ids: new Set(chosen.length === items.length ? [] : items.map(key)) }),
  };
}

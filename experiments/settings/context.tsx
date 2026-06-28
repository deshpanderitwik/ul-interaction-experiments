import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Schema, ValuesOf } from './types';

type Values = Record<string, number>;

type SettingsCtx = {
  schema: Schema | null;
  values: Values;
  setValue: (key: string, value: number) => void;
  register: (schema: Schema) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  audio: boolean; // musical experiment → show scale + tempo
};

const Context = createContext<SettingsCtx | null>(null);

// In-memory persistence keyed by experiment id — survives opening/closing the
// panel and navigating away and back within a session (not across app
// restarts; that would need on-device storage = a native dep).
const store = new Map<string, Values>();

export function SettingsProvider({
  id,
  audio = false,
  children,
}: {
  id: string;
  audio?: boolean;
  children: ReactNode;
}) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [values, setValues] = useState<Values>(() => ({ ...(store.get(id) ?? {}) }));
  const [open, setOpen] = useState(false);

  // Called by the experiment (via useSettings) to publish its schema and seed
  // any not-yet-set values with the control defaults.
  const register = useCallback(
    (sch: Schema) => {
      setSchema(sch);
      setValues((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(sch)) {
          if (next[key] === undefined) next[key] = sch[key].default;
        }
        store.set(id, next);
        return next;
      });
    },
    [id]
  );

  const setValue = useCallback(
    (key: string, value: number) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        store.set(id, next);
        return next;
      });
    },
    [id]
  );

  const ctx = useMemo<SettingsCtx>(
    () => ({ schema, values, setValue, register, open, setOpen, audio }),
    [schema, values, setValue, register, open, audio]
  );

  return <Context.Provider value={ctx}>{children}</Context.Provider>;
}

export function useSettingsContext(): SettingsCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error('useSettings must be used inside an experiment (SettingsProvider)');
  }
  return ctx;
}

/**
 * Declare an experiment's settings and read their live values. Call once with a
 * stable (module-scope) schema:
 *
 *   const SETTINGS = { gap: { type: 'slider', ... } } as const;
 *   const s = useSettings(SETTINGS); // { gap: number }
 *
 * Registering makes the gear + panel appear; values update live as the user
 * drags, so the experiment re-renders with the new value applied.
 */
export function useSettings<S extends Schema>(schema: S): ValuesOf<S> {
  const { register, values } = useSettingsContext();

  useEffect(() => {
    register(schema);
  }, [register, schema]);

  return useMemo(() => {
    const out = {} as Record<string, number>;
    for (const key in schema) out[key] = values[key] ?? schema[key].default;
    return out as ValuesOf<S>;
  }, [schema, values]);
}

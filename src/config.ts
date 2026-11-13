/**
 * Persistent, reset-proof configuration store.
 *
 * Why the old store lost settings: it lived only in `localStorage`, and the
 * YouTube TV app wipes its whole origin storage in some flows (its storage
 * service calls `localStorage.clear()` and clears every cookie, e.g. on
 * "Reset app" and on account/storage resets). A failed write (quota) also
 * dropped changes silently.
 *
 * What this store does instead:
 * - Values are validated against the defaults' types and merged over them,
 *   so a damaged or partial record never wipes everything.
 * - Every write goes to `localStorage` *and* an IndexedDB mirror. On start-up
 *   the newest copy wins, so a cleared `localStorage` is restored from IDB.
 * - `Storage.prototype.clear()`/`removeItem()` are guarded so YouTube clearing
 *   its storage no longer takes our key with it.
 *
 * The storage key and the flat record shape are unchanged from upstream, so
 * existing settings carry over.
 */

const CONFIG_KEY = 'ytaf-configuration';
const META_REV = '__ytafRev';
const META_SAVED = '__ytafSavedAt';

const IDB_NAME = 'ytaf';
const IDB_STORE = 'kv';

export const configDefaults = {
  enableAdBlock: true,
  removeShorts: false,
  enableSponsorBlock: true,
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockPreview: false,
  hideLogo: false,
  showWatch: false,
  forceHighResVideo: false,
  removeEndscreen: false,
  autoAccountSelect: false
} satisfies Record<string, boolean | number | string>;

export type ConfigKey = keyof typeof configDefaults;
export type ConfigValue<K extends ConfigKey> = (typeof configDefaults)[K];
type ConfigValues = { -readonly [K in ConfigKey]: ConfigValue<K> };
type Listener<K extends ConfigKey> = (
  newValue: ConfigValue<K>,
  oldValue: ConfigValue<K>
) => void;

interface StoredRecord {
  values: Partial<ConfigValues>;
  rev: number;
  savedAt: number;
}

const configKeys = Object.keys(configDefaults) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(configDefaults, key);
}

/** Keep only known keys whose value has the same type as the default. */
function sanitize(raw: unknown): StoredRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const values: Partial<Record<ConfigKey, unknown>> = {};
  let count = 0;

  for (const key of configKeys) {
    const v = obj[key];
    if (v !== undefined && typeof v === typeof configDefaults[key]) {
      values[key] = v;
      count++;
    }
  }

  const rev = typeof obj[META_REV] === 'number' ? obj[META_REV] : 0;
  const savedAt = typeof obj[META_SAVED] === 'number' ? obj[META_SAVED] : 0;

  if (count === 0 && rev === 0) return null;
  return { values: values as Partial<ConfigValues>, rev, savedAt };
}

function serialize(): string {
  return JSON.stringify({ ...values, [META_REV]: rev, [META_SAVED]: savedAt });
}

// Bind the native Storage methods before anything (including YouTube) can
// wrap them, and before our own guard below replaces them.
const nativeGetItem = Storage.prototype.getItem;
const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;
const nativeClear = Storage.prototype.clear;

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLocal(): StoredRecord | null {
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    const text = nativeGetItem.call(ls, CONFIG_KEY);
    if (text === null) return null;
    // `JSON.parse` may already be wrapped by our hooks; they ignore small
    // objects like this one, but use a reviver-free call either way.
    return sanitize(JSON.parse(text));
  } catch (err) {
    console.warn('[config] Stored configuration is unreadable:', err);
    return null;
  }
}

function writeLocal(text: string) {
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    nativeSetItem.call(ls, CONFIG_KEY, text);
  } catch (err) {
    // Quota exceeded or storage disabled; the IndexedDB mirror still has it.
    console.warn('[config] localStorage write failed:', err);
  }
}

/* ---------------- IndexedDB mirror ---------------- */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(IDB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If something deletes the database while we hold it open, reopen later.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function readIdb(): Promise<StoredRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db
        .transaction(IDB_STORE, 'readonly')
        .objectStore(IDB_STORE)
        .get(CONFIG_KEY);
      req.onsuccess = () => {
        try {
          resolve(
            typeof req.result === 'string'
              ? sanitize(JSON.parse(req.result))
              : null
          );
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeIdb(text: string) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(IDB_STORE, 'readwrite')
      .objectStore(IDB_STORE)
      .put(text, CONFIG_KEY);
  } catch (err) {
    console.warn('[config] IndexedDB write failed:', err);
  }
}

/* ---------------- State ---------------- */

const values: ConfigValues = { ...configDefaults };
let rev = 0;
let savedAt = 0;

const listeners = new Map<ConfigKey, Set<Listener<ConfigKey>>>();

function applyRecord(record: StoredRecord, notify: boolean) {
  rev = record.rev;
  savedAt = record.savedAt;
  for (const key of configKeys) {
    const next = (record.values[key] ?? configDefaults[key]) as ConfigValue<
      typeof key
    >;
    const prev = values[key];
    if (prev === next) continue;
    (values as Record<ConfigKey, unknown>)[key] = next;
    if (notify) emit(key, next, prev);
  }
}

function emit<K extends ConfigKey>(
  key: K,
  next: ConfigValue<K>,
  prev: ConfigValue<K>
) {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) {
    try {
      (cb as Listener<K>)(next, prev);
    } catch (err) {
      console.warn('[config] change listener failed for', key, err);
    }
  }
}

function persist() {
  rev++;
  savedAt = Date.now();
  const text = serialize();
  writeLocal(text);
  void writeIdb(text);
}

const initial = readLocal();
if (initial) applyRecord(initial, false);

// Reconcile with the IndexedDB mirror once it is readable.
export const configReady: Promise<void> = readIdb().then((mirror) => {
  if (mirror && (!initial || mirror.rev > rev)) {
    console.info('[config] Restoring settings from IndexedDB mirror');
    applyRecord(mirror, true);
    writeLocal(serialize());
  } else if (initial && (!mirror || mirror.rev < rev)) {
    void writeIdb(serialize());
  }
});

/* ---------------- Storage guard ---------------- */

function installStorageGuard() {
  const proto = Storage.prototype;
  proto.clear = function clear(this: Storage) {
    const isLocal = this === getLocalStorage();
    const saved = isLocal ? nativeGetItem.call(this, CONFIG_KEY) : null;
    nativeClear.call(this);
    if (saved !== null) {
      console.info('[config] Storage cleared by page; kept YTAF settings');
      try {
        nativeSetItem.call(this, CONFIG_KEY, saved);
      } catch {
        /* the IndexedDB mirror still has it */
      }
    }
  };
  proto.removeItem = function removeItem(this: Storage, key: string) {
    if (key === CONFIG_KEY && this === getLocalStorage()) return;
    nativeRemoveItem.call(this, key);
  };
}

installStorageGuard();

/* ---------------- Public API ---------------- */

export function configRead<K extends ConfigKey>(key: K): ConfigValue<K> {
  return values[key];
}

export function configWrite<K extends ConfigKey>(
  key: K,
  value: ConfigValue<K>
) {
  if (!isConfigKey(key)) throw new Error('unknown config key: ' + key);
  if (typeof value !== typeof configDefaults[key]) {
    throw new TypeError(`bad value for config key ${key}: ${String(value)}`);
  }
  const prev = values[key];
  if (prev === value) return;
  values[key] = value;
  console.info('[config]', key, prev, '->', value);
  persist();
  emit(key, value, prev);
}

export function configReset() {
  const prev = { ...values };
  Object.assign(values, configDefaults);
  persist();
  for (const key of configKeys) {
    if (prev[key] !== values[key]) emit(key, values[key], prev[key]);
  }
}

/**
 * Subscribe to changes of a key. Returns an unsubscribe function.
 */
export function configAddChangeListener<K extends ConfigKey>(
  key: K,
  callback: Listener<K>
): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(callback as Listener<ConfigKey>);
  return () => set.delete(callback as Listener<ConfigKey>);
}

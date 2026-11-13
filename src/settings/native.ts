/**
 * Puts the AdFree options into YouTube's own Settings page.
 *
 * The Settings page is built from the `account/get_setting` response: a list
 * of `settingCategoryCollectionRenderer`s. We add our categories to that list,
 * using YouTube's native `settingBooleanRenderer` (On/Off) items, so the
 * options look and navigate exactly like YouTube's own – no green button
 * needed.
 *
 * How the toggles work:
 * - Each toggle sends a `setClientSettingEndpoint` with an item name prefixed
 *   `YTAF_`. Our resolveCommand interceptor writes it to our config and
 *   reports it handled, which makes YouTube re-render the toggle.
 * - YouTube reads a toggle's state from its client-setting service, which
 *   falls back to a `Map` of default values for unknown items. We keep our
 *   current values in that `Map`, so the checkmark is always right.
 *
 * If that `Map` cannot be found (YouTube changed internals), the category
 * degrades to a single entry that opens our own overlay panel instead.
 */

import {
  configAddChangeListener,
  configRead,
  configReset,
  configWrite,
  isConfigKey,
  type ConfigKey
} from '../config';
import { addJsonFilter } from '../hooks/json-parse';
import { ResolveCommandRegistry, type ResolveCommandPayload } from '../app_api';
import { t, tf } from '../i18n';
import { showNotification } from '../notifications';
import {
  SETTING_PREFIX,
  settingsSections,
  type ActionItem,
  type SettingsSection,
  type ToggleItem
} from './definitions';
import { iconUri } from './icons';
import { showSettingsPanel } from './panel';

type Json = Record<string, unknown>;

const ACTION_PREFIX = 'YTAF_ACTION_';

const runs = (text: string) => ({ runs: [{ text }] });

/* ---------------- YouTube's client-setting defaults Map ---------------- */

let defaultsMap: Map<string, unknown> | null = null;

function syncDefaults() {
  if (!defaultsMap) return;
  for (const section of settingsSections) {
    for (const item of section.items) {
      if (item.kind === 'toggle') {
        defaultsMap.set(SETTING_PREFIX + item.key, configRead(item.key));
      }
    }
  }
}

function findDefaultsMap(): Map<string, unknown> | null {
  if (defaultsMap) return defaultsMap;
  const ns = window._yttv;
  if (!ns) return null;
  for (const key in ns) {
    const v = ns[key];
    if (
      v instanceof Map &&
      v.has('AUTONAV_FOR_SIGN_OUT') &&
      v.has('SAFETY_MODE')
    ) {
      defaultsMap = v as Map<string, unknown>;
      syncDefaults();
      return defaultsMap;
    }
  }
  return null;
}

for (const section of settingsSections) {
  for (const item of section.items) {
    if (item.kind !== 'toggle') continue;
    configAddChangeListener(item.key, (value) => {
      defaultsMap?.set(SETTING_PREFIX + item.key, value);
    });
  }
}

/* ---------------- Renderers ---------------- */

function toggleRenderer(item: ToggleItem): Json {
  const endpoint = (value: boolean) => ({
    setClientSettingEndpoint: {
      settingDatas: [
        {
          clientSettingEnum: { item: SETTING_PREFIX + item.key },
          boolValue: value
        }
      ]
    }
  });

  return {
    settingBooleanRenderer: {
      title: runs(t(item.title)),
      summary: runs(t(item.summary)),
      enableServiceEndpoint: endpoint(true),
      disableServiceEndpoint: endpoint(false),
      itemId: SETTING_PREFIX + item.key,
      thumbnail: { thumbnails: [{ url: iconUri(item.icon, item.color) }] }
    }
  };
}

function actionRenderer(item: ActionItem): Json {
  return {
    settingActionRenderer: {
      title: runs(t(item.title)),
      summary: runs(tf(item.summary, { version: __YTAF_VERSION__ })),
      actionLabel: runs(t(item.actionLabel)),
      itemId: SETTING_PREFIX + item.id,
      serviceEndpoint: {
        customAction: { action: ACTION_PREFIX + item.id }
      },
      thumbnail: { thumbnails: [{ url: iconUri(item.icon, item.color) }] }
    }
  };
}

function categoryRenderer(section: SettingsSection, items: Json[]): Json {
  return {
    settingCategoryCollectionRenderer: {
      title: runs(t(section.title)),
      categoryId: section.id,
      focused: false,
      items
    }
  };
}

function buildCategories(placement: 'top' | 'bottom', native: boolean) {
  if (!native) {
    if (placement === 'bottom') return [];
    // Degraded mode: one entry that opens the overlay panel.
    return [
      categoryRenderer(settingsSections[0]!, [
        actionRenderer({
          kind: 'action',
          id: 'about',
          title: { en: 'AdFree settings', sv: 'AdFree-inställningar' },
          summary: {
            en: 'Version {version}. Opens the AdFree settings panel.',
            sv: 'Version {version}. Öppnar panelen med AdFree-inställningar.'
          },
          actionLabel: { en: 'Open', sv: 'Öppna' },
          icon: 'shield',
          color: '#1e9e6a'
        })
      ])
    ];
  }

  return settingsSections
    .filter((s) => s.placement === placement)
    .map((section) =>
      categoryRenderer(
        section,
        section.items.map((item) =>
          item.kind === 'toggle' ? toggleRenderer(item) : actionRenderer(item)
        )
      )
    );
}

/* ---------------- Response filter ---------------- */

function isSettingsCategory(v: unknown): v is Json {
  return (
    !!v &&
    typeof v === 'object' &&
    'settingCategoryCollectionRenderer' in (v as Json)
  );
}

addJsonFilter('settings', (r) => {
  const items = r.items;
  if (!Array.isArray(items) || items.length === 0) return;
  if (!items.some(isSettingsCategory)) return;

  // Already patched (YouTube sometimes re-parses cached responses).
  const already = items.some((i) => {
    const id = (
      (i as Json | null)?.settingCategoryCollectionRenderer as Json | undefined
    )?.categoryId;
    return typeof id === 'string' && id.startsWith(SETTING_PREFIX);
  });
  if (already) return;

  const native = findDefaultsMap() !== null;
  if (!native) {
    console.warn('[settings] client-setting defaults not found; degraded mode');
  }

  items.unshift(...buildCategories('top', native));
  items.push(...buildCategories('bottom', native));
});

/* ---------------- Command handling ---------------- */

function handleAction(id: string) {
  switch (id) {
    case 'reset':
      configReset();
      showNotification(
        t({
          en: 'AdFree settings were reset to defaults',
          sv: 'AdFree-inställningarna har återställts'
        }),
        3000,
        'green'
      );
      break;
    case 'about':
      showSettingsPanel(true);
      break;
    default:
      console.warn('[settings] unknown action', id);
  }
}

function getSettingItem(payload: ResolveCommandPayload): Json | undefined {
  const ep = payload.setClientSettingEndpoint as Json | undefined;
  const datas = ep?.settingDatas;
  if (!Array.isArray(datas) || datas.length === 0) return undefined;
  return datas[0] as Json;
}

void ResolveCommandRegistry.getInstance().then((registry) => {
  registry.addInterceptor((payload) => {
    const data = getSettingItem(payload);
    if (data) {
      const item = (data.clientSettingEnum as Json | undefined)?.item;
      if (typeof item === 'string' && item.startsWith(SETTING_PREFIX)) {
        const key = item.slice(SETTING_PREFIX.length);
        if (isConfigKey(key) && typeof data.boolValue === 'boolean') {
          configWrite(key as ConfigKey, data.boolValue as never);
        }
        // Truthy return makes YouTube re-render the toggle.
        return true;
      }
    }

    const custom = payload.customAction as Json | undefined;
    const action = custom?.action;
    if (typeof action === 'string' && action.startsWith(ACTION_PREFIX)) {
      handleAction(action.slice(ACTION_PREFIX.length));
      return true;
    }

    return undefined;
  });
});

/** Open YouTube's Settings page (where our categories live). */
export function openYouTubeSettings(): boolean {
  const registry = ResolveCommandRegistry.peek();
  if (!registry) return false;
  try {
    registry.dispatchCommand({ applicationSettingsEndpoint: { hack: true } });
    return true;
  } catch (err) {
    console.warn('[settings] could not open YouTube settings:', err);
    return false;
  }
}

/** For the overlay: whether the native integration is active. */
export function nativeSettingsAvailable() {
  return findDefaultsMap() !== null;
}

export function isToggleKey(key: string): key is ConfigKey {
  return isConfigKey(key);
}

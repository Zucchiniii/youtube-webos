/**
 * "Remember profile": skip "Who's watching?" and continue with the last
 * profile.
 *
 * YouTube TV decides whether to show its start-up screens (account picker,
 * welcome, "welcome back") from recurring-action records in localStorage,
 * each with a `lastFired` time and a cool-down. Marking them as just fired
 * – pushed a week ahead, refreshed at every start – keeps the picker away, so
 * the app opens straight into the profile that was used last.
 *
 * The `startAccountSelectorCommand` hook stays as a second line: if YouTube
 * still asks for the picker, we answer "same profile" right away.
 */

import { configAddChangeListener, configRead } from './config';
import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';

const RECURRING_KEY = 'yt.leanback.default::recurring_actions';
const STARTUP_SCREENS = [
  'startup-screen-account-selector-with-guest',
  'whos_watching_fullscreen_zero_accounts',
  'startup-screen-signed-out-welcome-back'
] as const;
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

type Json = Record<string, unknown>;

function setStartupScreensLastFired(lastFired: number) {
  let stored: Json | null = null;
  try {
    const text = window.localStorage.getItem(RECURRING_KEY);
    stored = text ? (JSON.parse(text) as Json) : null;
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') stored = {};

  const record = (stored.data ??= {}) as Json;
  const actions = (record.data ??= {}) as Record<string, Json>;
  for (const name of STARTUP_SCREENS) {
    const entry = (actions[name] ??= { timesFired: 0, dailiesBitSet: 0 });
    entry.lastFired = lastFired;
    if (lastFired > 0 && !entry.timesFired) entry.timesFired = 1;
  }

  try {
    window.localStorage.setItem(RECURRING_KEY, JSON.stringify(stored));
  } catch (err) {
    console.warn('[remember-profile] could not update start-up screens:', err);
  }
}

function apply(enabled: boolean) {
  // Enabled: "fired just now, a week from now". Disabled: long ago, so the
  // picker shows again on the next start.
  setStartupScreensLastFired(enabled ? Date.now() + SNOOZE_MS : 1);
}

if (configRead('autoAccountSelect')) apply(true);
configAddChangeListener('autoAccountSelect', apply);

const hook: ResolveCommandHook = function (resolveCommand, payload, extra) {
  if (!configRead('autoAccountSelect')) {
    return resolveCommand(payload, extra);
  }

  const finalEndpoint = payload?.startAccountSelectorCommand // @ts-expect-error TS doesn't allow optional chaining on `unknown`. See: github.com/microsoft/TypeScript/issues/37700
    ?.nextEndpoint as unknown;

  ResolveCommandRegistry.peek()?.dispatchCommand({
    onIdentityChanged: {
      identityActionContext: {
        nextEndpoint: finalEndpoint,
        eventTrigger: 'ACCOUNT_EVENT_TRIGGER_WHOS_WATCHING',
        reloadRequired: undefined
      },
      isSameIdentity: true
    },
    commandMetadata: { webCommandMetadata: { clientAction: true } }
  });
};

void ResolveCommandRegistry.getInstance().then((registry) => {
  registry.setHook('startAccountSelectorCommand', hook);
});

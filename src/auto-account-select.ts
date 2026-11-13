import { configRead } from './config';

import { ResolveCommandRegistry, type ResolveCommandHook } from './app_api';

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

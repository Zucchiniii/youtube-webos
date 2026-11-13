// Adapted from https://github.com/reisxd/TizenTube/blob/522f83cc012d5b1c75181b651e084a3afa280323/mods/resolveCommand.js

declare global {
  interface Window {
    _yttv?: Record<string, unknown>;
  }
}

export type ResolveCommandPayload = Record<string, unknown>;

interface ResolveCommand {
  (command: ResolveCommandPayload, extra?: unknown): unknown;
}

export interface ResolveCommandHook {
  (
    originalFn: ResolveCommand,
    payload: ResolveCommandPayload,
    extra: unknown
  ): unknown;
}

/**
 * Runs before the per-command hooks. Return `undefined` to let the command
 * continue; any other value marks it handled and is returned to YouTube.
 */
export type ResolveCommandInterceptor = (
  payload: ResolveCommandPayload,
  extra: unknown
) => unknown;

let registry: ResolveCommandRegistry | null = null;
let pending: Promise<ResolveCommandRegistry> | null = null;

export class ResolveCommandRegistry {
  #originalFn: ResolveCommand;
  #cmds = new Map<string, ResolveCommandHook>();
  #interceptors: ResolveCommandInterceptor[] = [];

  private resolveCommand = (
    command: ResolveCommandPayload,
    extra?: unknown
  ) => {
    if (window.__ytaf_debug__) console.debug('[resolveCommand]', command);

    if (command && typeof command === 'object') {
      for (const interceptor of this.#interceptors) {
        let res: unknown;
        try {
          res = interceptor(command, extra);
        } catch (err) {
          console.warn('[resolveCommand] interceptor failed:', err);
          continue;
        }
        if (res !== undefined) return res;
      }

      for (const key of Object.keys(command)) {
        const hook = this.#cmds.get(key);
        if (hook) return hook(this.#originalFn, command, extra);
      }
    }

    return this.#originalFn(command, extra);
  };

  private constructor(hookTargetName: string) {
    const hookTarget = window._yttv![hookTargetName] as {
      instance: { resolveCommand: ResolveCommand };
    };

    this.#originalFn = hookTarget.instance.resolveCommand.bind(
      hookTarget.instance
    );

    hookTarget.instance.resolveCommand = this.resolveCommand;
  }

  private static checkHookTarget(targetName: string) {
    const target = window._yttv?.[targetName];

    return !!(
      target &&
      typeof target === 'function' &&
      'instance' in target &&
      target.instance &&
      typeof target.instance === 'object' &&
      typeof (target.instance as Record<string, unknown>).resolveCommand ===
        'function'
    );
  }

  private static findHookTarget() {
    if (typeof window._yttv !== 'object' || window._yttv === null) return null;

    for (const key in window._yttv) {
      if (this.checkHookTarget(key)) return key;
    }

    return null;
  }

  /** The registry if YouTube's command resolver is already hooked. */
  static peek(): ResolveCommandRegistry | null {
    return registry;
  }

  static getInstance(): Promise<ResolveCommandRegistry> {
    if (registry) return Promise.resolve(registry);
    if (pending) return pending;

    pending = new Promise((resolve) => {
      const poll = () => {
        const key = this.findHookTarget();
        if (key) {
          registry = new ResolveCommandRegistry(key);
          resolve(registry);
        } else {
          setTimeout(poll, 25);
        }
      };
      poll();
    });
    return pending;
  }

  setHook(command: string, fn: ResolveCommandHook) {
    this.#cmds.set(command, fn);
  }

  removeHook(command: string) {
    this.#cmds.delete(command);
  }

  addInterceptor(fn: ResolveCommandInterceptor) {
    this.#interceptors.push(fn);
  }

  /** Send a command straight to YouTube, bypassing our hooks. */
  dispatchCommand(payload: ResolveCommandPayload, extra?: unknown) {
    return this.#originalFn(payload, extra);
  }
}

void ResolveCommandRegistry.getInstance();

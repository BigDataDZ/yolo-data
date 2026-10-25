import { AsyncLocalStorage } from 'node:async_hooks';

// One scope per session manager; identity follows each HTTP request through SDK/tool awaits.
// Never overwrite a session's shared dependencies with the latest caller's identity.
export function createRequestContextScope() {
  const contexts = new AsyncLocalStorage();
  return {
    bindDeps(deps) {
      const initialContext = deps.requestContext;
      Object.defineProperty(deps, 'requestContext', {
        enumerable: true,
        configurable: true,
        get: () => contexts.getStore() ?? initialContext,
      });
      return deps;
    },
    run(requestContext, callback) {
      return contexts.run(requestContext, callback);
    },
  };
}

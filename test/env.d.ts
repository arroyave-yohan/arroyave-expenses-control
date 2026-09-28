import type { Bindings } from '../src/shared/types';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}

import type { Modeler } from '@miragon/event-storming-renderer';
import type { Shell } from '@miragon/modeler-shell';

export interface Plugin {
  readonly id: string;
  install(kernel: Kernel): void;
  destroy?(): void;
}

export class Kernel {
  private readonly plugins = new Map<string, Plugin>();
  private readonly handlers = new Map<string, (...args: any[]) => any>();
  private destroyed = false;

  constructor(
    public readonly modeler: Modeler,
    public readonly shell: Shell,
  ) {}

  use(plugin: Plugin): this {
    if (this.plugins.has(plugin.id)) return this;
    this.plugins.set(plugin.id, plugin);
    plugin.install(this);
    return this;
  }

  registerHandler(action: string, fn: (...args: any[]) => any): void {
    this.handlers.set(action, fn);
  }

  async request(action: string, ...args: any[]): Promise<any> {
    const fn = this.handlers.get(action);
    if (!fn) {
      throw new Error(`Handler not found for action: ${action}`);
    }
    return fn(...args);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const plugin of this.plugins.values()) {
      plugin.destroy?.();
    }
    this.plugins.clear();
    this.handlers.clear();
  }
}

import type { TypeCaptions } from '@miragon/event-storming-renderer';
import { readTypeCaptionsVisible } from '../preferences.js';
import type { Kernel, Plugin } from '../kernel.js';

export class PreferencesPlugin implements Plugin {
  readonly id = 'preferences';

  install(kernel: Kernel): void {
    const typeCaptions = kernel.modeler.get<TypeCaptions>('eventStormingViewOptions');
    if (readTypeCaptionsVisible() === false) {
      typeCaptions.setTypeCaptionsVisible(false);
    }
  }
}

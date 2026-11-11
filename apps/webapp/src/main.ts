import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import '@miragon/event-storming-renderer/assets/event-storming.css';
import '@miragon/modeler-shell/shell.css';

import { Modeler, boardMenu, type BoardLevels, type TypeCaptions } from '@miragon/event-storming-renderer';
import { commandKeyLabel, defaultMessages, detectPlatform, mountShell } from '@miragon/modeler-shell';
import { connectDiagramJs, shellModule } from '@miragon/modeler-shell/diagram-js';

import { Kernel } from './kernel.js';
import { DocumentPlugin } from './plugins/document.plugin.js';
import { PreferencesPlugin } from './plugins/preferences.plugin.js';
import { ProblemsPlugin } from './plugins/problems.plugin.js';
import { SharePlugin } from './plugins/share.plugin.js';
import { ShortcutsPlugin } from './plugins/shortcuts.plugin.js';
import { THEMES } from './themes.js';
import { readHashMap, hashHoldsBoard } from './share.js';
import { openFile, svgToPng } from './io.js';

const BOARD_NAME = 'Event Storming board';
const REPOSITORY_URL = 'https://github.com/Miragon/event-storming-modeler';

const app = document.getElementById('app');
if (!app) throw new Error('index.html has no #app root.');

const modeler = new Modeler({
  width: '100%',
  height: '100%',
  additionalModules: [shellModule],
  freeArea: { insets: () => shell.fitInsets() },
});
modeler.get('canvas');

const levels = modeler.get<BoardLevels>('eventStormingModeling');
const typeCaptions = modeler.get<TypeCaptions>('eventStormingViewOptions');

Object.assign(globalThis as Record<string, unknown>, {
  __eventStormingViewer: modeler,
  __eventStormingIo: { openFile, svgToPng },
});

const platform = detectPlatform(navigator);
const saveKey = commandKeyLabel('S', platform, defaultMessages.keyNames);

let kernel: Kernel;

const documentPlugin = new DocumentPlugin();
const sharePlugin = new SharePlugin();
const shortcutsPlugin = new ShortcutsPlugin();

const shell = mountShell(app, {
  host: 'web',
  canvas: modeler.container,
  lang: 'en',
  platform,
  themes: THEMES,
  messages: { canvas: BOARD_NAME },
  legal: { links: [{ label: 'GitHub', href: REPOSITORY_URL }] },
  primary: {
    onSelect: () => void kernel?.request('share:shareLink'),
  },
  menu: boardMenu({
    levels,
    typeCaptions,
    exports: {
      png: { onSelect: () => void kernel?.request('share:exportPicture', 'png') },
      svg: { onSelect: () => void kernel?.request('share:exportPicture', 'svg') },
      transparentPng: { onSelect: () => void kernel?.request('share:exportPicture', 'png-transparent') },
      json: { onSelect: () => void kernel?.request('share:exportJson') },
      storm: { shortcut: saveKey, onSelect: () => void kernel?.request('share:exportStorm') },
    },
    showKeyboardShortcuts: () => {},
  }),
});

const connection = connectDiagramJs(shell, modeler, {
  modeler,
  isEmpty: () => !modeler.get<any>('elementRegistry').getAll().some((e: any) => e.parent && !e.waypoints),
});

kernel = new Kernel(modeler, shell);

kernel
  .use(new PreferencesPlugin())
  .use(new ProblemsPlugin())
  .use(documentPlugin)
  .use(sharePlugin)
  .use(shortcutsPlugin);

const linked = await readHashMap();
if (linked !== null) {
  await kernel.request('document:openDSL', linked);
} else {
  const brokenLink = hashHoldsBoard();
  await documentPlugin.newBoard(kernel, false);
  if (brokenLink) shell.toast({ status: 'danger', text: "Couldn't read the board in this link." });
}

let destroyed = false;
const eventStormingApp = {
  ready: true,
  shell,
  connection,
  destroy(): void {
    if (destroyed) return;
    destroyed = true;
    kernel.destroy();
    connection.destroy();
    modeler.destroy();
    shell.destroy();
  },
};
Object.assign(globalThis as Record<string, unknown>, { __eventStormingApp: eventStormingApp });

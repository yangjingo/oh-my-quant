// Loaded only by the isolated Electron fixture before the real main entry.
const { Tray } = require('electron');
const original = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  globalThis.__whyjTrayTest = { tray: this, menu };
  return original.call(this, menu);
};

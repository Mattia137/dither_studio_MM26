// Sidebar shell: collapsible prop-groups, tab strip, mode switch.
import { set, get } from '../state.js';

/** Wire click-to-fold behavior onto every .prop-group-header in the right panel. */
export function initCollapsibleGroups(root = document) {
  root.querySelectorAll('.prop-group-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });
}

/** Wire the left-panel tab strip (IMPORT / PROJECTS). */
export function initTabStrip(root = document) {
  const tabs = root.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      root.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.tabPanel === name);
      });
    });
  });
}

/** Wire the ZONES | LAYERS mode switch. Calls onModeChange(mode) after state updates. */
export function initModeSwitch(onModeChange) {
  const buttons = document.querySelectorAll('.mode-btn');
  const compositionHeader = document.getElementById('composition-header');
  const statusMode = document.getElementById('status-mode');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === get('mode')) return;
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      set('mode', mode);
      compositionHeader.textContent = mode.toUpperCase();
      statusMode.textContent = mode.toUpperCase();
      if (onModeChange) onModeChange(mode);
    });
  });
}

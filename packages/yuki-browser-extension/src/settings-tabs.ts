export type SettingsPanelId = 'settings' | 'prompt-settings' | 'backup-settings';

export function createSettingsTabs() {
  const tabList = document.getElementById('settings-tabs')!;
  const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

  function updateIndicator() {
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!;
    tabList.style.setProperty('--active-tab-width', `${selected.offsetWidth}px`);
    tabList.style.setProperty('--active-tab-left', `${selected.offsetLeft}px`);
  }

  function activate(panelId: SettingsPanelId, focus = false) {
    const selected = tabs.find(tab => tab.getAttribute('aria-controls') === panelId)!;
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !active;
    }
    updateIndicator();
    if (focus) selected.focus();
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activate(tab.getAttribute('aria-controls') as SettingsPanelId));
    tab.addEventListener('keydown', event => {
      let next: number;
      switch (event.key) {
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      activate(tabs[next].getAttribute('aria-controls') as SettingsPanelId, true);
    });
  }

  activate('settings');
  new ResizeObserver(updateIndicator).observe(tabList);
  return { activate };
}

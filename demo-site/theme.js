(() => {
  const key = 'remotectrl-demo-theme';
  const root = document.documentElement;
  const button = document.querySelector('[data-theme-toggle]');
  const apply = (theme) => {
    root.dataset.theme = theme;
    if (button) {
      button.textContent = theme === 'dark' ? '☼' : '☾';
      button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      button.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }
  };
  apply(localStorage.getItem(key) || 'dark');
  button?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(key, next);
    apply(next);
  });
})();

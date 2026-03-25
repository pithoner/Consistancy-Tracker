(function () {
  const storageKey = 'ct-theme';

  function getPreferredTheme() {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function updateThemeAssets(theme) {
    const favicon = document.getElementById('site-favicon');
    if (favicon) {
      favicon.href = theme === 'dark' ? '/static/favicon-dark.svg' : '/static/favicon.svg';
    }

    const themedImages = document.querySelectorAll('[data-theme-logo]');
    for (const image of themedImages) {
      image.src = theme === 'dark' ? image.dataset.darkSrc : image.dataset.lightSrc;
    }

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      const nextMode = theme === 'dark' ? 'light' : 'dark';
      toggle.setAttribute('aria-label', `Switch to ${nextMode} mode`);
      toggle.setAttribute('title', `Switch to ${nextMode} mode`);
      toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(storageKey, theme);
    updateThemeAssets(theme);
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getPreferredTheme());

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    }
  });
})();

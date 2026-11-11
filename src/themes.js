// src/themes.js: THE DESK THEMES. Three are free for every plan; the rest need a paid plan (the 'themes' feature). The look of each is in public/css/desk.css (html[data-theme="<id>"]) and its preview colours in public/js/desk.js; a test keeps the three lists in step.
export const THEMES = [
  { id: 'classic', name: 'Classic', premium: false },
  { id: 'midnight', name: 'Midnight', premium: false },
  { id: 'mint', name: 'Mint', premium: false },
  { id: 'aurora', name: 'Aurora', premium: true },
  { id: 'sunset', name: 'Sunset', premium: true },
  { id: 'forest', name: 'Forest', premium: true },
  { id: 'ocean', name: 'Ocean', premium: true },
  { id: 'orchid', name: 'Orchid', premium: true },
  { id: 'obsidian', name: 'Obsidian', premium: true },
  { id: 'champagne', name: 'Champagne', premium: true },
];
export const themeById = id => THEMES.find(t => t.id === id) || null;
// the theme a person gets to see: their saved choice if their plan allows it, otherwise the default
export const usableTheme = (id, hasThemes) => { const t = themeById(id); return t && (!t.premium || hasThemes) ? t.id : 'classic'; };
// the help center: Classic is free, every other look needs the Team plan
export const themeIsFree = id => id === 'classic';

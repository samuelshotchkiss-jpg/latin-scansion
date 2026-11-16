// Latin Scansion -- the menu of pages on a narrow screen. AGPL-3.0 (see COPYRIGHT.md).
//
// Each page's header carries pills linking the other pages; on a device they no longer fit (and the
// Scan page hid most of them), so a page could only be reached by typing its address (owner,
// 2026-11-16). On a narrow screen this adds a ☰ menu of every page and styles.css hides the link
// pills; the Scan page keeps its own buttons (Tutorial, Practice, Progress). THIS is the one list of
// the pages: add a new page here.
'use strict';

(() => {
  const PAGES = [
    ['index.html', 'Scan lines'],
    ['jumbles.html', 'Hexameter jumbles'],
    ['vowels.html', 'Vowels'],
    ['devices.html', 'Literary devices'],
    ['quiz.html', 'Practice quiz'],
    ['live.html', 'Play live'],
  ];
  const top = document.querySelector('.top');
  if (!top) return;
  const here = location.pathname.split('/').pop() || 'index.html';

  const wrap = document.createElement('div');
  wrap.className = 'navmenu';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode navmenu-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'navmenu-list');
  btn.setAttribute('aria-label', 'All pages');
  btn.textContent = '☰';
  const list = document.createElement('nav');
  list.id = 'navmenu-list';
  list.className = 'navmenu-list';
  list.setAttribute('aria-label', 'All pages');
  list.hidden = true;
  PAGES.forEach(([href, label]) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href === here) a.setAttribute('aria-current', 'page');
    list.append(a);
  });
  wrap.append(btn, list);
  top.append(wrap);

  const open = (yes) => { list.hidden = !yes; btn.setAttribute('aria-expanded', String(yes)); };
  btn.addEventListener('click', () => open(list.hidden));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
})();

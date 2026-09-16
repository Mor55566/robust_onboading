/* Paste this whole file into the browser Console while the new-work-order form is open.
 * IDs are local sequential numbers, not the application's database IDs.
 * Duplicate labels remain separate rows. Parent links use full label paths.
 * If parent paths repeat, use the closest preceding parent and report the inference.
 */
(async () => {
  'use strict';
  if (window.__categoryExportRunning) throw new Error('ייצוא קטגוריות כבר פועל.');
  window.__categoryExportRunning = true;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => el && el.getClientRects().length > 0;
  const menuSelector = '[data-test-id="work-order-category-select-menu"]';
  const getMenu = () => [...document.querySelectorAll(menuSelector)].find(visible);
  const collected = new Map();
  const clean = text => String(text ?? '').trim();
  let scroller, originalTop;
  try {
    const trigger = [...document.querySelectorAll('[data-test-id="work-order-category-select-trigger"]')].find(visible);
    if (!trigger) throw new Error('פתח/י את טופס קריאה חדשה לפני הרצת הסקריפט.');
    if (!getMenu()) trigger.click();
    const openDeadline = Date.now() + 10000;
    while (!getMenu() && Date.now() < openDeadline) await pause(100);
    const menu = getMenu();
    if (!menu) throw new Error('רשימת הקטגוריות לא נפתחה.');
    const search = menu.closest('[role="dialog"]')?.querySelector('input[role="combobox"]');
    if (search?.value.trim()) throw new Error('יש טקסט בחיפוש הקטגוריות. נקה/י אותו והריצ/י שוב כדי לייצא את כל הרשימה.');

    // Find the actual scroll container, without scrolling the page or modal.
    const candidates = [menu, ...menu.querySelectorAll('div')];
    for (let el = menu.parentElement; el && el !== document.body; el = el.parentElement) {
      candidates.push(el);
      if (el.matches('[role="dialog"]')) break;
    }
    scroller = candidates.find(el => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) || menu;
    originalTop = scroller.scrollTop;
    let expected = null;
    const collect = () => {
      if (getMenu() !== menu) throw new Error('הרשימה נסגרה או הוחלפה במהלך הייצוא. הריצ/י שוב.');
      for (const option of menu.querySelectorAll('[role="option"]')) {
        const count = Number(option.getAttribute('aria-setsize'));
        if (count > 0) {
          if (expected !== null && expected !== count) throw new Error('מספר הקטגוריות השתנה במהלך הייצוא. הריצ/י שוב.');
          expected = count;
        }
        const pos = option.hasAttribute('aria-posinset') ? Number(option.getAttribute('aria-posinset')) : Number(option.getAttribute('index')) + 1;
        if (!option.hasAttribute('aria-posinset') && !option.hasAttribute('index')) throw new Error('חסר מיקום פריט; לא ניתן לוודא איסוף מלא.');
        if (!Number.isInteger(pos) || pos < 1) throw new Error('מיקום פריט לא תקין.');
        const label = clean(option.querySelector('.label-text label, .label-text')?.textContent);
        if (!label) throw new Error(`חסר שם בפריט ${pos}.`);
        const prior = collected.get(pos);
        if (prior && prior.label !== label) throw new Error('סדר הקטגוריות השתנה בזמן הייצוא.');
        collected.set(pos, { pos, label, id: clean(option.getAttribute('data-category-id')) });
      }
    };
    const complete = () => expected !== null && collected.size === expected && Array.from({ length: expected }, (_, i) => i + 1).every(pos => collected.has(pos));
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await pause(500);
    let bottomWaits = 0;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      collect();
      if (complete()) break;
      const bottom = scroller.scrollHeight - scroller.clientHeight;
      if (scroller.scrollTop >= bottom - 2) {
        if (++bottomWaits >= 8) break;
      } else {
        bottomWaits = 0;
        scroller.scrollTop = Math.min(bottom, scroller.scrollTop + Math.max(1, Math.floor(scroller.clientHeight * 0.6)));
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      await pause(350);
    }
    collect();
    window.categoryExportPartial = [...collected.values()].sort((a, b) => a.pos - b.pos);
    if (!complete()) throw new Error(`האיסוף לא אומת כמלא: נאספו ${collected.size} מתוך ${expected ?? 'מספר לא ידוע'}. לא הורד CSV חלקי. הנתונים זמינים ב-window.categoryExportPartial.`);

    const items = window.categoryExportPartial;
    const byPath = new Map();
    for (const item of items) {
      item.id = item.pos;
      const path = item.label.split(/\s+<\s+/).join(' < ');
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(item);
    }
    const inferredParents = [];
    const rows = items.map(item => {
      // The supplied UI uses "Parent < Child"; support deeper paths too.
      const parts = item.label.split(/\s+<\s+/);
      const name = parts.pop();
      const parentPath = parts.join(' < ');
      const candidates = parentPath ? (byPath.get(parentPath) || []) : [];
      let parent = candidates.length === 1 ? candidates[0] : null;
      if (candidates.length > 1) {
        parent = candidates.filter(candidate => candidate.pos < item.pos).at(-1);
        if (!parent) throw new Error(`יש כמה קטגוריות אב אפשריות ואין אב קודם ברשימה עבור: ${item.label}`);
        inferredParents.push({ categoryId: item.id, path: item.label, parentId: parent.id });
      }
      if (parentPath && !parent) throw new Error(`לא נמצאה קטגוריית אב עבור: ${item.label}`);
      return { categoryId: item.id, name, 'parent category id': parent?.id || '', 'parent category name': parts.at(-1) || '' };
    });
    const headers = ['categoryId', 'name', 'parent category id', 'parent category name'];
    const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '﻿' + [headers.join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
    window.categoryExport = { rows, csv, expected, idType: 'local-sequential', inferredParents };
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'categories.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    console.table(rows);
    console.info(`יוצאו ${rows.length} קטגוריות ל-categories.csv.`);
    console.info('המזהים הם מספרים מקומיים לייצוא הזה, ולא מזהי המערכת.');
    if (inferredParents.length) console.warn('יש שמות מסלול כפולים של קטגוריות אב. השיוך הבא הוסק לפי האב הקרוב הקודם ברשימה ויש לבדוק אותו:', inferredParents);
    return window.categoryExport;
  } catch (error) {
    console.error('ייצוא הקטגוריות נכשל:', error.message);
    throw error;
  } finally {
    if (scroller?.isConnected && originalTop !== undefined) scroller.scrollTop = originalTop;
    window.__categoryExportRunning = false;
  }
})();

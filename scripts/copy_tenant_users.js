(async () => {
  const KEY = 'tenant-contacts-export-v1';
  const GRID = '[role="grid"][aria-label="tenants"]';
  const TAB =
    '[data-test-id="tenant-profile-tabs"] ' +
    'button[role="tab"][data-test-id="tenant-contacts-tab"]';
  const TABLE = 'table[data-test-id="tenant-contacts-table"]';
  const EMPTY = '[data-test-id="tenant-contacts-empty-state"]';
  const ROW = 'tbody tr[data-test-id="tenant-contact-row"]';
  const COUNT = '[data-test-id="tenant-contacts-count"]';

  const text = el =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  if (window.__tenantExportRunning) {
    console.warn('האיסוף כבר פועל.');
    return;
  }

  window.__tenantExportRunning = true;

  async function waitFor(getter, description) {
    const deadline = Date.now() + 20000;

    while (Date.now() < deadline) {
      const result = getter();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`המתנה הסתיימה: ${description}`);
  }

  function one(selector, root = document) {
    const elements = [...root.querySelectorAll(selector)];
    return elements.length === 1 ? elements[0] : null;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function getGrid() {
    const grid = one(GRID);

    if (!grid) {
      throw new Error('לא נמצאה טבלת דיירים יחידה.');
    }

    return grid;
  }

  // מספר הדיירים הצפוי לפי aria-rowcount (כולל שורת כותרת), או null אם לא ידוע.
  function expectedCount(grid) {
    const value = Number(grid.getAttribute('aria-rowcount'));
    return Number.isInteger(value) && value > 0 ? value - 1 : null;
  }

  function isScrollable(el) {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    const { overflowY } = getComputedStyle(el);
    return overflowY === 'auto' || overflowY === 'scroll' ||
      overflowY === 'overlay';
  }

  // הטבלה וירטואלית: רק השורות הנראות קיימות ב-DOM, לכן צריך לגלול.
  function findScroller(grid) {
    if (isScrollable(grid)) return grid;

    const inner = [...grid.querySelectorAll('*')].find(isScrollable);
    if (inner) return inner;

    for (let el = grid.parentElement; el; el = el.parentElement) {
      if (isScrollable(el)) return el;
    }

    return document.scrollingElement || document.documentElement;
  }

  // שורות הדיירים שמוצגות כרגע: [{ key, name, cell }]
  function visibleRows(grid) {
    return [...grid.querySelectorAll('[role="row"]')]
      .map(row => {
        const cell = row.querySelector(
          '[role="gridcell"][aria-colindex="2"]'
        );
        if (!cell) return null;
        const name = text(cell);
        const index = Number(row.getAttribute('aria-rowindex'));
        return {
          key: Number.isInteger(index) ? index : name,
          name,
          cell
        };
      })
      .filter(Boolean);
  }

  async function scrollTo(scroller, top) {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(350);
  }

  // גולל את הטבלה מההתחלה ועד הסוף ומפעיל את visit על כל מסך.
  // אם visit מחזיר ערך — עוצר ומחזיר אותו.
  async function sweep(grid, visit) {
    const scroller = findScroller(grid);
    await scrollTo(scroller, 0);

    let stalled = 0;

    while (true) {
      const found = visit(visibleRows(grid));
      if (found) return found;

      const before = scroller.scrollTop;
      const step = Math.max(100, Math.floor(scroller.clientHeight * 0.7));
      await scrollTo(scroller, before + step);

      if (scroller.scrollTop <= before + 1) {
        // הגענו לסוף; ייתכן שנטענים עוד נתונים — ממתינים פעמיים.
        if (++stalled >= 3) {
          return visit(visibleRows(grid)) || null;
        }
        await sleep(700);
      } else {
        stalled = 0;
      }
    }
  }

  async function readTenants() {
    const grid = getGrid();
    const byKey = new Map();

    await sweep(grid, rows => {
      for (const row of rows) byKey.set(row.key, row.name);
      return null;
    });

    const keys = [...byKey.keys()];
    if (keys.every(key => typeof key === 'number')) {
      keys.sort((a, b) => a - b);
    }
    const names = keys.map(key => byKey.get(key));

    const expected = expectedCount(getGrid());

    if (expected !== null && expected !== names.length) {
      throw new Error(
        `לאחר גלילה נמצאו ${names.length} מתוך ${expected} דיירים. ` +
        'ייתכן שהטבלה מחולקת לעמודים — יש להציג את כל הדיירים בעמוד אחד.'
      );
    }

    if (
      names.some(name => !name) ||
      new Set(names).size !== names.length
    ) {
      throw new Error('נמצאו שמות דיירים ריקים או כפולים.');
    }

    return names;
  }

  async function findTenantCell(tenant) {
    const grid = getGrid();
    const match = rows => {
      const hits = rows.filter(row => row.name === tenant);
      return hits.length === 1 ? hits[0].cell : null;
    };

    const visible = match(visibleRows(grid));
    if (visible) return visible;

    return await sweep(grid, match);
  }

  function progress(state) {
    console.log(
      `📊 סה״כ דיירים: ${state.tenants.length} | ` +
      `הושלמו: ${state.completed.length} | ` +
      `נותרו: ${state.tenants.length - state.completed.length} | ` +
      `אנשי קשר שנאספו: ${state.contacts.length}`
    );
  }

  async function openContacts() {
    await waitFor(() => one(TAB), 'איתור לשונית אנשי קשר');
    await new Promise(resolve => setTimeout(resolve, 400));

    const tab = one(TAB);

    if (!tab) {
      throw new Error('לשונית אנשי קשר אינה יחידה.');
    }

    if (tab.disabled || tab.getAttribute('aria-disabled') === 'true') {
      throw new Error('לשונית אנשי קשר מושבתת.');
    }

    if (tab.getAttribute('aria-selected') !== 'true') {
      tab.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 1,
        ctrlKey: false
      }));

      tab.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 0
      }));

      if (tab.isConnected) tab.click();
    }

    await waitFor(() => {
      const current = one(TAB);
      return current?.getAttribute('aria-selected') === 'true';
    }, 'אישור שלשונית אנשי קשר נפתחה');

    // דייר בלי אנשי קשר מציג רק "0 תוצאות" בלי טבלה. כדי לא לפספס
    // נתונים שעוד נטענים, מצב ריק נחשב סופי רק אחרי שנשאר יציב שנייה.
    let emptySince = null;

    return await waitFor(() => {
      const currentTab = one(TAB);

      if (currentTab?.getAttribute('aria-selected') !== 'true') {
        emptySince = null;
        return null;
      }

      const panelId = currentTab.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;

      if (
        !panel ||
        panel.getAttribute('data-state') !== 'active'
      ) {
        return null;
      }

      const table = one(TABLE, panel);
      const rows = table ? [...table.querySelectorAll(ROW)] : [];
      const countMatch = text(one(COUNT, panel)).match(/\d+/);
      const count = countMatch ? Number(countMatch[0]) : null;
      const empty = Boolean(one(EMPTY, panel)) || count === 0;

      if (empty && rows.length) {
        throw new Error('נמצאו גם אנשי קשר וגם מצב ריק. האיסוף נעצר.');
      }

      if (rows.length) {
        emptySince = null;
        return { empty: false, rows };
      }

      if (empty) {
        emptySince ??= Date.now();
        if (Date.now() - emptySince >= 1000) {
          return { empty: true, rows: [] };
        }
      } else {
        emptySince = null;
      }

      return null;
    }, 'טעינת אנשי קשר או מצב אין אנשי קשר');
  }

  async function returnToTenants() {
    const matches = [
      ...document.querySelectorAll('a[href="/tenants"]')
    ].filter(link =>
      link.getClientRects().length > 0 &&
      link.textContent.trim() === 'דיירים' &&
      link.querySelector('use[href="#Arrow_Right_16x16"]')
    );

    if (matches.length !== 1) {
      throw new Error(
        `נמצאו ${matches.length} קישורי חזרה תואמים. לא בוצעה לחיצה.`
      );
    }

    matches[0].click();

    await waitFor(() => {
      const grid = one(GRID);
      return grid?.querySelector(
        '[role="gridcell"][aria-colindex="2"]'
      );
    }, 'חזרה לרשימת הדיירים');

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  function downloadCSV(contacts) {
    const fields = ['tenant', 'name', 'role', 'email', 'phone'];
    const headers = ['דייר', 'שם', 'תפקיד', 'אימייל', 'טלפון'];

    const escape = value => {
      let valueText = String(value ?? '');

      // מונע פירוש של תוכן טקסט כנוסחה בגיליון.
      if (/^[=+\-@\t\r\n]/.test(valueText)) {
        valueText = "'" + valueText;
      }

      return `"${valueText.replace(/"/g, '""')}"`;
    };

    const csv = [
      headers.map(escape).join(','),
      ...contacts.map(contact =>
        fields.map(field => escape(contact[field])).join(',')
      )
    ].join('\r\n');

    const url = URL.createObjectURL(
      new Blob(['﻿', csv], {
        type: 'text/csv;charset=utf-8;'
      })
    );

    const link = document.createElement('a');
    link.href = url;
    link.download = 'tenant-users.csv';
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  try {
    console.log('🔎 גולל את רשימת הדיירים כדי לאסוף את כולם...');
    const tenantNames = await readTenants();

    // כל הרצה מתחילה מחדש, ללא שימוש בסריקה הקודמת.
    sessionStorage.removeItem(KEY);

    const state = {
      tenants: tenantNames,
      completed: [],
      contacts: []
    };

    const save = () =>
      sessionStorage.setItem(KEY, JSON.stringify(state));

    save();

    console.log('🔄 התחילה סריקה חדשה.');
    progress(state);

    for (const tenant of state.tenants) {
      const cell = await findTenantCell(tenant);

      if (!cell) {
        throw new Error(`לא נמצאה התאמה יחידה לדייר: ${tenant}`);
      }

      console.log(
        `⏳ פותח ${tenant} — ` +
        `${state.completed.length + 1} מתוך ${state.tenants.length}`
      );

      cell.scrollIntoView({ block: 'center' });
      await sleep(150);
      cell.click();

      const result = await openContacts();

      const contacts = result.rows.map(row => {
        const cells = [...row.children];

        if (
          cells.length !== 5 ||
          cells.some(cell => cell.tagName !== 'TD')
        ) {
          throw new Error('מבנה טבלת אנשי הקשר השתנה.');
        }

        return {
          tenant,
          name: text(cells[0]),
          role: text(
            cells[1].querySelector('select option:checked') ||
            cells[1].querySelector(
              '[data-test-id="contact-role-select-trigger"]'
            )
          ),
          email: text(cells[2].querySelector(
            '[data-slot="copyable-cell-value"]'
          )),
          phone: text(cells[3].querySelector(
            '[data-slot="copyable-cell-value"]'
          ))
        };
      });

      state.contacts.push(...contacts);
      state.completed.push(tenant);
      save();

      if (result.empty) {
        console.log(
          `✅ הושלם ${tenant}: אין אנשי קשר — ממשיכים.`
        );
      } else {
        console.log(
          `✅ הושלם ${tenant}: נאספו ${contacts.length} אנשי קשר`
        );
      }

      progress(state);
      await returnToTenants();

      const expected = expectedCount(getGrid());
      if (expected !== null && expected !== state.tenants.length) {
        throw new Error('רשימת הדיירים השתנתה במהלך האיסוף.');
      }
    }

    downloadCSV(state.contacts);

    console.log(
      `🎉 הסתיים! הושלמו ${state.completed.length} ` +
      `מתוך ${state.tenants.length} דיירים. ` +
      `נוצר CSV עם ${state.contacts.length} אנשי קשר.`
    );
  } catch (error) {
    console.error(
      '🛑 האיסוף נעצר:',
      error.message,
      '\nהמידע שנאסף נשמר ב-sessionStorage לעיון בלבד. ' +
      'הרצה נוספת מרשימת הדיירים תמחק אותו ותתחיל סריקה חדשה.'
    );
  } finally {
    window.__tenantExportRunning = false;
  }
})();

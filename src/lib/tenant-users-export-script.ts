// Mirrors scripts/copy_tenant_users.js — keep the two in sync.
export const TENANT_USERS_EXPORT_SCRIPT = `(async () => {
  const KEY = 'tenant-contacts-export-v1';
  const GRID = '[role="grid"][aria-label="tenants"]';
  const TAB =
    '[data-test-id="tenant-profile-tabs"] ' +
    'button[role="tab"][data-test-id="tenant-contacts-tab"]';
  const TABLE = 'table[data-test-id="tenant-contacts-table"]';
  const EMPTY = '[data-test-id="tenant-contacts-empty-state"]';
  const ROW = 'tbody tr[data-test-id="tenant-contact-row"]';

  const text = el =>
    (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();

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

    throw new Error(\`המתנה הסתיימה: \${description}\`);
  }

  function one(selector, root = document) {
    const elements = [...root.querySelectorAll(selector)];
    return elements.length === 1 ? elements[0] : null;
  }

  function readTenants() {
    const grid = one(GRID);

    if (!grid) {
      throw new Error('לא נמצאה טבלת דיירים יחידה.');
    }

    const rows = [...grid.querySelectorAll('[role="row"]')]
      .filter(row => row.querySelector('[role="gridcell"]'));

    const countAttribute = grid.getAttribute('aria-rowcount');
    const expected = Number(countAttribute) - 1;

    if (
      countAttribute === null ||
      !Number.isInteger(expected) ||
      expected !== rows.length
    ) {
      throw new Error(
        'לא כל הדיירים נמצאים כרגע בטבלה. נדרש טיפול בגלילה או בעימוד.'
      );
    }

    const names = rows.map(row =>
      text(row.querySelector(
        '[role="gridcell"][aria-colindex="2"]'
      ))
    );

    if (
      names.some(name => !name) ||
      new Set(names).size !== names.length
    ) {
      throw new Error('נמצאו שמות דיירים ריקים או כפולים.');
    }

    return names;
  }

  function progress(state) {
    console.log(
      \`📊 סה״כ דיירים: \${state.tenants.length} | \` +
      \`הושלמו: \${state.completed.length} | \` +
      \`נותרו: \${state.tenants.length - state.completed.length} | \` +
      \`אנשי קשר שנאספו: \${state.contacts.length}\`
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

    return await waitFor(() => {
      const currentTab = one(TAB);

      if (currentTab?.getAttribute('aria-selected') !== 'true') {
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

      const empty = one(EMPTY, panel);
      const table = one(TABLE, panel);
      const rows = table ? [...table.querySelectorAll(ROW)] : [];

      if (empty && rows.length) {
        throw new Error('נמצאו גם אנשי קשר וגם מצב ריק. האיסוף נעצר.');
      }

      if (empty) {
        return { empty: true, rows: [] };
      }

      if (rows.length) {
        return { empty: false, rows };
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
        \`נמצאו \${matches.length} קישורי חזרה תואמים. לא בוצעה לחיצה.\`
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
      if (/^[=+\\-@\\t\\r\\n]/.test(valueText)) {
        valueText = "'" + valueText;
      }

      return \`"\${valueText.replace(/"/g, '""')}"\`;
    };

    const csv = [
      headers.map(escape).join(','),
      ...contacts.map(contact =>
        fields.map(field => escape(contact[field])).join(',')
      )
    ].join('\\r\\n');

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
    const tenantNames = readTenants();

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
      const matches = [...document.querySelectorAll(
        \`\${GRID} [role="row"] \` +
        '[role="gridcell"][aria-colindex="2"]'
      )].filter(cell => text(cell) === tenant);

      if (matches.length !== 1) {
        throw new Error(\`לא נמצאה התאמה יחידה לדייר: \${tenant}\`);
      }

      console.log(
        \`⏳ פותח \${tenant} — \` +
        \`\${state.completed.length + 1} מתוך \${state.tenants.length}\`
      );

      matches[0].click();

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
          \`✅ הושלם \${tenant}: אין אנשי קשר — ממשיכים.\`
        );
      } else {
        console.log(
          \`✅ הושלם \${tenant}: נאספו \${contacts.length} אנשי קשר\`
        );
      }

      progress(state);
      await returnToTenants();

      if (
        JSON.stringify(readTenants()) !== JSON.stringify(state.tenants)
      ) {
        throw new Error('רשימת הדיירים השתנתה במהלך האיסוף.');
      }
    }

    downloadCSV(state.contacts);

    console.log(
      \`🎉 הסתיים! הושלמו \${state.completed.length} \` +
      \`מתוך \${state.tenants.length} דיירים. \` +
      \`נוצר CSV עם \${state.contacts.length} אנשי קשר.\`
    );
  } catch (error) {
    console.error(
      '🛑 האיסוף נעצר:',
      error.message,
      '\\nהמידע שנאסף נשמר ב-sessionStorage לעיון בלבד. ' +
      'הרצה נוספת מרשימת הדיירים תמחק אותו ותתחיל סריקה חדשה.'
    );
  } finally {
    window.__tenantExportRunning = false;
  }
})();`;

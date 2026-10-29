export const MISSION_EXPORT_SCRIPT = `/*
 * Read-only assignment checklist exporter — unified-locations version.
 * Run from DevTools Console while the assignments table is visible.
 *
 * Opens only assignment links in column 2. It never clicks the row checkbox.
 * Also records whether each assignment is paused (never clicks "הפעל").
 * Reads the location order from ⋯ → "ערוך" → "סדר" and leaves the edit
 * wizard with history.back() — it never presses "שמור" or "ביטול".
 */
(async () => {
  'use strict';

  const CONFIG = Object.freeze({
    ROW_SELECTOR: '[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"] > a.black-text[href^="/assignment/"]',
    MODAL_SELECTOR: '.Page.Page__is-modal',
    CLOSE_SELECTOR: '[data-test-id="modal-close"]',
    ITEM_SELECTOR: '.AssignmentItem',
    PAUSED_BANNER_SELECTOR: '.HintBanner',
    PAUSED_TEXT: 'משימה זו מושהית',
    PAUSED_ICON_SELECTOR: 'use[href="#Pause_Filled_20x20"]',
    OPEN_TIMEOUT_MS: 5000,
    CLOSE_CLICK_TIMEOUT_MS: 700,
    CLOSE_NAVIGATION_TIMEOUT_MS: 4000,
    BEFORE_OPEN_MIN_MS: 900,
    BEFORE_OPEN_MAX_MS: 1700,
    BEFORE_OPTION_CLICK_MIN_MS: 450,
    BEFORE_OPTION_CLICK_MAX_MS: 900,
    BEFORE_CLOSE_MIN_MS: 500,
    BEFORE_CLOSE_MAX_MS: 1000,
    BETWEEN_ROWS_MIN_MS: 1200,
    BETWEEN_ROWS_MAX_MS: 2400,
    DEFAULT_TEST_ROWS: 1,
    MAX_REQUESTED_ROWS: 100,
    GRID_SELECTOR: '[data-test-id="assignments-table"] [role="grid"]',
    ACTIONS_TOGGLE_SELECTOR: '[data-test-id="assignment-actions-dropdown"] .dropdown-button',
    EDIT_LINK_SELECTOR: 'a[data-test-id="edit-assignment-dropdown-button"]',
    EDIT_FORM_SELECTOR: 'form.assignment-form',
    ORDER_STEP_TITLE: 'סדר',
    ORDER_ROW_SELECTOR: '.site-sort-wrapper[data-id]',
    ORDER_TIMEOUT_MS: 6000,
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function randomDelay(minMs, maxMs) {
    const duration = Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
    return sleep(duration);
  }

  function waitFor(getValue, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const value = getValue();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(\`Timeout while waiting for \${description}\`));
        }
      }, 100);
    });
  }

  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !document.contains(element)) return false;

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    const intersectsViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth;

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      intersectsViewport &&
      element.getAttribute('aria-hidden') !== 'true'
    );
  }

  function visibleModal() {
    return [...document.querySelectorAll(CONFIG.MODAL_SELECTOR)].find(isVisible) || null;
  }

  function assignmentLinkByHref(href) {
    return (
      [...document.querySelectorAll(CONFIG.ROW_SELECTOR)].find(
        (link) => link.href === href && isVisible(link)
      ) || null
    );
  }

  async function scanGridForHrefs(requestedCount) {
    const grid = document.querySelector(CONFIG.GRID_SELECTOR);

    if (!(grid instanceof HTMLElement)) {
      throw new Error('לא נמצאה הטבלה הווירטואלית; לא בוצעו לחיצות.');
    }

    const originalScrollTop = grid.scrollTop;
    const hrefs = new Set();
    const step = Math.max(100, Math.floor(grid.clientHeight * 0.75));

    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(150);

    while (hrefs.size < requestedCount) {
      document
        .querySelectorAll(CONFIG.ROW_SELECTOR)
        .forEach((link) => hrefs.add(link.href));

      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2) break;

      const previousTop = grid.scrollTop;
      grid.scrollTop = Math.min(grid.scrollTop + step, grid.scrollHeight);
      grid.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(150);

      if (grid.scrollTop === previousTop) break;
    }

    grid.scrollTop = originalScrollTop;
    grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(150);

    return [...hrefs].slice(0, requestedCount);
  }

  async function findAssignmentLinkByScrolling(href) {
    const immediate = assignmentLinkByHref(href);
    if (immediate) return immediate;

    const grid = await waitFor(
      () => document.querySelector(CONFIG.GRID_SELECTOR),
      CONFIG.OPEN_TIMEOUT_MS,
      'the assignments grid'
    );

    const step = Math.max(100, Math.floor(grid.clientHeight * 0.75));

    grid.scrollTop = 0;
    grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(150);

    while (true) {
      const link = assignmentLinkByHref(href);
      if (link) return link;

      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2) break;

      const previousTop = grid.scrollTop;
      grid.scrollTop = Math.min(grid.scrollTop + step, grid.scrollHeight);
      grid.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(150);

      if (grid.scrollTop === previousTop) break;
    }

    return null;
  }

  function activateCloseButton(button) {
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.focus({ preventScroll: true });

    const pointerOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    };

    button.dispatchEvent(new PointerEvent('pointerdown', pointerOptions));
    button.dispatchEvent(new MouseEvent('mousedown', pointerOptions));
    button.dispatchEvent(
      new PointerEvent('pointerup', { ...pointerOptions, buttons: 0 })
    );
    button.dispatchEvent(
      new MouseEvent('mouseup', { ...pointerOptions, buttons: 0 })
    );

    button.click();
  }

  // Reads the location order from the edit wizard's "סדר" step: ⋯ → "ערוך" →
  // "סדר". It never presses a button inside the edit form ("שמור"/"ביטול");
  // it leaves with history.back(), so nothing can be saved. \`returned\` is
  // false only when the page could not get back out of the wizard.
  async function readSiteOrder(modal, assignmentHref) {
    const toggle = modal.querySelector(CONFIG.ACTIONS_TOGGLE_SELECTOR);
    if (!(toggle instanceof HTMLElement)) {
      console.warn('תפריט ⋯ של המשימה לא נמצא; המשימה תיוצא לפי סדר הכרטיסים.');
      return { siteOrder: [], returned: true };
    }

    const assignmentId = new URL(assignmentHref).pathname.split('/')[2];

    await randomDelay(
      CONFIG.BEFORE_OPTION_CLICK_MIN_MS,
      CONFIG.BEFORE_OPTION_CLICK_MAX_MS
    );
    activateCloseButton(toggle);

    let editLink;
    try {
      editLink = await waitFor(() => {
        const link = document.querySelector(CONFIG.EDIT_LINK_SELECTOR);
        return link instanceof HTMLAnchorElement &&
          link.getAttribute('href') === \`/assignment/\${assignmentId}/edit\` &&
          clean(link.textContent) === 'ערוך'
          ? link
          : null;
      }, 3000, 'the exact "ערוך" link');
    } catch (error) {
      activateCloseButton(toggle);
      console.warn('הקישור "ערוך" לא נמצא; המשימה תיוצא לפי סדר הכרטיסים.', error);
      return { siteOrder: [], returned: true };
    }

    await randomDelay(
      CONFIG.BEFORE_OPTION_CLICK_MIN_MS,
      CONFIG.BEFORE_OPTION_CLICK_MAX_MS
    );
    editLink.click();

    let siteOrder = [];
    try {
      const stepButton = await waitFor(() => {
        const step = [
          ...document.querySelectorAll(
            \`\${CONFIG.EDIT_FORM_SELECTOR} .stepper-wrapper .step-wrapper\`
          ),
        ].find(
          (element) =>
            clean(element.querySelector('.step-title')?.textContent) ===
            CONFIG.ORDER_STEP_TITLE
        );
        return step?.querySelector('button.step-number-button[type="button"]') || null;
      }, CONFIG.ORDER_TIMEOUT_MS, 'the "סדר" step');

      await randomDelay(
        CONFIG.BEFORE_OPTION_CLICK_MIN_MS,
        CONFIG.BEFORE_OPTION_CLICK_MAX_MS
      );
      stepButton.click();

      const rows = await waitFor(() => {
        const found = [
          ...document.querySelectorAll(
            \`\${CONFIG.EDIT_FORM_SELECTOR} \${CONFIG.ORDER_ROW_SELECTOR}\`
          ),
        ];
        return found.length ? found : null;
      }, CONFIG.ORDER_TIMEOUT_MS, 'the sorted locations');

      siteOrder = rows.map((row) => {
        const name = clean(row.querySelector('.site-name > div:first-child')?.textContent);
        const parents = [...row.querySelectorAll('.site-name .grey-text')]
          .map((element) => clean(element.textContent))
          .filter(Boolean);
        // The first parent is the building, which card locations leave out.
        return {
          id: row.getAttribute('data-id'),
          name,
          path: [...parents.slice(1), name].join(' < '),
        };
      });
    } catch (error) {
      console.warn('מסך הסדר לא נקרא; המשימה תיוצא לפי סדר הכרטיסים.', error);
    }

    if (location.pathname.endsWith('/edit')) {
      history.back();
      try {
        await waitFor(
          () =>
            !location.pathname.endsWith('/edit') &&
            !document.querySelector(CONFIG.EDIT_FORM_SELECTOR),
          CONFIG.CLOSE_NAVIGATION_TIMEOUT_MS,
          'leaving the edit wizard'
        );
      } catch (error) {
        console.warn('לא ניתן היה לצאת ממסך העריכה בבטחה.', error);
        return { siteOrder, returned: false };
      }
    } else if (document.querySelector(CONFIG.EDIT_FORM_SELECTOR)) {
      console.warn('מסך העריכה נפתח בלי כתובת /edit; עצרתי כדי לא לגעת בו.');
      return { siteOrder, returned: false };
    }

    return { siteOrder, returned: true };
  }

  function directChildrenByClass(root, className) {
    return [...root.children].filter((element) =>
      element.classList.contains(className)
    );
  }

  function parseNumericValue(value) {
    const normalized = clean(value).replace(/,/g, '.');

    if (!/^-?\\d+(?:\\.\\d+)?$/.test(normalized)) return null;

    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function extractNumberDefinition(wrapper) {
    if (!(wrapper instanceof HTMLElement)) {
      return {
        unit: '',
        number_constraint_type: JSON.stringify({ type: 'free' }),
        number_min: null,
        number_max: null,
      };
    }

    const fields = directChildrenByClass(wrapper, 'readonly-field');
    const unit = clean(fields[0]?.textContent);
    const constraintField = fields[1] || null;

    const spanValues = constraintField
      ? [...constraintField.querySelectorAll('span')]
          .map((span) => parseNumericValue(span.textContent))
          .filter((value) => value !== null)
      : [];

    if (spanValues.length >= 2) {
      const minimum = spanValues[0];
      const maximum = spanValues[1];

      return {
        unit,
        number_constraint_type: JSON.stringify({
          type: 'between',
          min: minimum,
          max: maximum,
        }),
        number_min: minimum,
        number_max: maximum,
      };
    }

    return {
      unit,
      number_constraint_type: JSON.stringify({ type: 'free' }),
      number_min: null,
      number_max: null,
    };
  }

  function labelledValue(modal, label) {
    const labels = [...modal.querySelectorAll('span')];

    const labelElement = labels.find(
      (element) => clean(element.textContent) === label
    );

    if (!labelElement) return '';

    let sibling = labelElement.nextElementSibling;

    while (sibling) {
      const value = clean(sibling.textContent);
      if (value) return value;
      sibling = sibling.nextElementSibling;
    }

    return '';
  }

  // A paused assignment shows a HintBanner with the pause icon and the text
  // "משימה זו מושהית" (next to a "הפעל" button, which is never touched here).
  function extractPausedState(modal) {
    return [...modal.querySelectorAll(CONFIG.PAUSED_BANNER_SELECTOR)].some(
      (banner) =>
        clean(banner.querySelector('.hint-text')?.textContent) ===
          CONFIG.PAUSED_TEXT ||
        Boolean(banner.querySelector(CONFIG.PAUSED_ICON_SELECTOR))
    );
  }

  // Visitt section headings ("מיקומים", "בדיקות") used to carry .title-small;
  // newer markup uses Tailwind classes (text-sm font-semibold), so match by text.
  const SECTION_HEADING_TEXTS = ['מיקומים', 'בדיקות'];

  function isSectionHeading(element) {
    return (
      element.matches('.title-small, .font-semibold') &&
      SECTION_HEADING_TEXTS.includes(clean(element.textContent))
    );
  }

  function sectionHeadings(root) {
    return [...root.querySelectorAll('.title-small, .font-semibold')].filter(
      isSectionHeading
    );
  }

  function extractLocations(root) {
    const heading = sectionHeadings(root).find(
      (element) => clean(element.textContent) === 'מיקומים'
    );

    if (!heading) return [];

    const locations = [];
    let sibling = heading.nextElementSibling;

    while (sibling && !isSectionHeading(sibling)) {
      const locationElements = sibling.children.length
        ? [...sibling.children]
        : [sibling];

      locationElements.forEach((element) => {
        // The visual building badge is nested inside the location row, but it
        // is not part of the location path. Read from a detached clone so the
        // live page remains untouched.
        const clone = element.cloneNode(true);
        clone.querySelectorAll?.('.item-badge').forEach((badge) => badge.remove());
        const value = clean(clone.textContent);
        if (value) locations.push(value);
      });

      sibling = sibling.nextElementSibling;
    }

    return [...new Set(locations)];
  }

  async function expandMultiSelectOptions(modal) {
    const items = [...modal.querySelectorAll(CONFIG.ITEM_SELECTOR)];

    for (const item of items) {
      const nameContainer = item.querySelector('.item-name');

      const directFields = nameContainer
        ? directChildrenByClass(nameContainer, 'readonly-field')
        : [];

      const rawType = clean(directFields.at(-1)?.textContent);

      if (rawType !== 'בחירה מרובה') continue;

      if (item.querySelectorAll('.multiselect-readonly-option').length) continue;

      const button = item.querySelector(
        'button.collapse-button[id^="collapse-button-"]'
      );

      if (
        !(button instanceof HTMLButtonElement) ||
        !/^אפשרויות\\s*\\(\\d+\\)$/.test(clean(button.childNodes[0]?.textContent))
      ) {
        throw new Error(
          'Safety stop: a multi-select item was found without the exact options button.'
        );
      }

      if (
        button.closest(
          '[data-test-id="assignment-actions-dropdown"], [data-test-id="assignments-actions-menu"]'
        )
      ) {
        throw new Error(
          'Safety stop: the options button resolved inside an actions menu.'
        );
      }

      await randomDelay(
        CONFIG.BEFORE_OPTION_CLICK_MIN_MS,
        CONFIG.BEFORE_OPTION_CLICK_MAX_MS
      );

      button.click();

      await waitFor(
        () => item.querySelectorAll('.multiselect-readonly-option').length > 0,
        2000,
        'read-only multi-select options'
      );
    }
  }

  function extractChecklistItems(root) {
    return [...root.querySelectorAll(CONFIG.ITEM_SELECTOR)].map(
      (item, checklistIndex) => {
        const nameContainer = item.querySelector('.item-name');
        const wrapper = item.querySelector('.item-type-data-wrapper');

        const directFields = nameContainer
          ? directChildrenByClass(nameContainer, 'readonly-field')
          : [];

        const rawType = clean(directFields.at(-1)?.textContent);

        const type =
          rawType === 'צ׳ק'
            ? 'checkbox'
            : rawType === 'מספר'
              ? 'number'
              : rawType === 'בחירה מרובה'
                ? 'multi_select'
                : rawType === 'טקסט'
                  ? 'text'
                  : 'unknown';

        const options =
          type === 'multi_select'
            ? [...item.querySelectorAll('.multiselect-readonly-option')]
                .map((element) => clean(element.textContent))
                .filter(Boolean)
            : [];

        const numberDefinition =
          type === 'number'
            ? extractNumberDefinition(wrapper)
            : {
                unit: '',
                number_constraint_type: '',
                number_min: null,
                number_max: null,
              };

        return {
          checklist_order: checklistIndex + 1,
          checklist_name: clean(
            item.querySelector('.item-name-readonly')?.textContent
          ),
          field_type: type,
          field_type_original: rawType,
          unit: numberDefinition.unit,
          number_constraint_type: numberDefinition.number_constraint_type,
          number_min: numberDefinition.number_min,
          number_max: numberDefinition.number_max,
          options_count: options.length,
          options: JSON.stringify(options),
        };
      }
    );
  }

  function extractAssignment(modal, sourceIndex) {
    const fullTitle = clean(modal.querySelector('h2')?.textContent);
    const assignmentName = fullTitle.replace(/^משימה\\s*\\/\\s*/, '');

    const common = {
      source_index: sourceIndex + 1,
      assignment_name: assignmentName,
      building: labelledValue(modal, 'בניין:'),
      category: labelledValue(modal, 'קטגוריה:'),
      frequency: labelledValue(modal, 'תדירות:'),
      skip_on_holidays: labelledValue(modal, 'התנהגות בחגים:') === 'מדולגת בחגים',
      is_paused: extractPausedState(modal),
      assigned_users: labelledValue(modal, 'משתמש משויך:'),
    };

    // Every Visitt card containing its own "מיקומים" and "בדיקות" headings is
    // a separate checklist. Read locations and items inside that card only.
    const sections = [...modal.querySelectorAll('.body-bg')].filter((section) => {
      const headings = sectionHeadings(section).map(
        (heading) => clean(heading.textContent)
      );
      return (
        headings.includes('מיקומים') &&
        headings.includes('בדיקות') &&
        section.querySelector('.Collection')
      );
    });

    const effectiveSections = sections.length ? sections : [modal];

    return {
      common,
      sections: effectiveSections.map((section) => ({
        locations: extractLocations(section),
        items: extractChecklistItems(section),
      })),
    };
  }

  // The card lists a location as "parent < … < name" while the "סדר" step
  // shows the name and its parents separately; both drop the building badge.
  function locationLeaf(location) {
    return clean(location.split(' < ').at(-1));
  }

  function findSiteOrder(location, siteOrder) {
    const byPath = siteOrder.findIndex((site) => site.path === clean(location));
    if (byPath >= 0) return byPath + 1;

    const leaf = locationLeaf(location);
    const byName = siteOrder.filter((site) => site.name === leaf);
    return byName.length === 1 ? siteOrder.indexOf(byName[0]) + 1 : null;
  }

  // Visitt's execution form shows one card per location, ordered by the edit
  // wizard's "סדר" step rather than by checklist card. With that order known,
  // emit every location as its own checklist in that order; without it, keep
  // one checklist per card as before.
  function buildAssignmentExport({ common, sections }, siteOrder) {
    const slots = sections.flatMap((section, sectionIndex) => {
      if (!section.locations.length || !siteOrder.length) {
        return [{
          section,
          title: section.locations.length
            ? section.locations.join(' | ')
            : \`בדיקות \${sectionIndex + 1}\`,
          locations: section.locations,
          order: null,
        }];
      }

      return section.locations.map((location) => ({
        section,
        title: location,
        locations: [location],
        order: findSiteOrder(location, siteOrder),
      }));
    });

    const unmatched = slots.filter((slot) => slot.order === null && slot.locations.length);
    if (siteOrder.length && unmatched.length) {
      console.warn(
        'חלק מהמיקומים לא נמצאו במסך הסדר ויופיעו בסוף:',
        unmatched.map((slot) => slot.title)
      );
    }

    // Stable sort: unmatched slots keep their card order after the ordered ones.
    const ordered = slots
      .map((slot, index) => ({ slot, index }))
      .sort((left, right) =>
        (left.slot.order ?? Infinity) - (right.slot.order ?? Infinity) ||
        left.index - right.index
      )
      .map(({ slot }) => slot);

    const checklist = ordered.flatMap((slot) =>
      slot.section.items.map((item) => ({
        ...common,
        location: slot.locations.join(';'),
        location_order: slot.order ?? '',
        checklist_title: slot.title,
        ...item,
      }))
    );

    return {
      common: {
        ...common,
        locations: [...new Set(ordered.flatMap((slot) => slot.locations))],
        checklist_count: ordered.length,
        site_order_found: siteOrder.length > 0,
      },
      checklist,
    };
  }

  function validateRow(row) {
    if (!(row instanceof HTMLElement)) {
      throw new Error('A selected row is not an HTML element.');
    }

    if (row.closest(CONFIG.MODAL_SELECTOR)) {
      throw new Error(
        'Safety stop: row selector matched content inside the modal.'
      );
    }

    if (!row.matches('a[href^="/assignment/"]')) {
      throw new Error(
        'Safety stop: selected target is not an assignment link.'
      );
    }

    if (
      row.matches('button, input, [type="checkbox"], [role="checkbox"]') ||
      row.closest('[data-test-id="assignments-actions-menu"]')
    ) {
      throw new Error(
        'Safety stop: row selector matched a forbidden control.'
      );
    }

    if (row.querySelector('input[type="checkbox"]') === row) {
      throw new Error('Safety stop: checkbox matched.');
    }
  }

  function csvCell(value) {
    const stringValue = String(value ?? '');
    return \`"\${stringValue.replace(/"/g, '""')}"\`;
  }

  function offerCsvDownload(rows) {
    const columns = [
      'source_index',
      'assignment_name',
      'building',
      'category',
      'frequency',
      'skip_on_holidays',
      'is_paused',
      'assigned_users',
      'location',
      'location_order',
      'checklist_title',
      'checklist_order',
      'checklist_name',
      'field_type',
      'field_type_original',
      'unit',
      'number_constraint_type',
      'number_min',
      'number_max',
      'options_count',
      'options',
    ];

    const booleanColumns = new Set(['skip_on_holidays', 'is_paused']);

    const csv = [
      columns.map(csvCell).join(','),
      ...rows.map((row) =>
        columns.map((column) => csvCell(
          booleanColumns.has(column)
            ? (row[column] ? 'yes' : 'no')
            : row[column]
        )).join(',')
      ),
    ].join('\\r\\n');

    const blob = new Blob(['﻿', csv], {
      type: 'text/csv;charset=utf-8',
    });

    const url = URL.createObjectURL(blob);

    const previousButton = document.getElementById(
      'codex-checklist-csv-download'
    );

    if (previousButton) previousButton.remove();

    const link = document.createElement('a');

    link.id = 'codex-checklist-csv-download';
    link.href = url;
    link.download = \`assignment-checklists-\${new Date()
      .toISOString()
      .slice(0, 10)}.csv\`;

    link.textContent = \`הורד CSV — \${rows.length} פריטי צ׳קליסט\`;

    Object.assign(link.style, {
      position: 'fixed',
      left: '24px',
      bottom: '24px',
      zIndex: '2147483647',
      padding: '14px 20px',
      borderRadius: '8px',
      background: '#087f5b',
      color: '#fff',
      font: '600 16px Arial, sans-serif',
      textDecoration: 'none',
      boxShadow: '0 4px 18px rgba(0,0,0,.25)',
      cursor: 'pointer',
      direction: 'rtl',
    });

    link.addEventListener(
      'click',
      () => {
        link.textContent = 'ה־CSV הורד';

        setTimeout(() => {
          link.remove();
          URL.revokeObjectURL(url);
        }, 1500);
      },
      { once: true }
    );

    document.body.appendChild(link);

    console.info(
      'החילוץ הסתיים. לחץ על הכפתור הירוק בתחתית העמוד כדי להוריד את ה-CSV.'
    );
  }

  const allRows = [...document.querySelectorAll(CONFIG.ROW_SELECTOR)].filter(
    (row) => !row.closest(CONFIG.MODAL_SELECTOR)
  );

  if (!allRows.length) {
    throw new Error(
      'לא נמצאו קישורי משימות בעמודה 2. מבנה הטבלה כנראה השתנה; לא בוצעו לחיצות.'
    );
  }

  const requested = Number.parseInt(
    prompt(
      \`כמה משימות לחלץ? אפשר לבחור בין 1 ל-\${CONFIG.MAX_REQUESTED_ROWS} (ברירת מחדל \${CONFIG.DEFAULT_TEST_ROWS})\`,
      String(CONFIG.DEFAULT_TEST_ROWS)
    ) || String(CONFIG.DEFAULT_TEST_ROWS),
    10
  );

  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), CONFIG.MAX_REQUESTED_ROWS)
    : CONFIG.DEFAULT_TEST_ROWS;

  const assignmentHrefs = await scanGridForHrefs(limit);

  if (assignmentHrefs.length < limit) {
    console.info(
      \`נבחרו \${limit} משימות, אך בטבלה קיימות כרגע רק \${assignmentHrefs.length}. כולן יחולצו.\`
    );
  }

  const exportedRows = [];
  const exportedAssignments = [];

  for (let index = 0; index < assignmentHrefs.length; index += 1) {
    const assignmentHref = assignmentHrefs[index];

    const row = await findAssignmentLinkByScrolling(assignmentHref);

    if (!row) {
      console.warn(
        'קישור המשימה לא נמצא מחדש; החילוץ נעצר לפני לחיצה נוספת.',
        assignmentHref
      );
      break;
    }

    validateRow(row);

    const tableUrl = location.href;

    await randomDelay(
      CONFIG.BEFORE_OPEN_MIN_MS,
      CONFIG.BEFORE_OPEN_MAX_MS
    );

    row.click();

    const modal = await waitFor(
      () => visibleModal(),
      CONFIG.OPEN_TIMEOUT_MS,
      'the read-only assignment modal'
    );

    const findCloseButton = (currentModal) => {
      const button = currentModal.querySelector(CONFIG.CLOSE_SELECTOR);

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(
          'Safety stop: the exact modal close button was not found.'
        );
      }

      if (button.closest('[data-test-id="assignment-actions-dropdown"]')) {
        throw new Error(
          'Safety stop: close selector resolved inside an actions menu.'
        );
      }

      return button;
    };

    findCloseButton(modal);

    await expandMultiSelectOptions(modal);

    const cards = extractAssignment(modal, index);
    const { siteOrder, returned } = await readSiteOrder(modal, assignmentHref);
    const extracted = buildAssignmentExport(cards, siteOrder);

    exportedAssignments.push(extracted);
    exportedRows.push(...extracted.checklist);

    if (!returned) {
      console.warn(
        'החילוץ נעצר כדי לא לגעת במסך העריכה. הנתונים שכבר נקראו יורדו ולא תיפתח שורה נוספת.'
      );
      break;
    }

    // Coming back from the edit wizard re-renders the assignment window.
    const currentModal =
      location.href === tableUrl
        ? null
        : await waitFor(
            () => visibleModal(),
            CONFIG.OPEN_TIMEOUT_MS,
            'the assignment modal after leaving the edit wizard'
          );

    let closeConfirmed = true;

    try {
      if (!currentModal) throw new Error('already back at the table');

      const closeButton = findCloseButton(currentModal);

      await randomDelay(
        CONFIG.BEFORE_CLOSE_MIN_MS,
        CONFIG.BEFORE_CLOSE_MAX_MS
      );

      activateCloseButton(closeButton);

      await waitFor(
        () => location.href === tableUrl || !isVisible(currentModal),
        CONFIG.CLOSE_CLICK_TIMEOUT_MS,
        'the assignment modal to close after activating X'
      );
    } catch (error) {
      if (location.href === tableUrl) {
        // Already back at the table (the wizard's history.back() closed it).
      } else if (location.href === assignmentHref) {
        history.back();

        try {
          await waitFor(
            () => location.href === tableUrl,
            CONFIG.CLOSE_NAVIGATION_TIMEOUT_MS,
            'return to the exact table URL'
          );
        } catch (navigationError) {
          closeConfirmed = false;

          console.warn(
            'לא ניתן היה לחזור בבטחה לטבלה. הנתונים שכבר נקראו יורדו ולא תיפתח שורה נוספת.',
            navigationError
          );
        }
      } else {
        closeConfirmed = false;

        console.warn(
          'כתובת העמוד השתנתה באופן לא צפוי. הנתונים שכבר נקראו יורדו ולא תיפתח שורה נוספת.',
          error
        );
      }
    }

    if (closeConfirmed) {
      console.info(
        \`נוספו \${exportedAssignments.length} מתוך \${assignmentHrefs.length} טיקטים.\` +
          (extracted.common.is_paused ? ' (מושהית)' : '')
      );
    }

    await randomDelay(
      CONFIG.BETWEEN_ROWS_MIN_MS,
      CONFIG.BETWEEN_ROWS_MAX_MS
    );

    if (!closeConfirmed) break;
  }

  console.table(exportedRows);
  console.log('Structured extraction for DB use:', exportedAssignments);

  if (exportedRows.length) {
    offerCsvDownload(exportedRows);
  } else {
    throw new Error(
      'לא חולצו פריטי צ׳קליסט ולכן לא נוצר קובץ ריק.'
    );
  }

  return exportedAssignments;
})();
`;

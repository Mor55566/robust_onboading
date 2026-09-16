export const MISSION_EXPORT_SCRIPT = `/*
 * Read-only assignment checklist exporter — unified-locations version.
 * Run from DevTools Console while the assignments table is visible.
 *
 * Opens only assignment links in column 2. It never clicks the row checkbox.
 */
(async () => {
  'use strict';

  const CONFIG = Object.freeze({
    ROW_SELECTOR: '[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"] > a.black-text[href^="/assignment/"]',
    MODAL_SELECTOR: '.Page.Page__is-modal',
    CLOSE_SELECTOR: '[data-test-id="modal-close"]',
    ITEM_SELECTOR: '.AssignmentItem',
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

  function extractLocations(root) {
    const headings = [...root.querySelectorAll('.title-small')];

    const heading = headings.find(
      (element) => clean(element.textContent) === 'מיקומים'
    );

    if (!heading) return [];

    const locations = [];
    let sibling = heading.nextElementSibling;

    while (sibling && !sibling.matches('.title-small')) {
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
      assigned_users: labelledValue(modal, 'משתמש משויך:'),
    };

    // Every Visitt card containing its own "מיקומים" and "בדיקות" headings is
    // a separate checklist. Read locations and items inside that card only.
    const sections = [...modal.querySelectorAll('.body-bg')].filter((section) => {
      const headings = [...section.querySelectorAll('.title-small')].map(
        (heading) => clean(heading.textContent)
      );
      return (
        headings.includes('מיקומים') &&
        headings.includes('בדיקות') &&
        section.querySelector('.Collection')
      );
    });

    const effectiveSections = sections.length ? sections : [modal];
    const checklist = effectiveSections.flatMap((section, sectionIndex) => {
      const locations = extractLocations(section);
      const items = extractChecklistItems(section);
      const checklistTitle = locations.length
        ? locations.join(' | ')
        : \`בדיקות \${sectionIndex + 1}\`;

      return items.map((item) => ({
        ...common,
        location: locations.join(';'),
        checklist_title: checklistTitle,
        ...item,
      }));
    });

    return {
      common: {
        ...common,
        locations: [
          ...new Set(effectiveSections.flatMap((section) => extractLocations(section))),
        ],
        checklist_count: effectiveSections.length,
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
      'assigned_users',
      'location',
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

    const csv = [
      columns.map(csvCell).join(','),
      ...rows.map((row) =>
        columns.map((column) => csvCell(
          column === 'skip_on_holidays'
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

    const closeButton = modal.querySelector(CONFIG.CLOSE_SELECTOR);

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error(
        'Safety stop: the exact modal close button was not found.'
      );
    }

    if (
      closeButton.closest('[data-test-id="assignment-actions-dropdown"]')
    ) {
      throw new Error(
        'Safety stop: close selector resolved inside an actions menu.'
      );
    }

    await expandMultiSelectOptions(modal);

    const extracted = extractAssignment(modal, index);

    exportedAssignments.push(extracted);
    exportedRows.push(...extracted.checklist);

    await randomDelay(
      CONFIG.BEFORE_CLOSE_MIN_MS,
      CONFIG.BEFORE_CLOSE_MAX_MS
    );

    activateCloseButton(closeButton);

    let closeConfirmed = true;

    try {
      await waitFor(
        () => location.href === tableUrl || !isVisible(modal),
        CONFIG.CLOSE_CLICK_TIMEOUT_MS,
        'the assignment modal to close after activating X'
      );
    } catch (error) {
      if (location.href === assignmentHref) {
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
        \`נוספו \${exportedAssignments.length} מתוך \${assignmentHrefs.length} טיקטים.\`
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

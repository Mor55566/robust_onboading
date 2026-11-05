/*
 * Probe: conditional checklist items (read-only).
 * Run from DevTools Console while ONE assignment window is open.
 *
 * For every .AssignmentItem with a .trigger-indicator it hovers the icon,
 * reads the tooltip text from #tooltip-root, and logs it next to the item.
 * It also expands "אפשרויות (N)" buttons (same as the export script) so we can
 * see which earlier multi-select question has the option the condition names.
 * It never clicks anything else.
 */
(async () => {
  'use strict';

  const CONFIG = Object.freeze({
    MODAL_SELECTOR: '.Page.Page__is-modal',
    ITEM_SELECTOR: '.AssignmentItem',
    TRIGGER_SELECTOR: '.trigger-indicator',
    TOOLTIP_SELECTOR: '#tooltip-root .Tooltip.Tooltip__visible .Tooltip-after, #tooltip-root .Tooltip .Tooltip-after',
    EXPAND_OPTIONS: true,
    TOOLTIP_TIMEOUT_MS: 2000,
    TOOLTIP_GONE_TIMEOUT_MS: 1000,
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  async function waitFor(getValue, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getValue();
      if (value) return value;
      await sleep(50);
    }
    return null;
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function tooltipText() {
    const nodes = [...document.querySelectorAll(CONFIG.TOOLTIP_SELECTOR)].filter(isVisible);
    return clean(nodes.at(-1)?.textContent);
  }

  function hoverEvents(target, entering) {
    const rect = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    const names = entering
      ? ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']
      : ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'];
    for (const name of names) {
      const Ctor = name.startsWith('pointer') ? PointerEvent : MouseEvent;
      const bubbles = !name.endsWith('enter') && !name.endsWith('leave');
      target.dispatchEvent(new Ctor(name, { ...options, bubbles }));
    }
  }

  async function readTooltip(item) {
    const indicator = item.querySelector(CONFIG.TRIGGER_SELECTOR);
    const wrapper = indicator?.closest('.Tooltip-wrapper');
    const targets = [indicator, wrapper, indicator?.querySelector('.Icon')].filter(Boolean);

    for (const target of targets) {
      target.scrollIntoView({ block: 'center' });
      await sleep(100);
      hoverEvents(target, true);
      const text = await waitFor(tooltipText, CONFIG.TOOLTIP_TIMEOUT_MS);
      hoverEvents(target, false);
      await waitFor(() => !tooltipText(), CONFIG.TOOLTIP_GONE_TIMEOUT_MS);
      if (text) {
        return { text, hoveredOn: target.className || target.tagName };
      }
    }
    return { text: '', hoveredOn: 'none worked' };
  }

  async function expandOptions(modal) {
    for (const item of modal.querySelectorAll(CONFIG.ITEM_SELECTOR)) {
      if (item.querySelector('.multiselect-readonly-option')) continue;
      const button = item.querySelector('button.collapse-button[id^="collapse-button-"]');
      if (!(button instanceof HTMLButtonElement)) continue;
      if (!/^אפשרויות\s*\(\d+\)$/.test(clean(button.childNodes[0]?.textContent))) continue;
      button.click();
      await waitFor(() => item.querySelector('.multiselect-readonly-option'), 2000);
      await sleep(250);
    }
  }

  const modal = [...document.querySelectorAll(CONFIG.MODAL_SELECTOR)].find(isVisible) || document;
  if (CONFIG.EXPAND_OPTIONS) await expandOptions(modal);

  const results = [];
  const sections = [...modal.querySelectorAll('.Collection')];

  for (const [sectionIndex, collection] of sections.entries()) {
    const items = [...collection.querySelectorAll(CONFIG.ITEM_SELECTOR)];

    for (const [index, item] of items.entries()) {
      const info = item.querySelector('.item-info');
      const nameContainer = item.querySelector('.item-name');
      const directFields = nameContainer
        ? [...nameContainer.children].filter((el) => el.classList.contains('readonly-field'))
        : [];
      const indicator = item.querySelector(CONFIG.TRIGGER_SELECTOR);
      const options = [...item.querySelectorAll('.multiselect-readonly-option')].map((el) => clean(el.textContent));

      const row = {
        section: sectionIndex + 1,
        order: index + 1,
        name: clean(item.querySelector('.item-name-readonly')?.textContent),
        type: clean(directFields.at(-1)?.textContent),
        options: options.join(' | '),
        is_conditional: Boolean(info?.classList.contains('conditional')),
        trigger_number: indicator ? clean(indicator.textContent) : '',
        tooltip: '',
        hovered_on: '',
        parsed_option: '',
      };

      if (indicator) {
        const { text, hoveredOn } = await readTooltip(item);
        row.tooltip = text;
        row.hovered_on = hoveredOn;
        const match = text.match(/אפשרו(?:ת|יות)\s+(.+?)\s+נבחר/);
        row.parsed_option = match ? match[1] : '';
      }

      results.push(row);
    }
  }

  console.table(results);
  const json = JSON.stringify(results, null, 2);
  console.log('PROBE_RESULT_JSON\n' + json);
  try {
    await navigator.clipboard.writeText(json);
    console.info('התוצאה הועתקה ללוח.');
  } catch {
    console.info('לא ניתן היה להעתיק ללוח; העתק את ה-JSON מהלוג.');
  }

  // Extra debug for the first conditional item: its outer HTML and the tooltip root.
  const firstConditional = modal.querySelector(`${CONFIG.ITEM_SELECTOR} ${CONFIG.TRIGGER_SELECTOR}`);
  if (firstConditional) {
    console.log('tooltip-root exists:', Boolean(document.getElementById('tooltip-root')));
  }

  return results;
})();

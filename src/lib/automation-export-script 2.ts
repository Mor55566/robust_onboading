export const AUTOMATION_EXPORT_SCRIPT = `/**
 * Read-only automation exporter for the source Automations page.
 *
 * Usage: paste this entire file into the source site's browser DevTools
 * console and press Enter. The export starts immediately.
 *
 * The exporter only clicks an automation row, a multi-select trigger that has
 * hidden +N values, and the modal's exact close button. It never clicks an
 * option, clear, delete, confirm, save, or submit control.
 */
(() => {
  "use strict";

  const CONFIG = Object.freeze({
    itemSelector: ".Automations .AutomationItem",
    itemClickSelector: ".flex.items-center.flex-1.pointer",
    modalSelector: ".ReactModalPortal [role='dialog'][aria-modal='true']",
    closeSelector: "button.ModalClose[data-test-id='modal-close'][type='button']",
    formRowSelector: ".FormRow",
    delayBetweenItemsMs: 2000,
    modalTimeoutMs: 5000,
    modalSettleMs: 500,
    listSettleMs: 300,
  });

  const sleep = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const clean = (value) =>
    String(value ?? "")
      .replace(/\\s+/g, " ")
      .replace(/\\s+,/g, ",")
      .trim();

  const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];

  function isPlaceholder(value) {
    return /^(בחר|בחרו)\\s+(משתמש|משתמשים)$/i.test(clean(value));
  }

  function waitFor(selector, { present, timeoutMs = CONFIG.modalTimeoutMs }) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        const element = document.querySelector(selector);
        if (Boolean(element) === present) return resolve(element);
        if (Date.now() - startedAt >= timeoutMs) {
          return reject(
            new Error(
              present
                ? \`לא נמצא רכיב צפוי: \${selector}\`
                : \`הרכיב לא נסגר בזמן: \${selector}\`,
            ),
          );
        }
        window.setTimeout(check, 50);
      };
      check();
    });
  }

  function waitUntil(check, errorMessage, timeoutMs = CONFIG.modalTimeoutMs) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        const result = check();
        if (result) return resolve(result);
        if (Date.now() - startedAt >= timeoutMs) return reject(new Error(errorMessage));
        window.setTimeout(poll, 50);
      };
      poll();
    });
  }

  function assertSafePage() {
    const root = document.querySelector(".Automations");
    if (!root) throw new Error("לא נמצא אזור האוטומציות; לא בוצעה אף לחיצה.");

    const items = [...root.querySelectorAll(":scope .AutomationItem")];
    if (!items.length) throw new Error("לא נמצאו אוטומציות; לא בוצעה אף לחיצה.");

    const alreadyOpen = document.querySelector(CONFIG.modalSelector);
    if (alreadyOpen) {
      throw new Error("מודל כבר פתוח. יש לסגור אותו לפני הפעלת הסקריפט.");
    }
    return items;
  }

  function rowSummary(item, index) {
    const group = item.closest(".list-wrapper");
    return {
      index: index + 1,
      event: clean(group?.querySelector(".event")?.textContent),
      action: clean(group?.querySelector(".event-action-group-title .action")?.textContent),
    };
  }

  function visibleValues(row) {
    const exactBadgeValues = [...row.querySelectorAll(
      ".OptionsDisplay .scrollable-options > .item-badge > span:first-child",
    )].map((span) => clean(span.textContent)).filter((value) => value && !isPlaceholder(value));
    if (exactBadgeValues.length) return unique(exactBadgeValues);

    const optionBadges = [...row.querySelectorAll(".OptionsDisplay .item-badge")]
      .map((badge) => {
        const copy = badge.cloneNode(true);
        copy.querySelectorAll("button, svg").forEach((node) => node.remove());
        return clean(copy.textContent);
      })
      .filter((value) => value && !/^\\+\\d+$/.test(value) && !isPlaceholder(value));

    if (optionBadges.length) return unique(optionBadges);

    const singleValue = row.querySelector(".react-select__single-value");
    if (singleValue && !isPlaceholder(singleValue.textContent)) return unique([singleValue.textContent]);

    const trigger = row.querySelector(".button-as-input-trigger, .select-input");
    if (trigger) {
      const copy = trigger.cloneNode(true);
      copy.querySelectorAll("button, svg, .controls, .custom-select-arrow, .action-button")
        .forEach((node) => node.remove());
      const value = clean(copy.textContent);
      return isPlaceholder(value) ? [] : unique([value]);
    }
    return [];
  }

  function hiddenCount(row) {
    const marker = [...row.querySelectorAll(".OptionsDisplay .item-badge")]
      .map((node) => clean(node.textContent))
      .find((value) => /^\\+\\d+$/.test(value));
    return marker ? Number(marker.slice(1)) : 0;
  }

  async function readAllSelectedValues(row, forceOpen = false) {
    const hidden = hiddenCount(row);
    const visible = visibleValues(row);
    if (!hidden && !forceOpen) return visible;
    const triggerCandidates = [...row.querySelectorAll(
      "button[role='combobox'], .SelectCombobox > button.SelectComboboxValue",
    )];
    const trigger = triggerCandidates.find((candidate) =>
      candidate.tagName === "BUTTON" &&
      candidate.getAttribute("type") !== "submit" &&
      candidate.disabled !== true &&
      candidate.getAttribute("aria-disabled") !== "true" &&
      Boolean(candidate.querySelector(".OptionsDisplay, .button-as-input-trigger")),
    );
    if (!trigger) {
      const fieldLabel = clean(
        row.querySelector(":scope > .FormRow-controls > .FormRow-label, .FormRow-label")?.textContent,
      );
      const diagnostics = triggerCandidates.map((candidate) => ({
        tag: candidate.tagName,
        type: candidate.getAttribute("type"),
        role: candidate.getAttribute("role"),
        disabled: candidate.disabled === true,
        ariaDisabled: candidate.getAttribute("aria-disabled"),
        className: candidate.getAttribute("class"),
      }));
      console.error(\`אבחון select עבור השדה „\${fieldLabel}”:\`, diagnostics);
      throw new Error(\`בשדה „\${fieldLabel}” נמצאו ערכים מוסתרים אך לא נמצא select בטוח לפתיחה.\`);
    }
    if (clean(trigger.textContent).includes("אשר") || clean(trigger.textContent).includes("שמור")) {
      throw new Error("יעד הפתיחה זוהה ככפתור שמירה; ההרצה נעצרה.");
    }

    const listboxesBefore = new Set(document.querySelectorAll("[role='listbox']"));
    trigger.click();
    const listbox = await waitUntil(() => {
      const controlledId = trigger.getAttribute("aria-controls");
      if (controlledId) {
        const controlled = document.getElementById(controlledId);
        if (
          controlled?.getAttribute("role") === "listbox" &&
          controlled.getClientRects().length > 0
        ) return controlled;
      }
      const search = [...document.querySelectorAll("input[role='combobox'][aria-controls]")]
        .find((element) => element.getClientRects().length > 0);
      const searchListbox = search
        ? document.getElementById(search.getAttribute("aria-controls"))
        : null;
      if (
        searchListbox?.getAttribute("role") === "listbox" &&
        searchListbox.getClientRects().length > 0
      ) return searchListbox;
      const open = [...document.querySelectorAll("[role='listbox']")]
        .find((element) =>
          !listboxesBefore.has(element) && element.getClientRects().length > 0,
        );
      return open ?? null;
    }, "רשימת הבחירה לא נפתחה בזמן.");
    await sleep(CONFIG.listSettleMs);

    try {
      const selectedFromList = [...listbox.querySelectorAll("[role='option']")]
        .filter((option) => {
          const checkbox = option.querySelector("input[type='checkbox']");
          return option.getAttribute("aria-selected") === "true" ||
            checkbox?.checked === true ||
            checkbox?.hasAttribute("checked") === true;
        })
        .map((option) => clean(option.querySelector("label")?.textContent ?? option.textContent))
        .filter((value) => value && !isPlaceholder(value));
      const selected = unique([...visible, ...selectedFromList]);
      const expected = hidden ? visible.length + hidden : visible.length;
      if (selected.length < expected) {
        throw new Error(
          \`חסרות בחירות ברשימה: ציפיתי לפחות ל-\${expected}, נמצאו \${selected.length}.\`,
        );
      }
      return selected;
    } finally {
      // Clicking the same combobox trigger only closes the list. No option is clicked.
      trigger.click();
      await waitUntil(
        () => !document.contains(listbox) || listbox.getClientRects().length === 0,
        "רשימת הבחירה לא נסגרה בזמן.",
      );
    }
  }

  async function extractModal(modal, summary) {
    const close = modal.querySelector(CONFIG.closeSelector);
    const form = modal.querySelector("form");
    if (!close || !form) {
      throw new Error("מבנה המודל שונה מהדוגמה; ההרצה נעצרה ללא אישור או שינוי.");
    }

    const confirmButton = [...modal.querySelectorAll("button")].find(
      (button) => clean(button.textContent) === "אשר" && button.type === "submit",
    );
    if (!confirmButton) {
      throw new Error("בדיקת הבטיחות של המודל נכשלה; ההרצה נעצרה.");
    }

    const fields = {};
    for (const row of modal.querySelectorAll(CONFIG.formRowSelector)) {
      const label = clean(row.querySelector("label")?.textContent).replace(/\\s*\\.\\.\\s*$/, "");
      if (!label) continue;
      fields[label] = (await readAllSelectedValues(row)).join(" | ");
    }

    const usersLabel = modal.querySelector("label[for='actionValue']");
    const usersRow = usersLabel?.closest(CONFIG.formRowSelector);
    if (usersRow) {
      const users = await readAllSelectedValues(usersRow, true);
      if (!users.length) {
        throw new Error("שדה המשתמשים נמצא במודל אך לא נמצאו בו משתמשים מסומנים.");
      }
      fields["משתמשים"] = users.join(" | ");
    }

    const ruleParts = [
      fields["בבניין"],
      fields["תחת קטגוריה"],
      fields["ותת קטגוריה"],
      fields["בקומה"],
      fields["באזור"],
      fields["ציוד"],
    ].filter((value) => value && !/^כל\\s/.test(value));
    const actionValue =
      fields["משתמשים"] ||
      fields["דחיפות"] ||
      fields["עדיפות"] ||
      "";

    return {
      ...summary,
      trigger_type: fields["כש"] ?? "",
      priorities: fields["בדחיפות"] ?? "",
      buildings: fields["בבניין"] ?? "",
      categories: fields["תחת קטגוריה"] ?? "",
      floors: fields["בקומה"] ?? "",
      areas: fields["באזור"] ?? "",
      equipment: fields["ציוד"] ?? "",
      action_type: fields["אז"] ?? summary.action,
      users: fields["משתמשים"] ?? "",
      rule_preview: ruleParts.join(">"),
      action_preview: actionValue,
      hidden_values: "",
      needs_review: "no",
    };
  }

  function clickAutomation(item) {
    const target = item.querySelector(CONFIG.itemClickSelector);
    if (!target || target.closest("button, a, form")) {
      throw new Error("יעד פתיחת האוטומציה אינו בטוח; לא בוצעה לחיצה.");
    }
    target.click();
  }

  async function closeModal(modal) {
    const close = modal.querySelector(CONFIG.closeSelector);
    if (!close) {
      const candidates = [...modal.querySelectorAll("[data-test-id='modal-close'], .ModalClose")]
        .map((element) => ({
          tag: element.tagName,
          type: element.getAttribute("type"),
          className: element.getAttribute("class"),
          testId: element.getAttribute("data-test-id"),
        }));
      console.error("פרטי אבחון של כפתורי סגירה אפשריים:", candidates);
      throw new Error("לא נמצא כפתור סגירה בטוח; יש לסגור את המודל ידנית.");
    }
    close.click();
    await waitFor(CONFIG.modalSelector, { present: false });
  }

  async function readItem(item, index) {
    const summary = rowSummary(item, index);
    clickAutomation(item);
    const close = await waitFor(
      \`\${CONFIG.modalSelector} \${CONFIG.closeSelector}\`,
      { present: true },
    );
    const modal = close.closest(CONFIG.modalSelector);
    if (!modal) {
      throw new Error("כפתור הסגירה נמצא מחוץ למודל הצפוי; ההרצה נעצרה.");
    }
    try {
      await sleep(CONFIG.modalSettleMs);
      return await extractModal(modal, summary);
    } finally {
      if (document.contains(modal)) await closeModal(modal);
    }
  }

  function toCsv(rows) {
    const columns = [
      "index", "event", "trigger_type", "priorities", "buildings",
      "categories", "floors", "areas", "equipment", "action_type",
      "users", "rule_preview", "action_preview", "hidden_values", "needs_review",
    ];
    const escape = (value) => \`"\${String(value ?? "").replace(/"/g, '""')}"\`;
    return [columns.join(","), ...rows.map((row) => columns.map((key) => escape(row[key])).join(","))]
      .join("\\r\\n");
  }

  function downloadCsv(rows) {
    const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = \`automations-\${new Date().toISOString().slice(0, 10)}.csv\`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function withSubmitBlocked(work) {
    const blockSubmit = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      throw new Error("ניסיון שליחת טופס נחסם על ידי מנגנון הבטיחות.");
    };
    const blockDangerousClick = (event) => {
      const target = event.target && typeof event.target.closest === "function"
        ? event.target
        : null;
      const button = target?.closest("button");
      const option = target?.closest("[role='option']");
      const text = clean(button?.textContent);
      const forbidden =
        Boolean(option) ||
        Boolean(button?.classList.contains("clear-button")) ||
        button?.getAttribute("data-test-id") === "multiple-select-clear-all" ||
        /^(אשר|שמור|מחק|נקה הכל|confirm|save|delete|clear all)$/i.test(text) ||
        button?.getAttribute("type") === "submit";
      if (!forbidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      throw new Error(\`לחיצה מסוכנת נחסמה: \${text || "אפשרות בחירה"}\`);
    };
    document.addEventListener("submit", blockSubmit, true);
    document.addEventListener("click", blockDangerousClick, true);
    try {
      return await work();
    } finally {
      document.removeEventListener("submit", blockSubmit, true);
      document.removeEventListener("click", blockDangerousClick, true);
    }
  }

  const api = Object.freeze({
    scan() {
      const items = assertSafePage();
      const result = items.map(rowSummary);
      console.table(result);
      console.info(\`נמצאו \${result.length} אוטומציות. לא בוצעה אף לחיצה.\`);
      return result;
    },

    async testOne(index = 1) {
      return withSubmitBlocked(async () => {
        const items = assertSafePage();
        if (!Number.isInteger(index) || index < 1 || index > items.length) {
          throw new Error(\`יש לבחור מספר בין 1 ל-\${items.length}.\`);
        }
        const result = await readItem(items[index - 1], index - 1);
        console.table([result]);
        console.info("הבדיקה הסתיימה. לא נשלח ולא שונה מידע באתר.");
        return result;
      });
    },

    async exportAll() {
      return withSubmitBlocked(async () => {
        const items = assertSafePage();
        const rows = [];
        console.info(\`מתחיל סריקה: 0 נסרקו, \${items.length} נשארו.\`);
        for (let index = 0; index < items.length; index += 1) {
          rows.push(await readItem(items[index], index));
          const scanned = index + 1;
          const remaining = items.length - scanned;
          console.info(\`התקדמות: \${scanned} נסרקו, \${remaining} נשארו.\`);
          if (index < items.length - 1) await sleep(CONFIG.delayBetweenItemsMs);
        }
        downloadCsv(rows);
        console.table(rows);
        console.info("קובץ ה-CSV הורד. לא נשלח ולא שונה מידע באתר.");
        return rows;
      });
    },
  });

  Object.defineProperty(window, "automationExporter", {
    value: api,
    configurable: true,
  });
  console.info("הסקריפט נטען. הסריקה מתחילה כעת במצב קריאה בלבד.");
  api.exportAll().catch((error) => {
    console.error("הסריקה נעצרה:", error);
  });
})();
`;

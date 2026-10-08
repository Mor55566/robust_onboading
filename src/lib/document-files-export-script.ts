export const DOCUMENT_FILES_EXPORT_SCRIPT = `(async () => {
    'use strict';

    const CONFIG = {
      AFTER_ROW_SCROLL_MS: 400,
      AFTER_OPEN_DELAY_MS: 800,
      AFTER_HISTORY_CLICK_DELAY_MS: 2000,
      AFTER_CLOSE_DELAY_MS: 500,

      ROW_RENDER_TIMEOUT_MS: 10000,
      MODAL_TIMEOUT_MS: 15000,
      CURRENT_FILE_TIMEOUT_MS: 15000,

      CSV_FILENAME: 'documents_export.csv'
    };

    const sleep = ms =>
      new Promise(resolve => setTimeout(resolve, ms));

    const cleanText = value =>
      value?.replace(/\\s+/g, ' ').trim() || '';

    const waitFor = async (fn, timeoutMs) => {
      const started = Date.now();

      while (Date.now() - started < timeoutMs) {
        const result = fn();

        if (result) {
          return result;
        }

        await sleep(100);
      }

      return null;
    };

    const getGrid = () =>
      document.querySelector(
        '[data-test-id="documents-table"] [role="grid"][aria-label="documents"]'
      );

    const getTotalDocumentCount = () => {
      const elements = Array.from(
        document.querySelectorAll('.BottomActions, .BottomActions *')
      );

      for (const el of elements) {
        const text = cleanText(el.textContent);
        const match = text.match(/(\\d+)\\s*תוצאות/);

        if (match) {
          return Number(match[1]);
        }
      }

      const grid = getGrid();
      const fallback =
        Number(grid?.getAttribute('aria-rowcount'));

      return fallback > 1
        ? fallback - 1
        : 0;
    };

    const getRenderedRows = () =>
      Array.from(
        document.querySelectorAll(
          '[data-test-id="documents-table"] [role="row"][aria-rowindex]'
        )
      ).filter(
        row =>
          Number(
            row.getAttribute('aria-rowindex')
          ) > 1
      );

    const getDocumentRow = documentIndex => {
      const wantedAriaIndex =
        documentIndex + 1;

      return document.querySelector(
        \`[data-test-id="documents-table"] [role="row"][aria-rowindex="\${wantedAriaIndex}"]\`
      );
    };

    const scrollToDocument = async documentIndex => {
      const grid = getGrid();

      if (!grid) {
        return null;
      }

      let row =
        getDocumentRow(documentIndex);

      if (row) {
        return row;
      }

      const wantedAriaIndex =
        documentIndex + 1;

      const maxAttempts = 100;

      for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
      ) {
        const renderedRows =
          getRenderedRows();

        const maxRenderedIndex =
          Math.max(
            0,
            ...renderedRows.map(row =>
              Number(
                row.getAttribute(
                  'aria-rowindex'
                )
              )
            )
          );

        if (
          maxRenderedIndex >=
          wantedAriaIndex
        ) {
          row =
            getDocumentRow(
              documentIndex
            );

          if (row) {
            return row;
          }
        }

        const beforeScrollTop =
          grid.scrollTop;

        const beforeScrollHeight =
          grid.scrollHeight;

        const step =
          Math.max(
            grid.clientHeight * 0.75,
            300
          );

        grid.scrollTop =
          Math.min(
            grid.scrollTop + step,
            grid.scrollHeight
          );

        grid.dispatchEvent(
          new Event('scroll', {
            bubbles: true
          })
        );

        await sleep(
          CONFIG.AFTER_ROW_SCROLL_MS
        );

        row =
          getDocumentRow(
            documentIndex
          );

        if (row) {
          return row;
        }

        const afterScrollTop =
          grid.scrollTop;

        const afterScrollHeight =
          grid.scrollHeight;

        if (
          afterScrollTop ===
            beforeScrollTop &&
          afterScrollHeight ===
            beforeScrollHeight
        ) {
          grid.scrollTop =
            grid.scrollHeight;

          grid.dispatchEvent(
            new Event('scroll', {
              bubbles: true
            })
          );

          await sleep(800);
        }
      }

      return await waitFor(
        () =>
          getDocumentRow(
            documentIndex
          ),
        CONFIG.ROW_RENDER_TIMEOUT_MS
      );
    };

    const getExternalId = () => {
      const match =
        window.location.pathname.match(
          /\\/document\\/([^/?#]+)/
        );

      return match?.[1] || '';
    };

    const toFullCloudinaryUrl = url => {
      if (!url) {
        return '';
      }

      return url.replace(
        /\\/image\\/upload\\/c_fill,h_60,w_60\\//,
        '/image/upload/'
      );
    };

    const getFileNameFromUrl = url => {
      if (!url) {
        return '';
      }

      try {
        return decodeURIComponent(
          new URL(url)
            .pathname
            .split('/')
            .pop()
        );
      } catch {
        return (
          url.split('/').pop() ||
          ''
        );
      }
    };

    const getMimeType = url => {
      const value =
        url
          .split('?')[0]
          .toLowerCase();

      if (value.endsWith('.jpeg')) {
        return 'image/jpeg';
      }

      if (value.endsWith('.jpg')) {
        return 'image/jpeg';
      }

      if (value.endsWith('.png')) {
        return 'image/png';
      }

      if (value.endsWith('.webp')) {
        return 'image/webp';
      }

      if (value.endsWith('.gif')) {
        return 'image/gif';
      }

      if (value.endsWith('.pdf')) {
        return 'application/pdf';
      }

      return 'application/octet-stream';
    };

    const extractCreatedAt = item => {
      const text =
        cleanText(item.textContent);

      const match =
        text.match(
          /תאריך יצירה:\\s*([0-9/]+),\\s*([0-9:]+)/
        );

      return match
        ? \`\${match[1]} \${match[2]}\`
        : '';
    };

    const extractCreatedByName = item => {
      const text =
        cleanText(item.textContent);

      const match =
        text.match(
          /נוסף ע"י:\\s*(.+?)(?=תאריך יצירה:|$)/
        );

      return cleanText(
        match?.[1] || ''
      );
    };

    const extractFileItem = ({
      item,
      externalId,
      title,
      tagName,
      linkedEntity,
      version,
      source
    }) => {
      const startDate =
        cleanText(
          item.querySelector(
            '[data-test-id="view-document-item-start-date"]'
          )?.textContent
        );

      const expirationDate =
        cleanText(
          item.querySelector(
            '[data-test-id="view-document-item-end-date"]'
          )?.textContent
        );

      const createdAt =
        extractCreatedAt(item);

      const createdByName =
        extractCreatedByName(item);

      const attachments =
        Array.from(
          item.querySelectorAll(
            '[data-test-id="media-thumbnails-with-carousel"] img'
          )
        );

      if (!attachments.length) {
        return [{
          external_id: externalId,
          title,
          tag_name: tagName,
          linked_entity:
            linkedEntity,
          version,
          source,
          start_date:
            startDate,
          expiration_date:
            expirationDate,
          created_at:
            createdAt,
          created_by_name:
            createdByName,
          attachment_index: '',
          file_name: '',
          mime_type: '',
          storage_url: ''
        }];
      }

      return attachments.map(
        (img, index) => {
          const storageUrl =
            toFullCloudinaryUrl(
              img.src
            );

          return {
            external_id:
              externalId,
            title,
            tag_name:
              tagName,
            linked_entity:
              linkedEntity,
            version,
            source,
            start_date:
              startDate,
            expiration_date:
              expirationDate,
            created_at:
              createdAt,
            created_by_name:
              createdByName,
            attachment_index:
              index + 1,
            file_name:
              getFileNameFromUrl(
                storageUrl
              ),
            mime_type:
              getMimeType(
                storageUrl
              ),
            storage_url:
              storageUrl
          };
        }
      );
    };

    const closeModalSafely =
      async modal => {
        const closeButton =
          modal?.querySelector(
            '[data-test-id="modal-close"]'
          );

        if (!closeButton) {
          console.error(
            'Close button not found.'
          );

          return false;
        }

        closeButton.click();

        const closed =
          await waitFor(
            () =>
              !document.querySelector(
                '.Modal__content[role="dialog"]'
              ),
            CONFIG.MODAL_TIMEOUT_MS
          );

        if (closed) {
          await sleep(
            CONFIG.AFTER_CLOSE_DELAY_MS
          );
        }

        return !!closed;
      };

    const openHistoryTab =
      async modal => {
        const historyTab =
          modal.querySelector(
            'button[role="tab"][aria-controls$="-content-history"]'
          );

        if (!historyTab) {
          return false;
        }

        historyTab.scrollIntoView({
          block: 'center'
        });

        await sleep(300);

        for (const eventName of [
          'mousedown',
          'mouseup',
          'click'
        ]) {
          historyTab.dispatchEvent(
            new MouseEvent(
              eventName,
              {
                bubbles: true,
                cancelable: true,
                view: window
              }
            )
          );
        }

        return !!(
          await waitFor(
            () => {
              const tab =
                document.querySelector(
                  '.Modal__content[role="dialog"] button[role="tab"][aria-controls$="-content-history"]'
                );

              return (
                tab &&
                (
                  tab.getAttribute(
                    'aria-selected'
                  ) === 'true' ||
                  tab.getAttribute(
                    'data-state'
                  ) === 'active'
                )
              );
            },
            CONFIG.MODAL_TIMEOUT_MS
          )
        );
      };

    const downloadCsv = rows => {
      if (!rows.length) {
        console.warn(
          'No rows to export.'
        );

        return;
      }

      const headers = [
        'external_id',
        'title',
        'tag_name',
        'linked_entity',
        'version',
        'source',
        'start_date',
        'expiration_date',
        'created_at',
        'created_by_name',
        'attachment_index',
        'file_name',
        'mime_type',
        'storage_url'
      ];

      const escapeCsv = value =>
        \`"\${String(
          value ?? ''
        ).replace(/"/g, '""')}"\`;

      const csv = [
        headers.join(','),

        ...rows.map(row =>
          headers
            .map(header =>
              escapeCsv(
                row[header]
              )
            )
            .join(',')
        )
      ].join('\\n');

      const blob =
        new Blob(
          ['﻿' + csv],
          {
            type:
              'text/csv;charset=utf-8;'
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const a =
        document.createElement(
          'a'
        );

      a.href = url;

      a.download =
        CONFIG.CSV_FILENAME;

      document.body.appendChild(
        a
      );

      a.click();

      a.remove();

      URL.revokeObjectURL(
        url
      );
    };

    /*
     * ============================
     * START
     * ============================
     */

    const totalDocuments =
      getTotalDocumentCount();

    console.log(
      'Total documents detected:',
      totalDocuments
    );

    if (!totalDocuments) {
      console.error(
        'Could not detect document count.'
      );

      return;
    }

    const input = prompt(
      \`נמצאו \${totalDocuments} פריטים.\\nכמה פריטים אתה רוצה לסרוק?\`,
      String(totalDocuments)
    );

    if (input === null) {
      return;
    }

    const requestedCount =
      Number.parseInt(
        input,
        10
      );

    if (
      !Number.isInteger(
        requestedCount
      ) ||
      requestedCount <= 0
    ) {
      console.error(
        'Invalid number.'
      );

      return;
    }

    const scanCount =
      Math.min(
        requestedCount,
        totalDocuments
      );

    const exportedRows = [];

    for (
      let documentIndex = 1;
      documentIndex <= scanCount;
      documentIndex++
    ) {
      console.log(
        \`[\${documentIndex}/\${scanCount}] Looking for row...\`
      );

      const row =
        await scrollToDocument(
          documentIndex
        );

      if (!row) {
        console.warn(
          \`Could not render row \${documentIndex}. Skipping.\`
        );

        continue;
      }

      const nameCell =
        row.querySelector(
          '[role="gridcell"][aria-colindex="3"]'
        );

      if (!nameCell) {
        console.warn(
          \`Name cell missing for row \${documentIndex}\`
        );

        continue;
      }

      const rowTitle =
        cleanText(
          nameCell.textContent
        ) ||
        \`Document \${documentIndex}\`;

      console.log(
        \`[\${documentIndex}/\${scanCount}] Opening: \${rowTitle}\`
      );

      /*
       * SAFE:
       * Only document-name cell.
       */
      nameCell.click();

      const modal =
        await waitFor(
          () =>
            document.querySelector(
              '.Modal__content[role="dialog"]'
            ),
          CONFIG.MODAL_TIMEOUT_MS
        );

      if (!modal) {
        console.warn(
          \`Modal did not open: \${rowTitle}\`
        );

        continue;
      }

      await sleep(
        CONFIG.AFTER_OPEN_DELAY_MS
      );

      /*
       * IMPORTANT FIX:
       *
       * Do NOT immediately decide there is no file.
       *
       * Wait up to 5 seconds for the current
       * CollectionItem to render.
       */
      const currentItem =
        await waitFor(
          () =>
            document.querySelector(
              '.Modal__content[role="dialog"] [role="tabpanel"][id$="-content-current"] li.CollectionItem'
            ),
          CONFIG.CURRENT_FILE_TIMEOUT_MS
        );

      if (!currentItem) {
        /*
         * Only classify as "no file" when
         * the actual empty placeholder exists.
         */
        const currentModal =
          document.querySelector(
            '.Modal__content[role="dialog"]'
          );

        const modalText =
          cleanText(
            currentModal?.textContent
          );

        const definitelyNoFile =
          modalText.includes(
            'העלה את המסמך הראשון שלך לכאן'
          );

        if (definitelyNoFile) {
          console.log(
            \`○ No file: \${rowTitle} — skipping\`
          );

          const closed =
            await closeModalSafely(
              currentModal
            );

          if (!closed) {
            console.error(
              \`Could not close empty document "\${rowTitle}".\`
            );

            break;
          }

          continue;
        }

        /*
         * We did NOT see the empty state,
         * so we must not assume there is no file.
         */
        console.warn(
          \`⚠ Current file did not finish loading for "\${rowTitle}". Skipping this document without exporting it.\`
        );

        const closed =
          await closeModalSafely(
            currentModal
          );

        if (!closed) {
          break;
        }

        continue;
      }

      const externalId =
        getExternalId();

      const currentModal =
        document.querySelector(
          '.Modal__content[role="dialog"]'
        );

      const title =
        cleanText(
          currentModal.querySelector(
            '.Page-pane-top h2 .editable-text'
          )?.textContent
        ) || rowTitle;

      const tagName =
        Array.from(
          currentModal.querySelectorAll(
            '[data-test-id="editable-document-tags"] .document-tag-badge'
          )
        )
          .map(el =>
            cleanText(
              el.textContent
            )
          )
          .filter(Boolean)
          .join(' | ');

      const linkedEntity =
        cleanText(
          currentModal.querySelector(
            '[data-test-id="editable-document-linked-entity"]'
          )?.textContent
        );

      let currentRows =
        extractFileItem({
          item: currentItem,
          externalId,
          title,
          tagName,
          linkedEntity,
          version: null,
          source: 'current'
        });

      console.log(
        \`✓ Current file found: \${title}\`
      );

      const historyOpened =
        await openHistoryTab(
          currentModal
        );

      if (!historyOpened) {
        console.error(
          \`Could not open history: \${title}\`
        );

        break;
      }

      await sleep(
        CONFIG.AFTER_HISTORY_CLICK_DELAY_MS
      );

      const modalAfterHistory =
        document.querySelector(
          '.Modal__content[role="dialog"]'
        );

      const historyPanel =
        modalAfterHistory?.querySelector(
          '[role="tabpanel"][id$="-content-history"]'
        );

      const historyItems =
        Array.from(
          historyPanel?.querySelectorAll(
            'li.CollectionItem'
          ) || []
        );

      console.log(
        historyItems.length
          ? \`✓ Found \${historyItems.length} history version(s)\`
          : \`✓ No history\`
      );

      const totalVersions =
        historyItems.length + 1;

      currentRows =
        currentRows.map(row => ({
          ...row,
          version:
            totalVersions
        }));

      exportedRows.push(
        ...currentRows
      );

      historyItems.forEach(
        (
          historyItem,
          historyIndex
        ) => {
          const version =
            totalVersions -
            historyIndex -
            1;

          const historyRows =
            extractFileItem({
              item: historyItem,
              externalId,
              title,
              tagName,
              linkedEntity,
              version,
              source:
                'history'
            });

          exportedRows.push(
            ...historyRows
          );

          console.log(
            \`   ✓ v\${version}: \${historyRows.length} attachment row(s)\`
          );
        }
      );

      const closed =
        await closeModalSafely(
          modalAfterHistory
        );

      if (!closed) {
        console.error(
          \`Could not close "\${title}".\`
        );

        break;
      }
    }

    console.table(
      exportedRows
    );

    downloadCsv(
      exportedRows
    );

    console.log(
      \`Done. Exported \${exportedRows.length} rows.\`
    );
  })();`;

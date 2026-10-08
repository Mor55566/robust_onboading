export const DOCUMENT_TAGS_EXPORT_SCRIPT = `(async () => {
  const root = document.querySelector('[data-test-id="document-tags"]');
  if (!root) return console.error('לא נמצא רכיב התגיות בעמוד');
  const list = root.querySelector('.tags-list') || root;

  const isScrollable = el => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
  };
  let scroller = list;
  while (scroller && scroller !== document.body && !isScrollable(scroller)) scroller = scroller.parentElement;
  if (!scroller || scroller === document.body) scroller = document.scrollingElement;

  const toHex = c => {
    const m = c.match(/\\d+/g);
    return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : c;
  };

  const tags = new Map();
  const collect = () => {
    root.querySelectorAll('[data-test-id="docment-tag-item"]').forEach(item => {
      const name = item.querySelector('.grey-dark-text .me-1')?.textContent.trim();
      const circle = item.querySelector('.tag-circle');
      if (!name || !circle) return;
      const color = circle.style.backgroundColor || getComputedStyle(circle).backgroundColor;
      if (!tags.has(name)) tags.set(name, { name, color: toHex(color) });
    });
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  scroller.scrollTop = 0;
  await sleep(400);
  let stable = 0;
  while (stable < 4) {
    const before = tags.size;
    collect();
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    scroller.scrollTop += scroller.clientHeight * 0.8;
    await sleep(500);
    stable = (tags.size === before && atBottom) ? stable + 1 : 0;
  }
  collect();

  const result = [...tags.values()];
  console.table(result);

  // יצירת CSV והורדה
  const esc = v => \`"\${String(v).replace(/"/g, '""')}"\`;
  const csv = ['name,color', ...result.map(t => \`\${esc(t.name)},\${esc(t.color)}\`)].join('\\r\\n');
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tags.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  console.log(\`נאספו \${result.length} תגיות, הקובץ tags.csv ירד\`);
})();
`;

const state = {
  manifest: null,
  documents: new Map(),
  activeId: '',
  rendered: null,
  matches: [],
  matchIndex: -1,
};

const elements = {
  tabs: document.querySelector('#documentTabs'),
  toc: document.querySelector('#toc'),
  article: document.querySelector('#document'),
  meta: document.querySelector('#documentMeta'),
  developer: document.querySelector('#developer'),
  contactToggle: document.querySelector('#contactToggle'),
  contactPopover: document.querySelector('#contactPopover'),
  pageSearch: document.querySelector('#pageSearch'),
  pageSearchCount: document.querySelector('#pageSearchCount'),
  globalSearch: document.querySelector('#globalSearch'),
  globalResults: document.querySelector('#globalResults'),
  globalResultsBody: document.querySelector('#globalResultsBody'),
  sidebar: document.querySelector('#sidebar'),
};

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (value) => value.toLocaleLowerCase('zh-CN').replace(/[\s，。；：、（）()《》〈〉“”‘’·—-]+/g, '');

function parseMarkdown(markdown, highlight = '') {
  const headings = [];
  const searchable = [];
  const html = [];
  const lines = markdown.replace(/\r/g, '').split('\n');
  let paragraph = [];
  let listOpen = false;
  let blockquote = [];
  let currentHeading = '';
  let headingIndex = 0;

  const decorate = (text) => {
    let result = escapeHtml(text);
    if (!highlight) return result;
    const pattern = new RegExp(escapeRegex(escapeHtml(highlight)), 'gi');
    return result.replace(pattern, (match) => `<mark>${match}</mark>`);
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join('');
    searchable.push({ heading: currentHeading, text });
    html.push(`<p>${decorate(text)}</p>`);
    paragraph = [];
  };
  const closeList = () => { if (listOpen) { html.push('</ul>'); listOpen = false; } };
  const flushQuote = () => {
    if (!blockquote.length) return;
    const text = blockquote.join('');
    searchable.push({ heading: currentHeading, text });
    html.push(`<blockquote><p>${decorate(text)}</p></blockquote>`);
    blockquote = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,5})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushQuote(); closeList();
      headingIndex += 1;
      const level = heading[1].length;
      const text = heading[2];
      const id = `section-${headingIndex}`;
      currentHeading = text;
      headings.push({ level, text, id });
      searchable.push({ heading: text, text });
      html.push(`<h${level} id="${id}">${decorate(text)}</h${level}>`);
    } else if (line === '---') {
      flushParagraph(); flushQuote(); closeList(); html.push('<hr>');
    } else if (line.startsWith('> ')) {
      flushParagraph(); closeList(); blockquote.push(line.slice(2));
    } else if (line.startsWith('- ')) {
      flushParagraph(); flushQuote();
      if (!listOpen) { html.push('<ul>'); listOpen = true; }
      searchable.push({ heading: currentHeading, text: line.slice(2) });
      html.push(`<li>${decorate(line.slice(2))}</li>`);
    } else if (!line) {
      flushParagraph(); flushQuote(); closeList();
    } else {
      flushQuote(); closeList(); paragraph.push(line);
    }
  }
  flushParagraph(); flushQuote(); closeList();
  return { html: html.join('\n'), headings, searchable };
}

async function loadDocument(id) {
  if (state.documents.has(id)) return state.documents.get(id);
  const descriptor = state.manifest.documents.find((item) => item.id === id);
  const embedded = window.__SITE_CONTENT__?.documents?.[id];
  if (typeof embedded === 'string') {
    state.documents.set(id, embedded);
    return embedded;
  }
  const response = await fetch(`content/${descriptor.file}`);
  if (!response.ok) throw new Error(`无法加载 ${descriptor.title}`);
  const markdown = await response.text();
  state.documents.set(id, markdown);
  return markdown;
}

function updateHash(section = '') {
  const params = new URLSearchParams({ doc: state.activeId });
  if (section) params.set('section', section);
  history.replaceState(null, '', `#${params}`);
}

async function showDocument(id, options = {}) {
  const descriptor = state.manifest.documents.find((item) => item.id === id) || state.manifest.documents[0];
  state.activeId = descriptor.id;
  const markdown = await loadDocument(descriptor.id);
  state.rendered = parseMarkdown(markdown, options.highlight || '');
  elements.article.innerHTML = state.rendered.html;
  document.title = `${descriptor.title}｜${state.manifest.siteTitle}`;
  const sourceUrl = (() => { try { const url = new URL(descriptor.source); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } })();
  elements.meta.innerHTML = `${escapeHtml(descriptor.version)}${sourceUrl ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(descriptor.sourceLabel || '官方来源')}</a>` : ''}`;
  elements.tabs.querySelectorAll('button').forEach((button) => button.setAttribute('aria-current', button.dataset.id === descriptor.id ? 'page' : 'false'));
  renderToc();
  state.matches = [...elements.article.querySelectorAll('mark')];
  state.matchIndex = -1;
  updateSearchCount();
  updateHash(options.section || '');
  if (options.section) document.getElementById(options.section)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  else window.scrollTo({ top: 0 });
  elements.sidebar.classList.remove('open');
}

function renderToc() {
  const headings = state.rendered.headings.filter((heading) => heading.level <= 5);
  if (state.activeId !== 'examination-guidelines') {
    elements.toc.innerHTML = headings
      .filter((heading) => heading.level === 2)
      .map((heading) => `<a class="toc-link level-2" href="#${heading.id}" data-section="${heading.id}">${escapeHtml(heading.text)}</a>`)
      .join('');
    bindTocLinks();
    return;
  }
  const roots = [];
  const stack = [];
  for (const heading of headings) {
    const node = { ...heading, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  const renderNode = (node) => {
    if (!node.children.length) return `<a class="toc-link level-${node.level}" href="#${node.id}" data-section="${node.id}">${escapeHtml(node.text)}</a>`;
    return `<details class="toc-group level-${node.level}"><summary data-section="${node.id}">${escapeHtml(node.text)}</summary><div class="toc-children">${node.children.map(renderNode).join('')}</div></details>`;
  };
  elements.toc.innerHTML = roots.map(renderNode).join('');
  bindTocLinks();
  elements.toc.querySelectorAll('summary').forEach((summary) => summary.addEventListener('click', () => {
    const section = summary.dataset.section;
    if (section) {
      document.getElementById(section)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      updateHash(section);
    }
  }));
}

function bindTocLinks() {
  elements.toc.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById(link.dataset.section)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    updateHash(link.dataset.section);
    elements.sidebar.classList.remove('open');
  }));
}

function updateSearchCount() {
  elements.pageSearchCount.textContent = state.matches.length ? `${Math.max(1, state.matchIndex + 1)}/${state.matches.length}` : '0';
}

function moveMatch(direction) {
  if (!state.matches.length) return;
  state.matches[state.matchIndex]?.classList.remove('active-match');
  state.matchIndex = (state.matchIndex + direction + state.matches.length) % state.matches.length;
  const match = state.matches[state.matchIndex];
  match.classList.add('active-match');
  match.scrollIntoView({ block: 'center' });
  updateSearchCount();
}

async function applyPageSearch() {
  const query = elements.pageSearch.value.trim();
  await showDocument(state.activeId, { highlight: query });
  if (query && state.matches.length) moveMatch(1);
}

function snippetsFor(markdown, query) {
  const parsed = parseMarkdown(markdown);
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return parsed.searchable.filter((item) => {
    const haystack = normalize(`${item.heading}${item.text}`);
    return tokens.every((token) => haystack.includes(token));
  });
}

async function runGlobalSearch() {
  const query = elements.globalSearch.value.trim();
  if (!query) return;
  const results = [];
  for (const descriptor of state.manifest.documents) {
    const markdown = await loadDocument(descriptor.id);
    for (const match of snippetsFor(markdown, query).slice(0, 60)) results.push({ descriptor, ...match });
  }
  elements.globalResults.hidden = false;
  elements.globalResultsBody.innerHTML = `<p class="result-summary">找到 ${results.length} 条结果（每份文件最多显示60条）</p>${results.map((result, index) => {
    const snippet = result.text.length > 150 ? `${result.text.slice(0, 150)}…` : result.text;
    return `<button class="result-item" type="button" data-index="${index}"><span class="result-doc">${escapeHtml(result.descriptor.shortTitle)}</span><span class="result-title">${escapeHtml(result.heading || result.descriptor.title)}</span><span class="result-snippet">${escapeHtml(snippet)}</span></button>`;
  }).join('')}`;
  elements.globalResultsBody.querySelectorAll('.result-item').forEach((button) => button.addEventListener('click', async () => {
    const result = results[Number(button.dataset.index)];
    elements.pageSearch.value = query;
    await showDocument(result.descriptor.id, { highlight: query });
    elements.globalResults.hidden = true;
    const target = [...elements.article.querySelectorAll('h1,h2,h3,h4,h5')].find((heading) => heading.textContent.includes(result.heading));
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }));
}

function setupControls() {
  const setContactOpen = (open) => {
    elements.contactPopover.hidden = !open;
    elements.contactToggle.setAttribute('aria-expanded', String(open));
  };
  elements.contactToggle.addEventListener('click', () => setContactOpen(elements.contactPopover.hidden));
  document.querySelector('#closeContact').addEventListener('click', () => setContactOpen(false));
  document.addEventListener('click', (event) => {
    if (!elements.contactPopover.hidden && !event.target.closest('.contact-menu')) setContactOpen(false);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setContactOpen(false); });
  elements.pageSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') applyPageSearch(); });
  document.querySelector('#nextMatch').addEventListener('click', () => moveMatch(1));
  document.querySelector('#previousMatch').addEventListener('click', () => moveMatch(-1));
  elements.globalSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') runGlobalSearch(); });
  document.querySelector('#globalSearchButton').addEventListener('click', runGlobalSearch);
  document.querySelector('#closeResults').addEventListener('click', () => { elements.globalResults.hidden = true; });
  document.querySelector('#menuButton').addEventListener('click', () => elements.sidebar.classList.add('open'));
  document.querySelector('#closeMenu').addEventListener('click', () => elements.sidebar.classList.remove('open'));
  document.querySelector('#backToTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'auto' }));
  document.querySelector('#paletteSelect').addEventListener('change', (event) => {
    document.documentElement.dataset.theme = event.target.value;
    localStorage.setItem('palette', event.target.value);
  });
  const changeFont = (delta) => {
    const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reading-size'), 10) || 18;
    const next = Math.max(14, Math.min(24, current + delta));
    document.documentElement.style.setProperty('--reading-size', `${next}px`);
    localStorage.setItem('readingSize', next);
  };
  document.querySelector('#fontDown').addEventListener('click', () => changeFont(-1));
  document.querySelector('#fontUp').addEventListener('click', () => changeFont(1));
}

async function initialize() {
  if (window.__SITE_CONTENT__?.manifest) {
    state.manifest = window.__SITE_CONTENT__.manifest;
  } else {
    const response = await fetch('content/manifest.json');
    state.manifest = await response.json();
  }
  document.title = state.manifest.siteTitle;
  elements.tabs.innerHTML = state.manifest.documents.map((item) => `<button type="button" data-id="${item.id}">${escapeHtml(item.shortTitle)}</button>`).join('');
  elements.tabs.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => showDocument(button.dataset.id)));
  const developerReady = state.manifest.developer.name && state.manifest.developer.name !== '待补充';
  elements.developer.hidden = !developerReady;
  if (developerReady) elements.developer.innerHTML = `<h2>关于开发者</h2><strong>${escapeHtml(state.manifest.developer.name)}</strong><p>${escapeHtml(state.manifest.developer.bio)}</p>${state.manifest.developer.contact ? `<p>${escapeHtml(state.manifest.developer.contact)}</p>` : ''}`;
  const savedPalette = localStorage.getItem('palette') || 'paper';
  document.documentElement.dataset.theme = savedPalette;
  document.querySelector('#paletteSelect').value = savedPalette;
  const savedSize = Number(localStorage.getItem('readingSize'));
  if (savedSize) document.documentElement.style.setProperty('--reading-size', `${savedSize}px`);
  const hash = new URLSearchParams(location.hash.slice(1));
  await showDocument(hash.get('doc') || state.manifest.documents[0].id, { section: hash.get('section') || '' });
}

setupControls();
initialize().catch((error) => { elements.article.innerHTML = `<p>网站内容加载失败：${escapeHtml(error.message)}</p>`; });

/**
 * 依存パッケージなしの最小XMLパーサ。
 * RSS 2.0 / RDF (RSS 1.0) / Atom を読むのに必要な範囲だけを扱う。
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  yen: '¥',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** XML/HTML の実体参照を復号する。 */
export function decodeEntities(input) {
  if (!input || input.indexOf('&') === -1) return input || '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function createElement(name) {
  const colon = name.indexOf(':');
  return {
    name,
    local: (colon === -1 ? name : name.slice(colon + 1)).toLowerCase(),
    attrs: Object.create(null),
    children: [],
    text: '',
  };
}

function parseAttrs(source, element) {
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || '';
    const key = m[1].toLowerCase();
    element.attrs[key] = decodeEntities(value);
  }
}

/**
 * XML文字列を要素ツリーへ変換する。
 * @returns {{name:string, local:string, attrs:Object, children:Array, text:string}|null} ルート要素
 */
export function parseXml(source) {
  if (typeof source !== 'string' || source.trim() === '') return null;

  const root = createElement('#document');
  const stack = [root];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(stack[stack.length - 1], source.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], source.slice(i, lt));

    // <![CDATA[ ... ]]>
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      const raw = end === -1 ? source.slice(lt + 9) : source.slice(lt + 9, end);
      stack[stack.length - 1].text += raw;
      i = end === -1 ? len : end + 3;
      continue;
    }
    // コメント
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // <?xml ... ?> / <!DOCTYPE ...>
    if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      const end = source.indexOf('>', lt + 1);
      i = end === -1 ? len : end + 1;
      continue;
    }
    // 終了タグ
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt + 2);
      const name = source.slice(lt + 2, end === -1 ? len : end).trim();
      closeElement(stack, name);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // 開始タグ（属性値中の `>` を考慮して走査する）
    let end = -1;
    let quote = null;
    for (let p = lt + 1; p < len; p += 1) {
      const ch = source[p];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        end = p;
        break;
      }
    }
    if (end === -1) break;

    let inner = source.slice(lt + 1, end);
    const selfClosing = inner.endsWith('/');
    if (selfClosing) inner = inner.slice(0, -1);

    const space = inner.search(/\s/);
    const tagName = (space === -1 ? inner : inner.slice(0, space)).trim();
    if (tagName === '') {
      i = end + 1;
      continue;
    }

    const element = createElement(tagName);
    if (space !== -1) parseAttrs(inner.slice(space), element);
    stack[stack.length - 1].children.push(element);
    if (!selfClosing) stack.push(element);
    i = end + 1;
  }

  return root.children[0] || null;
}

function appendText(element, chunk) {
  if (chunk) element.text += decodeEntities(chunk);
}

function closeElement(stack, name) {
  const local = (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name).toLowerCase();
  for (let depth = stack.length - 1; depth > 0; depth -= 1) {
    if (stack[depth].local === local) {
      stack.length = depth;
      return;
    }
  }
  // 対応する開始タグが無い終了タグは無視する
}

/** 直下の子から局所名が一致する最初の要素を返す。 */
export function child(element, ...localNames) {
  if (!element) return null;
  const wanted = localNames.map((n) => n.toLowerCase());
  return element.children.find((c) => wanted.includes(c.local)) || null;
}

/** 子孫すべてから局所名が一致する要素を集める。 */
export function descendants(element, localName) {
  const wanted = localName.toLowerCase();
  const found = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (c.local === wanted) found.push(c);
      walk(c);
    }
  };
  if (element) walk(element);
  return found;
}

/** 要素以下のテキストを連結して返す。 */
export function textOf(element) {
  if (!element) return '';
  let out = element.text;
  for (const c of element.children) out += textOf(c);
  return out.trim();
}

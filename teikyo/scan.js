/* 提供票チェック — スキャン画像から表のマスを切り出し、マークの有無を読み取る。
 *
 * 文字を読む OCR ではなく、「マスの中に、どれだけ濃い点があるか」で判定する。
 * 提供票のマークは印字の「1」だったり手書きの丸だったりして形が定まらないため、
 * 形を当てにせず濃さだけを見るほうが、この用紙ではよく当たる。
 *
 * 表の四隅は人が合わせる。写真は必ず少し傾いて台形になるので、
 * 四隅から射影変換をつくり、そのうえでマス目に等分する。
 */

const SAMPLE = 24;   // 1マスあたり SAMPLE×SAMPLE 点を読む（確認画面の小さな画像も兼ねる）
const INSET = 0.18;  // マスの内側だけを見る割合。罫線を拾わないための余白

/** 画像ファイルを読み込み、長辺 maxEdge に収まる canvas にする。 */
export async function loadImage(file, { maxEdge = 1600 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** canvas を時計回りに 90 度回す。 */
export function rotate90(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.height;
  canvas.height = source.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * 四隅（左上・右上・右下・左下の順、画像の実座標）から射影変換をつくる。
 * 返り値は (u, v) → { x, y }。u, v は表の中での 0〜1 の位置。
 */
export function projection(corners) {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;

  if (Math.abs(den) < 1e-9) {
    // 四隅がつぶれている（一直線など）。せめて落ちないように平行四辺形として扱う。
    return (u, v) => ({
      x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v,
      y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v,
    });
  }

  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;

  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/**
 * ヒストグラムを2つの山に分ける値（大津の方法）を返す。
 *
 * 分かれ目そのものではなく、分かれた2つの山の平均の中間を返す。
 * 提供票のように「紙が大半・墨はごくわずか」だと、分かれ目は墨のすぐ上に寄ってしまい、
 * 墨そのものを取りこぼすことがあるため。
 */
function otsu(histogram, total) {
  let sum = 0;
  for (let i = 0; i < histogram.length; i++) sum += i * histogram[i];

  let sumBack = 0, countBack = 0, bestVariance = -1;
  let meanDark = 0, meanLight = histogram.length - 1;

  for (let t = 0; t < histogram.length; t++) {
    countBack += histogram[t];
    sumBack += t * histogram[t];
    if (countBack === 0) continue;
    const countFore = total - countBack;
    if (countFore === 0) break;
    const dark = sumBack / countBack;
    const light = (sum - sumBack) / countFore;
    const variance = countBack * countFore * (dark - light) ** 2;
    if (variance > bestVariance) { bestVariance = variance; meanDark = dark; meanLight = light; }
  }
  return (meanDark + meanLight) / 2;
}

/** 並べ替えずに p 分位（0〜1）を返す。値は 0〜255 の明るさ。 */
function percentile(values, p) {
  const sorted = Uint8Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * 表を columns × rows のマスに等分し、マスごとの「濃さ」を測る。
 *
 * 返り値の cells は行優先。ratio は 0〜1（マスの中で濃い点が占める割合）、
 * pixels は確認画面に出すための SAMPLE×SAMPLE の白黒画像。
 */
export function measure(canvas, corners, { columns, rows }) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = image;
  const map = projection(corners);

  const luminanceAt = (x, y) => {
    const px = Math.min(width - 1, Math.max(0, Math.round(x)));
    const py = Math.min(height - 1, Math.max(0, Math.round(y)));
    const i = (py * width + px) * 4;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };

  const cells = [];
  const histogram = new Uint32Array(256);
  let sampled = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const pixels = new Uint8Array(SAMPLE * SAMPLE);
      for (let sy = 0; sy < SAMPLE; sy++) {
        const v = (row + INSET + ((sy + 0.5) / SAMPLE) * (1 - INSET * 2)) / rows;
        for (let sx = 0; sx < SAMPLE; sx++) {
          const u = (col + INSET + ((sx + 0.5) / SAMPLE) * (1 - INSET * 2)) / columns;
          const point = map(u, v);
          const value = luminanceAt(point.x, point.y) | 0;
          pixels[sy * SAMPLE + sx] = value;
          histogram[value]++;
          sampled++;
        }
      }
      cells.push({ row, col, pixels, ratio: 0 });
    }
  }

  // 用紙全体での「紙と墨の境目」。影で暗くなった部分に引きずられないよう、
  // マスごとの紙の明るさ（上位 15% あたり）でも頭を押さえる。
  const inkLevel = otsu(histogram, sampled);
  for (const cell of cells) {
    const paper = percentile(cell.pixels, 0.85);
    const limit = Math.min(inkLevel, paper * 0.78);
    let dark = 0;
    for (const value of cell.pixels) if (value < limit) dark++;
    cell.ratio = dark / cell.pixels.length;
  }

  return { cells, columns, rows, sampleSize: SAMPLE, inkLevel };
}

/**
 * 濃さの一覧から「マークあり」と言えるしきい値を決める。
 * マークのあるマスとないマスは濃さがはっきり2つに分かれるので、そこを大津の方法で切る。
 * どのマスも薄いとき（その行に利用がない月）は、無理に切らず全部「なし」にする。
 */
export function autoThreshold(cells) {
  const ratios = cells.map((cell) => cell.ratio);
  const max = Math.max(...ratios, 0);
  if (max < 0.05) return { threshold: Infinity, confident: true };

  const histogram = new Uint32Array(256);
  for (const ratio of ratios) histogram[Math.min(255, Math.round((ratio / max) * 255))]++;
  const level = otsu(histogram, ratios.length);
  const threshold = Math.min(Math.max(((level + 0.5) / 255) * max, 0.03), 0.6);

  // 2つの山が近すぎるときは、目で見て直したほうがよい合図
  const dark = ratios.filter((r) => r >= threshold);
  const light = ratios.filter((r) => r < threshold);
  const gap = dark.length && light.length ? Math.min(...dark) - Math.max(...light) : 1;
  return { threshold, confident: gap > threshold * 0.35 };
}

/**
 * しきい値を当てはめて、マスごとの判定を返す。
 * sensitivity は 0.5（かたい＝拾いにくい）〜1.5（やわらかい＝拾いやすい）。
 */
export function classify(cells, threshold, sensitivity = 1) {
  const level = threshold / sensitivity;
  return cells.map((cell) => ({
    row: cell.row,
    col: cell.col,
    ratio: cell.ratio,
    marked: cell.ratio >= level,
    // しきい値のすぐ近くは「どちらとも言いにくい」。確認画面で目立たせる。
    unsure: Math.abs(cell.ratio - level) < level * 0.3,
  }));
}

/** 確認画面用に、1マスの白黒画像を canvas へ描く。 */
export function paintCell(canvas, pixels, size = SAMPLE) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < pixels.length; i++) {
    image.data[i * 4] = pixels[i];
    image.data[i * 4 + 1] = pixels[i];
    image.data[i * 4 + 2] = pixels[i];
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

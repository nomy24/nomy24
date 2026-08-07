"""バーセルインデックス評価書の上余白に測定値記入表を追加する。

元のフォームを 94% に縮小して下方向へ寄せ、空いた上部に 9 列の表を描画する。
"""

import io

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

SRC = "/root/.claude/uploads/9bb03cad-1b19-503b-b1b7-92d3ba5c2bbd/3d7a8a5b-Barthel_Index_____.pdf"
DST = "/home/user/nomy24/output/Barthel_Index_measurement_table.pdf"

FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"
FONT = "IPAGothic"

PAGE_W, PAGE_H = A4  # 595.28 x 841.89

# 元フォームの罫線の外形（pdfplumber で計測）
CONTENT_X0, CONTENT_X1 = 51.24, 533.70
CONTENT_TOP = 59.70      # 上端（上原点）
CONTENT_BOTTOM = 771.45  # 下端（上原点）

SCALE = 0.94

# (見出し, 単位, 幅比率, 小見出し) — 単位・小見出しのない列は空
# 小見出しを持つ列は見出し行が上下 2 段に分かれ、記入欄も小見出しの数だけ分割される
HEADERS = [
    ("Ｎｏ", "", 0.085, []),
    ("氏名", "", 0.120, []),
    ("握力(右)", "kg", 0.087, []),
    ("握力(左)", "kg", 0.087, []),
    ("5m歩行", "秒", 0.087, []),
    ("TUG", "秒", 0.081, []),
    ("FRT", "cm", 0.081, []),
    ("身長", "cm", 0.081, []),
    ("体重", "kg", 0.081, []),
    ("義歯", "", 0.210, ["自歯のみ", "一部義歯", "全義歯"]),
]
SUB_W_RATIO = {"義歯": [0.35, 0.35, 0.30]}
CHECKBOX_SIZE = 8.0  # 小見出しを持つ列の記入欄に置くチェックボックスの一辺

DATA_ROWS = 1
HEADER_H = 26.0  # 見出し＋単位の 2 行分
ROW_H = 26.0
TABLE_TOP_MARGIN = 38.0  # ページ上端から表の上辺まで

LINE_W = 0.8
HEADER_FILL = colors.HexColor("#B4C7E7")  # 見出し行の背景色（青）
HEADER_TEXT = colors.HexColor("#1F3864")  # 見出しの文字色（濃紺）


def transformed_content_box():
    """縮小・移動後の元コンテンツの外形（PDF 座標）と変換量を返す。"""
    # 下端の余白は元のまま保つ
    bottom_pdf = PAGE_H - CONTENT_BOTTOM
    ty = bottom_pdf * (1 - SCALE)
    # 左右は元のコンテンツの中心に合わせ直す
    center_x = (CONTENT_X0 + CONTENT_X1) / 2
    tx = center_x * (1 - SCALE)

    x0 = CONTENT_X0 * SCALE + tx
    x1 = CONTENT_X1 * SCALE + tx
    top_pdf = (PAGE_H - CONTENT_TOP) * SCALE + ty
    return tx, ty, x0, x1, top_pdf


def build_table_overlay(x0, x1, content_top_pdf):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)

    table_w = x1 - x0
    table_top = PAGE_H - TABLE_TOP_MARGIN
    table_h = HEADER_H + ROW_H * DATA_ROWS
    table_bottom = table_top - table_h

    if table_bottom < content_top_pdf + 4:
        raise SystemExit(
            f"表が元コンテンツに重なります (表下端 {table_bottom:.1f} < 本文上端 {content_top_pdf:.1f})"
        )

    widths = [table_w * col[2] for col in HEADERS]
    # 丸め誤差を最終列で吸収
    widths[-1] += table_w - sum(widths)

    xs = [x0]
    for w in widths:
        xs.append(xs[-1] + w)

    header_mid = table_top - HEADER_H / 2
    header_bottom = table_top - HEADER_H

    # 見出し行の背景色
    c.setFillColor(HEADER_FILL)
    c.rect(x0, header_bottom, table_w, HEADER_H, stroke=0, fill=1)

    c.setLineWidth(LINE_W)
    c.setStrokeColorRGB(0, 0, 0)

    # 横罫線
    ys = [table_top, header_bottom]
    for i in range(DATA_ROWS):
        ys.append(header_bottom - ROW_H * (i + 1))
    for y in ys:
        c.line(x0, y, x1, y)

    # 縦罫線
    for x in xs:
        c.line(x, table_top, x, table_bottom)

    # 小見出しを持つ列の内部罫線とチェックボックス
    for i, (label, _unit, _ratio, subs) in enumerate(HEADERS):
        if not subs:
            continue
        c.line(xs[i], header_mid, xs[i + 1], header_mid)
        sub_ratio = SUB_W_RATIO[label]
        sx = xs[i]
        for r in sub_ratio[:-1]:
            sx += widths[i] * r
            c.line(sx, header_mid, sx, table_bottom)

        c.setLineWidth(LINE_W * 0.9)
        for row in range(DATA_ROWS):
            row_center = header_bottom - ROW_H * row - ROW_H / 2
            sx = xs[i]
            for r in sub_ratio:
                sw = widths[i] * r
                c.rect(
                    sx + sw / 2 - CHECKBOX_SIZE / 2,
                    row_center - CHECKBOX_SIZE / 2,
                    CHECKBOX_SIZE,
                    CHECKBOX_SIZE,
                    stroke=1,
                    fill=0,
                )
                sx += sw
        c.setLineWidth(LINE_W)

    # 見出し文字（列幅に収まるようにフォントサイズを自動調整）
    label_size_base = 9.0
    sub_size_base = 7.0
    unit_size = 7.0
    lower_baseline = header_bottom + 4.8

    def fitted_size(text, avail, base, floor=4.5):
        size = base
        while pdfmetrics.stringWidth(text, FONT, size) > avail and size > floor:
            size -= 0.25
        return size

    c.setFillColor(HEADER_TEXT)
    for i, (label, unit, _ratio, subs) in enumerate(HEADERS):
        cx = xs[i] + widths[i] / 2
        size = fitted_size(label, widths[i] - 6, label_size_base)
        if subs:
            c.setFont(FONT, size)
            c.drawCentredString(cx, header_mid + 3.6, label)
            sub_ratio = SUB_W_RATIO[label]
            sx = xs[i]
            for sub, r in zip(subs, sub_ratio):
                sw = widths[i] * r
                ssize = fitted_size(sub, sw - 3, sub_size_base)
                c.setFont(FONT, ssize)
                c.drawCentredString(sx + sw / 2, lower_baseline, sub)
                sx += sw
        elif unit:
            c.setFont(FONT, size)
            c.drawCentredString(cx, table_top - HEADER_H * 0.42, label)
            c.setFont(FONT, unit_size)
            c.drawCentredString(cx, lower_baseline, f"({unit})")
        else:
            c.setFont(FONT, size)
            c.drawCentredString(cx, header_mid - size * 0.36, label)
    c.save()
    buf.seek(0)
    return buf


def main():
    pdfmetrics.registerFont(TTFont(FONT, FONT_PATH))

    tx, ty, x0, x1, content_top_pdf = transformed_content_box()
    overlay_buf = build_table_overlay(x0, x1, content_top_pdf)

    reader = PdfReader(SRC)
    src_page = reader.pages[0]

    writer = PdfWriter()
    page = writer.add_blank_page(width=PAGE_W, height=PAGE_H)
    page.merge_transformed_page(
        src_page, Transformation().scale(SCALE).translate(tx, ty)
    )
    page.merge_page(PdfReader(overlay_buf).pages[0])

    with open(DST, "wb") as fh:
        writer.write(fh)
    print("wrote", DST)


if __name__ == "__main__":
    main()

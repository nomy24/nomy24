"""バーセルインデックス評価書の上余白に測定値記入表を追加する。

元のフォームを 90% に縮小して下方向へ寄せ、空いた上部に 9 列の表を描画する。
"""

import io

from pypdf import PdfReader, PdfWriter, Transformation
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

SCALE = 0.90

HEADERS = ["Ｎｏ", "握力(右)", "握力(左)", "5m歩行", "TUG", "FRT", "身長", "体重", "義歯"]
COL_W_RATIO = [0.078, 0.120, 0.120, 0.120, 0.110, 0.110, 0.110, 0.110, 0.122]

DATA_ROWS = 3
HEADER_H = 20.0
ROW_H = 20.0
TABLE_TOP_MARGIN = 38.0  # ページ上端から表の上辺まで

LINE_W = 0.8


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

    widths = [table_w * r for r in COL_W_RATIO]
    # 丸め誤差を最終列で吸収
    widths[-1] += table_w - sum(widths)

    c.setLineWidth(LINE_W)
    c.setStrokeColorRGB(0, 0, 0)

    # 横罫線
    ys = [table_top, table_top - HEADER_H]
    for i in range(DATA_ROWS):
        ys.append(table_top - HEADER_H - ROW_H * (i + 1))
    for y in ys:
        c.line(x0, y, x1, y)

    # 縦罫線
    xs = [x0]
    for w in widths:
        xs.append(xs[-1] + w)
    for x in xs:
        c.line(x, table_top, x, table_bottom)

    # 見出し文字（列幅に収まるようにフォントサイズを自動調整）
    base_size = 9.0
    for i, label in enumerate(HEADERS):
        size = base_size
        while pdfmetrics.stringWidth(label, FONT, size) > widths[i] - 6 and size > 5:
            size -= 0.25
        c.setFont(FONT, size)
        cx = xs[i] + widths[i] / 2
        cy = table_top - HEADER_H / 2 - size * 0.36
        c.drawCentredString(cx, cy, label)
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

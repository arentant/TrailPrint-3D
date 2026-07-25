#!/usr/bin/env python3
"""Hand-drawn line-art NFC tutorial .pen generator (Xiaohongshu carousel)."""

import json
import math
import random
import string
from pathlib import Path
from typing import List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "NFC写入教程.pen"

W = 1080
H = 1440
GAP = 80
MX = 44
CW = W - MX * 2
BORDER = 14
BODY_PAD = 18

# Tight vertical zones — minimal dead space between header / body / footer
Y_HEADER = 38
H_HEADER = 100
Y_BODY = 142
H_BODY = 1048
Y_FOOTER = 1208
H_FOOTER = 196

# Content scale (~1.3×) — elements feel larger, like a denser canvas
S = 1.3

_used_ids: set[str] = set()

PAPER = "#F4EDE0"
INK = "#1E1A16"
INK_MID = "#4A433C"
INK_LIGHT = "#7A7268"
PENCIL = "#8B7355"
ACCENT = "#C0392B"

FONT_DISPLAY = "Caveat Brush"
FONT_TITLE = "Caveat"
FONT_BODY = "Patrick Hand"


def nid() -> str:
    while True:
        s = "".join(random.choices(string.ascii_letters + string.digits, k=5))
        if s not in _used_ids:
            _used_ids.add(s)
            return s


def rng(seed: int) -> random.Random:
    return random.Random(seed)


def j(r: random.Random, v: float, amp: float = 3.5) -> float:
    return round(v + r.uniform(-amp, amp), 1)


def ink_stroke(width: float = 2.0, color: str = INK) -> dict:
    return {"thickness": width, "cap": "round", "join": "round", "fill": color}


def path_node(
    geometry: str,
    width: int,
    height: int,
    *,
    x: int = 0,
    y: int = 0,
    stroke_w: float = 2.0,
    color: str = INK,
    fill: str = "transparent",
) -> dict:
    node = {
        "type": "path",
        "id": nid(),
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "geometry": geometry,
        "viewBox": [0, 0, width, height],
        "stroke": ink_stroke(stroke_w, color),
    }
    if fill != "transparent":
        node["fill"] = fill
    return node


def text_node(
    content: str,
    *,
    x: int = 0,
    y: int = 0,
    size: int = 28,
    weight: str = "normal",
    fill: str = INK,
    font: str = FONT_BODY,
    growth: Optional[str] = None,
    width: Optional[int] = None,
    align: Optional[str] = None,
    line_height: Optional[float] = None,
) -> dict:
    n = {
        "type": "text",
        "id": nid(),
        "x": x,
        "y": y,
        "fill": fill,
        "content": content,
        "fontFamily": font,
        "fontSize": size,
        "fontWeight": weight,
    }
    if growth:
        n["textGrowth"] = growth
    if width is not None:
        n["width"] = width
    if align:
        n["textAlign"] = align
    if line_height is not None:
        n["lineHeight"] = line_height
    return n


def abs_box(
    x: int,
    y: int,
    width: int,
    height: int,
    children: List[dict],
    *,
    name: str = "Box",
    layout: str = "none",
) -> dict:
    return {
        "type": "frame",
        "id": nid(),
        "name": name,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "layout": layout,
        "children": children,
    }


def wobbly_rect_path(w: int, h: int, seed: int, inset: int = 10) -> str:
    r = rng(seed)
    x0, y0 = inset, inset
    x1, y1 = w - inset, h - inset
    return (
        f"M{j(r,x0)} {j(r,y0)} "
        f"L{j(r,x1)} {j(r,y0+1)} "
        f"L{j(r,x1-1)} {j(r,y1)} "
        f"L{j(r,x0+1)} {j(r,y1-1)} "
        f"L{j(r,x0)} {j(r,y0)}"
    )


def wobbly_circle_path(cx: float, cy: float, radius: float, seed: int) -> Tuple[str, int, int]:
    r = rng(seed)
    pts = []
    for deg in range(0, 361, 24):
        rad = math.radians(deg)
        rr = radius + r.uniform(-2.5, 2.5)
        pts.append((cx + math.cos(rad) * rr, cy + math.sin(rad) * rr))
    d = f"M{j(r,pts[0][0],2)} {j(r,pts[0][1],2)}"
    for px, py in pts[1:]:
        d += f" L{j(r,px,2)} {j(r,py,2)}"
    size = int(radius * 2 + 24)
    return d, size, size


def sketch_border(x: int, y: int, w: int, h: int, seed: int) -> dict:
    return path_node(wobbly_rect_path(w, h, seed), w, h, x=x, y=y, stroke_w=1.8, color=PENCIL)


def sketch_panel(x: int, y: int, w: int, h: int, seed: int) -> dict:
    return path_node(wobbly_rect_path(w, h, seed), w, h, x=x, y=y, stroke_w=2.2, color=INK)


def scribble_underline(w: int, x: int, y: int, seed: int = 0) -> dict:
    r = rng(seed)
    return path_node(
        f"M{j(r,6)} {j(r,6,1)} C{j(r,w*0.25)} {j(r,2,1)} {j(r,w*0.55)} {j(r,9,1)} {j(r,w-8)} {j(r,5,1)}",
        w,
        12,
        x=x,
        y=y,
        stroke_w=2.2,
        color=INK_MID,
    )


def hand_arrow(x: int, y: int, length: int = 80, seed: int = 0) -> dict:
    r = rng(seed)
    return path_node(
        f"M{j(r,4)} {j(r,8)} C{j(r,length * 0.4)} {j(r,0)} {j(r,length * 0.7)} {j(r,14)} {j(r,length)} {j(r,8)} "
        f"M{j(r,length - 14)} {j(r,0)} L{j(r,length)} {j(r,8)} L{j(r,length - 12)} {j(r,18)}",
        length + 20,
        24,
        x=x,
        y=y,
        stroke_w=2,
    )


def paper_grain(seed: int = 7) -> List[dict]:
    r = rng(seed)
    lines = []
    for i in range(22):
        x1 = r.randint(20, W - 20)
        y1 = r.randint(20, H - 20)
        length = r.randint(8, 28)
        angle = r.uniform(-0.4, 0.4)
        x2 = x1 + math.cos(angle) * length
        y2 = y1 + math.sin(angle) * length
        lines.append(
            path_node(
                f"M{x1:.0f} {y1:.0f} L{x2:.0f} {y2:.0f}",
                W,
                H,
                stroke_w=0.8,
                color="#D8CCB8",
            )
        )
    return lines


def sz(n: float) -> int:
    return int(round(n * S))


def step_number_badge(num: str, x: int, y: int, seed: int) -> List[dict]:
    geo, bw, bh = wobbly_circle_path(40, 40, 36, seed)
    return [
        path_node(geo, bw, bh, x=x, y=y, stroke_w=2.6, color=INK),
        text_node(num, x=x + 20, y=y + 8, size=sz(36), weight="700", fill=INK, font=FONT_DISPLAY),
    ]


def nfc_waves(x: int, y: int, scale: float = 1.0) -> List[dict]:
    arcs = []
    for i, (rx, ry) in enumerate([(18, 14), (28, 22), (38, 30)]):
        rx, ry = int(rx * scale), int(ry * scale)
        arcs.append(
            path_node(
                f"M4 {ry + 4} Q{rx + 4} 4 {rx * 2 + 4} {ry + 4}",
                rx * 2 + 12,
                ry + 12,
                x=x - 4,
                y=y - ry,
                stroke_w=2.2 - i * 0.2,
            )
        )
    return arcs


def phone_line_art(x: int, y: int, seed: int, label: Optional[str] = None) -> List[dict]:
    w, h = sz(168), sz(280)
    r = rng(seed)
    body = path_node(
        f"M{j(r,16)} {j(r,8)} "
        f"L{j(r,w-16)} {j(r,10)} "
        f"Q{j(r,w-4)} {j(r,18)} {j(r,w-6)} {j(r,40)} "
        f"L{j(r,w-8)} {j(r,h-36)} "
        f"Q{j(r,w-10)} {j(r,h-6)} {j(r,w-20)} {j(r,h-8)} "
        f"L{j(r,20)} {j(r,h-10)} "
        f"Q{j(r,6)} {j(r,h-18)} {j(r,8)} {j(r,h-40)} "
        f"L{j(r,10)} {j(r,24)} "
        f"Q{j(r,8)} {j(r,10)} {j(r,16)} {j(r,8)}",
        w,
        h,
        x=x,
        y=y,
        stroke_w=2.2,
    )
    screen = path_node(
        wobbly_rect_path(w - 28, h - 70, seed + 1, inset=6),
        w - 28,
        h - 70,
        x=x + 14,
        y=y + 28,
        stroke_w=1.6,
        color=INK_MID,
    )
    home = path_node(
        wobbly_circle_path(10, 10, 7, seed + 2)[0],
        24,
        24,
        x=x + w // 2 - 12,
        y=y + h - 22,
        stroke_w=1.6,
        color=INK_MID,
    )
    nodes = [body, screen, home]
    if label:
        nodes.append(text_node(label, x=x + w // 5, y=y + h // 3, size=sz(20), fill=INK_MID, font=FONT_TITLE))
    return nodes


def model_base_sketch(x: int, y: int, seed: int) -> List[dict]:
    w, h = sz(130), sz(96)
    r = rng(seed)
    base = path_node(
        f"M{j(r,8)} {j(r,h-12)} L{j(r,w-8)} {j(r,h-10)} L{j(r,w-4)} {j(r,h-4)} L{j(r,4)} {j(r,h-6)} Z",
        w,
        h,
        x=x,
        y=y,
        stroke_w=2,
    )
    mountain = path_node(
        f"M{j(r,20)} {j(r,52)} L{j(r,48)} {j(r,18)} L{j(r,76)} {j(r,40)} L{j(r,108)} {j(r,52)}",
        w,
        h,
        x=x,
        y=y,
        stroke_w=2,
    )
    tag = path_node(wobbly_circle_path(18, 74, 10, seed + 3)[0], 36, 36, x=x + 48, y=y + 56, stroke_w=1.8, color=ACCENT)
    waves = nfc_waves(x + 56, y + 70, 0.55)
    hatch = []
    for i in range(5):
        hatch.append(
            path_node(
                f"M12 {52 + i * 5} L{w - 12} {54 + i * 5}",
                w,
                h,
                x=x,
                y=y,
                stroke_w=0.8,
                color=INK_LIGHT,
            )
        )
    return [base, mountain, *hatch, tag, *waves]


def strike_line(x: int, y: int, w: int) -> dict:
    return path_node(f"M4 6 L{w - 4} 10", w + 10, 12, x=x, y=y, stroke_w=2, color=ACCENT)


def screen_frame(x: int, name: str, children: List[dict], seed: int) -> dict:
    return {
        "type": "frame",
        "id": nid(),
        "x": x,
        "y": 0,
        "name": name,
        "clip": True,
        "width": W,
        "height": H,
        "fill": PAPER,
        "layout": "none",
        "children": [
            *paper_grain(seed),
            sketch_border(BORDER, BORDER, W - BORDER * 2, H - BORDER * 2, seed + 99),
            *children,
        ],
    }


def step_header(title: str, step_num: str, seed: int) -> dict:
    ul_w = min(len(title) * sz(22), int(340 * S))
    return abs_box(
        MX,
        Y_HEADER,
        CW,
        H_HEADER,
        [
            *step_number_badge(step_num, 0, 10, seed),
            text_node(
                title,
                x=sz(96),
                y=0,
                size=sz(48),
                weight="700",
                fill=INK,
                font=FONT_DISPLAY,
                growth="fixed-width",
                width=CW - sz(100),
            ),
            scribble_underline(ul_w, sz(96), sz(58), seed + 11),
        ],
        name="StepHeader",
    )


def body_zone(children: List[dict], seed: int) -> dict:
    inner_w = CW - BODY_PAD * 2
    return abs_box(
        MX,
        Y_BODY,
        CW,
        H_BODY,
        [
            sketch_panel(0, 0, CW, H_BODY, seed),
            abs_box(BODY_PAD, BODY_PAD, inner_w, H_BODY - BODY_PAD * 2, children, name="BodyContent"),
        ],
        name="BodyArea",
    )


def footer_block(step_num: str, tip: Optional[str], seed: int) -> dict:
    children: List[dict] = []
    y = 0
    tip_h = sz(100)
    if tip:
        children.extend(
            [
                sketch_panel(0, y, CW, tip_h, seed + 20),
                text_node(
                    f"※ {tip}",
                    x=BODY_PAD,
                    y=y + sz(18),
                    size=sz(24),
                    fill=INK_MID,
                    growth="fixed-width",
                    width=CW - BODY_PAD * 2,
                    line_height=1.2,
                    font=FONT_BODY,
                ),
            ]
        )
        y += tip_h + 12
    children.append(
        text_node(
            f"— {step_num} / 5 —",
            x=0,
            y=y,
            size=sz(22),
            fill=INK_LIGHT,
            growth="fixed-width",
            width=CW,
            align="center",
            font=FONT_TITLE,
        )
    )
    return abs_box(MX, Y_FOOTER, CW, H_FOOTER, children, name="StepFooter")


def build_cover(x: int) -> dict:
    cx = W // 2
    ill_w, ill_h = sz(300), sz(280)
    ill_x, ill_y = cx - ill_w // 2, 340
    nfc_art = [
        path_node(
            wobbly_circle_path(ill_w // 2, ill_h // 2 + 10, sz(88), 1)[0],
            ill_w,
            ill_h,
            x=ill_x,
            y=ill_y,
            stroke_w=2.2,
            color=INK_MID,
        ),
        path_node(
            wobbly_circle_path(ill_w // 2, ill_h // 2 + 10, sz(58), 2)[0],
            ill_w,
            ill_h,
            x=ill_x,
            y=ill_y,
            stroke_w=2.2,
        ),
        *nfc_waves(ill_x + ill_w // 2 - 20, ill_y + ill_h // 2 + 10, 1.45),
        path_node(
            f"M{ill_w//2-60} {ill_h//2+50} L{ill_w//2} {ill_h//2-10}",
            ill_w,
            ill_h,
            x=ill_x,
            y=ill_y,
            stroke_w=1.8,
            color=PENCIL,
        ),
        path_node(
            f"M{ill_w//2} {ill_h//2+50} L{ill_w//2+60} {ill_h//2-10}",
            ill_w,
            ill_h,
            x=ill_x,
            y=ill_y,
            stroke_w=1.8,
            color=PENCIL,
        ),
    ]
    return screen_frame(
        x,
        "封面",
        [
            text_node(
                "将小红书链接写入 NFC",
                x=MX,
                y=100,
                size=sz(68),
                weight="700",
                fill=INK,
                font=FONT_DISPLAY,
                growth="fixed-width",
                width=CW,
                align="center",
            ),
            scribble_underline(sz(340), cx - sz(170), 200, 3),
            text_node(
                "印迹 TrailPrint 3D",
                x=MX,
                y=210,
                size=sz(36),
                fill=INK_MID,
                font=FONT_TITLE,
                growth="fixed-width",
                width=CW,
                align="center",
            ),
            text_node(
                "碰一碰，直达你的小红书笔记",
                x=MX,
                y=260,
                size=sz(30),
                fill=INK_LIGHT,
                growth="fixed-width",
                width=CW,
                align="center",
            ),
            *nfc_art,
            text_node(
                "5 步手绘教程",
                x=MX,
                y=ill_y + ill_h + 36,
                size=sz(34),
                fill=INK,
                font=FONT_TITLE,
                growth="fixed-width",
                width=CW,
                align="center",
            ),
            hand_arrow(cx - sz(100), ill_y + ill_h + sz(72), sz(110), 4),
            text_node(
                "左滑开始 →",
                x=cx - sz(54),
                y=ill_y + ill_h + sz(58),
                size=sz(28),
                fill=INK_MID,
                font=FONT_TITLE,
            ),
            sketch_panel(cx - sz(155), 1180, sz(310), sz(58), 5),
            text_node(
                "线稿风 · NFC 写入指南",
                x=cx - sz(132),
                y=1194,
                size=sz(24),
                fill=INK_MID,
                font=FONT_BODY,
            ),
        ],
        seed=100,
    )


def build_step_screen(
    x: int,
    *,
    name: str,
    step_num: str,
    title: str,
    body: str,
    seed: int,
    illustration: Optional[List[dict]] = None,
    tip: Optional[str] = None,
):
    body_children: List[dict] = [
        text_node(
            body,
            x=0,
            y=0,
            size=sz(30),
            fill=INK,
            growth="fixed-width",
            width=CW - BODY_PAD * 2,
            line_height=1.3,
            font=FONT_BODY,
        ),
    ]
    if illustration:
        body_children.extend(illustration)

    return screen_frame(
        x,
        name,
        [
            step_header(title, step_num, seed),
            body_zone(body_children, seed + 1),
            footer_block(step_num, tip, seed + 2),
        ],
        seed=seed + 50,
    )


def build_document():
    iw = CW - BODY_PAD * 2
    pw = sz(168)
    screens = [
        build_cover(0),
        build_step_screen(
            W + GAP,
            name="步骤1-下载NFC Tools",
            step_num="1",
            title="下载 NFC Tools",
            body="在 App Store 搜索「NFC Tools」\n下载安装，这是常用的 NFC 写入工具。",
            seed=201,
            illustration=[
                path_node(
                    f"M16 30 L{iw-16} 30 M16 70 L{iw-60} 70 M16 110 L{iw-100} 110",
                    iw,
                    sz(140),
                    x=0,
                    y=sz(72),
                    stroke_w=1.6,
                    color=INK_LIGHT,
                ),
                text_node("⌕  NFC Tools", x=0, y=sz(200), size=sz(48), fill=INK, font=FONT_DISPLAY),
                hand_arrow(sz(30), sz(280), sz(120), 201),
                text_node("应用商店", x=sz(160), y=sz(268), size=sz(30), fill=INK_MID, font=FONT_TITLE),
            ],
            tip="iPhone 需 iOS 13+ 并支持 NFC 读写",
        ),
        build_step_screen(
            (W + GAP) * 2,
            name="步骤2-复制链接",
            step_num="2",
            title="复制小红书链接",
            body="打开你的笔记\n点击「分享」→「复制链接」",
            seed=301,
            illustration=[
                *phone_line_art((iw - pw) // 2, sz(80), 301, "分享 ↗"),
                text_node(
                    "复制链接",
                    x=(iw - pw) // 2 + sz(16),
                    y=sz(80) + sz(280) + 8,
                    size=sz(26),
                    fill=INK,
                    font=FONT_TITLE,
                ),
                path_node(
                    f"M{(iw-pw)//2+12} {sz(80)+sz(280)+sz(36)} L{(iw-pw)//2+pw-12} {sz(80)+sz(280)+sz(40)}",
                    iw,
                    40,
                    stroke_w=2.2,
                    color=INK,
                ),
            ],
        ),
        build_step_screen(
            (W + GAP) * 3,
            name="步骤3-清理链接",
            step_num="3",
            title="只保留 URL",
            body="删掉中文描述，只留 http 开头的网址。",
            seed=401,
            illustration=[
                sketch_panel(0, sz(72), iw, sz(320), 401),
                text_node("× 错误", x=BODY_PAD, y=sz(92), size=sz(28), fill=ACCENT, font=FONT_TITLE),
                text_node(
                    "快来小红书看我的… http://xhslink.com/o/abc",
                    x=BODY_PAD,
                    y=sz(132),
                    size=sz(26),
                    fill=INK_LIGHT,
                    growth="fixed-width",
                    width=iw - BODY_PAD * 2,
                    line_height=1.2,
                ),
                strike_line(BODY_PAD, sz(168), iw - BODY_PAD * 3),
                text_node("○ 正确", x=BODY_PAD, y=sz(210), size=sz(28), fill=INK, font=FONT_TITLE),
                text_node(
                    "http://xhslink.com/o/abc",
                    x=BODY_PAD,
                    y=sz(256),
                    size=sz(30),
                    fill=INK,
                    font=FONT_TITLE,
                ),
                scribble_underline(sz(280), BODY_PAD, sz(296), 402),
            ],
            tip="纯 URL 才能被 NFC 正确识别",
        ),
        build_step_screen(
            (W + GAP) * 4,
            name="步骤4-写入NFC",
            step_num="4",
            title="NFC Tools 写入",
            body="写入 → 添加记录 → URL\n粘贴清理后的链接",
            seed=501,
            illustration=[
                text_node("写入", x=0, y=sz(72), size=sz(32), font=FONT_TITLE),
                hand_arrow(sz(72), sz(88), sz(56), 501),
                text_node("添加记录", x=sz(140), y=sz(72), size=sz(32), font=FONT_TITLE),
                hand_arrow(sz(280), sz(88), sz(56), 502),
                text_node("URL", x=sz(350), y=sz(72), size=sz(32), font=FONT_TITLE),
                sketch_panel(0, sz(130), iw, sz(80), 503),
                text_node(
                    "http://xhslink.com/o/abc",
                    x=BODY_PAD,
                    y=sz(152),
                    size=sz(28),
                    fill=INK_MID,
                    font=FONT_TITLE,
                ),
            ],
        ),
        build_step_screen(
            (W + GAP) * 5,
            name="步骤5-靠近写入",
            step_num="5",
            title="靠近模型写入",
            body="点击「写入」，手机背部贴近\n模型底座 NFC 标签 1～2 秒",
            seed=601,
            illustration=[
                *phone_line_art(0, sz(72), 601, "写入中"),
                hand_arrow(pw + sz(20), sz(200), sz(80), 601),
                *model_base_sketch(pw + sz(110), sz(100), 602),
                path_node(
                    "M0 0 Q60 -30 120 0",
                    sz(140),
                    sz(50),
                    x=pw + sz(10),
                    y=sz(180),
                    stroke_w=2,
                    color=PENCIL,
                ),
            ],
            tip="写入后，碰一下模型即可打开笔记",
        ),
    ]

    return {
        "version": "2.6",
        "variables": {
            "color/paper": {"type": "color", "value": PAPER},
            "color/ink": {"type": "color", "value": INK},
            "color/pencil": {"type": "color", "value": PENCIL},
        },
        "children": screens,
    }


def main():
    doc = build_document()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()

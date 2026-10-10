#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 Windows 安装程序图标 setup/app.ico（与 public/favicon.svg 同款设计：
绿色圆角方块 + 白色花括号）。修改 favicon 后可重新运行本脚本同步：python setup/gen_icon.py"""
from PIL import Image, ImageDraw

S = 1024  # 基准渲染分辨率，再缩到各 ICO 尺寸


def gradient(size, c_top_left, c_bottom_right):
    import numpy as np
    xs = np.linspace(0, 1, size)[None, :]
    ys = np.linspace(0, 1, size)[:, None]
    t = (xs + ys) / 2  # 对角渐变系数 (size, size)
    arr = (np.asarray(c_top_left)[None, None, :] * (1 - t)[..., None]
           + np.asarray(c_bottom_right)[None, None, :] * t[..., None]).astype("uint8")
    return Image.fromarray(arr)


def quadratic(p0, p1, p2, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def brace_path(flipped):
    """一朵 '{' 的折线点（归一化坐标 0..1）；flipped=True 得 '}'。"""
    segs = [
        ((0.36, 0.14), (0.20, 0.16), (0.20, 0.42)),
        ((0.20, 0.42), (0.20, 0.48), (0.10, 0.50)),
        ((0.10, 0.50), (0.20, 0.52), (0.20, 0.58)),
        ((0.20, 0.58), (0.20, 0.84), (0.36, 0.86)),
    ]
    pts = []
    for p0, p1, p2 in segs:
        pts.extend(quadratic(p0, p1, p2)[1 if pts else 0:])
    if flipped:
        pts = [(1 - x, y) for x, y in pts]
    return pts


def render():
    base = gradient(S, (0x12, 0xB8, 0x6B), (0x08, 0x7F, 0x49))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)
    d = ImageDraw.Draw(img)
    sw = int(S * 0.07)
    for offset, flipped in ((0.08, False), (-0.08, True)):
        pts = [( (x + offset) * S, y * S) for x, y in brace_path(flipped)]
        d.line(pts, fill=(255, 255, 255, 255), width=sw, joint="curve")
        # 圆头端点
        for p in (pts[0], pts[-1]):
            d.ellipse([p[0] - sw / 2, p[1] - sw / 2, p[0] + sw / 2, p[1] + sw / 2],
                      fill=(255, 255, 255, 255))
    return img


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.ico")
    img = render()
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.resize((256, 256), Image.LANCZOS).save(out, format="ICO", sizes=sizes)
    img.resize((64, 64), Image.LANCZOS).save(os.path.join(os.path.dirname(out), "icon-preview-64.png"))
    print("written:", out)

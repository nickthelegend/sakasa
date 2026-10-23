"""Render a one-line caption bar (B612 Mono, Sakasa ink) as a PNG for ffmpeg overlay.
Usage: python3 -I e2e/caption.py <out.png> <width> <text>"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, width, text = sys.argv[1], int(sys.argv[2]), sys.argv[3]
font_path = sys.argv[4] if len(sys.argv) > 4 else 'public/fonts/B612Mono-Regular.ttf'
h = 36
img = Image.new('RGBA', (width, h), (11, 13, 16, 170))
d = ImageDraw.Draw(img)
font = ImageFont.truetype(font_path, 16)
d.rectangle([0, 0, 5, h], fill=(34, 184, 255, 255))
d.text((16, 9), text, font=font, fill=(233, 246, 253, 255))
img.save(out)

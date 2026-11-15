"""Cut the Sakasa walkthrough film from raw emulator takes (no pixel of the app is altered).

Usage: python3 -I e2e/cut-film.py <shots.json> <out.mp4>

shots.json: {"fonts": {"caption": ".../AlbertSans-SemiBold.ttf", "label": ".../B612Mono-Regular.ttf"},
             "shots": [{"src": "take.mp4", "in": 1.0, "out": 9.5, "caption": "text", "label": "IWER ..."}]}

Each shot is trimmed from its take, gets a lower-third caption (Albert Sans, Sakasa ink panel with a
flip-blue rule) and optionally a small corner label, and keeps the take's own recorded app audio.
Shots are joined with hard cuts; the audio is loudness-normalised once at the end.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080


def caption_png(path, text, font_path, label=None, label_font=None):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if text:
        font = ImageFont.truetype(font_path, 44)
        lines = text.split('\n')
        widths = [d.textlength(line, font=font) for line in lines]
        pad_x, pad_y, gap = 34, 24, 12
        line_h = 52
        box_w = int(max(widths)) + pad_x * 2 + 10
        box_h = line_h * len(lines) + gap * (len(lines) - 1) + pad_y * 2
        x0, y1 = 72, H - 72
        y0 = y1 - box_h
        d.rounded_rectangle([x0, y0, x0 + box_w, y1], radius=22, fill=(11, 13, 16, 222))
        d.rounded_rectangle([x0, y0, x0 + 10, y1], radius=5, fill=(34, 184, 255, 255))
        y = y0 + pad_y - 4
        for line in lines:
            d.text((x0 + 10 + pad_x, y), line, font=font, fill=(233, 246, 253, 255))
            y += line_h + gap
    if label:
        lf = ImageFont.truetype(label_font, 24)
        tw = d.textlength(label, font=lf)
        x1, y0 = W - 56, 48
        d.rounded_rectangle([x1 - tw - 36, y0, x1, y0 + 48], radius=12, fill=(11, 13, 16, 190))
        d.text((x1 - tw - 18, y0 + 10), label, font=lf, fill=(169, 199, 214, 255))
    img.save(path)


def run(args):
    subprocess.run(args, check=True)


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    fonts = spec['fonts']
    tmp = tempfile.mkdtemp(prefix='sakasa-cut-')
    parts = []
    for i, s in enumerate(spec['shots']):
        png = os.path.join(tmp, f'cap{i}.png')
        caption_png(png, s.get('caption', ''), fonts['caption'], s.get('label'), fonts['label'])
        part = os.path.join(tmp, f'part{i:02d}.mp4')
        dur = s['out'] - s['in']
        fade = min(0.35, dur / 4)
        vf = (
            f"[0:v]trim=start={s['in']}:end={s['out']},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v];"
            f"[1:v]format=rgba,fade=t=in:st=0.15:d={fade}:alpha=1,fade=t=out:st={max(0.2, dur - fade - 0.1)}:d={fade}:alpha=1[c];"
            f"[v][c]overlay=0:0:shortest=1[vo];"
            f"[0:a]atrim=start={s['in']}:end={s['out']},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=0.08,afade=t=out:st={max(0, dur - 0.12)}:d=0.12[ao]"
        )
        run([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', s['src'], '-loop', '1', '-t', str(dur), '-i', png,
            '-filter_complex', vf, '-map', '[vo]', '-map', '[ao]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
            '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', part,
        ])
        parts.append(part)
    lst = os.path.join(tmp, 'list.txt')
    with open(lst, 'w') as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    joined = os.path.join(tmp, 'joined.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    run([
        'ffmpeg', '-y', '-loglevel', 'error', '-i', joined, '-c:v', 'copy',
        '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
        '-movflags', '+faststart', out,
    ])
    print(out)


if __name__ == '__main__':
    main()

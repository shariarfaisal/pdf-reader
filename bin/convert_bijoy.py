#!/usr/bin/env python3
import sys
import json
from bijoy2unicode import converter

def is_bijoy(text):
    if not text:
        return False
    # Check for characteristic Bijoy ASCII patterns & ligatures
    bijoy_markers = ['Zvdmxi', 'cvewj‡Kkb', 'wbwl×', 'm~iv', 'cviv', 'AvZ¥i¶v', '†gvt', 'Be&b', 'gyRxeyi', '†nv‡mb']
    for m in bijoy_markers:
        if m in text:
            return True
    # Characteristic vowel markers in Bijoy: † (U+2020), ‡ (U+2021), ˆ, ‰
    if any(c in text for c in ['\u2020', '\u2021', 'Be&b', 'wK', 'GK', 'bv', 'gv‡m', 'hy×']):
        return True
    return False

def main():
    if len(sys.argv) > 1:
        text = sys.argv[1]
    else:
        text = sys.stdin.read()

    b2u = converter.Unicode()
    try:
        converted = b2u.convertBijoyToUnicode(text)
        print(converted)
    except Exception as e:
        # fallback to original
        print(text)

if __name__ == '__main__':
    main()

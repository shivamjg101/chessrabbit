"""
Gate the Insights chart palettes in src/lib/vizTheme.ts.

    python apps/web/scripts/palette-check.py

Every number quoted in vizTheme.ts's header comes from this script, so change
a colour there and re-run this before you trust the comment. Implements
CIEDE2000, the Vienot-Brettel-Mollon (1999) dichromat simulation, and the WCAG
relative-contrast ratio; no third-party packages.

The gates differ by palette type, and that is deliberate:

  categorical (SERIES)  lightness band, chroma floor, contrast floor, and CVD
                        separation between ADJACENT SLOTS ONLY - the fixed
                        assignment order is what keeps confusable hues apart,
                        so slot 0 vs slot 5 is not a pair anyone can see side
                        by side in a legend.

  diverging (OUTCOME)   no band and no chroma floor: a diverging midpoint is
                        required to be neutral, and the endpoints are
                        deliberately separated by LIGHTNESS rather than hue.
                        CVD is checked across all pairs, since only three
                        colours are involved and they always appear together.
"""
import math, itertools

def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lin2srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def rgb2xyz(rgb):
    r, g, b = (srgb2lin(c) for c in rgb)
    return (0.4124*r + 0.3576*g + 0.1805*b,
            0.2126*r + 0.7152*g + 0.0722*b,
            0.0193*r + 0.1192*g + 0.9505*b)

def xyz2lab(xyz):
    wx, wy, wz = 0.95047, 1.0, 1.08883
    def f(t):
        return t ** (1/3) if t > 216/24389 else (841/108) * t + 4/29
    fx, fy, fz = f(xyz[0]/wx), f(xyz[1]/wy), f(xyz[2]/wz)
    return (116*fy - 16, 500*(fx - fy), 200*(fy - fz))

def lab(h):
    return xyz2lab(rgb2xyz(hex2rgb(h)))

def chroma(h):
    L, a, b = lab(h)
    return math.hypot(a, b)

def ciede2000(l1, l2):
    L1, a1, b1 = l1; L2, a2, b2 = l2
    kL = kC = kH = 1.0
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb**7 / (Cb**7 + 25**7))) if Cb > 0 else 0
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0:
        dhp = 0
    else:
        dh = h2p - h1p
        dhp = dh - 360 if dh > 180 else dh + 360 if dh < -180 else dh
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    else:
        s = h1p + h2p
        hbp = (s + 360) / 2 if abs(h1p - h2p) > 180 and s < 360 else \
              (s - 360) / 2 if abs(h1p - h2p) > 180 else s / 2
    T = (1 - 0.17*math.cos(math.radians(hbp - 30))
           + 0.24*math.cos(math.radians(2*hbp))
           + 0.32*math.cos(math.radians(3*hbp + 6))
           - 0.20*math.cos(math.radians(4*hbp - 63)))
    dTh = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp**7 / (Cbp**7 + 25**7)) if Cbp > 0 else 0
    Sl = 1 + (0.015 * (Lbp - 50)**2) / math.sqrt(20 + (Lbp - 50)**2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dTh)) * Rc
    return math.sqrt((dLp/(kL*Sl))**2 + (dCp/(kC*Sc))**2 + (dHp/(kH*Sh))**2
                     + Rt * (dCp/(kC*Sc)) * (dHp/(kH*Sh)))

# Viénot, Brettel & Mollon (1999) dichromat simulation in linear LMS.
RGB2LMS = ((0.31399022, 0.63951294, 0.04649755),
           (0.15537241, 0.75789446, 0.08670142),
           (0.01775239, 0.10944209, 0.87256922))
LMS2RGB = (( 5.47221206, -4.6419601,  0.16963708),
           (-1.1252419,   2.29317094, -0.1678952),
           ( 0.02980165, -0.19318073, 1.16364789))
PLANES = {
    'protan': ((0, 0, 0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), 0),
    'deutan': ((1.0, 0.0, 0.0), (0, 0, 0), (0.0, 0.0, 1.0), 1),
    'tritan': ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0, 0, 0), 2),
}
# Standard Viénot substitution coefficients.
SUB = {'protan': (0.0, 1.05118294, -0.05116099),
       'deutan': (0.9513092, 0.0, 0.04264542),
       'tritan': (-0.86744736, 1.86727089, 0.0)}

def mat(m, v):
    return tuple(sum(m[i][j] * v[j] for j in range(3)) for i in range(3))

def cvd(h, kind):
    lin = tuple(srgb2lin(c) for c in hex2rgb(h))
    lms = mat(RGB2LMS, lin)
    c = SUB[kind]
    idx = PLANES[kind][3]
    new = list(lms)
    new[idx] = c[0]*lms[0] + c[1]*lms[1] + c[2]*lms[2]
    out = mat(LMS2RGB, tuple(new))
    return '#%02X%02X%02X' % tuple(round(lin2srgb(x) * 255) for x in out)

def rellum(h):
    r, g, b = (srgb2lin(c) for c in hex2rgb(h))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(a, b):
    la, lb = rellum(a), rellum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def report(name, colors, surface, band=None, chroma_floor=None,
           cvd_floor=10.0, normal_floor=15.0, contrast_floor=3.0,
           cvd_adjacent_only=False):
    print(f"\n=== {name}  (surface {surface}) ===")
    ok = True
    pairs = (list(zip(colors, colors[1:])) if cvd_adjacent_only
             else list(itertools.combinations(colors, 2)))
    for c in colors:
        L = lab(c)[0]; ch = chroma(c); cr = contrast(c, surface)
        flags = []
        if band and not (band[0] <= L <= band[1]): flags.append(f"L*{L:.0f} outside {band}")
        if chroma_floor and ch < chroma_floor: flags.append(f"chroma {ch:.0f}<{chroma_floor}")
        if cr < contrast_floor: flags.append(f"contrast {cr:.2f}<{contrast_floor}")
        if flags: ok = False
        print(f"  {c}  L*{L:5.1f}  C{ch:5.1f}  contrast {cr:5.2f}  {'; '.join(flags)}")

    worst_norm = (999, None)
    for a, b in itertools.combinations(colors, 2):
        d = ciede2000(lab(a), lab(b))
        if d < worst_norm[0]: worst_norm = (d, (a, b))
    print(f"  worst normal-vision pair: {worst_norm[0]:.1f}  {worst_norm[1]}")
    if worst_norm[0] < normal_floor: ok = False

    scope = 'adjacent' if cvd_adjacent_only else 'all-pairs'
    for kind in ('protan', 'deutan', 'tritan'):
        worst = (999, None)
        for a, b in pairs:
            d = ciede2000(lab(cvd(a, kind)), lab(cvd(b, kind)))
            if d < worst[0]: worst = (d, (a, b))
        star = '' if worst[0] >= cvd_floor else '   <-- FAILS'
        print(f"  worst {kind:7s} {scope} pair: {worst[0]:.1f}  {worst[1]}{star}")
        if worst[0] < cvd_floor: ok = False

    print(f"  => {'PASS' if ok else 'FAIL'}")
    return ok

if __name__ == '__main__':
    # Keep in step with src/lib/vizTheme.ts and the `panel` colour in
    # tailwind.config.ts - the surface is what the contrast gate measures
    # against, so a change to the panel invalidates every number below.
    SURFACE = '#2E231B'
    OUTCOME = ['#94DBA6', '#8F99A3', '#D4513F']
    SERIES = ['#5AA0E0', '#D9A356', '#35B29B', '#9080E6', '#D4688C', '#8CB43F']
    SEQUENTIAL = ['#DEE8E1', '#A9CFC1', '#72B4A0', '#47907D', '#2C6A5C']

    ok = report('OUTCOME (diverging)', OUTCOME, SURFACE,
                cvd_floor=10.0, normal_floor=15.0)
    ok &= report('SERIES (categorical)', SERIES, SURFACE,
                 band=(40, 72), chroma_floor=28.0, cvd_adjacent_only=True)

    # A magnitude ramp is read against its neighbours, not against a legend,
    # so it is gated on step size rather than on hue separation.
    print(f"\n=== SEQUENTIAL (single hue)  (surface {SURFACE}) ===")
    for c in SEQUENTIAL:
        print(f"  {c}  L*{lab(c)[0]:5.1f}  contrast {contrast(c, SURFACE):5.2f}")
    step = min(ciede2000(lab(a), lab(b)) for a, b in zip(SEQUENTIAL, SEQUENTIAL[1:]))
    print(f"  smallest adjacent step: {step:.1f}  => {'PASS' if step >= 6 else 'FAIL'}")
    ok &= step >= 6

    print(f"\n{'ALL PALETTES PASS' if ok else 'SOME PALETTES FAIL'}")
    raise SystemExit(0 if ok else 1)

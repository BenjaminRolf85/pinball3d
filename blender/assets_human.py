"""ERDABWEHR (Earth Defense): HUMAN-side toys for the third table.

Same conventions as assets.py: every make_*() returns the ROOT object at the world origin
(unrotated, unit scale, final meshes). mm in the code, metres in the meshes, +Z up,
playfield at z=0, +Y up-table, the front of an asset faces -Y (the player).
Animated parts are child objects whose object origin sits on the stated pivot.

Look: near-future human defenders - dark olive / gunmetal hard surfaces, cold cyan emissive
tech accents, yellow/black hazard stripes. Original designs: no real vehicles, units,
insignia or flags.
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

import materials
import assets as A
from assets import Builder, T, R, S, MM, _lathe, _torus, _prism, _box, _sphere, _tube, _limb, tri_count, bounds_mm  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
STENCIL_FONT = os.path.join(HERE, "BlackOpsOne-Regular.ttf")

materials.SPECS.update({
    "hum_olive":          ((0.105, 0.125, 0.07),  0.25, 0.55, None),
    "hum_olive_dark":     ((0.05, 0.06, 0.035),   0.25, 0.60, None),
    "hum_olive_light":    ((0.22, 0.25, 0.15),    0.15, 0.55, None),
    "hum_gunmetal":       ((0.07, 0.075, 0.085),  0.85, 0.35, None),
    "hum_gunmetal_light": ((0.34, 0.36, 0.39),    0.90, 0.30, None),
    "hum_concrete":       ((0.36, 0.355, 0.335),  0.00, 0.90, None),
    "hum_concrete_dark":  ((0.20, 0.20, 0.19),    0.00, 0.90, None),
    "hum_sandbag":        ((0.46, 0.37, 0.21),    0.00, 0.95, None),
    "hum_sandbag_dark":   ((0.31, 0.25, 0.14),    0.00, 0.95, None),
    "hum_hazard_yellow":  ((0.90, 0.62, 0.02),    0.10, 0.45, None),
    "hum_hazard_black":   ((0.018, 0.018, 0.018), 0.10, 0.50, None),
    "hum_void":           ((0.003, 0.003, 0.004), 0.00, 0.95, None),
    "hum_track":          ((0.028, 0.028, 0.03),  0.40, 0.70, None),
    "hum_fabric":         ((0.16, 0.18, 0.14),    0.00, 0.85, None),
    "hum_armor":          ((0.14, 0.165, 0.10),   0.20, 0.50, None),
    "hum_glove":          ((0.025, 0.025, 0.025), 0.00, 0.60, None),
    "hum_visor":          ((0.10, 0.42, 0.52),    0.50, 0.12, None),
    "hum_skin_a":         ((0.80, 0.56, 0.42),    0.00, 0.50, None),
    "hum_skin_b":         ((0.42, 0.26, 0.16),    0.00, 0.50, None),
    "hum_skin_c":         ((0.62, 0.42, 0.29),    0.00, 0.50, None),
    "hum_stencil":        ((0.85, 0.85, 0.80),    0.00, 0.50, None),
    "hum_dish":           ((0.55, 0.57, 0.55),    0.30, 0.45, None),
    "hum_wire":           ((0.40, 0.40, 0.42),    1.00, 0.40, None),
    "hum_copper":         ((0.80, 0.42, 0.20),    1.00, 0.30, None),
    "hum_city_a":         ((0.11, 0.12, 0.145),   0.10, 0.80, None),
    "hum_city_b":         ((0.17, 0.17, 0.19),    0.10, 0.80, None),
    "hum_city_c":         ((0.08, 0.085, 0.10),   0.10, 0.80, None),
    "hum_window_dark":    ((0.02, 0.03, 0.045),   0.50, 0.15, None),
    "hum_smoke":          ((0.05, 0.05, 0.055),   0.00, 1.00, None),
    "glow_hum_cyan":      ((0.0, 0.0, 0.0),       0.00, 0.50, (0.25, 0.85, 1.00)),
    "glow_hum_muzzle":    ((0.0, 0.0, 0.0),       0.00, 0.50, (0.75, 0.95, 1.00)),
    "glow_hum_amber":     ((0.0, 0.0, 0.0),       0.00, 0.50, (1.00, 0.55, 0.05)),
    "glow_hum_red":       ((0.0, 0.0, 0.0),       0.00, 0.50, (1.00, 0.06, 0.03)),
    "glow_hum_fire":      ((0.0, 0.0, 0.0),       0.00, 0.50, (1.00, 0.22, 0.02)),
    "glow_windows":       ((0.0, 0.0, 0.0),       0.00, 0.50, (1.00, 0.68, 0.30)),
})

FACE_FRONT = R('X', 90)                                                    # local +Z -> world -Y
CYCLIC = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # prism (y, z) outline, extruded along x
XZ = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))      # prism (x, z) outline, extruded along y
I4 = Matrix.Identity(4)


# ==============================================================================================
# helpers
# ==============================================================================================
def _bx(B, size, loc, m, M=I4, bevel=0.0):
    """Box positioned in the local frame M (loc is applied inside M)."""
    B.add(_box(size[0], size[1], size[2], bevel), m, M @ T(*loc))


def _finish_at(B, name, pivot, parent=None, parent_pivot=(0.0, 0.0, 0.0), sharp_deg=38.0):
    """Finish a Builder whose geometry is in world mm so that the object origin sits on `pivot`
    (world mm); the location is expressed relative to the (unrotated) parent's pivot."""
    ob = B.finish(name, parent=parent, sharp_deg=sharp_deg)
    off = Vector(pivot) * MM
    for v in ob.data.vertices:
        v.co -= off
    ob.location = (Vector(pivot) - Vector(parent_pivot)) * MM
    return ob


def _loft(rings):
    """Solid through stacked horizontal polygons: rings = [(pts, z), ...], equal point counts."""
    bm = bmesh.new()
    vs = [[bm.verts.new((x, y, z)) for x, y in A._ccw(pts)] for pts, z in rings]
    n = len(vs[0])
    bm.faces.new(list(reversed(vs[0])))
    bm.faces.new(vs[-1])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _tri_prism(pts, z0, z1):
    """Prism with explicitly tessellated, consistently wound caps (safe for concave outlines)."""
    from mathutils.geometry import tessellate_polygon
    pts = A._ccw(pts)
    n = len(pts)
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    for a, b, c in tessellate_polygon([[Vector((x, y, 0.0)) for x, y in pts]]):
        (ax, ay), (bx, by), (cx, cy) = pts[a], pts[b], pts[c]
        cr = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        if abs(cr) < 1e-9:
            continue
        if cr < 0:
            b, c = c, b
        bm.faces.new((top[a], top[b], top[c]))
        bm.faces.new((bot[a], bot[c], bot[b]))
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((bot[i], bot[i2], top[i2], top[i]))
    return bm


def _scale_poly(pts, k, cx=0.0, cy=0.0):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def _clip_rect(poly, x0, x1, y0, y1):
    """Sutherland-Hodgman clip of a convex polygon against an axis-aligned rectangle."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out

    def ix(xc):
        return lambda a, b: (xc, a[1] + (b[1] - a[1]) * (xc - a[0]) / (b[0] - a[0]))

    def iy(yc):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (yc - a[1]) / (b[1] - a[1]), yc)

    pts = list(poly)
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= y0, iy(y0)), (lambda p: p[1] <= y1, iy(y1))):
        if not pts:
            break
        pts = clip(pts, inside, inter)
    return pts


def _poly_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))


def _hazard(B, w, h, M, pitch=5.0, depth=0.5, raise_=0.15, slant=45.0, bevel=0.0):
    """Yellow plate w x h (local XY, front +Z, back at z=0) with raised black diagonal bands."""
    B.add(_box(w, h, depth, bevel), "hum_hazard_yellow", M @ T(0, 0, depth / 2))
    t = math.tan(math.radians(slant))
    hw, hh = w / 2, h / 2
    k0 = int(math.floor(-(hw + hh * t) / pitch)) - 1
    k1 = int(math.ceil((hw + hh * t) / pitch)) + 1
    for k in range(k0, k1 + 1):
        x = k * pitch
        quad = [(x - hh * t, -hh), (x + pitch / 2 - hh * t, -hh), (x + pitch / 2 + hh * t, hh), (x + hh * t, hh)]
        poly = _clip_rect(quad, -hw, hw, -hh, hh)
        if len(poly) >= 3 and abs(_poly_area(poly)) > 0.05:
            B.add(_prism(poly, depth, depth + raise_), "hum_hazard_black", M)


def _stencil_text(text, height, depth=0.5, max_points=120):
    """Stencil lettering, front at +Z, back at z=0, reading along +X, cap height `height`."""
    old = A.FONT_PATH
    A.FONT_PATH = STENCIL_FONT
    try:
        bm, w, h = A._text_solid(text, max_points=max_points, depth=1.0)
    finally:
        A.FONT_PATH = old
    k = height / h
    bmesh.ops.transform(bm, matrix=S(k, k, depth) @ T(0, 0, 0.5), verts=bm.verts)
    return bm, w * k


def _label(B, text, height, M, m="hum_stencil", depth=0.4, max_points=120, max_width=None):
    bm, w = _stencil_text(text, height, depth, max_points)
    if max_width and w > max_width:
        k = max_width / w
        bmesh.ops.scale(bm, vec=(k, k, 1.0), verts=bm.verts)
    B.add(bm, m, M)


def _pillow(length, width, height, u=6, v=4, power=0.55):
    bm = _sphere(1.0, u, v)
    for vt in bm.verts:
        x, y, z = vt.co
        vt.co = Vector((math.copysign(abs(x) ** power, x) * length / 2,
                        math.copysign(abs(y) ** power, y) * width / 2,
                        math.copysign(abs(z) ** 0.8, z) * height / 2))
    return bm


def _bag(B, centre, yaw, rng, length=12.0, width=7.0, height=6.0, m=None):
    j = rng.uniform(-1, 1)
    m = m or ("hum_sandbag_dark" if rng.random() < 0.3 else "hum_sandbag")
    B.add(_pillow(length * (1 + 0.05 * j), width, height), m,
          T(*centre) @ R('Z', yaw + rng.uniform(-4, 4)) @ R('X', rng.uniform(-3, 3)))


def _bag_line(B, p0, p1, z, rng, n, **kw):
    p0, p1 = Vector(p0), Vector(p1)
    yaw = math.degrees(math.atan2(p1.y - p0.y, p1.x - p0.x))
    for i in range(n):
        c = p0.lerp(p1, (i + 0.5) / n)
        _bag(B, (c.x, c.y, z), yaw, rng, **kw)


def _arc_band(r0, r1, z0, z1, a0, a1, n=10, bulge=0.0):
    """Partial ring (curved strip) about Z between angles a0..a1 (degrees)."""
    zm = (z0 + z1) / 2
    prof = [(r0, z0), (r1, z0), (r1 + bulge, zm), (r1, z1), (r0, z1), (r0 + bulge, zm)]
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in prof])
    k = len(prof)
    for i in range(n):
        p, q = rings[i], rings[i + 1]
        for j in range(k):
            j2 = (j + 1) % k
            bm.faces.new((p[j], p[j2], q[j2], q[j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _ring(r0, r1, z0, z1, segs=16):
    prof = [(r0, z0), (r1, z0), (r1, z1), (r0, z1), (r0, z0)]
    bm = _lathe(prof, segs, cap_start=False, cap_end=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _lathe_bands(B, profile, mats, segs, M=I4):
    """Closed-profile lathe (no caps); band i (profile[i] -> profile[i+1]) gets mats[i]."""
    bm = _lathe(profile, segs, cap_start=False, cap_end=False)
    bm.faces.ensure_lookup_table()
    idx = [B.mi(mats[min(k // segs, len(mats) - 1)]) for k in range(len(bm.faces))]
    for k, f in enumerate(bm.faces):
        f.material_index = idx[k]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    B.add(bm, None, M)


def _frame(fwd, up=(0, 0, 1)):
    """Rotation whose local -Y points along `fwd` and local +Z as close as possible to `up`."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    u = (u - f * u.dot(f)).normalized()
    y = -f
    x = y.cross(u)
    return Matrix((x, y, u)).transposed().to_4x4()


def _cyl_between(B, a, b, r, m, segs=8, caps=True):
    B.add(_limb(a, b, r, r, segs, caps, caps), m)


# ---------------------------------------------------------------------------------- validation
def _world_tris(root):
    bpy.context.view_layer.update()
    out = []
    stack = [root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        if ob.type != 'MESH':
            continue
        mw = ob.matrix_world
        me = ob.data
        me.calc_loop_triangles()
        vs = [(mw @ v.co) / MM for v in me.vertices]
        for t in me.loop_triangles:
            out.append(([vs[i] for i in t.vertices], ob.name))
    return out


def _tri_box(tri, c, h):
    """Separating-axis triangle / AABB overlap test (box centre c, half-size h)."""
    v = [p - c for p in tri]
    for i in range(3):
        if min(p[i] for p in v) > h[i] or max(p[i] for p in v) < -h[i]:
            return False
    e = [v[1] - v[0], v[2] - v[1], v[0] - v[2]]
    n = e[0].cross(e[1])
    if n.length_squared > 1e-14:
        r = h.x * abs(n.x) + h.y * abs(n.y) + h.z * abs(n.z)
        if abs(n.dot(v[0])) > r:
            return False
    for ed in e:
        for ax in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
            a = ax.cross(ed)
            if a.length_squared < 1e-14:
                continue
            p = [a.dot(x) for x in v]
            r = h.x * abs(a.x) + h.y * abs(a.y) + h.z * abs(a.z)
            if min(p) > r or max(p) < -r:
                return False
    return True


def check_clear(root, box, label):
    """Raise if any triangle of root (incl. children) enters the open box ((x0,x1),(y0,y1),(z0,z1))."""
    (x0, x1), (y0, y1), (z0, z1) = box
    c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    h = Vector(((x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01, (z1 - z0) / 2 - 0.01))
    for tri, name in _world_tris(root):
        if _tri_box(tri, c, h):
            raise RuntimeError("%s: clearance box obstructed by %s at %s" %
                               (label, name, [tuple(round(k, 1) for k in p) for p in tri]))


# ==============================================================================================
# 1. Tank bunker scoop
# ==============================================================================================
TANK_RZ = 40.0                        # bunker roof top = tank base
TURRET_PIVOT = (0.0, 26.0, 56.5)      # turret ring centre (on the hull deck)
TRUNNION = (0.0, 11.0, 64.5)          # gun elevation axis (along X)
MUZZLE = (0.0, -31.2, 64.5)           # muzzle tip (glow disc centre)
TANKPIT_OPENING = ((-18.0, 18.0), (-32.0, 8.0), (0.8, 32.0))   # must stay empty (flush plate below z 0.8)


def _tank_hull(B):
    z = TANK_RZ
    track = [(-20, z), (54, z), (61, z + 5), (60, z + 9.5), (56, z + 12), (-22, z + 12), (-27, z + 9), (-27, z + 6)]
    for s in (-1, 1):
        x0, x1 = sorted((s * 16.5, s * 25.0))
        B.add(_prism(track, x0, x1), "hum_track", CYCLIC)
        # tread ridges on the front run of the track
        for k in range(4):
            t = (k + 0.5) / 4
            yy = -20 + (-27 + 20) * t
            zz = z + 6 * t
            B.box((x1 - x0 + 0.6, 1.4, 1.0), ((x0 + x1) / 2, yy - 0.3, zz + 0.2), "hum_gunmetal", M=R('X', -40))
        # sprocket / idler hubs
        B.cyl(3.0, 0, 1.0, "hum_gunmetal_light", segs=10, M=T(s * 25.0, -22.0, z + 6.0) @ R('Y', 90 * s))
        B.cyl(3.0, 0, 1.0, "hum_gunmetal_light", segs=10, M=T(s * 25.0, 56.0, z + 6.0) @ R('Y', 90 * s))
    # lower hull between the tracks
    B.box((33, 80, 8), (0, 18, z + 5), "hum_olive_dark")
    # upper hull with sloped glacis
    upper = [(-27, z + 8), (61, z + 8), (61, z + 13), (58, z + 16.5), (-12, z + 16.5), (-26, z + 10.5)]
    B.add(_prism(upper, -24.5, 24.5, bevel=0.6), "hum_olive", CYCLIC)
    # armoured side skirts
    skirt = [(-25, z + 7), (-21, z + 4), (58, z + 4), (60, z + 7), (60, z + 13.8), (-21, z + 13.8), (-25, z + 11)]
    for s in (-1, 1):
        x0, x1 = sorted((s * 25.0, s * 26.6))
        B.add(_prism(skirt, x0, x1, bevel=0.3), "hum_olive", CYCLIC)
        for k in range(4):                                         # skirt panel seams
            B.box((0.4, 0.8, 9.0), (s * 26.7, 6 + k * 15, z + 9.0), "hum_olive_dark")
        _hazard(B, 9.4, 3.2, T(s * 26.6, -16.5, z + 11.6) @ R('Z', 90 * s) @ R('X', 90), pitch=3.2, depth=0.2)
    # hazard band on the lower nose, headlights, tow hooks
    _hazard(B, 30, 4.4, T(0, -22.0, z + 4.4) @ FACE_FRONT, pitch=4.0, depth=0.3)
    for s in (-1, 1):
        B.box((5.0, 1.4, 2.0), (s * 19.0, -27.4, z + 9.6), "hum_gunmetal", bevel=0.3)
        B.box((3.6, 0.6, 1.2), (s * 19.0, -28.2, z + 9.6), "glow_hum_muzzle")
        B.add(_torus(1.3, 0.45, 8, 4), "hum_gunmetal_light", T(s * 9.0, -22.6, z + 2.6) @ R('X', 90))
    # driver hatch with cyan periscopes
    B.cyl(4.0, z + 16.5, z + 17.6, "hum_olive_dark", segs=12, M=T(0, -6.0, 0))
    for s in (-1, 0, 1):
        B.box((2.0, 1.2, 1.0), (s * 2.6, -9.4, z + 17.8), "glow_hum_cyan")
    # engine deck grille and exhausts at the back
    for k in range(5):
        B.box((30, 1.4, 0.6), (0, 44 + k * 3.0, z + 16.8), "hum_gunmetal")
    for s in (-1, 1):
        B.box((6, 3, 3), (s * 14.0, 60.0, z + 12.0), "hum_gunmetal", bevel=0.5)
    # stowage bins along the fenders
    for s in (-1, 1):
        B.box((5.0, 30.0, 3.4), (s * 20.5, 22.0, z + 18.0), "hum_olive_dark", bevel=0.5)
        for k in range(3):
            B.box((5.6, 0.8, 3.8), (s * 20.5, 10.0 + k * 12.0, z + 18.0), "hum_gunmetal")
        B.box((5.2, 0.4, 1.0), (s * 20.5, 6.8, z + 18.4), "glow_hum_cyan")
    # stencil hull number on the glacis
    _label(B, "E-07", 3.2, T(-11.0, -18.5, z + 13.75) @ R('X', 23.2), depth=0.3, max_points=80)


def _tank_turret(B):
    cx, cy, cz = TURRET_PIVOT
    B.cyl(12.5, cz, cz + 1.6, "hum_gunmetal", segs=20, M=T(cx, cy, 0))
    full = [(-8, -17), (8, -17), (16.5, -8), (17.5, 12), (13.5, 21), (-13.5, 21), (-17.5, 12), (-16.5, -8)]
    low = _scale_poly(full, 0.93)
    top = [(-6.5, -14.5), (6.5, -14.5), (14.5, -7), (15.5, 11), (12, 19), (-12, 19), (-15.5, 11), (-14.5, -7)]
    off = lambda pts: [(x + cx, y + cy) for x, y in pts]
    B.add(_loft([(off(low), cz + 1.5), (off(full), cz + 6.0), (off(top), cz + 12.0)]), "hum_olive")
    tz = cz + 12.0
    # add-on armour blocks on the front cheeks
    for s in (-1, 1):
        B.add(_loft([([(s * 9, -18.2 + cy), (s * 15.5, -11.5 + cy), (s * 14.5, -9 + cy), (s * 8.5, -15.5 + cy)], cz + 2.2),
                     ([(s * 8, -16.2 + cy), (s * 14, -10.5 + cy), (s * 13.5, -8.5 + cy), (s * 7.8, -14 + cy)], cz + 11.0)]),
              "hum_olive_dark")
    # cyan sensor strips on both front cheeks (the tank's "eyes")
    for s in (-1, 1):
        a = math.degrees(math.atan2(9.0, 8.5)) * s
        mid = Vector((s * 12.15, -14.2 + cy, cz + 6.4))
        B.add(_box(8.5, 0.7, 1.1), "glow_hum_cyan", T(*mid) @ R('Z', a) @ T(0, -0.25, 0))
        B.add(_box(8.5, 0.8, 1.9), "hum_gunmetal", T(*mid) @ R('Z', a) @ T(0, 0.15, 0))
    # hazard band across the turret roof
    _hazard(B, 14, 3.0, T(0, cy - 10.5, tz), pitch=3.0, depth=0.15)
    # commander remote weapon station (back left) and gunner sight (right)
    B.cyl(3.4, tz, tz + 1.4, "hum_gunmetal", segs=12, M=T(-7.5, cy + 7.0, 0))
    B.box((5.0, 6.5, 4.0), (-7.5, cy + 6.0, tz + 3.4), "hum_gunmetal", bevel=0.6)
    B.add(_limb((-7.5, cy + 3.0, tz + 3.0), (-7.5, cy - 6.0, tz + 3.0), 0.7, 0.6, 6), "hum_gunmetal_light")
    B.box((2.4, 0.6, 1.6), (-7.5, cy + 2.6, tz + 4.4), "glow_hum_cyan")
    B.box((4.4, 4.4, 4.0), (7.5, cy - 3.0, tz + 2.0), "hum_olive_dark", bevel=0.6)
    B.box((3.2, 0.6, 2.4), (7.5, cy - 5.3, tz + 2.2), "glow_hum_cyan")
    B.cyl(3.6, tz, tz + 1.0, "hum_olive_dark", segs=12, M=T(5.0, cy + 9.0, 0))   # loader hatch
    # smoke dischargers on the cheeks
    for s in (-1, 1):
        for k in range(3):
            base = Vector((s * 16.2, cy - 1.0 + k * 2.6, cz + 7.5))
            d = Vector((s * 0.45, -0.55, 0.7)).normalized()
            B.add(_limb(base, base + d * 3.6, 0.95, 0.95, 6), "hum_gunmetal")
    # stowage bins on the bustle sides, antenna whips
    for s in (-1, 1):
        B.box((2.6, 10.0, 6.0), (s * 16.2, cy + 15.0, cz + 6.0), "hum_olive_dark", bevel=0.5)
        B.cyl(0.9, tz, tz + 1.2, "hum_gunmetal", segs=6, M=T(s * 10.5, cy + 16.0, 0))
        B.add(_limb((s * 10.5, cy + 16.0, tz + 1.0), (s * 11.5, cy + 18.0, tz + 12.5), 0.38, 0.25, 4), "hum_gunmetal_light")


def _tank_barrel(B):
    x, y, z = TRUNNION
    B.box((11.0, 6.5, 9.5), (0, 7.5, z), "hum_gunmetal", bevel=1.0)            # mantlet y 4.25..10.75
    Mb = T(0, 4.6, z) @ R('X', 90)                                              # +Z -> -Y
    B.cyl(3.0, 0.0, 10.0, "hum_olive_dark", segs=14, M=Mb)                     # sleeve y 4.6 .. -5.4
    B.cyl(2.3, 9.9, 31.8, "hum_gunmetal", segs=14, M=Mb)      # tube to y -27.2
    for k, d in enumerate((13.5, 18.0, 22.5)):
        B.add(_torus(2.75, 0.5, 14, 4), "glow_hum_cyan", Mb @ T(0, 0, d))
        B.add(_torus(2.75, 0.85, 14, 4), "hum_gunmetal_light", Mb @ T(0, 0, d + 1.6))
    B.box((6.4, 4.0, 4.2), (0, -29.1, z), "hum_gunmetal", bevel=0.5)           # muzzle brake y -31.1..-27.1
    for s in (-1, 1):
        B.box((0.6, 2.4, 2.6), (s * 3.0, -29.1, z), "hum_void")


def make_tank_bunker(name="tankpit"):
    """Scoop toy: fortified tank emplacement. Ball opening x -18..18, z 0..32, y -32..8 (empty);
    the ball rests at the origin. Children: tank_turret (pivot turret ring, rotates Z) >
    tank_barrel (pivot trunnion, elevates X / recoils along Y) > tank_muzzle_glow; tankpit_glow."""
    rng = random.Random(707)
    B = Builder()
    RZ = TANK_RZ
    # ---------------------------------------------------------------- concrete bunker
    for s in (-1, 1):
        B.box((22.2, 67.6, 33.6), (s * 30.5, 28.0, 16.8), "hum_concrete", bevel=1.0)   # side blocks x 19.4..41.6
    B.box((38.8, 52.0, 33.6), (0, 36.0, 16.8), "hum_concrete")                       # back block (y 10..62)
    B.box((84.0, 71.0, 7.0), (0, 26.5, 36.5), "hum_concrete_dark", bevel=1.2)        # armoured roof z 33..40
    # dark tunnel lining (just outside the clearance box)
    for s in (-1, 1):
        B.box((1.2, 17.6, 33.2), (s * 19.0, 1.4, 16.6), "hum_void")                  # x 18.4..19.6
    B.box((38.4, 1.2, 33.2), (0, 9.8, 16.6), "hum_void")                             # y 9.2..10.4
    B.box((38.4, 18.0, 1.0), (0, 1.2, 32.9), "hum_void")                             # z 32.4..33.4
    # darker footing and panel seams on the concrete
    for s in (-1, 1):
        B.box((22.6, 68.0, 3.0), (s * 30.7, 28.0, 1.5), "hum_concrete_dark", bevel=0.4)
        for y in (8.0, 24.0, 40.0, 56.0):
            B.box((0.5, 0.8, 30.0), (s * 41.65, y, 18.0), "hum_concrete_dark")
        _hazard(B, 2.6, 30.0, T(s * 41.6, -4.2, 18.0) @ R('Z', 90 * s) @ R('X', 90), pitch=3.0, depth=0.15)
    # hazard-striped portal frame
    for s in (-1, 1):
        B.box((6.4, 4.0, 33.4), (s * 21.6, -8.0, 16.7), "hum_concrete_dark", bevel=0.5)
        _hazard(B, 5.6, 31.6, T(s * 21.6, -10.0, 16.7) @ FACE_FRONT, pitch=5.0, depth=0.3)
    B.box((50.0, 3.0, 7.0), (0, -10.5, 36.5), "hum_concrete_dark", bevel=0.5)       # lintel y -12..-9, z 33..40
    _hazard(B, 48.0, 5.6, T(0, -12.0, 36.6) @ FACE_FRONT, pitch=5.0, depth=0.3)
    B.box((40.0, 1.6, 1.4), (0, -10.6, 33.3), "hum_gunmetal")                        # light bar housing z 32.6..34
    # facade details: stencil bay number, armoured vision slit, control panel
    _label(B, "07", 9.0, T(-32.0, -5.85, 21.0) @ FACE_FRONT, depth=0.4, max_points=80, max_width=15.0)
    _label(B, "BAY", 3.6, T(-32.0, -5.85, 12.0) @ FACE_FRONT, depth=0.4, max_points=80)
    B.box((12.0, 1.0, 2.2), (-33.5, -6.2, 28.5), "hum_void")
    B.box((14.0, 1.6, 1.0), (-33.5, -6.4, 27.0), "hum_concrete_dark")
    B.box((10.0, 2.6, 12.0), (33.5, -7.0, 18.0), "hum_gunmetal", bevel=0.6)
    B.box((7.0, 0.5, 4.0), (33.5, -8.4, 20.5), "glow_hum_cyan")
    for k in range(3):
        B.box((1.6, 0.6, 1.6), (31.0 + k * 2.5, -8.4, 15.0), ("hum_hazard_yellow", "glow_hum_amber", "hum_gunmetal_light")[k])
    # cable conduit along the facade
    B.add(_tube([(28.6, -6.6, 4.0), (28.6, -6.6, 12.0), (30.0, -7.6, 13.0)], 0.7, sides=5), "hum_gunmetal")
    # flush loading plate with hazard edge and inbound chevrons (z <= 0.8)
    B.box((44.0, 22.0, 0.6), (0, -21.0, 0.3), "hum_gunmetal")
    _hazard(B, 44.0, 3.0, T(0, -30.5, 0.6), pitch=4.0, depth=0.05, raise_=0.12)
    for cy in (-24.5, -16.5):
        chev = [(-7, -2.5), (0, 2.5), (7, -2.5), (7, 0.5), (0, 5.5), (-7, 0.5)]
        B.add(_tri_prism([(x, y + cy) for x, y in chev], 0.6, 0.75), "glow_hum_cyan")
    # sandbag wings at the front corners and parapets on the roof
    for s in (-1, 1):
        _bag_line(B, (s * 25.5, -13.0), (s * 35.0, -26.5), 3.0, rng, 3)
        _bag_line(B, (s * 27.0, -14.5), (s * 35.0, -25.5), 8.6, rng, 2)
        _bag_line(B, (s * 34.5, 3.0), (s * 34.5, 59.0), RZ + 3.0, rng, 5)
        _bag_line(B, (s * 35.0, 9.0), (s * 35.0, 53.0), RZ + 8.6, rng, 4)
    # warning beacon housings on the roof corners
    for s in (-1, 1):
        B.cyl(2.8, RZ, RZ + 1.6, "hum_gunmetal", segs=10, M=T(s * 36.0, -5.0, 0))
        for k in range(4):
            a = math.radians(45 + 90 * k)
            B.add(_tube([(s * 36.0 + 2.4 * math.cos(a), -5.0 + 2.4 * math.sin(a), RZ + 1.4),
                         (s * 36.0 + 2.4 * math.cos(a), -5.0 + 2.4 * math.sin(a), RZ + 6.0),
                         (s * 36.0, -5.0, RZ + 7.0)], 0.25, sides=3), "hum_gunmetal")
    # ---------------------------------------------------------------- tank hull (static)
    _tank_hull(B)
    root = B.finish(name, sharp_deg=40)

    # ---------------------------------------------------------------- turret > barrel > muzzle glow
    Tb = Builder()
    _tank_turret(Tb)
    turret = _finish_at(Tb, "tank_turret", TURRET_PIVOT, parent=root, sharp_deg=40)
    Bb = Builder()
    _tank_barrel(Bb)
    barrel = _finish_at(Bb, "tank_barrel", TRUNNION, parent=turret, parent_pivot=TURRET_PIVOT, sharp_deg=40)
    Mg = Builder()
    Mg.add(_lathe([(0, 0), (1.8, 0), (1.8, 0.45), (0, 0.45)], 12), "glow_hum_muzzle", T(*MUZZLE) @ T(0, 0.22, 0) @ R('X', 90))
    _finish_at(Mg, "tank_muzzle_glow", MUZZLE, parent=barrel, parent_pivot=TRUNNION)

    # ---------------------------------------------------------------- warning lights
    G = Builder()
    for s in (-1, 1):
        G.sphere(2.1, (s * 36.0, -5.0, RZ + 3.9), "glow_hum_amber", u=10, v=6, scale=(1, 1, 1.25))
    G.box((36.0, 0.6, 0.6), (0, -11.6, 33.3), "glow_hum_cyan")                       # light bar over the mouth
    for s in (-1, 1):                                                                  # guide marks on the back wall
        G.box((5.0, 0.3, 1.2), (s * 9.0, 9.05, 24.0), "glow_hum_cyan")
    _finish_at(G, name + "_glow", (0, 0, 0), parent=root)
    check_clear(root, TANKPIT_OPENING, "tankpit")
    return root


# ==============================================================================================
# 2. Near-future trooper
# ==============================================================================================
SKINS = ("hum_skin_a", "hum_skin_b", "hum_skin_c")
L_UP, L_FORE = 8.6, 8.4
L_THIGH, L_SHIN = 12.0, 11.6
RIFLE_K = 0.78
RIFLE_BUTT = Vector((0.0, 11.4, 0.6))
RIFLE_GRIP = Vector((0.0, 1.2, -2.6))
RIFLE_FORE = Vector((0.0, -11.5, -1.6))


def _ik(a, t, pole, l1, l2):
    """Two-bone chain from a toward t; returns (joint, end)."""
    a, t, pole = Vector(a), Vector(t), Vector(pole)
    d = t - a
    dist = max(0.5, min(d.length, l1 + l2 - 0.05))
    dn = d.normalized()
    x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - x * x, 0.0))
    p = pole - dn * pole.dot(dn)
    if p.length < 1e-6:
        p = Vector((0, 0, -1)) - dn * (-dn.z)
    p.normalize()
    mid = a + dn * x + p * h
    end = mid + (t - mid).normalized() * l2
    return mid, end


def _rifle_future(B, M):
    """Chunky bullpup-ish rifle, local: grip origin, barrel -Y, top +Z (scaled by RIFLE_K)."""
    M = M @ S(RIFLE_K, RIFLE_K, RIFLE_K)
    _bx(B, (3.2, 12.0, 4.4), (0, -1.5, 1.0), "hum_gunmetal", M, 0.45)       # receiver
    _bx(B, (2.8, 9.0, 4.2), (0, 7.0, 0.5), "hum_olive_dark", M, 0.5)        # stock
    _bx(B, (3.0, 1.2, 4.8), (0, 11.2, 0.3), "hum_glove", M)                  # butt pad
    _bx(B, (3.8, 11.0, 3.8), (0, -12.5, 1.0), "hum_olive", M, 0.6)          # shroud
    _bx(B, (2.0, 3.4, 2.4), (0, -19.4, 1.0), "hum_gunmetal", M)             # muzzle device
    _bx(B, (2.4, 3.2, 6.2), (0, -5.0, -3.6), "hum_gunmetal", M @ R('X', -12))        # magazine
    _bx(B, (2.2, 2.6, 5.0), (0, 1.2, -2.6), "hum_glove", M @ R('X', 14), 0.4)        # pistol grip
    _bx(B, (2.4, 5.6, 2.6), (0, -3.5, 4.4), "hum_gunmetal", M)              # optic
    _bx(B, (1.8, 0.4, 1.6), (0, -6.4, 4.5), "glow_hum_cyan", M)             # optic lens
    for s in (-1, 1):
        _bx(B, (0.35, 9.0, 0.8), (s * 1.95, -12.5, 1.6), "glow_hum_cyan", M)  # glow strips


def _rifle_place(fwd, up, anchor_world, anchor_local):
    Rm = _frame(fwd, up)
    a = Rm @ (anchor_local * RIFLE_K)
    return T(*(Vector(anchor_world) - a)) @ Rm


def _boot(B, ankle, yaw=0.0, pitch=0.0):
    M = T(*ankle) @ R('Z', yaw) @ R('X', pitch)
    _bx(B, (4.6, 8.4, 4.0), (0, -1.9, -1.55), "hum_glove", M, 1.0)
    _bx(B, (4.8, 3.2, 1.2), (0, -4.0, -3.0), "hum_gunmetal", M, 0.3)       # toe cap / sole


def _arm(B, sh, hand, pole, open_hand=False):
    el, wr = _ik(sh, hand, pole, L_UP, L_FORE)
    B.add(_limb(sh, el, 2.25, 2.0, 8), "hum_fabric")
    B.add(_limb(el, wr, 2.0, 1.75, 8), "hum_fabric")
    B.sphere(1.75, el, "hum_armor", u=6, v=4)
    fd = (wr - el).normalized()
    B.add(_limb(el + fd * 3.5, el + fd * 7.4, 2.2, 2.1, 6), "hum_armor")           # gauntlet
    if open_hand:
        B.add(_box(3.4, 1.4, 4.6, 0.5), "hum_glove", T(*(wr + fd * 2.2)) @ _frame((0, -1, 0), fd))
    else:
        B.sphere(1.95, wr + fd * 1.2, "hum_glove", u=7, v=5)
    return el, wr


def _leg(B, hip, ankle, pole):
    kn, an = _ik(hip, ankle, pole, L_THIGH, L_SHIN)
    B.add(_limb(hip, kn, 2.9, 2.5, 8), "hum_fabric")
    B.add(_limb(kn, an, 2.5, 2.1, 8), "hum_fabric")
    d = (an - kn).normalized()
    fwd = Vector(pole).normalized()
    B.add(_sphere(2.1, 7, 4), "hum_armor", T(*(kn + fwd * 1.0)) @ _frame(fwd, d) @ S(1.1, 0.8, 1.2))   # knee pad
    B.add(_limb(an - d * 1.0, an - d * 5.0, 2.45, 2.35, 7), "hum_glove")            # boot shaft
    return kn, an


def _head(B, Mh, skin):
    B.add(_sphere(4.0, 12, 8), skin, Mh @ S(0.9, 0.95, 1.08))
    B.sphere(0.8, (0, 0, 0), skin, u=6, v=4, M=Mh @ T(0, -3.7, -2.0))              # nose
    B.add(_box(1.8, 0.6, 0.45, 0.0), "hum_glove", Mh @ T(0, -3.5, -3.2))          # mouth
    B.add(_lathe([(0, -0.2), (5.7, -0.2), (5.8, 1.6), (5.2, 3.6), (3.8, 5.2), (1.9, 6.0), (0, 6.2)], 14),
          "hum_armor", Mh @ T(0, 0.3, 0.9) @ S(1.0, 1.06, 1.0))                    # helmet shell
    B.add(_box(8.6, 3.0, 3.4, 0.8), "hum_armor", Mh @ T(0, 4.2, -0.6))            # neck guard
    B.add(_arc_band(4.25, 5.15, -2.2, 1.1, -158, -22, 10, bulge=0.35), "hum_visor", Mh)
    B.add(_arc_band(5.5, 6.1, 0.4, 1.3, -150, -30, 8), "hum_olive_dark", Mh)    # brow ridge
    for s in (-1, 1):
        B.add(_lathe([(0, 0), (1.7, 0), (1.7, 1.4), (0, 1.4)], 10), "hum_gunmetal", Mh @ T(s * 5.2, 0.6, -0.7) @ R('Y', 90 * s))
    B.add(_box(0.5, 0.35, 0.8), "glow_hum_cyan", Mh @ T(6.65, 0.0, -0.7))
    B.add(_tube([(-5.0, 0.5, -1.6), (-3.2, -1.6, -3.9), (0, -2.3, -4.6), (3.2, -1.6, -3.9), (5.0, 0.5, -1.6)], 0.32, sides=4),
          "hum_glove", Mh)                                                          # chin strap
    B.add(_box(1.6, 3.0, 1.2), "hum_gunmetal", Mh @ T(-3.0, 0.8, 7.0))            # helmet camera
    B.add(_box(1.2, 0.3, 0.8), "glow_hum_cyan", Mh @ T(-3.0, -0.75, 7.0))


AIM_YAW = 30.0          # aim/kneel: rifle swung 30 deg to the figure's left so it reads in near-profile
POSES = {
    #        pelvis              yaw  lean  left ankle / pole                     right ankle / pole                     boots (L yaw, R yaw, R pitch)
    "aim":   dict(pelvis=(0, 1.0, 25.4), yaw=-4, lean=9,
                  la=(4.6, -7.0, 3.6), lp=(0.2, -1, 0.1), ra=(-4.4, 7.0, 3.6), rp=(0, -1, 0.3), boots=(-18, 28, 0)),
    "kneel": dict(pelvis=(0, 3.0, 15.6), yaw=-4, lean=6,
                  la=(4.6, -9.6, 3.6), lp=(0, -1, 1.0), ra=(-4.2, 11.0, 5.5), rp=(0, -0.25, -1), boots=(-10, 10, 118)),
    "wave":  dict(pelvis=(0, 0.0, 26.4), yaw=6, lean=0,
                  la=(4.2, -1.0, 3.6), lp=(0, -1, 0), ra=(-4.2, 1.0, 3.6), rp=(0, -1, 0), boots=(-8, 8, 0)),
    "radio": dict(pelvis=(0, 0.0, 26.4), yaw=14, lean=2,
                  la=(4.4, -2.6, 3.6), lp=(0, -1, 0), ra=(-4.0, 1.8, 3.6), rp=(0, -1, 0), boots=(-6, 20, 0)),
}


def make_soldier_future(name="trooper_0", pose="aim"):
    """Human defender (~55 mm) in near-future armour with a glowing rifle. Static decor."""
    P = POSES[pose]
    digits = "".join(c for c in name if c.isdigit())
    skin = SKINS[int(digits or 0) % len(SKINS)]
    B = Builder()
    pel = Vector(P["pelvis"])
    Mt = T(*pel) @ R('Z', P["yaw"]) @ R('X', P["lean"])
    W = lambda p: (Mt @ Vector(p))                                         # torso frame -> world
    # ------------------------------------------------------------- legs
    hipL, hipR = W((3.1, 0, 0.4)), W((-3.1, 0, 0.4))
    _leg(B, hipL, P["la"], P["lp"])
    _leg(B, hipR, P["ra"], P["rp"])
    by_l, by_r, pr = P["boots"]
    _boot(B, P["la"], by_l)
    _boot(B, P["ra"], by_r, pr)
    # ------------------------------------------------------------- torso
    _bx(B, (10.4, 6.4, 6.0), (0, 0, 0.8), "hum_fabric", Mt, 1.2)
    _bx(B, (11.0, 7.0, 1.6), (0, 0, 3.6), "hum_gunmetal", Mt)
    _bx(B, (9.6, 6.0, 5.0), (0, 0, 6.4), "hum_fabric", Mt, 1.2)
    _bx(B, (12.6, 8.2, 10.6), (0, -0.2, 12.2), "hum_armor", Mt, 1.6)               # vest z 6.9..17.5
    _bx(B, (8.6, 1.0, 5.4), (0, -4.4, 13.6), "hum_olive_light", Mt, 0.35)          # chest plate
    for x in (-3.4, 0.0, 3.4):
        _bx(B, (2.9, 1.9, 3.1), (x, -4.7, 8.8), "hum_olive_dark", Mt)              # pouches
    _bx(B, (1.8, 0.3, 0.7), (-2.4, -4.95, 15.2), "glow_hum_cyan", Mt)             # ID light
    B.cyl(3.4, 16.8, 18.6, "hum_fabric", segs=10, r2=2.7, M=Mt)                    # collar
    B.cyl(1.8, 17.0, 20.4, skin, segs=8, M=Mt)                                     # neck
    radio = pose == "radio"
    if radio:
        _bx(B, (9.2, 5.0, 10.6), (0, 6.6, 11.6), "hum_olive_dark", Mt, 0.9)       # radio pack
        _bx(B, (6.0, 0.4, 2.0), (0, 9.2, 14.0), "glow_hum_cyan", Mt)
        B.add(_limb(W((3.0, 8.0, 16.6)), W((3.6, 9.5, 46.0)), 0.45, 0.25, 4), "hum_gunmetal")   # whip antenna
    else:
        _bx(B, (8.6, 3.6, 8.4), (0, 5.4, 11.6), "hum_olive_dark", Mt, 0.9)        # backpack
    for s in (-1, 1):
        B.add(_sphere(3.3, 9, 5), "hum_armor", Mt @ T(s * 7.0, 0, 16.2) @ R('Y', s * 18) @ S(1.15, 1.1, 0.78))
    B.add(_box(2.8, 0.3, 0.8), "glow_hum_cyan", Mt @ T(7.0, 0, 16.2) @ R('Y', 18) @ T(0, -3.55, 0.3))
    shL, shR = W((6.6, 0, 14.4)), W((-6.6, 0, 14.4))
    # ------------------------------------------------------------- head
    hc = W((0, -0.5, 22.9))
    hyaw, hpitch, hoff = -P["yaw"], 0.0, Vector()
    if pose in ("aim", "kneel"):
        hyaw, hpitch, hoff = AIM_YAW - 4, 8.0, Vector((-1.2, -0.6, -0.2))
    elif pose == "wave":
        hyaw, hpitch = -P["yaw"] + 10, 4.0
    elif pose == "radio":
        hyaw, hpitch = -P["yaw"] + 12, -4.0
    Mh = T(*(hc + hoff)) @ R('Z', hyaw) @ R('X', hpitch)
    _head(B, Mh, skin)
    # ------------------------------------------------------------- arms and rifle
    if pose in ("aim", "kneel"):
        elev = 16.0 if pose == "aim" else 26.0                       # aiming up at the saucers
        fwd = R('Z', AIM_YAW) @ Vector((0.0, -math.cos(math.radians(elev)), math.sin(math.radians(elev))))
        butt = shR + R('Z', AIM_YAW) @ Vector((2.2, -2.2, -0.4))
        Mr = _rifle_place(fwd, (0, 0, 1), butt, RIFLE_BUTT)
        _arm(B, shR, Mr @ (RIFLE_GRIP * RIFLE_K), (-1, 0.5, -0.6))
        _arm(B, shL, Mr @ (RIFLE_FORE * RIFLE_K), (0.6, 0, -1))
    elif pose == "wave":
        _arm(B, shR, (-12.5, -2.5, 55.5), (-1, 0.4, -0.6), open_hand=True)
        hand = Vector((9.4, -3.2, 29.5))
        el, wr = _arm(B, shL, hand, (0.3, 1, 0))
        Mr = _rifle_place((0.1, -0.35, -0.93), (0, -1, 0), wr + Vector((0, 0, 0.2)), RIFLE_GRIP)
    else:  # radio
        tgt = Mh @ Vector((4.4, -2.4, -2.6))
        el, wr = _arm(B, shL, tgt, (1, 0.4, -1))
        hs = wr + (wr - el).normalized() * 1.0
        B.add(_box(1.6, 1.8, 5.4, 0.5), "hum_gunmetal", T(*hs) @ _frame((0, -1, 0), Vector((-0.25, -0.2, 1))))
        B.add(_tube([hs - Vector((0, 0, 2.6)), hs + Vector((0.6, 2.4, -6.0)), W((4.6, 4.6, 9.0)), W((4.6, 6.0, 9.6))],
                    0.3, sides=4), "hum_glove")
        hand = Vector((-5.6, -6.8, 33.0))
        el, wr = _arm(B, shR, hand, (-1, 0.4, -0.6))
        Mr = _rifle_place((0.5, -0.6, -0.62), (0, -0.3, 1), wr + Vector((0, 0, 0.3)), RIFLE_GRIP)
    _rifle_future(B, Mr)
    return B.finish(name, sharp_deg=40)


# ==============================================================================================
# 3. Laser cannon
# ==============================================================================================
LASER_PAN_Z = 36.0


def make_laser_cannon(name="laser_0"):
    """Anti-alien twin laser turret (~70 mm). Children: <name>_head (pivot pan bearing,
    rotates about Z, barrels toward -Y at rest) > <name>_glow (cyan rings and emitters)."""
    B = Builder()
    B.lathe([(0, 0), (15.0, 0), (15.0, 3.5), (13.0, 6.0), (0, 6.0)], "hum_gunmetal", segs=6)       # hex plinth
    B.lathe([(0, 6.0), (11.5, 6.0), (11.5, 8.0), (0, 8.0)], "hum_olive_dark", segs=6, M=R('Z', 30))
    for k in range(4):
        a = 45 + 90 * k
        Ma = R('Z', a)
        _bx(B, (14.0, 4.6, 3.4), (17.0, 0, 2.4), "hum_olive", Ma, 0.5)                  # outrigger arm
        _hazard(B, 11.0, 3.4, Ma @ T(17.0, 0, 4.1), pitch=3.4, depth=0.12)
        B.cyl(4.0, 0, 1.6, "hum_gunmetal", segs=10, M=Ma @ T(25.0, 0, 0))               # foot pad
        B.cyl(1.6, 1.6, 4.6, "hum_gunmetal_light", segs=8, M=Ma @ T(25.0, 0, 0))
        B.add(_limb(Ma @ Vector((9.0, 0, 16.0)), Ma @ Vector((21.5, 0, 4.4)), 1.0, 1.0, 6), "hum_gunmetal_light")   # strut
    B.lathe([(0, 8.0), (8.4, 8.0), (8.4, 10.0), (6.8, 12.0), (6.8, 28.0), (9.6, 30.5), (9.6, LASER_PAN_Z), (0, LASER_PAN_Z)],
            "hum_olive", segs=16)
    B.add(_ring(6.7, 7.4, 18.0, 19.6, 16), "glow_hum_cyan")                            # pedestal light ring
    for k in range(3):
        B.box((2.0, 1.0, 9.0), (0, 0, 21.0), "hum_gunmetal", M=R('Z', 120 * k + 90) @ T(0, -6.9, 0))
    root = B.finish(name, sharp_deg=40)

    PZ = LASER_PAN_Z
    H = Builder()
    H.lathe([(0, 0), (11.5, 0), (11.5, 2.4), (9.5, 3.6), (0, 3.6)], "hum_gunmetal", segs=16)          # turntable
    for s in (-1, 1):
        H.box((3.2, 13.0, 14.0), (s * 10.6, 2.0, 10.0), "hum_olive", bevel=0.6)                    # yoke cheeks
        H.cyl(2.6, 0, 1.6, "hum_gunmetal_light", segs=10, M=T(s * 12.2, 2.0, 13.0) @ R('Y', 90 * s))
    H.box((17.6, 23.0, 11.0), (0, 2.5, 13.5), "hum_olive", bevel=1.4)                                # housing z 8..19
    H.add(_prism([(-9.0, 19.0), (14.0, 19.0), (14.0, 21.5), (-3.0, 23.0), (-9.0, 21.5)], -7.6, 7.6, bevel=0.5),
          "hum_olive_dark", CYCLIC)                                                                     # armour cap
    for s in (-1, 1):
        _hazard(H, 2.8, 12.0, T(s * 10.6, -4.55, 10.0) @ FACE_FRONT, pitch=3.0, depth=0.15)        # cheek bands
    H.box((4.8, 4.0, 3.2), (0, -5.0, 23.6), "hum_gunmetal", bevel=0.4)                               # sensor head
    G = Builder()
    for s in (-1, 1):
        x = s * 5.4
        Mb = T(x, -9.0, 13.6) @ R('X', 90)                                                          # +Z -> -Y
        H.cyl(3.4, 0, 7.0, "hum_gunmetal", segs=12, M=Mb)                                          # emitter housing
        H.cyl(2.0, 6.9, 25.6, "hum_gunmetal_light", segs=10, M=Mb)               # focusing tube
        for d in (9.5, 12.6, 15.7):
            H.add(_torus(2.75, 0.75, 10, 3), "hum_copper", Mb @ T(0, 0, d))                       # coils
        H.cyl(3.0, 22.5, 27.0, "hum_gunmetal", segs=12, M=Mb)                                      # muzzle collar
        G.add(_torus(3.05, 0.45, 12, 3), "glow_hum_cyan", Mb @ T(0, 0, 19.6))                      # emitter ring
        G.add(_lathe([(0, 0), (2.1, 0), (2.1, 0.4), (0, 0.4)], 12), "glow_hum_muzzle", Mb @ T(0, 0, 27.0))   # lens
        # capacitor banks behind
        cxy = (s * 5.6, 11.0)
        H.cyl(3.2, 19.0, 30.0, "hum_gunmetal_light", segs=12, M=T(*cxy, 0))
        H.cyl(3.55, 20.6, 26.6, "hum_copper", segs=12, M=T(*cxy, 0))
        for z in (20.6, 26.6):
            H.add(_torus(3.6, 0.5, 12, 3), "hum_gunmetal", T(*cxy, z))
        H.lathe([(0, 30.0), (3.4, 30.0), (3.4, 31.0), (1.8, 32.6), (0, 33.0)], "hum_gunmetal", segs=12, M=T(*cxy, 0))
        G.add(_torus(3.35, 0.5, 12, 3), "glow_hum_cyan", T(*cxy, 28.6))
        H.add(_tube([(s * 5.6, 8.0, 21.0), (s * 6.8, 4.0, 19.8), (s * 6.0, -6.0, 18.4)], 0.6, sides=5), "hum_gunmetal")
    G.box((3.4, 0.5, 1.8), (0, -7.05, 23.8), "glow_hum_cyan")                                       # sensor lens
    head = H.finish(name + "_head", origin=(0, 0, PZ), parent=root, sharp_deg=40)
    G.finish(name + "_glow", origin=(0, 0, 0), parent=head)
    return root


# ==============================================================================================
# 4. Barricade
# ==============================================================================================
JERSEY = [(-8.0, 0.0), (8.0, 0.0), (8.0, 2.6), (5.4, 6.8), (3.0, 21.0), (-3.0, 21.0), (-5.4, 6.8), (-8.0, 2.6)]


def make_barricade(name="barricade_0", length=70):
    """Concrete jersey barrier segments with sandbags and a coil of barbed wire (along X)."""
    rng = random.Random(sum(map(ord, name)) + int(length))
    B = Builder()
    n = max(1, int(round(length / 36.0)))
    gap = 1.4
    seg = (length - (n - 1) * gap) / n
    tilt = math.degrees(math.atan2(2.4, 14.2))
    for i in range(n):
        xc = -length / 2 + seg / 2 + i * (seg + gap)
        yaw = rng.uniform(-3.5, 3.5)
        dy = rng.uniform(-1.2, 1.2)
        M = T(xc, dy, 0) @ R('Z', yaw)
        B.add(_prism(JERSEY, -seg / 2, seg / 2, bevel=0.7, bevel_bottom=True), "hum_concrete", M @ CYCLIC)
        zc = 16.5
        yc = -5.4 + (zc - 6.8) / 14.2 * 2.4
        _hazard(B, seg - 5.0, 4.6, M @ T(0, yc - 0.05, zc) @ R('X', 90 - tilt), pitch=4.2, depth=0.12)
        for sx in (-1, 1):
            B.add(_torus(1.4, 0.4, 8, 4), "hum_gunmetal_light", M @ T(sx * seg * 0.28, 0, 21.4) @ R('X', 90))
    # sandbags piled against the left end and on top of the right end
    x0 = -length / 2
    for k in range(3):
        _bag(B, (x0 + 6 + k * 11.0, -12.5, 3.0), 0, rng)
    for k in range(2):
        _bag(B, (x0 + 11.5 + k * 11.0, -12.0, 8.6), 0, rng)
    _bag(B, (x0 + 16.5, -11.8, 14.0), 0, rng)
    # barbed wire coil over the right part with three pickets
    xa, xb = -length / 2 + length * 0.42, length / 2 - 2.0
    r, zc = 4.2, 26.5
    turns = max(3, int((xb - xa) / 4.6))
    pts = []
    N = turns * 5
    for t in range(N + 1):
        a = 2 * math.pi * t / 5
        pts.append((xa + (xb - xa) * t / N, r * math.cos(a), zc + r * math.sin(a)))
    B.tube(pts, 0.32, "hum_wire", sides=3)
    for x in (xa + 2, (xa + xb) / 2, xb - 2):
        B.add(_limb((x, 0, 19.0), (x, 0, 31.5), 0.55, 0.45, 4), "hum_gunmetal")
    return B.finish(name, sharp_deg=40)


# ==============================================================================================
# 5. City skyline relief
# ==============================================================================================
#           cx    w    h    kind      mat           style
SKY_BACK = [(-196, 34, 128, "flat", "hum_city_a", "grid"),
            (-152, 38, 172, "broken", "hum_city_b", "ribbon"),
            (-106, 30, 150, "step", "hum_city_a", "grid"),
            (2, 34, 140, "flat", "hum_city_c", "ribbon"),
            (44, 40, 166, "step", "hum_city_b", "grid"),
            (94, 30, 186, "spire", "hum_city_a", "ribbon"),
            (142, 36, 138, "broken", "hum_city_c", "grid"),
            (194, 40, 160, "flat", "hum_city_b", "ribbon")]
SKY_FRONT = [(-198, 40, 66, "flat", "hum_city_c", "grid"),
             (-150, 30, 96, "broken", "hum_city_a", "grid"),
             (-98, 42, 58, "flat", "hum_city_b", "ribbon"),
             (-60, 24, 80, "step", "hum_city_c", "grid"),
             (-12, 36, 88, "flat", "hum_city_a", "grid"),
             (36, 40, 72, "broken", "hum_city_c", "ribbon"),
             (90, 32, 104, "flat", "hum_city_b", "grid"),
             (140, 44, 62, "flat", "hum_city_a", "ribbon"),
             (196, 34, 88, "step", "hum_city_c", "grid")]
SKY_TOWER_X = -40.0


def _sky_outline(rng, x0, x1, h, kind):
    """Top outline from right to left (the base corners are added by the caller)."""
    w = x1 - x0
    xc = (x0 + x1) / 2
    if kind == "flat":
        return [(x1, h), (x0, h)]
    if kind == "step":
        return [(x1, h * 0.72), (x1 - w * 0.16, h * 0.72), (x1 - w * 0.16, h * 0.88), (x1 - w * 0.3, h * 0.88),
                (x1 - w * 0.3, h), (x0 + w * 0.3, h), (x0 + w * 0.3, h * 0.88), (x0 + w * 0.16, h * 0.88),
                (x0 + w * 0.16, h * 0.72), (x0, h * 0.72)]
    if kind == "spire":
        return [(x1, h * 0.78), (x1 - w * 0.18, h * 0.84), (xc + w * 0.12, h * 0.92), (xc, h), (xc - w * 0.12, h * 0.92),
                (x0 + w * 0.18, h * 0.84), (x0, h * 0.78)]
    # broken: jagged, one deep bite
    n = 7
    pts = []
    bite = rng.randint(2, n - 2)
    for i in range(n + 1):
        x = x1 - w * i / n
        dz = rng.uniform(4, 14)
        if i == bite:
            dz = rng.uniform(24, 32)
        elif abs(i - bite) == 1:
            dz = rng.uniform(14, 20)
        pts.append((x, h - dz))
        if 0 < i < n:
            pts.append((x - w / n * 0.5, h - rng.uniform(0, 8) - (10 if abs(i - bite) <= 1 else 0)))
    return pts


class _Quads:
    """Batch of one-sided rectangles facing -Y (window panes), merged into one piece per material."""
    def __init__(self):
        self.bm = {}

    def add(self, cx, y, cz, w, h, m):
        bm = self.bm.setdefault(m, bmesh.new())
        vs = [bm.verts.new((cx - w / 2, y, cz - h / 2)), bm.verts.new((cx + w / 2, y, cz - h / 2)),
              bm.verts.new((cx + w / 2, y, cz + h / 2)), bm.verts.new((cx - w / 2, y, cz + h / 2))]
        bm.faces.new(vs)                                   # (+X) x (+Z) -> normal -Y

    def flush(self, B):
        for m, bm in self.bm.items():
            B.add(bm, m)
        self.bm = {}


def _top_at(outline, x):
    """Height of the top outline at x (outline from right to left; vertical steps take the min)."""
    best = None
    for (xa, za), (xb, zb) in zip(outline, outline[1:]):
        lo, hi = min(xa, xb), max(xa, xb)
        if lo - 1e-6 <= x <= hi + 1e-6:
            z = za if abs(xb - xa) < 1e-6 else za + (zb - za) * (x - xa) / (xb - xa)
            z = min(z, za, zb) if abs(xb - xa) < 1e-6 else z
            best = z if best is None else min(best, z)
    return best if best is not None else min(z for _, z in outline)


def make_skyline(name="skyline", width=440, height=190):
    """Standing city relief for the back of the table (front faces -Y, y -15..15).
    Children: skyline_glow (lit windows, warm), skyline_fire_glow (fires, orange)."""
    rng = random.Random(4242)
    kx, kz = width / 440.0, height / 190.0
    B = Builder()      # buildings + static details
    G = Builder()      # lit windows
    F = Builder()      # fire
    QB, QG, QF = _Quads(), _Quads(), _Quads()
    fronts = []
    plan = [(b, -14.0, -1.0) for b in SKY_FRONT] + [(b, 1.0, 14.0) for b in SKY_BACK]
    # front extents first (for window occlusion of the back row)
    for (cx, w, h, kind, m, style), y0, y1 in plan[:len(SKY_FRONT)]:
        fronts.append(((cx - w / 2) * kx, (cx + w / 2) * kx, h * kz))
    for (cx, w, h, kind, m, style), y0, y1 in plan:
        x0, x1, hh = (cx - w / 2) * kx, (cx + w / 2) * kx, h * kz
        front = y0 < 0
        yf = y0 + (rng.uniform(0, 3.0) if front else rng.uniform(0, 2.0))
        top = _sky_outline(rng, x0, x1, hh, kind)
        outline = [(x0, 0.0), (x1, 0.0)] + top
        B.add(_tri_prism(outline, yf, y1), m, XZ)
        # occlusion by the front row (back row only)
        def occl(xa, xb):
            if front:
                return 0.0
            return max([fh for fx0, fx1, fh in fronts if fx0 < xb and fx1 > xa] + [0.0])
        # windows
        cw, ch = (4.6, 6.0) if style == "grid" else (4.2, 5.4)
        ncol = int((x1 - x0 - 4.0) // cw)
        mx = (x1 - x0 - ncol * cw) / 2
        broken = kind == "broken"
        p_lit = 0.24 if broken else 0.44
        z = 6.0
        floor = 0
        while True:
            row_top = z + ch
            if row_top > hh:
                break
            any_row = False
            for c in range(ncol):
                xa = x0 + mx + c * cw
                xb = xa + cw
                tz = min(_top_at(top, xa + f * (xb - xa)) for f in (0.0, 0.25, 0.5, 0.75, 1.0))
                if row_top > tz - 3.0 or z < occl(xa, xb) + 2.0:
                    continue
                any_row = True
                if style == "grid":
                    ww, wh = 2.6, 3.4
                else:
                    ww, wh = 3.4, 2.8
                wx, wz = (xa + xb) / 2, z + ch / 2
                if broken and row_top > tz - 18 and rng.random() < 0.35:
                    QF.add(wx, yf - 0.2, wz, ww + 0.4, wh + 0.4, "glow_hum_fire")
                elif rng.random() < p_lit:
                    QG.add(wx, yf - 0.2, wz, ww, wh, "glow_windows")
                elif style == "grid" and rng.random() < 0.5:
                    QB.add(wx, yf - 0.12, wz, ww, wh, "hum_window_dark")
            if style == "ribbon" and any_row:
                # one dark glass band per floor, trimmed to the columns that are visible
                cols = [c for c in range(ncol)
                        if z + ch <= min(_top_at(top, x0 + mx + c * cw), _top_at(top, x0 + mx + (c + 1) * cw)) - 3.0
                        and z >= occl(x0 + mx + c * cw, x0 + mx + (c + 1) * cw) + 2.0]
                if cols:
                    xa, xb = x0 + mx + cols[0] * cw + 0.3, x0 + mx + (cols[-1] + 1) * cw - 0.3
                    QB.add((xa + xb) / 2, yf - 0.08, z + ch / 2, xb - xa, 3.6, "hum_window_dark")
            z += ch
            floor += 1
        # roof furniture / damage
        if kind == "flat":
            if rng.random() < 0.6:
                B.cyl(3.0, hh, hh + 5.0, "hum_city_c", segs=8, M=T(x0 + (x1 - x0) * rng.uniform(0.2, 0.4), (yf + y1) / 2, 0))
            B.box((8.0, 6.0, 3.0), (x1 - 7.0, (yf + y1) / 2, hh + 1.5), "hum_city_c")
            if rng.random() < 0.7:
                ax = x0 + (x1 - x0) * rng.uniform(0.55, 0.75)
                B.add(_limb((ax, (yf + y1) / 2, hh), (ax, (yf + y1) / 2, hh + rng.uniform(10, 18)), 0.6, 0.4, 4), "hum_gunmetal")
            if rng.random() < 0.5:                                       # rooftop defence light
                G.box((2.2, 0.6, 1.2), (x0 + 4.0, yf - 0.3, hh - 2.0), "glow_hum_cyan")
        elif kind == "spire":
            B.add(_limb((cx * kx, (yf + y1) / 2, hh), (cx * kx, (yf + y1) / 2, min(hh + 12.0, height - 2.0)), 0.8, 0.3, 4), "hum_gunmetal")
            B.sphere(1.2, (cx * kx, yf + 4.0, hh - 3.0), "glow_hum_red", u=6, v=4)
        elif broken:
            # exposed girders sticking out of the break
            for k in range(4):
                gx = x0 + (x1 - x0) * (0.15 + 0.23 * k) + rng.uniform(-2, 2)
                gz = _top_at(top, gx)
                ln = rng.uniform(5, 11)
                ang = rng.uniform(-25, 25)
                B.add(_box(1.0, 1.0, ln), "hum_gunmetal", T(gx, yf + 2.0, gz + ln / 2 - 1.0) @ R('Y', ang))
            # fire on the break + smoke drifting right
            hot = sorted(top[1:-1], key=lambda p: p[1])[:2]
            for (fx, fz) in hot:
                fx = min(max(fx, x0 + 4), x1 - 4)
                fz = _top_at(top, fx)
                for (dx, dz, rx, rz) in ((0, 1.2, 3.4, 5.4), (2.6, 0.4, 2.2, 3.6), (-2.4, 0.2, 2.0, 3.0)):
                    F.add(_sphere(1.0, 8, 5), "glow_hum_fire", T(fx + dx, yf + 2.5, fz + dz) @ S(rx, 2.6, rz))
                sx, sz = fx, fz + 6.0
                r = 3.2
                for k in range(5):
                    if sz + r > height - 1.0:
                        break
                    B.add(_sphere(1.0, 8, 5), "hum_smoke", T(sx, yf + 4.5 + k * 0.4, sz) @ S(r * 1.2, min(r, 4.0), r))
                    sx += 3.0 + k * 0.8
                    sz += r * 1.1
                    r += 0.9
    # ---------------------------------------------------------------- broadcast mast (square lattice, guyed)
    tx, ty = SKY_TOWER_X * kx, 3.0
    Mt = T(tx, ty, 0)
    top_z = 150.0 * kz
    B.box((20.0, 12.0, 10.0), (tx, ty, 5.0), "hum_city_c", bevel=0.8)
    B.lathe([(10.0, 10.0), (3.0, top_z)], "hum_gunmetal", segs=4, M=Mt @ R('Z', 45))
    rad = lambda z: 10.0 + (3.0 - 10.0) * (z - 10.0) / (top_z - 10.0)
    for k in range(10):                                            # lattice collars
        z = 22.0 + k * (top_z - 30.0) / 9
        hw = rad(z) / math.sqrt(2) + 0.6
        B.box((2 * hw, 2 * hw, 1.0), (tx, ty, z), "hum_gunmetal_light")
    for k in range(9):                                             # diagonal bracing on the front face
        za, zb = 22.0 + k * (top_z - 30.0) / 9, 22.0 + (k + 1) * (top_z - 30.0) / 9
        ha, hb = rad(za) / math.sqrt(2), rad(zb) / math.sqrt(2)
        sgn = 1 if k % 2 else -1
        B.add(_limb((tx - sgn * ha, ty - ha - 0.3, za), (tx + sgn * hb, ty - hb - 0.3, zb), 0.35, 0.35, 3), "hum_gunmetal_light")
    pz = 124.0 * kz                                                # equipment pod
    B.box((20.0, 12.0, 12.0), (tx, ty, pz), "hum_city_b", bevel=0.8)
    B.box((22.0, 13.0, 1.4), (tx, ty, pz + 6.6), "hum_gunmetal")
    B.box((22.0, 13.0, 1.4), (tx, ty, pz - 6.6), "hum_gunmetal")
    QG.add(tx, ty - 6.1, pz + 1.2, 16.0, 3.0, "glow_windows")
    QG.add(tx, ty - 6.1, pz - 3.0, 16.0, 1.2, "glow_hum_cyan")
    for s, dz in ((-1, 96.0), (1, 108.0)):                         # microwave dishes
        dz *= kz
        B.box((7.0, 1.6, 1.6), (tx + s * 5.0, ty, dz), "hum_gunmetal")
        B.add(_lathe([(0, 0), (4.6, 0), (4.6, 0.7), (0, 2.0)], 10), "hum_dish", T(tx + s * 8.5, ty - 1.0, dz) @ R('X', 90))
    B.add(_limb((tx, ty, top_z), (tx, ty, height - 3.0), 0.9, 0.4, 5), "hum_gunmetal")
    B.sphere(1.4, (tx, ty, height - 2.0), "glow_hum_red", u=8, v=5)
    for z in (top_z, 80.0 * kz):
        B.sphere(1.0, (tx, ty - rad(z) / math.sqrt(2) - 0.8, z), "glow_hum_red", u=6, v=4)
    for s in (-1, 1):                                              # guy wires
        for zg, xg in ((70.0 * kz, 26.0), (118.0 * kz, 36.0)):
            B.add(_limb((tx, ty + 0.5, zg), (tx + s * xg, ty + 0.5, 10.5), 0.28, 0.28, 3), "hum_wire")
    QB.flush(B)
    QG.flush(G)
    QF.flush(F)
    root = B.finish(name, sharp_deg=40)
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root)
    F.finish(name + "_fire_glow", origin=(0, 0, 0), parent=root)
    return root


# ==============================================================================================
# 6. Mobile radar trailer
# ==============================================================================================
RADAR_PIVOT = (0.0, 13.0, 38.5)


def make_radar(name="radar"):
    """Radar trailer (~60 mm). Child radar_dish: pivot on top of the mast, rotates about Z."""
    rng = random.Random(3)
    B = Builder()
    B.box((24.0, 40.0, 3.0), (0, 5.0, 10.5), "hum_olive_dark", bevel=0.5)                  # bed y -15..25, z 9..12
    B.box((14.0, 36.0, 3.0), (0, 5.0, 7.5), "hum_gunmetal")                                # chassis rails
    for s in (-1, 1):
        for wy in (5.0, 17.0):
            B.cyl(6.0, -2.0, 2.0, "hum_track", segs=14, M=T(s * 14.6, wy, 6.0) @ R('Y', 90))
            B.cyl(3.0, 2.0, 2.6, "hum_gunmetal_light", segs=10, M=T(s * 14.6, wy, 6.0) @ R('Y', 90 * s))
        B.box((5.4, 26.0, 1.2), (s * 14.6, 11.0, 13.2), "hum_olive", bevel=0.3)              # fender
        _hazard(B, 5.0, 2.4, T(s * 14.6, -2.05, 12.6) @ FACE_FRONT, pitch=2.4, depth=0.1)
        # stabiliser jacks
        for jy in (-12.0, 23.0):
            B.add(_limb((s * 11.5, jy, 9.5), (s * 17.5, jy, 1.2), 0.9, 0.9, 6), "hum_gunmetal_light")
            B.cyl(2.4, 0, 1.0, "hum_gunmetal", segs=8, M=T(s * 17.8, jy, 0))
    # tow bar, coupling ring, jockey wheel
    for s in (-1, 1):
        B.add(_limb((s * 7.0, -15.0, 10.0), (0, -27.0, 8.6), 0.9, 0.9, 6), "hum_olive_dark")
    B.add(_torus(1.6, 0.55, 10, 4), "hum_gunmetal_light", T(0, -28.4, 8.6))
    B.cyl(0.9, 1.8, 9.0, "hum_gunmetal_light", segs=6, M=T(0, -22.0, 0))
    B.cyl(1.8, -0.8, 0.8, "hum_track", segs=8, M=T(0, -22.0, 1.8) @ R('Y', 90))
    # generator (front)
    B.box((16.0, 12.0, 8.0), (0, -7.0, 16.0), "hum_gunmetal_light", bevel=0.6)
    for k in range(4):
        B.box((14.0, 0.5, 0.8), (0, -13.2, 13.5 + k * 1.6), "hum_gunmetal")
    B.add(_tube([(5.0, -3.0, 20.0), (5.0, -3.0, 24.0), (6.5, -4.5, 25.5)], 0.6, sides=5), "hum_gunmetal")
    # equipment shelter (rear)
    B.box((22.0, 22.0, 15.0), (0, 13.0, 19.5), "hum_olive", bevel=0.9)                    # y 2..24, z 12..27
    B.box((7.0, 0.6, 11.0), (-5.0, 1.75, 18.6), "hum_olive_dark", bevel=0.2)               # door
    B.box((1.4, 0.8, 0.6), (-2.4, 1.4, 18.6), "hum_gunmetal_light")
    B.box((7.0, 0.5, 4.0), (5.0, 1.8, 21.5), "hum_gunmetal")
    B.box((5.6, 0.4, 2.6), (5.0, 1.45, 21.5), "glow_hum_cyan")                             # status screen
    _hazard(B, 20.0, 2.0, T(0, 1.95, 13.4) @ FACE_FRONT, pitch=2.8, depth=0.1)
    for k in range(3):
        B.box((0.6, 14.0, 6.0), (11.15, 13.0, 18.0), "hum_olive_dark", M=T(0, 0, 0) @ T(0, -4.0 + k * 4.0, 0) @ S(1, 0.2, 1))
    _label(B, "R2", 3.0, T(11.05, 13.0, 23.6) @ R('Z', 90) @ R('X', 90), depth=0.25, max_points=50)
    # mast
    B.box((7.0, 7.0, 1.6), (0, 13.0, 27.8), "hum_gunmetal", bevel=0.3)
    B.cyl(2.6, 28.5, 33.0, "hum_gunmetal_light", segs=10, M=T(0, 13.0, 0))
    B.cyl(2.0, 33.0, 37.4, "hum_gunmetal_light", segs=10, M=T(0, 13.0, 0))
    B.cyl(3.0, 37.4, 38.5, "hum_gunmetal", segs=12, M=T(0, 13.0, 0))
    B.sphere(0.9, (9.0, 21.0, 28.0), "glow_hum_amber", u=6, v=4)
    root = B.finish(name, sharp_deg=40)

    # dish (world mm, pivot on the mast top)
    D = Builder()
    px, py, pz = RADAR_PIVOT
    D.cyl(3.4, pz, pz + 2.0, "hum_gunmetal", segs=12, M=T(px, py, 0))
    D.box((3.0, 3.0, 8.0), (0, py + 1.0, pz + 5.5), "hum_olive_dark", bevel=0.4)
    C = Vector((0.0, py - 2.6, pz + 9.6))
    Md = T(*C) @ R('X', 75)                                     # dish axis +Z -> forward (-Y) and 15 deg up
    f4 = 36.0
    rs = (0.0, 3.0, 6.0, 9.0, 11.5, 13.0)
    prof = [(r, r * r / f4 - 0.9) for r in rs] + [(r, r * r / f4) for r in reversed(rs)]
    D.add(_lathe(prof, 16, cap_start=False, cap_end=False), "hum_dish", Md)
    D.add(_torus(13.0, 0.6, 16, 4), "hum_gunmetal", Md @ T(0, 0, 13.0 * 13.0 / f4 - 0.4))
    focus = Md @ Vector((0, 0, 9.0))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        D.add(_limb(Md @ Vector((12.4 * math.cos(a), 12.4 * math.sin(a), 4.3)), focus, 0.35, 0.35, 4), "hum_gunmetal")
    D.add(_lathe([(0, 8.0), (1.4, 8.0), (1.0, 10.4), (0, 10.4)], 8), "hum_gunmetal_light", Md)
    D.add(_lathe([(0, 10.3), (0.9, 10.3), (0.9, 10.7), (0, 10.7)], 8), "glow_hum_cyan", Md)
    D.add(_box(6.0, 6.0, 3.0, 0.5), "hum_gunmetal", Md @ T(0, 0, -2.2))               # back hub
    D.add(_box(4.0, 5.0, 4.0, 0.5), "hum_olive_dark", Md @ T(0, 4.0, -4.6))           # counterweight / receiver
    _finish_at(D, name + "_dish", RADAR_PIVOT, parent=root, sharp_deg=40)
    return root


# ==============================================================================================
# 7. Shield emitter post
# ==============================================================================================
def make_shield_post(name="shield_0"):
    """Slim emitter post (~47 mm, r <= 6 below z 30). Child <name>_glow: cyan ring, pivot at its centre."""
    B = Builder()
    B.lathe([(0, 0), (6.0, 0), (6.0, 1.4), (4.4, 3.0), (2.6, 3.8), (2.4, 30.0), (2.2, 36.0), (3.6, 37.4),
             (5.2, 39.2), (5.2, 40.2), (2.2, 40.6), (2.2, 43.4), (5.0, 43.8), (5.0, 44.8), (3.2, 46.4), (1.0, 47.2), (0, 47.4)],
            "hum_gunmetal", segs=10)
    prof = [(2.25, 12.0), (2.65, 12.0), (2.65, 14.0), (2.65, 16.0), (2.65, 18.0), (2.65, 20.0), (2.25, 20.0), (2.25, 12.0)]
    _lathe_bands(B, prof, ["hum_hazard_yellow", "hum_hazard_yellow", "hum_hazard_black", "hum_hazard_yellow",
                           "hum_hazard_black", "hum_hazard_black", "hum_hazard_black"], 10)
    root = B.finish(name, sharp_deg=40)
    G = Builder()
    G.add(_torus(3.5, 1.25, 12, 6), "glow_hum_cyan")
    G.finish(name + "_glow", origin=(0, 0, 42.0), parent=root)
    return root


HUMAN_ASSETS = {
    "tankpit": make_tank_bunker,
    "trooper_aim": lambda name="trooper_0": make_soldier_future(name, "aim"),
    "trooper_kneel": lambda name="trooper_1": make_soldier_future(name, "kneel"),
    "trooper_wave": lambda name="trooper_2": make_soldier_future(name, "wave"),
    "trooper_radio": lambda name="trooper_3": make_soldier_future(name, "radio"),
    "laser": make_laser_cannon,
    "barricade": make_barricade,
    "skyline": make_skyline,
    "radar": make_radar,
    "shield": make_shield_post,
}

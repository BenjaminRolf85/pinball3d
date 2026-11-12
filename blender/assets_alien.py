"""ERDABWEHR (Earth Defense): toys for the ALIEN side of the third table.

Same conventions as assets.py: mm in code, metres in meshes, +Z up, playfield z=0,
front faces -Y (the player), animated parts are children `{name}_{part}` with their
object origin on the pivot. Materials whose name starts with "glow_" are emissive.
Alien tech = acid green + violet glow on gunmetal / lilac hulls.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import materials
import assets as A
from assets import Builder, T, R, S, MM, _lathe, _torus, _prism, _box, _sphere, _limb, _aim, tri_count, bounds_mm  # noqa: F401

materials.SPECS.update({
    "alien_hull":        ((0.13, 0.12, 0.17),    1.0, 0.30, None),
    "alien_hull_light":  ((0.60, 0.58, 0.70),    1.0, 0.22, None),
    "alien_panel":       ((0.025, 0.02, 0.035),  0.5, 0.40, None),
    "alien_armor":       ((0.22, 0.21, 0.28),    0.9, 0.30, None),
    "alien_violet":      ((0.30, 0.05, 0.56),    0.35, 0.28, None),
    "alien_glass":       ((0.05, 0.02, 0.09),    0.2, 0.04, None),
    "alien_skin":        ((0.32, 0.47, 0.29),    0.0, 0.42, None),
    "alien_suit":        ((0.05, 0.035, 0.08),   0.25, 0.32, None),
    "alien_eye":         ((0.004, 0.004, 0.006), 0.0, 0.04, None),
    "glow_alien_green":  ((0.0, 0.0, 0.0),       0.0, 0.50, (0.30, 1.00, 0.04)),
    "glow_alien_violet": ((0.0, 0.0, 0.0),       0.0, 0.50, (0.50, 0.08, 1.00)),
    "glow_alien_dome":   ((0.04, 0.0, 0.08),     0.2, 0.10, (0.55, 0.20, 1.00)),
    "glow_beam":         ((0.20, 0.60, 0.05),    0.0, 0.50, (0.30, 1.00, 0.10)),
})

FACE_FRONT = R('X', 90)        # prism/lathe +Z -> -Y (faces the player); prism (x, y) -> world (x, z)
CYCLIC = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # (u, v, w) -> (x=w, y=u, z=v)


def _tweak(name, strength=None, alpha=None):
    """Adjust a library material after creation (emission strength, alpha blending)."""
    m = materials.mat(name)
    b = materials._principled(m)
    if strength is not None:
        b.inputs["Emission Strength"].default_value = strength
    if alpha is not None:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
        m.diffuse_color = (*m.diffuse_color[:3], alpha)
    return m


def _bands(B, profile, mats, segs, M=None):
    """Open lathe; band i (profile[i] -> profile[i+1]) gets mats[i]."""
    bm = _lathe(profile, segs, cap_start=False, cap_end=False)
    bm.faces.ensure_lookup_table()
    # _lathe creates the faces band after band (segs faces each, single-vertex ends included)
    k = 0
    for i in range(len(profile) - 1):
        for _ in range(segs):
            bm.faces[k].material_index = B.mi(mats[i])
            k += 1
    B.add(bm, None, M)


def _sector(r0, r1, z0, z1, a0, a1, n=4):
    """Closed annular sector solid (angles in degrees)."""
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        c, s = math.cos(a), math.sin(a)
        rows.append([bm.verts.new((r * c, r * s, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for i in range(n):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _shift(B, pivot):
    bmesh.ops.translate(B.bm, vec=(-pivot[0], -pivot[1], -pivot[2]), verts=B.bm.verts)


def _scale(B, k):
    if abs(k - 1.0) > 1e-6:
        bmesh.ops.scale(B.bm, vec=(k, k, k), verts=B.bm.verts)


def _polar(r, deg):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a))


def _on_slope(B, p0, p1, size, deg, m, lift=0.25):
    """Radial box lying on the conical surface between profile points p0=(r,z) and p1=(r,z)."""
    (ra, za), (rb, zb) = p0, p1
    ang = math.degrees(math.atan2(zb - za, rb - ra))
    rm, zm = (ra + rb) / 2, (za + zb) / 2
    nr, nz = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
    if nz < 0:
        nr, nz = -nr, -nz
    B.box(size, (0, 0, 0), m, M=R('Z', deg) @ T(rm + nr * lift, 0, zm + nz * lift) @ R('Y', -ang))


# ==============================================================================================
# 1. Mothership (hovers over the back of the playfield)
# ==============================================================================================
def make_mothership(name="mothership", r=105):
    """Origin: centre of the ship's underside (z=0). ~70 mm tall incl. dome and spire.
    Children: {name}_ring (rim light ring, spins about Z, origin (0,0,17.5)),
    {name}_glow (ventral tractor emitter, origin (0,0,14.6)),
    {name}_beam (open cone z 0 .. -150, glow_beam, origin (0,0,0))."""
    k = r / 105.0
    _tweak("glow_alien_dome", strength=1.6)
    _tweak("glow_beam", strength=2.5, alpha=0.35)
    B = Builder()
    SEG = 64
    hull = [(0, 15.0), (30, 15.0), (30, 4.0), (35, 0.0), (56, 0.0), (60, 1.6), (84, 6.0), (98, 10.6), (104, 14.0),
            (105, 15.0), (105, 20.0), (101.5, 23.0), (90, 26.2), (88.5, 26.6), (70, 31.6), (66, 32.6), (66, 37.0),
            (62, 39.0), (46, 41.5), (41, 42.0)]
    mats = ["alien_panel", "glow_alien_violet", "alien_hull_light", "alien_hull", "alien_hull_light", "alien_hull",
            "alien_panel", "alien_hull", "alien_hull_light", "alien_panel", "alien_hull_light", "alien_hull", "alien_panel",
            "alien_hull", "alien_hull_light", "alien_panel", "alien_hull_light", "alien_hull", "alien_panel"]
    _bands(B, hull, mats, SEG)
    # command tower: collar, window band, glowing dome, spire
    tower = [(42, 41.0), (42, 44.5), (37, 46.5), (36, 50.5), (33, 52.0)]
    _bands(B, tower, ["alien_hull_light", "alien_hull_light", "alien_panel", "alien_hull_light"], 48)
    dome = [(33.0 * math.cos(math.radians(a)), 52.0 + 11.5 * math.sin(math.radians(a))) for a in (0, 18, 36, 54, 72)] + [(0, 63.5)]
    _bands(B, dome, ["glow_alien_dome"] * (len(dome) - 1), 48)
    B.torus(33.4, 1.0, "alien_hull_light", segs=48, sides=6, M=T(0, 0, 52.2))
    for i in range(16):                                            # tower windows
        a = i * 22.5 + 11.25
        B.box((4.6, 1.2, 2.6), (0, 0, 0), "glow_alien_green", M=R('Z', a) @ T(36.4, 0, 48.6) @ R('Z', 90) @ R('X', -14))
    B.cyl(1.1, 62.5, 67.5, "chrome_dark", segs=8, cap_start=False)
    B.sphere(1.8, (0, 0, 68.0), "glow_alien_green", u=8, v=6)
    B.torus(5.0, 0.7, "alien_hull_light", segs=16, sides=4, M=T(0, 0, 63.0))
    # step wall windows (deck at r 66)
    for i in range(32):
        a = i * 11.25
        if i % 4 == 3:
            continue
        B.box((1.0, 5.4, 2.6), (0, 0, 0), "glow_alien_violet", M=R('Z', a) @ T(66.2, 0, 34.8))
    # panel lines on the upper slopes
    for i in range(24):
        _on_slope(B, (88.5, 26.6), (70, 31.6), (18.0, 1.0, 0.7), i * 15, "alien_panel")
        _on_slope(B, (101.5, 23.0), (90, 26.2), (11.0, 1.0, 0.7), i * 15 + 7.5, "alien_panel")
    # three swept fins (none in front of the dome)
    fin = [(46, 41.0), (66, 32.0), (86, 26.5), (84, 30.5), (70, 39.5), (54, 47.5), (46, 47.5)]
    for a in (90, 210, 330):
        B.prism(fin, -1.6, 1.6, "alien_violet", bevel=0.5, M=R('Z', a) @ FACE_FRONT)
        B.prism([(66, 36.6), (80, 31.4), (79, 32.6), (66, 38.0)], -1.9, 1.9, "glow_alien_green", M=R('Z', a) @ FACE_FRONT)
    # hull lights on the dark band of the lower slope (face down / out)
    d = Vector((14.0, 4.6)).normalized()
    out = Vector((d.y, -d.x))
    for i in range(18):
        a = i * 20
        p = Vector((91.0, 6.0 + 7.0 / 14.0 * 4.6)) + out * 0.7
        x, y = _polar(p.x, a)
        B.sphere(2.3, (x, y, p.y), "glow_alien_green" if i % 2 == 0 else "glow_alien_violet", u=8, v=4)
    # six ventral turrets with green lenses
    for i in range(6):
        x, y = _polar(70.0, i * 60 + 30)
        B.lathe([(3.2, 0.6), (5.5, 1.4), (7.0, 3.0), (7.0, 5.0)], "alien_hull_light", segs=12, M=T(x, y, 0),
                cap_start=False, cap_end=False)
        B.lathe([(0, 0.6), (3.2, 0.6)], "glow_alien_green", segs=12, M=T(x, y, 0), cap_start=False, cap_end=False)
    # bay mouth: dark spokes inside the violet wall
    for i in range(8):
        B.box((4.0, 2.0, 10.0), (0, 0, 0), "alien_panel", M=R('Z', i * 45) @ T(29.4, 0, 9.5))
    _scale(B, k)
    root = B.finish(name, sharp_deg=40)

    # spinning rim ring: alternating lit / unlit segments, two violet markers
    RZ = 17.5
    G = Builder()
    n = 24
    for i in range(n):
        a0, a1 = i * 15 + 0.8, (i + 1) * 15 - 0.8
        if i % 2 == 0:
            m = "glow_alien_violet" if i in (0, 8) else "glow_alien_green"
            G.add(_sector(103.5, 109.0, 14.2 - RZ, 20.8 - RZ, a0, a1, 4), m)
        else:
            G.add(_sector(103.5, 108.0, 13.4 - RZ, 21.6 - RZ, a0, a1, 4), "alien_hull_light")
            G.add(_sector(107.9, 108.5, 15.8 - RZ, 19.2 - RZ, a0 + 3, a1 - 3, 2), "alien_panel")
    _scale(G, k)
    G.finish(name + "_ring", origin=(0, 0, RZ * k), parent=root, sharp_deg=30)

    # ventral tractor emitter
    EZ = 14.6
    E = Builder()
    E.torus(24.0, 2.2, "glow_alien_green", segs=32, sides=6, M=T(0, 0, -1.2))
    E.lathe([(0, -3.6), (7, -3.1), (13, -1.7), (17.5, 0.4)], "glow_alien_green", segs=32, cap_start=False, cap_end=False)
    for i in range(6):
        E.box((5.0, 1.6, 2.0), (0, 0, 0), "alien_panel", M=R('Z', i * 60 + 30) @ T(20.5, 0, -0.6))
    _scale(E, k)
    E.finish(name + "_glow", origin=(0, 0, EZ * k), parent=root, sharp_deg=30)

    # tractor beam (faded by the renderer)
    Bm = Builder()
    Bm.lathe([(30.0, -150.0), (26.0, -75.0), (22.0 * k, 0.0)], "glow_beam", segs=24, cap_start=False, cap_end=False)
    Bm.finish(name + "_beam", origin=(0, 0, 0), parent=root, smooth=True, sharp_deg=60)
    return root


# ==============================================================================================
# 2. Saucer pop bumper (same contract as assets.make_bumper)
# ==============================================================================================
def make_saucer_bumper(name="bumper_0"):
    """Footprint r 26 (body <= 26 for z 5..30, apron r 30 at z 3..5 like the original).
    Children: {name}_ring (chrome skirt, origin z=24), {name}_cap (saucer, origin z=38, glows)."""
    B = Builder()
    B.lathe([(22.5, 3), (30, 3), (30, 4.4), (29.2, 5), (22.5, 5)], "alien_panel", segs=28, cap_start=False, cap_end=False)
    # twelve-sided landing plinth
    _bands(B, [(24.4, 0), (24.4, 6.0), (22.2, 8.5), (22.2, 26.0), (19.8, 30.0), (13.0, 30.0)],
           ["alien_armor", "alien_hull_light", "alien_armor", "alien_hull_light", "alien_panel"], 12, M=R('Z', 15))
    for z in (8.0, 26.0):
        B.lathe([(20.8, z - 1.0), (23.2, z - 1.0), (23.2, z + 1.0), (20.8, z + 1.0)], "chrome_dark", segs=12,
                M=R('Z', 15), cap_start=False, cap_end=False)
    # three landing legs with foot pads (max radius 25.9)
    for i in range(3):
        a = i * 120 + 90
        top = Vector((*_polar(17.5, a), 28.5))
        foot = Vector((*_polar(23.0, a), 3.2))
        B.add(_limb(top, foot, 2.4, 2.0, 8), "alien_violet")
        B.sphere(3.0, tuple(top), "chrome_dark", u=6, v=4)
        B.cyl(2.9, 0.0, 3.2, "chrome_dark", segs=10, M=T(*_polar(23.0, a), 0), cap_start=False)
        B.box((2.0, 4.0, 8.0), (0, 0, 0), "alien_panel", M=R('Z', a) @ T(22.2, 0, 17.0))
    # glowing slots between the legs
    for i in range(3):
        a = i * 120 + 150
        B.box((1.2, 3.0, 13.0), (0, 0, 0), "glow_alien_green", M=R('Z', a) @ T(21.9, 0, 17.0))
    B.cyl(13, 30, 38, "alien_hull_light", segs=16, cap_start=False, cap_end=False)
    B.torus(13.2, 0.9, "glow_alien_violet", segs=12, sides=4, M=T(0, 0, 34.0))
    root = B.finish(name)

    G = Builder()
    G.torus(31, 2, "chrome", segs=28, sides=6)
    for i in range(6):
        G.box((3.4, 2.4, 2.4), (0, 0, 0), "alien_violet", M=R('Z', i * 60) @ T(31.0, 0, 0))
    G.finish(name + "_ring", origin=(0, 0, 24), parent=root)

    C = Builder()
    _bands(C, [(13.0, 0.0), (24.0, 3.6), (33.0, 7.4), (34.0, 8.4), (34.0, 10.6), (31.0, 12.2), (24.0, 13.6), (17.0, 14.8)],
           ["alien_hull", "alien_hull_light", "alien_hull_light", "alien_panel", "alien_hull_light", "alien_hull", "alien_hull_light"], 28)
    C.lathe([(17.0, 14.6), (16.0, 17.0), (12.5, 19.8), (6.5, 21.6), (0, 22.0)], "glow_alien_violet", segs=20,
            cap_start=False, cap_end=False)
    C.torus(17.0, 0.8, "chrome", segs=20, sides=4, M=T(0, 0, 14.8))
    for i in range(8):                                             # rim lights
        x, y = _polar(34.3, i * 45 + 22.5)
        C.sphere(2.0, (x, y, 9.5), "glow_alien_green", u=6, v=4)
    for i in range(8):                                             # panel ribs on the upper deck
        _on_slope(C, (31.0, 12.2), (24.0, 13.6), (7.0, 1.0, 0.6), i * 45, "alien_panel")
    C.finish(name + "_cap", origin=(0, 0, 38), parent=root)
    return root


# ==============================================================================================
# 3. Alien war-robot (walker); the ball rolls between its legs
# ==============================================================================================
ROBOT_LEG_X = 24.0
ROBOT_LEG_R = 9.0          # each leg below z 40 stays within this radius around (+-24, 0)
ROBOT_LEG_Z = 40.0
ROBOT_GAP = (15.0, 40.0, 34.0)   # |x| < 15, |y| < 40, z < 34 is empty


def _claw(B, wrist, fwd, up, m="chrome_dark", reach=1.0):
    """Three-fingered claw at `wrist`, pointing along `fwd`."""
    fwd, up = Vector(fwd).normalized(), Vector(up).normalized()
    side = fwd.cross(up).normalized()
    for k in range(3):
        a = math.radians(90 + 120 * k)
        off = up * math.sin(a) + side * math.cos(a)
        base = Vector(wrist) + off * 2.6 + fwd * 1.0
        mid = base + fwd * 6.5 * reach + off * 3.2
        tip = mid + fwd * 5.5 * reach - off * 3.4
        B.add(_limb(base, mid, 1.9, 1.5, 6), m)
        B.sphere(1.6, tuple(mid), m, u=6, v=4)
        B.add(_limb(mid, tip, 1.5, 0.3, 6), m)


def make_robot(name="robot"):
    """Alien walker ~165 mm tall, facing -Y; its right side is -X.
    Root: legs/feet (posts at x=+-24), pelvis. Children: {name}_torso (pivot hip (0,0,75))
    > {name}_head (pivot neck (0,-1,126)) > {name}_eye_glow (eye centre);
    {name}_torso > {name}_arm_R (pivot right shoulder (-31,0,118)) > {name}_gun_glow (muzzle)."""
    X = ROBOT_LEG_X
    B = Builder()
    for s in (-1, 1):
        x = s * X
        B.lathe([(8.4, 0.0), (8.4, 2.2), (7.0, 4.0), (0, 4.0)], "alien_panel", segs=12, M=T(x, 0, 0), cap_end=False)
        for a in (-90, -130, -50, 90):                              # claw toes + back spur
            dv = Vector((*_polar(1.0, a), 0.0))
            p0 = Vector((x, 0, 3.4)) + dv * 3.2
            p1 = Vector((x, 0, 1.4)) + dv * 7.0
            B.add(_limb(p0, p1, 1.9, 1.0, 6), "alien_armor")
            B.add(_limb(p1, p1 + dv * 1.5 - Vector((0, 0, 1.2)), 1.0, 0.15, 6), "chrome_dark")
        B.sphere(5.2, (x, 0, 6.5), "chrome_dark", u=10, v=6)                         # ankle
        B.cyl(3.4, 6.5, 20.0, "chrome", segs=10, M=T(x, 0, 0), cap_start=False, cap_end=False)   # piston
        B.lathe([(6.0, 16.5), (8.3, 20.5), (8.3, 33.0), (7.4, 39.0), (5.5, 40.8)], "alien_armor", segs=8,
                M=T(x, 0, 0) @ R('Z', 22.5))                                         # octagonal shin
        B.box((5.0, 1.0, 13.0), (x, -7.35, 27.5), "alien_violet", bevel=0.3)         # shin plate
        B.box((1.4, 0.6, 7.0), (x, -7.95, 27.5), "glow_alien_green")
        B.sphere(9.2, (x, 0, 49.0), "chrome_dark", u=14, v=10)                       # knee
        B.prism([(0, -8.0), (6.6, -3.0), (6.6, 6.5), (-6.6, 6.5), (-6.6, -3.0)], 5.2, 9.6, "alien_violet", bevel=1.0,
                M=T(x, 0, 50.5) @ FACE_FRONT)                                       # knee shield
        B.box((1.4, 0.6, 5.0), (x, -9.9, 52.5), "glow_alien_green")
        hip = Vector((s * 18.0, 2.0, 71.0))
        knee = Vector((x, 0.0, 49.0))
        B.add(_limb(knee, hip, 7.6, 8.6, 10), "alien_armor")                         # thigh
        mid = knee.lerp(hip, 0.5) + Vector((s * 6.4, 0, 0))
        B.box((3.0, 12.0, 16.0), tuple(mid), "alien_violet", bevel=1.0, M=R('Y', s * -18))   # thigh plate
        B.sphere(8.4, tuple(hip), "chrome_dark", u=12, v=8)                          # hip joint
        Mt = T(s * 27.5, 1.0, 72.0) @ R('Y', s * 12)
        B.box((5.0, 20.0, 18.0), (0, 0, 0), "alien_violet", bevel=1.5, M=Mt)                 # tasset
        B.box((0.6, 14.0, 2.0), (0, 0, 0), "glow_alien_violet", M=Mt @ T(s * 2.55, 0, -4.0))
    B.box((30.0, 22.0, 15.0), (0, 2.0, 71.0), "alien_armor", bevel=3.0)              # pelvis
    B.box((12.0, 14.0, 10.0), (0, -1.0, 61.0), "alien_violet", bevel=2.5)            # crotch armour
    B.box((8.0, 0.8, 1.6), (0, -8.3, 61.0), "glow_alien_green")
    root = B.finish(name, sharp_deg=40)

    # ------------------------------------------------------------------ torso
    PT = (0.0, 0.0, 75.0)
    Tb = Builder()
    Tb.cyl(9.5, 74.0, 88.0, "chrome_dark", segs=16, cap_start=False, cap_end=False)
    for z in (79.0, 84.0):
        Tb.torus(9.7, 1.0, "alien_panel", segs=16, sides=4, M=T(0, 0, z))
    chest = [(-14, 83), (14, 83), (25, 100), (27, 112), (24, 126), (-24, 126), (-27, 112), (-25, 100)]
    Tb.prism(chest, -16, 14, "alien_armor", bevel=3.0, M=FACE_FRONT, bevel_bottom=True)
    plate = [(-10, 88), (10, 88), (19, 101), (20, 111), (17, 121), (-17, 121), (-20, 111), (-19, 101)]
    Tb.prism(plate, 13.0, 15.4, "alien_violet", bevel=0.8, M=FACE_FRONT, cap_bottom=False)
    Tb.torus(5.6, 1.3, "chrome", segs=20, sides=6, M=T(0, -15.6, 106.0) @ FACE_FRONT)
    Tb.lathe([(4.8, 0.0), (4.0, 0.9), (0, 1.5)], "glow_alien_violet", segs=20, M=T(0, -15.2, 106.0) @ FACE_FRONT,
             cap_start=False)
    for sx in (-1, 1):                                               # chevron vent + rivets
        Tb.box((8.0, 0.8, 1.7), (sx * 3.5, -15.6, 95.5), "glow_alien_green", M=R('Y', -sx * 28))
        for x, z in ((15.0, 117.0), (14.0, 93.0)):
            Tb.sphere(1.1, (sx * x, -15.4, z), "chrome", u=6, v=4)
    Tb.box((30.0, 12.0, 30.0), (0, 19.0, 108.0), "alien_panel", bevel=2.0)            # back reactor
    for sx in (-1, 1):
        Tb.lathe([(3.0, 108.0), (3.0, 133.0), (2.2, 133.0), (2.2, 131.5)], "chrome_dark", segs=10,
                 M=T(sx * 9.0, 22.0, 0), cap_end=False)
        Tb.lathe([(2.2, 131.5), (0, 131.5)], "glow_alien_green", segs=10, M=T(sx * 9.0, 22.0, 0), cap_start=False)
    # left shoulder (+X), shoulder-mounted plasma launcher
    Tb.sphere(7.5, (31.0, 0.0, 118.0), "chrome_dark", u=12, v=8)
    Tb.lathe([(12.0, 0.0), (12.0, 2.6), (9.2, 6.2), (4.0, 8.6), (0, 9.0)], "alien_violet", segs=6,
             M=T(33.0, 0.0, 120.5) @ R('Y', 18) @ S(1.0, 1.15, 1.0))
    Tb.torus(10.6, 0.8, "chrome_dark", segs=6, sides=4, M=T(33.0, 0.0, 120.5) @ R('Y', 18) @ S(1.0, 1.15, 1.0) @ R('Z', 30) @ T(0, 0, 1.2))
    Tb.box((8.0, 8.0, 8.0), (31.0, 2.0, 132.0), "alien_panel", bevel=1.0)
    Tb.box((18.0, 24.0, 13.0), (32.0, 2.0, 140.0), "alien_armor", bevel=2.2)
    Tb.box((19.0, 6.0, 2.0), (32.0, 6.0, 147.0), "alien_violet", bevel=0.6)
    for dx in (-4.4, 4.4):
        for dz in (-3.2, 3.2):
            Tb.lathe([(2.8, 0.0), (2.8, 4.0), (1.9, 4.0), (1.9, 3.0)], "alien_panel", segs=10,
                     M=T(32.0 + dx, -9.6, 140.0 + dz) @ FACE_FRONT, cap_start=False, cap_end=False)
            Tb.lathe([(1.95, 3.0), (0, 3.0)], "glow_alien_violet", segs=10, M=T(32.0 + dx, -9.6, 140.0 + dz) @ FACE_FRONT,
                     cap_start=False, cap_end=False)
    # left arm (static): heavy claw held forward
    sh, el, wr = Vector((31.0, 0.0, 118.0)), Vector((39.0, -1.0, 100.0)), Vector((39.0, -19.0, 94.0))
    Tb.add(_limb(sh, el, 6.6, 5.8, 10), "alien_armor")
    Tb.sphere(6.0, tuple(el), "chrome_dark", u=10, v=6)
    Tb.add(_limb(el, wr, 6.6, 5.4, 10), "alien_armor")
    Tb.add(_limb(el.lerp(wr, 0.25), el.lerp(wr, 0.7), 7.4, 6.6, 10), "alien_violet")
    Tb.sphere(4.2, tuple(wr), "chrome_dark", u=10, v=6)
    _claw(Tb, wr, wr - el, (0, 0, 1), "chrome_dark", reach=1.15)
    _shift(Tb, PT)
    torso = Tb.finish(name + "_torso", origin=PT, parent=root, sharp_deg=40)

    # ------------------------------------------------------------------ head (cockpit with one big eye)
    PH = (0.0, -1.0, 126.0)
    H = Builder()
    H.cyl(6.0, 124.0, 132.0, "chrome_dark", segs=12, M=T(0, -1.0, 0), cap_start=False, cap_end=False)
    H.box((30.0, 26.0, 21.0), (0, -2.0, 140.5), "alien_armor", bevel=5.0)
    H.box((33.0, 10.0, 5.5), (0, -12.0, 150.6), "alien_violet", bevel=1.8, M=R('X', 12))     # brow hood
    H.torus(9.3, 1.9, "chrome", segs=24, sides=6, M=T(0, -15.3, 139.5) @ FACE_FRONT)
    H.cyl(9.2, 0.0, 0.6, "alien_panel", segs=24, M=T(0, -14.8, 139.5) @ FACE_FRONT, cap_start=False)
    for s in (-1, 1):                                                                   # mandible plates
        H.box((5.5, 11.0, 11.0), (s * 13.0, -12.0, 133.5), "alien_violet", bevel=1.0, M=R('Z', s * -20) @ R('Y', s * 10))
        H.tube([(s * 10.0, 7.0, 150.5), (s * 12.5, 10.0, 157.5), (s * 14.5, 13.0, 163.0)], 0.8, "chrome_dark", sides=5)
        H.sphere(1.7, (s * 14.6, 13.2, 164.1), "glow_alien_violet", u=8, v=4)
    H.box((11.0, 2.0, 3.8), (0, -15.0, 132.4), "alien_panel", bevel=0.4)                 # jaw grille
    for dx in (-3.2, 0.0, 3.2):
        H.box((1.0, 0.6, 2.8), (dx, -16.0, 132.4), "glow_alien_green")
    crest = [(-11.0, 150.0), (13.0, 150.0), (15.5, 154.0), (-2.0, 158.5), (-10.0, 154.0)]
    H.prism(crest, -1.6, 1.6, "alien_violet", bevel=0.5, M=CYCLIC)
    _shift(H, PH)
    head = H.finish(name + "_head", origin=tuple(Vector(PH) - Vector(PT)), parent=torso, sharp_deg=40)

    EYE = Vector((0.0, -15.6, 139.5))
    Eg = Builder()
    Eg.sphere(7.8, (0, 0, 0), "glow_alien_green", u=18, v=12, scale=(1.0, 0.46, 1.0))
    Eg.box((1.8, 1.0, 9.8), (0, -3.3, 0), "alien_eye", bevel=0.4)                       # slit pupil
    Eg.finish(name + "_eye_glow", origin=tuple(EYE - Vector(PH)), parent=head, sharp_deg=60)

    # ------------------------------------------------------------------ right arm (-X): laser cannon + claw
    PA = Vector((-31.0, 0.0, 118.0))
    Ar = Builder()
    Ar.sphere(7.5, tuple(PA), "chrome_dark", u=12, v=8)
    Mp = T(-33.0, 0.0, 120.5) @ R('Y', -18) @ S(1.0, 1.15, 1.0)
    Ar.lathe([(12.5, 0.0), (12.5, 2.6), (9.6, 6.4), (4.2, 9.0), (0, 9.4)], "alien_violet", segs=6, M=Mp)
    Ar.torus(11.1, 0.8, "chrome_dark", segs=6, sides=4, M=Mp @ R('Z', 30) @ T(0, 0, 1.2))
    for dy in (-5.0, 4.5):
        Ar.add(_lathe([(2.4, 0), (0, 9.0)], 6), "chrome_dark", T(-38.0, dy, 127.5) @ _aim((-0.5, 0, 1)))
    el = Vector((-38.0, -1.0, 100.0))
    Ar.add(_limb(PA, el, 6.6, 5.8, 10), "alien_armor")
    Ar.sphere(6.0, tuple(el), "chrome_dark", u=10, v=6)
    d = Vector((0.0, -1.0, -0.08)).normalized()
    Mc = T(*el) @ _aim(d)
    Ar.lathe([(6.5, -3.0), (8.8, 2.0), (8.8, 24.0), (7.0, 28.0), (4.4, 28.0)], "alien_armor", segs=12, M=Mc, cap_end=False)
    for z in (9.0, 15.0, 21.0):
        Ar.torus(8.9, 1.0, "glow_alien_green" if z == 15.0 else "alien_panel", segs=12, sides=4, M=Mc @ T(0, 0, z))
    Ar.cyl(4.4, 28.0, 40.0, "chrome_dark", segs=10, M=Mc, cap_start=False, cap_end=False)
    Ar.lathe([(4.3, 39.0), (6.2, 40.0), (6.2, 45.0), (3.2, 45.0)], "alien_violet", segs=12, M=Mc, cap_start=False,
             cap_end=False)
    up = Vector((0, 0, 1))
    Ar.box((3.4, 18.0, 2.6), tuple(el + d * 13.0 + up * 8.8), "alien_violet", bevel=0.5)
    Ar.box((1.6, 16.0, 1.0), tuple(el + d * 13.0 + up * 10.3), "glow_alien_green")
    side = d.cross(up).normalized()
    for sx in (-1, 1):                                         # gripping claws under the barrel
        b0 = el + d * 8.0 - up * 7.0 + side * sx * 3.4
        b1 = el + d * 20.0 - up * 11.5 + side * sx * 4.0
        b2 = el + d * 27.0 - up * 7.8 + side * sx * 2.2
        Ar.add(_limb(b0, b1, 2.0, 1.6, 6), "chrome_dark")
        Ar.sphere(1.7, tuple(b1), "chrome_dark", u=6, v=4)
        Ar.add(_limb(b1, b2, 1.6, 0.3, 6), "chrome_dark")
    _shift(Ar, PA)
    arm = Ar.finish(name + "_arm_R", origin=tuple(PA - Vector(PT)), parent=torso, sharp_deg=40)

    MUZ = el + d * 45.0
    Gg = Builder()
    Gg.lathe([(3.4, 0.0), (2.4, 1.2), (0, 1.9)], "glow_alien_green", segs=12, M=_aim(d), cap_start=False)
    Gg.cyl(3.3, -1.5, 0.0, "glow_alien_green", segs=12, M=_aim(d), cap_start=False, cap_end=False)
    Gg.finish(name + "_gun_glow", origin=tuple(MUZ - PA), parent=arm, sharp_deg=60)
    return root


# ==============================================================================================
# 4. Alien foot soldier (static decor)
# ==============================================================================================
ALIEN_HEAD = [(0.0, -10.5), (1.7, -10.2), (3.2, -9.3), (4.8, -7.6), (6.3, -5.4), (7.6, -2.8), (8.7, -0.2), (9.5, 2.4),
              (9.8, 4.8), (9.6, 7.0), (8.8, 8.8), (7.3, 10.2), (5.2, 11.1), (2.7, 11.6), (0.0, 11.75)]
ALIEN_HEAD_KY = 0.88


def _alien_head_r(dz):
    for (r0, z0), (r1, z1) in zip(ALIEN_HEAD, ALIEN_HEAD[1:]):
        if z0 <= dz <= z1:
            return r0 + (r1 - r0) * (dz - z0) / (z1 - z0)
    return 0.0


def _alien_pose(pose):
    sh = lambda s, y, z: Vector((s * 6.0, y, z))  # noqa: E731
    if pose == "point":
        return dict(
            legs={-1: ((-4.2, 0.6, 2.2), (-4.0, -0.6, 13.0), (-3.4, 0.5, 24.5)),
                  1: ((4.6, 1.2, 2.2), (4.3, 0.2, 13.0), (3.4, 0.5, 24.5))},
            pelvis=(0, 0.5, 25.5), neck=(0, 0.0, 40.5), head=(0, -0.6, 51.0), tilt=-14.0, spine_k=1.0,
            arms={-1: (sh(-1, 0.3, 38.0), Vector((-8.8, -1.0, 46.0)), Vector((-9.6, -2.2, 53.5))),
                  1: (sh(1, 0.3, 38.0), Vector((8.6, 1.0, 31.0)), Vector((9.0, -2.0, 24.6)))},
            gun=(1, (0.0, -0.55, -0.83)), point=-1)
    if pose == "crouch":
        return dict(
            legs={-1: ((-4.8, -7.0, 2.2), (-5.2, -9.5, 12.5), (-3.4, 1.0, 15.5)),
                  1: ((4.6, 7.0, 2.4), (4.6, -3.6, 2.4), (3.4, 1.0, 15.5))},
            pelvis=(0, 1.0, 16.5), neck=(0, -2.0, 31.5), head=(0, -3.4, 42.0), tilt=-4.0, spine_k=0.95,
            arms={-1: (Vector((-6.0, -1.2, 29.0)), Vector((-5.4, -8.6, 25.8)), Vector((-2.6, -14.6, 29.0))),
                  1: (Vector((6.0, -1.2, 29.0)), Vector((5.6, -8.0, 23.6)), Vector((0.4, -15.4, 27.2)))},
            gun=(-1, (0.0, -1.0, 0.03)), point=None, kneel=1)
    return dict(
        legs={-1: ((-4.6, 0.6, 2.2), (-4.2, -0.8, 13.0), (-3.4, 0.5, 24.5)),
              1: ((4.8, 1.6, 2.2), (4.4, 0.4, 13.0), (3.4, 0.5, 24.5))},
        pelvis=(0, 0.5, 25.5), neck=(0, 0.0, 40.5), head=(0, -0.8, 51.0), tilt=4.0, spine_k=1.0,
        arms={-1: (sh(-1, 0.3, 38.0), Vector((-6.4, -7.6, 37.2)), Vector((-3.8, -14.6, 38.4))),
              1: (sh(1, 0.3, 38.0), Vector((9.0, 1.4, 31.4)), Vector((7.6, -2.4, 25.4)))},
        gun=(-1, (0.0, -1.0, 0.0)), point=None)


def _ray_gun(B, hand, direction):
    """Ray gun with the grip in `hand`, muzzle along `direction`."""
    d = Vector(direction).normalized()
    rot = Vector((0, -1, 0)).rotation_difference(d).to_matrix().to_4x4()
    M = T(*hand) @ rot
    B.box((1.6, 2.2, 4.4), (0, 0, 0), "alien_panel", bevel=0.4, M=M @ T(0, 0.8, -1.4) @ R('X', -18))
    body = M @ T(0, 0, 1.9) @ FACE_FRONT
    B.lathe([(0, -3.0), (1.6, -2.8), (2.4, -1.0), (2.5, 2.0), (2.0, 5.0), (1.2, 6.0), (1.2, 8.6)], "alien_hull_light",
            segs=10, M=body, cap_end=False)
    for z in (6.4, 7.8):
        B.torus(1.5, 0.5, "alien_violet", segs=8, sides=4, M=body @ T(0, 0, z))
    B.lathe([(1.2, 8.6), (2.6, 10.4), (2.4, 10.8), (1.0, 9.6)], "alien_hull_light", segs=10, M=body,
            cap_start=False, cap_end=False)
    B.sphere(1.1, (0, 0, 0), "glow_alien_green", u=8, v=6, M=body @ T(0, 0, 9.9))
    B.box((0.8, 4.0, 2.0), (0, 0, 0), "alien_violet", M=M @ T(0, 1.0, 4.4))         # top fin
    B.sphere(1.0, (0, 0, 0), "glow_alien_violet", u=6, v=4, M=body @ T(0, -0.2, -1.6) @ S(1, 1, 1))


def make_alien(name="alien_0", pose="gun"):
    """Grey-green alien trooper ~62 mm tall (crouch ~53), facing -Y, origin between the feet.
    pose: "gun" (aims forward), "point" (points up, gun lowered), "crouch" (kneels, aims). Static."""
    P = _alien_pose(pose)
    B = Builder()
    # legs and boots
    for s, (ankle, knee, hip) in P["legs"].items():
        ankle, knee, hip = Vector(ankle), Vector(knee), Vector(hip)
        B.add(_limb(ankle, knee, 1.6, 1.9, 8, False, False), "alien_suit")
        B.add(_limb(knee, hip, 1.9, 2.5, 8, False, True), "alien_suit")
        B.sphere(2.0, tuple(knee), "alien_suit", u=8, v=4)
        if P.get("kneel") == s:
            B.ellipsoid((ankle.x, ankle.y + 1.8, 1.5), (1.9, 3.4, 1.5), "alien_violet", u=8, v=5)
            B.sphere(2.3, (knee.x, knee.y, 2.3), "alien_violet", u=8, v=4)
        else:
            B.ellipsoid((ankle.x, ankle.y - 1.6, 1.5), (2.0, 3.8, 1.5), "alien_violet", u=8, v=5)
    # torso along the spine
    pel, nk = Vector(P["pelvis"]), Vector(P["neck"])
    spine = nk - pel
    L = spine.length
    Ms = T(*pel) @ _aim(spine) @ S(1.0, 0.68, L / 16.0)
    _bands(B, [(0, -2.0), (3.8, -1.6), (4.7, 0.3), (4.7, 2.0), (4.0, 4.0), (4.4, 7.5), (5.8, 11.5), (6.2, 13.2),
               (5.0, 15.0), (3.4, 15.9), (2.6, 17.0), (0, 17.2)],
           ["alien_suit", "alien_suit", "alien_violet", "alien_suit", "alien_suit", "alien_suit", "alien_suit", "alien_suit",
            "alien_suit", "alien_violet", "alien_violet"], 12, M=Ms)
    sdir = spine.normalized()
    B.ellipsoid(tuple(pel + Vector((0, 0, -1.4))), (5.0, 3.4, 3.0), "alien_suit", u=8, v=4)      # hips
    chest = pel + sdir * (11.0 * L / 16.0) + Vector((0, -5.8 * 0.68 + 0.15, 0))
    B.prism([(0, 1.9), (1.4, 0), (0, -1.9), (-1.4, 0)], 0.0, 0.6, "glow_alien_violet", M=T(*chest) @ FACE_FRONT,
            cap_bottom=False)
    buckle = pel + sdir * 1.2 + Vector((0, -4.6 * 0.68 - 0.2, 0))
    B.box((2.2, 0.8, 1.6), tuple(buckle), "glow_alien_green", bevel=0.2)
    # arms
    for s, (sh, el, hand) in P["arms"].items():
        B.ellipsoid(tuple(sh + Vector((s * 0.6, 0, 0.6))), (2.8, 2.6, 1.9), "alien_violet", u=8, v=5)
        B.add(_limb(sh, el, 1.6, 1.35, 8, False, False), "alien_suit")
        B.sphere(1.45, tuple(el), "alien_suit", u=8, v=4)
        B.add(_limb(el, hand, 1.35, 1.15, 8, False, False), "alien_suit")
        B.add(_limb(el.lerp(hand, 0.72), el.lerp(hand, 0.9), 1.55, 1.45, 8), "alien_violet")   # glove cuff
        B.sphere(1.75, tuple(hand), "alien_skin", u=8, v=5)
        if P.get("point") == s:
            fd = (hand - el).normalized()
            B.add(_limb(hand + fd * 1.0, hand + fd * 6.2, 0.62, 0.45, 6), "alien_skin")
            B.sphere(0.5, tuple(hand + fd * 6.2), "alien_skin", u=6, v=4)
    gs, gdir = P["gun"]
    _ray_gun(B, P["arms"][gs][2], gdir)
    # neck and head
    hc = Vector(P["head"])
    B.add(_limb(nk + Vector((0, 0, -1.0)), hc + Vector((0, 0.6, -8.5)), 1.7, 1.5, 8, False, False), "alien_skin")
    Mh = T(*hc) @ R('X', P["tilt"])
    B.lathe(ALIEN_HEAD, "alien_skin", segs=18, M=Mh @ S(1.0, ALIEN_HEAD_KY, 1.0))
    for s in (-1, 1):
        dz, ex = -0.9, 4.3
        rr = _alien_head_r(dz)
        ey = -ALIEN_HEAD_KY * math.sqrt(max(0.0, rr * rr - ex * ex)) + 0.95
        B.sphere(1.0, (0, 0, 0), "alien_eye", u=12, v=8,
                 M=Mh @ T(s * ex, ey, dz) @ R('Z', s * 32) @ R('Y', -s * 26) @ S(4.7, 1.75, 2.6))
    rr = _alien_head_r(-6.6)
    B.box((2.6, 0.6, 0.45), (0, 0, 0), "alien_eye", M=Mh @ T(0, -ALIEN_HEAD_KY * rr + 0.15, -6.6))   # mouth slit
    return B.finish(name, sharp_deg=55)


# ==============================================================================================
# 5. Drop target with an alien head stencil
# ==============================================================================================
def _alien_face_outline(scale=1.0, n=28):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, z = 7.4 * math.cos(t), 9.5 * math.sin(t)
        if z < 0:
            x *= 1.0 + 0.55 * math.sin(t)
            z *= 1.15
        pts.append((x * scale, z * scale))
    return pts


def _almond(sx, cx, cz, rx=3.0, rz=1.5, deg=28, n=12):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = rx * math.cos(t)
        z = rz * math.sin(t) * (1.0 - 0.35 * abs(math.cos(t)) ** 3)
        a = math.radians(-sx * deg)
        xr, zr = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
        pts.append((cx + xr, cz + zr))
    return pts


def make_alien_drop_target(name="droptarget_0", w=24):
    """Same blade as assets.make_drop_target (w x 6 x 30, z 2..32, base 20 x 8 x 2), glowing alien face on -Y."""
    B = Builder()
    B.box((w, 6, 30), (0, 0, 17), "alien_violet", bevel=1.2)
    B.box((min(20.0, w - 4.0), 8, 2), (0, 0, 1), "steel")
    B.box((w - 4.0, 0.3, 26.0), (0, -3.05, 17.0), "alien_panel")
    M = T(0, 0, 17.0) @ FACE_FRONT
    B.prism(_alien_face_outline(min(1.0, (w - 7.0) / 16.0)), 3.15, 3.7, "glow_alien_green", M=M, cap_bottom=False)
    for s in (-1, 1):
        B.prism(_almond(s, s * 3.5, -0.8), 3.2, 3.95, "alien_eye", M=M, cap_bottom=False)
    B.prism([(-1.3, -7.0), (1.3, -7.0), (1.3, -6.5), (-1.3, -6.5)], 3.2, 3.85, "alien_eye", M=M, cap_bottom=False)
    return B.finish(name)


# ==============================================================================================
# 6. Small attack saucer (decor)
# ==============================================================================================
def make_saucer_small(name="saucer_0", r=34):
    """Origin: centre bottom (z=0), ~26 mm tall at r=34. Child {name}_glow: rim lights + ventral emitter."""
    k = r / 34.0
    B = Builder()
    _bands(B, [(9.0, 2.2), (20.0, 4.2), (31.0, 7.4), (34.0, 8.6), (34.0, 10.8), (31.5, 12.4), (22.0, 15.2), (16.5, 16.4)],
           ["alien_hull", "alien_hull", "alien_hull_light", "alien_panel", "alien_hull_light", "alien_hull", "alien_hull_light"], 32)
    B.lathe([(16.5, 16.0), (16.0, 18.2), (13.0, 21.8), (7.5, 24.6), (0, 25.6)], "alien_glass", segs=24,
            cap_start=False, cap_end=False)
    B.torus(16.8, 0.9, "alien_hull_light", segs=24, sides=4, M=T(0, 0, 16.4))
    for a in (90, 210, 330):
        B.prism([(16.0, 16.2), (27.0, 13.4), (29.5, 14.6), (21.0, 19.8), (16.0, 20.6)], -0.8, 0.8, "alien_violet",
                bevel=0.3, M=R('Z', a) @ FACE_FRONT)
    for i in range(12):
        _on_slope(B, (31.5, 12.4), (22.0, 15.2), (9.0, 0.8, 0.5), i * 30 + 15, "alien_panel")
    for i in range(4):                                     # dome port windows
        a = i * 90 + 45
        B.box((0.8, 3.0, 1.8), (0, 0, 0), "glow_alien_green", M=R('Z', a) @ T(15.2, 0, 19.0) @ R('Y', -30))
    _scale(B, k)
    root = B.finish(name, sharp_deg=40)

    G = Builder()
    for i in range(12):
        x, y = _polar(34.4, i * 30)
        G.sphere(1.8, (x, y, 9.7), "glow_alien_green" if i % 2 == 0 else "glow_alien_violet", u=8, v=4)
    G.lathe([(0, 0.0), (5.0, 0.4), (8.6, 1.6), (9.6, 2.6)], "glow_alien_green", segs=20, cap_start=False, cap_end=False)
    _scale(G, k)
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root)
    return root


# ==============================================================================================
# 7. Abduction pad around a scoop hole
# ==============================================================================================
def make_beam_pad(name="beampad", r=22):
    """Flush ring r 15..r, top z 2.2 (glyphs to 2.7); hole r 15 stays open (dark sleeve down to z -8).
    Child {name}_glow: the glowing glyph ring."""
    B = Builder()
    _bands(B, [(r, 0.0), (r, 1.6), (r - 1.2, 2.2), (15.8, 2.2), (15.0, 1.4), (15.0, -8.0)],
           ["chrome_dark", "chrome_dark", "alien_panel", "chrome_dark", "black_plastic"], 40)
    root = B.finish(name, sharp_deg=30)

    G = Builder()
    z0, z1 = 2.1, 2.7
    pattern = [0, 1, 2, 3, 4, 2, 1, 0, 3, 4, 1, 2]
    ri, ro = 16.6, 20.0
    for i, g in enumerate(pattern):
        a = i * 30 + 15
        if g == 0:          # radial bar
            G.add(_sector(ri, ro, z0, z1, a - 2.2, a + 2.2, 1), "glow_alien_green")
        elif g == 1:        # arc with a dot
            G.add(_sector(18.6, ro, z0, z1, a - 8, a + 8, 3), "glow_alien_green")
            G.cyl(0.9, z0, z1, "glow_alien_green", segs=6, M=T(*_polar(17.4, a), 0), cap_start=False)
        elif g == 2:        # inward triangle
            pts = [_polar(ro, a - 7), _polar(ro, a + 7), _polar(ri, a)]
            G.prism(pts, z0, z1, "glow_alien_violet", cap_bottom=False)
        elif g == 3:        # two dots
            for rr in (17.4, 19.2):
                G.cyl(0.9, z0, z1, "glow_alien_green", segs=6, M=T(*_polar(rr, a), 0), cap_start=False)
        else:               # T glyph
            G.add(_sector(19.0, ro, z0, z1, a - 7, a + 7, 2), "glow_alien_green")
            G.add(_sector(ri, 19.0, z0, z1, a - 1.6, a + 1.6, 1), "glow_alien_green")
    # inner glowing lip ring segments pointing into the hole
    for i in range(8):
        G.add(_sector(15.9, 16.3, z0, 2.4, i * 45 + 5, i * 45 + 40, 3), "glow_alien_violet")
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root, sharp_deg=30)
    return root


ALIEN_ASSETS = {
    "mothership": make_mothership,
    "saucer_bumper": make_saucer_bumper,
    "robot": make_robot,
    "alien": make_alien,
    "alien_droptarget": make_alien_drop_target,
    "saucer_small": make_saucer_small,
    "beampad": make_beam_pad,
}

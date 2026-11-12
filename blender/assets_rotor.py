"""ROTORSTURM asset library: the second table (Vietnam 1968, helicopter rescue and supply crew).

Same conventions as assets.py: every make_*() returns the ROOT object at the world origin
(unrotated, unit scale, final meshes). Dimensions in mm in the code, metres in the meshes.
+Z up, playfield at z=0, +Y up-table, the front of an asset faces -Y (the player).
Animated parts are child objects named `{name}_{part}` whose origin sits on their pivot.

Tone: rescue, radio, supply, jungle, monsoon. No weapons, no insignia, no protected emblems,
and the helicopter is an original, generic 1960s-style utility design.
"""
import contextlib
import math
import os
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

try:
    from . import assets as A
    from . import materials
except ImportError:  # plain script module
    import assets as A
    import materials

from assets import Builder, T, R, S, MM, _lathe, _prism, _tube, _box, _sphere, _limb  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STENCIL_FONT = os.path.join(HERE, "BlackOpsOne-Regular.ttf")

materials.SPECS.update({
    "olive_drab":       ((0.16, 0.18, 0.08), 0.20, 0.55, None),
    "olive_dark":       ((0.07, 0.08, 0.04), 0.20, 0.60, None),
    "khaki":            ((0.45, 0.38, 0.22), 0.00, 0.80, None),
    "canvas":           ((0.33, 0.30, 0.18), 0.00, 0.90, None),
    "sandbag":          ((0.42, 0.36, 0.24), 0.00, 0.95, None),
    "sandbag_dark":     ((0.30, 0.25, 0.16), 0.00, 0.95, None),
    "bamboo":           ((0.55, 0.42, 0.18), 0.00, 0.60, None),
    "bamboo_dark":      ((0.32, 0.23, 0.09), 0.00, 0.65, None),
    "thatch":           ((0.40, 0.30, 0.12), 0.00, 0.95, None),
    "thatch_dark":      ((0.24, 0.17, 0.06), 0.00, 0.95, None),
    "wood_crate":       ((0.30, 0.20, 0.09), 0.00, 0.80, None),
    "timber_dark":      ((0.10, 0.065, 0.035), 0.00, 0.85, None),
    "mud":              ((0.18, 0.12, 0.06), 0.00, 0.90, None),
    "palm_leaf":        ((0.08, 0.22, 0.05), 0.00, 0.60, None),
    "palm_trunk":       ((0.25, 0.18, 0.10), 0.00, 0.85, None),
    "yellow_stencil":   ((0.85, 0.65, 0.05), 0.00, 0.50, None),
    "white_stencil":    ((0.85, 0.85, 0.80), 0.00, 0.50, None),
    "glass_dark":       ((0.02, 0.03, 0.03), 0.00, 0.05, None),
    "rotor_black":      ((0.02, 0.02, 0.02), 0.30, 0.40, None),
    "glow_green":       ((0.0, 0.0, 0.0), 0.00, 0.50, (0.35, 1.00, 0.20)),
    "glow_amber_rotor": ((0.0, 0.0, 0.0), 0.00, 0.50, (1.00, 0.60, 0.10)),
    "glow_redbeacon":   ((0.0, 0.0, 0.0), 0.00, 0.50, (1.00, 0.05, 0.03)),
    "glow_searchlight": ((0.0, 0.0, 0.0), 0.00, 0.50, (1.00, 0.95, 0.80)),
})

TUNNEL_HALF = 20.5      # bunker: ball tunnel |x| < 20.5, z < 34, y from -74 to -30
TUNNEL_TOP = 34.0
TUNNEL_BACK = -30.0
FRONT_Y = -74.0
TOWER_X = 26.0          # watchtower: front legs at x = +-26 (same contract as the pin-up)


# ------------------------------------------------------------------------------ text in the stencil face
@contextlib.contextmanager
def _stencil():
    old = A.FONT_PATH
    A.FONT_PATH = STENCIL_FONT
    try:
        yield
    finally:
        A.FONT_PATH = old


def _text_piece(text, height, depth=0.6, max_points=160, keep_back=False):
    """Stencil text as a bmesh standing in the XY plane, front at +Z, scaled so the
    capital height is `height` mm. Returns (bm, width_mm)."""
    with _stencil():
        bm, w, h = A._text_solid(text, max_points=max_points, depth=1.0)
    k = height / h
    bmesh.ops.transform(bm, matrix=S(k, k, depth) @ T(0, 0, 0.5), verts=bm.verts)  # back at z=0
    bm.normal_update()
    if not keep_back:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5], context='FACES')
    return bm, w * k


def _label(B, text, height, M, m="white_stencil", depth=0.5, max_points=160, max_width=None):
    """Raised stencil lettering. Text space: front faces +Z, back at z=0. M places it."""
    bm, w = _text_piece(text, height, depth, max_points)
    if max_width and w > max_width:
        k = max_width / w
        bmesh.ops.scale(bm, vec=(k, k, 1.0), verts=bm.verts)
    B.add(bm, m, M)


FACE_FRONT = R('X', 90)          # text +Z -> -Y (facing the player)


def _face(direction):
    """Rotation that turns text (+Z front, reading along +X) toward a world direction."""
    return {
        "-Y": R('X', 90),
        "+Z": Matrix.Identity(4),
        "+X": R('Z', 90) @ R('X', 90),
        "-X": R('Z', -90) @ R('X', 90),
    }[direction]


def _lbox(B, size, loc, m, bevel=0.0, M=None):
    """Box positioned in the local frame M (unlike Builder.box, which applies loc after M)."""
    mtx = (M if M is not None else Matrix.Identity(4)) @ T(*loc)
    B.add(_box(size[0], size[1], size[2], bevel), m, mtx)


# ------------------------------------------------------------------------------ sandbags
def _pillow(length, width, height, u=8, v=5, power=0.55):
    """A filled sandbag: a superellipsoid that reads as a soft rounded pillow."""
    bm = _sphere(1.0, u, v)
    for vt in bm.verts:
        x, y, z = vt.co
        vt.co = Vector((math.copysign(abs(x) ** power, x) * length / 2,
                        math.copysign(abs(y) ** power, y) * width / 2,
                        math.copysign(abs(z) ** 0.8, z) * height / 2))
    return bm


def _bag(B, centre, yaw, length=16.0, width=9.0, height=8.5, m="sandbag", rng=None, u=8, v=5):
    """One sandbag (long axis along local X) at `centre` (mm) rotated by `yaw` degrees."""
    j = rng.uniform(-1, 1) if rng else 0.0
    L = length * (1 + 0.04 * j)
    piece = _pillow(L, width, height, u, v)
    tilt = rng.uniform(-3, 3) if rng else 0.0
    B.add(piece, m, T(*centre) @ R('Z', yaw) @ R('X', tilt))


def _bag_ring(B, r, z, n, height, width, length, rng, skip=None, phase=0.0, m_alt=True):
    for i in range(n):
        a = 2 * math.pi * (i + phase) / n
        c = (r * math.cos(a), r * math.sin(a), z)
        if skip and skip(c, a):
            continue
        m = "sandbag_dark" if (m_alt and rng.random() < 0.28) else "sandbag"
        _bag(B, c, math.degrees(a) + 90, length, width, height, m, rng)


# ------------------------------------------------------------------------------ bamboo
def _bamboo(B, p0, p1, r, m="bamboo", node_every=18.0, segs=6):
    """Bamboo pole with little bulging nodes."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    L = d.length
    prof = [(r, 0.0)]
    n = max(1, int(L // node_every))
    for i in range(1, n + 1):
        z = L * i / (n + 1)
        prof += [(r, z - 1.2), (r * 1.18, z - 0.4), (r * 1.18, z + 0.4), (r, z + 1.2)]
    prof.append((r, L))
    piece = _lathe(prof, segs, cap_start=True, cap_end=True)
    bmesh.ops.transform(piece, matrix=Matrix.Translation(a) @ A._aim(d), verts=piece.verts)
    B.add(piece, m)


def _double_side(bm, gap):
    """Back side for thin cards (leaves, cloth): reversed copy pushed `gap` mm behind each face."""
    bm.normal_update()
    offs = {}
    for f in bm.faces:
        for v in f.verts:
            offs.setdefault(v.index if False else id(v), [v, Vector()])[1] += f.normal
    dup = bmesh.ops.duplicate(bm, geom=list(bm.faces))
    vmap = dup["vert_map"]
    new_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    for old, new in vmap.items():
        if isinstance(old, bmesh.types.BMVert) and id(old) in offs:
            n = offs[id(old)][1]
            if n.length > 1e-9:
                new.co = old.co - n.normalized() * gap
    bmesh.ops.reverse_faces(bm, faces=new_faces)


# ------------------------------------------------------------------------------ checks
def _world_verts(root):
    bpy.context.view_layer.update()
    out = []
    stack = [root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        if ob.type == 'MESH':
            mw = ob.matrix_world
            out.extend(((mw @ v.co) / MM, ob.name) for v in ob.data.vertices)
    return out


def _check_bunker(root):
    problems = []
    for p, name in _world_verts(root):
        if p.y < FRONT_Y - 0.6:
            problems.append("%s in front of y=-74 (%.1f)" % (name, p.y))
            break
    for p, name in _world_verts(root):
        if abs(p.x) < TUNNEL_HALF - 0.05 and 0.05 < p.z < TUNNEL_TOP - 0.05 and FRONT_Y - 1 < p.y < TUNNEL_BACK - 0.05:
            problems.append("tunnel obstructed by %s at %s" % (name, tuple(round(c, 1) for c in p)))
            break
    for p, name in _world_verts(root):
        if p.y > -40 and math.hypot(p.x, p.y) > 52.5:
            problems.append("%s outside the footprint circle (r=%.1f)" % (name, math.hypot(p.x, p.y)))
            break
    if problems:
        raise RuntimeError("lz bunker failed validation: " + "; ".join(problems))


def _check_tower(root):
    problems = []
    for p, name in _world_verts(root):
        if p.z < -0.05:
            problems.append("%s below the playfield" % name)
            break
        if abs(p.x) < 18.5 - 1e-3 and p.z < 42.0:
            problems.append("tunnel obstructed by %s at %s" % (name, tuple(round(c, 1) for c in p)))
            break
        if p.z < 3.0 and abs(p.x) < 40 and p.y < 18.0:
            # footprint on the floor: inside one of the leg capsules
            ok = False
            for sx in (-TOWER_X, TOWER_X):
                for (y0, y1) in ((-9, 9), (25, 43)):
                    yy = min(max(p.y, y0), y1)
                    if math.hypot(p.x - sx, p.y - yy) <= 7.5 + 1e-3:
                        ok = True
            if not ok and not name.endswith("_ladderfoot"):
                problems.append("%s footprint outside the leg capsules at %s" % (name, tuple(round(c, 1) for c in p)))
                break
    if problems:
        raise RuntimeError("watchtower failed validation: " + "; ".join(problems))


# ==============================================================================================
# 1. LZ bunker (the central scoop)
# ==============================================================================================
def make_lz_bunker(name="skull"):
    """Sandbagged landing-zone bunker with a helipad roof.

    Contract (same as the skull): body inside r=52, entrance to y=-74, free ball tunnel
    |x|<20.5, z<34, y -74..-30. Children {name}_eye_L / _eye_R: red signal lamps."""
    rng = random.Random(1968)
    B = Builder()

    # ---- earth core (dome), the tunnel cut out of it
    core = Builder()
    core.lathe([(42.5, 0), (42.0, 9), (40.4, 18), (38.2, 27), (35.6, 35), (33.0, 42), (31.0, 46.5), (0, 46.5)],
               "mud", segs=28, cap_start=True)
    cob = core.finish("_core", smooth=False)
    C = Builder()
    C.box((2 * TUNNEL_HALF, 60, 44), (0, TUNNEL_BACK - 30, TUNNEL_TOP - 22), "mud")   # y -90..-30, z -10..34
    cut = C.finish("_cut")
    md = cob.modifiers.new("b", 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.solver = 'EXACT'
    md.object = cut
    A._apply_modifiers(cob)
    A._remove(cut)
    cbm = bmesh.new()
    cbm.from_mesh(cob.data)
    A._remove(cob)
    bmesh.ops.scale(cbm, vec=(1 / MM, 1 / MM, 1 / MM), verts=cbm.verts)
    bmesh.ops.recalc_face_normals(cbm, faces=cbm.faces)
    B.add(cbm, "mud")

    # ---- sandbag rings: rows 0-3 leave the tunnel and the entrance passage open
    rows = 6
    bag_h = 8.5
    for k in range(rows):
        z = bag_h / 2 + bag_h * k + (0.7 if k >= 4 else 0.0)
        r = 44.2 - 2.15 * k
        n = max(10, int(round(2 * math.pi * r / 16.5)))

        def skip(c, a, k=k):
            if k >= 4:
                return False
            return c[1] < 0 and abs(c[0]) < 33.5
        _bag_ring(B, r, z, n, bag_h, 9.0, 2 * math.pi * r / n * 1.04, rng, skip=skip, phase=0.5 * (k % 2))

    # ---- entrance passage: sandbag "jaw prong" walls, timber revetment, log roof
    for s in (-1, 1):
        for k in range(4):
            z = bag_h / 2 + bag_h * k
            for j, y in enumerate((-65.5, -49.5, -35.0)):
                yy = y + (1.5 if k % 2 else 0.0) * (1 if j == 0 else -1)
                m = "sandbag_dark" if rng.random() < 0.3 else "sandbag"
                _bag(B, (s * 27.6, yy, z), 90, 16.5, 10.6, bag_h, m, rng)
        # revetment planks forming the crisp inner wall at |x| = 20.5
        for i in range(5):
            y0 = FRONT_Y + 1.0 + i * 8.6
            B.box((1.4, 8.0, TUNNEL_TOP - 0.2), (s * (TUNNEL_HALF + 0.7), y0 + 4.0, (TUNNEL_TOP - 0.2) / 2),
                  "timber_dark", bevel=0.25)
    # log roof over the passage (underside at z=34)
    for i in range(7):
        y = FRONT_Y + 3.0 + i * 5.0
        hx = 35.5 if y < -45 else 31.0
        B.add(_limb((-hx, y, TUNNEL_TOP + 2.4), (hx, y, TUNNEL_TOP + 2.4), 2.4, 2.4, 7), "timber_dark")
    # sandbags on top of the passage roof
    for i, x in enumerate((-26, -9, 8, 25)):
        _bag(B, (x + rng.uniform(-1, 1), -61.0, TUNNEL_TOP + 8.6), 0, 16.0, 10.0, 7.5, "sandbag", rng)
        if i < 3:
            _bag(B, (x + 8 + rng.uniform(-1, 1), -49.0, TUNNEL_TOP + 8.6), 0, 16.0, 10.0, 7.5, "sandbag_dark", rng)
    # heavy timber lintel with the stencil across the entrance
    B.box((74, 6.0, 9.0), (0, FRONT_Y + 3.0, TUNNEL_TOP + 4.5), "wood_crate", bevel=0.8)
    for s in (-1, 1):
        B.box((6.0, 6.0, TUNNEL_TOP + 9), (s * 36.8, FRONT_Y + 3.4, (TUNNEL_TOP + 9) / 2), "wood_crate", bevel=0.8)
    _label(B, "DUST OFF", 5.2, T(0, FRONT_Y + 0.05, TUNNEL_TOP + 4.6) @ FACE_FRONT, "white_stencil", depth=0.4,
           max_points=260, max_width=60)
    # dark lining at the back of the tunnel and the ceiling of the cut
    B.box((2 * TUNNEL_HALF, 1.0, TUNNEL_TOP), (0, TUNNEL_BACK + 0.5, TUNNEL_TOP / 2), "black_plastic")

    # ---- helipad roof
    B.lathe([(0, 46.0), (30.5, 46.0), (30.5, 47.6), (0, 47.6)], "olive_dark", segs=28, cap_start=False)
    B.lathe([(25.0, 47.6), (27.5, 47.6), (27.5, 47.9), (25.0, 47.9)], "white_stencil", segs=28, cap_start=False,
            cap_end=False)
    _label(B, "H", 26.0, T(0, 0, 47.6), "white_stencil", depth=0.35, max_points=40)
    # perforated steel planking marks on the pad
    for i in (-2, -1, 1, 2):
        B.box((1.1, 46 - abs(i) * 6, 0.25), (i * 8.0, 0, 47.7), "olive_drab")

    # ---- signal lamp housings on the front corners
    for s in (-1, 1):
        B.cyl(3.2, 0, 4.2, "olive_dark", segs=8, M=T(s * 31.5, -69.0, TUNNEL_TOP + 9.0))
        B.lathe([(4.6, 0), (4.6, 0.8), (3.8, 0.8)], "olive_dark", segs=8, M=T(s * 31.5, -69.0, TUNNEL_TOP + 13.0),
                cap_start=False, cap_end=False)

    root = B.finish(name, sharp_deg=62)
    for s, tag in ((-1, "L"), (1, "R")):
        E = Builder()
        E.sphere(3.6, (0, 0, 0), "glow_redbeacon", u=10, v=7)
        E.finish("%s_eye_%s" % (name, tag), origin=(s * 31.5, -69.0, TUNNEL_TOP + 16.4), parent=root)
    _check_bunker(root)
    return root


# ==============================================================================================
# 2. Helicopter (original generic 1960s utility design)
# ==============================================================================================
def make_heli(name="heli"):
    """Origin between the skids at skid-bottom level, nose toward -Y.
    Children: {name}_rotor (spins about Z), {name}_tail_rotor (spins about X), {name}_beacon."""
    def body(P):
        P.box((27.0, 40.0, 23.0), (0, -6, 23.5), "olive_drab", bevel=7.5)  # boxy utility cabin
        P.ellipsoid((0, -8, 24), (14.0, 24, 13.0), "olive_drab")          # cabin crown
        P.ellipsoid((0, -29, 20.5), (13.2, 16, 11.0), "olive_drab")       # nose
        P.ellipsoid((0, -2, 36), (8.5, 17, 6.5), "olive_drab")            # engine cowling
        P.ellipsoid((0, 12, 33), (6.5, 10, 5.5), "olive_drab")            # exhaust fairing
        P.add(_limb((0, 12, 29), (0, 58, 32.5), 6.8, 2.6, 14), "olive_drab")   # tail boom
        P.ellipsoid((0, 4, 14), (11.5, 18, 5), "olive_drab")              # belly
    bm = A._organic(body, 1.1, smooth=4, tris=2300)

    # open cabin: cut the door openings right through, then line them dark
    ob_me = bpy.data.meshes.new("_hb")
    bm.to_mesh(ob_me)
    bm.free()
    hob = bpy.data.objects.new("_hb", ob_me)
    bpy.context.scene.collection.objects.link(hob)
    for o in hob.data.vertices:
        o.co *= MM
    C = Builder()
    C.box((40, 23, 16.5), (0, -5.0, 22.5), "black_plastic")
    cut = C.finish("_door")
    md = hob.modifiers.new("b", 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.solver = 'EXACT'
    md.object = cut
    A._apply_modifiers(hob)
    A._remove(cut)
    bm = bmesh.new()
    bm.from_mesh(hob.data)
    A._remove(hob)
    bmesh.ops.scale(bm, vec=(1 / MM, 1 / MM, 1 / MM), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()

    B = Builder()
    i_olive = B.mi("olive_drab")
    i_dark = B.mi("black_plastic")
    for f in bm.faces:
        c = f.calc_center_median()
        inside = abs(c.y + 5.0) < 11.6 and abs(c.z - 22.5) < 8.35 and abs(c.x) < 13.0
        f.material_index = i_dark if inside else i_olive
    probe = A._Probe(bm)
    B.add(bm)

    # cockpit glazing: a slightly larger dark glass shell over the nose top
    # windscreen: the front-upper part of the nose, glazed; conformed to the hull skin
    gl = _sphere(1.0, 18, 12)
    for v in gl.verts:
        v.co = Vector((v.co.x * 13.5, v.co.y * 16.5, v.co.z * 11.5))
    bmesh.ops.delete(gl, geom=[v for v in gl.verts if v.co.z < -1.5 or v.co.y > 1.0], context='VERTS')
    bmesh.ops.transform(gl, matrix=T(0, -29.0, 20.5), verts=gl.verts)
    for v in gl.verts:                                  # snap onto the hull, a hair outside
        loc, nrm = probe.near(v.co)
        v.co = loc + nrm * 0.7
    B.add(gl, "glass_dark")
    # window frame: centre post and a sill line
    B.add(_tube([(0, -45.0, 21.0), (0, -42.5, 27.5), (0, -36.0, 31.6), (0, -30.5, 32.3)], 0.55, sides=4), "olive_dark")
    sill = []
    for i in range(13):
        a = math.radians(-90 + i * 15)
        sill.append((13.8 * math.cos(a + math.pi / 2) * 0.98, -29.0 - 16.6 * math.sin(a + math.pi / 2) * 0.98, 20.2))
    B.add(_tube(sill, 0.5, sides=4), "olive_dark")
    # chin windows
    for s in (-1, 1):
        B.add(_pillow(5.0, 4.0, 1.4, 8, 5), "glass_dark", T(s * 5.5, -41.6, 14.6) @ R('X', -55))

    # side door panels slid open (rear of the opening)
    for s in (-1, 1):
        loc, nrm = probe.near((s * 15.0, 12.0, 22.5))
        B.box((1.0, 14.0, 16.0), (s * (abs(loc.x) + 0.9), 12.5, 22.5), "olive_drab", bevel=0.35)
        B.box((1.2, 5.0, 3.6), (s * (abs(loc.x) + 1.1), 12.0, 26.0), "glass_dark", bevel=0.3)
        # door rail
        B.add(_tube([(s * 14.2, -17.5, 30.6), (s * 14.4, 17.0, 30.6)], 0.45, sides=4), "olive_dark")
        # stretcher racks visible inside (canvas)
        B.box((0.8, 18.0, 1.6), (s * 7.0, -6.0, 19.0), "canvas")

    # skids
    for s in (-1, 1):
        B.add(_tube([(s * 13.5, -33, 3.2), (s * 13.5, -30, 1.3), (s * 13.5, -26, 1.2), (s * 13.5, 22, 1.2)], 1.25,
                    sides=6), "olive_dark")
    for y in (-18, 10):
        B.add(_tube([(-13.5, y, 1.3), (-12.4, y, 7.5), (-7.5, y, 11.5), (7.5, y, 11.5), (12.4, y, 7.5),
                     (13.5, y, 1.3)], 1.1, sides=6), "olive_dark")

    # tail: vertical fin, small stabiliser, tail skid
    fin = [(0, 0), (6.5, 0), (14.5, 18.5), (10.5, 19.5), (2.0, 6.0)]
    PERM = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # prism (u,v,w) -> world (w,u,v)
    B.add(_prism(fin, -0.9, 0.9, bevel=0.3), "olive_drab", T(0, 52.0, 31.0) @ PERM)
    for s in (-1, 1):
        B.box((11.0, 4.6, 1.0), (s * 6.0, 44.5, 31.0), "olive_drab", bevel=0.3)
        B.box((1.2, 4.6, 3.6), (s * 11.5, 44.5, 32.2), "olive_drab", bevel=0.3)
    B.add(_tube([(0, 54, 29.5), (0, 59, 25.0)], 0.6, sides=4), "olive_dark")
    # tail rotor gearbox
    B.cyl(2.2, 0, 3.2, "olive_dark", segs=8, M=T(-0.5, 65.8, 44.0) @ R('Y', -90))

    # mast, swashplate, engine intake and exhaust
    B.cyl(2.1, 41.0, 46.5, "steel_dark", segs=8, M=T(0, -2.0, 0))
    B.cyl(4.6, 40.6, 42.0, "steel_dark", segs=10, M=T(0, -2.0, 0))
    B.lathe([(0, 0), (3.4, 0), (3.4, 2.4), (2.8, 3.4), (0, 3.4)], "rotor_black", segs=10, M=T(0, 19.5, 34.0) @ R('X', -80))
    for s in (-1, 1):
        B.box((2.0, 6.0, 3.0), (s * 7.6, -7.0, 37.4), "rotor_black", bevel=0.5)     # intake grilles

    # markings: white stencil (made-up serial and DUST OFF), conformed to the hull
    def decal(text, height, y, z, side, max_width):
        """Stencil text painted on the curved hull: every vertex is projected onto the skin."""
        bm, w = _text_piece(text, height, depth=0.35, max_points=220)
        if w > max_width:
            k = max_width / w
            bmesh.ops.scale(bm, vec=(k, k, 1.0), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=T(0, y, z) @ _face("-X" if side < 0 else "+X"), verts=bm.verts)
        for v in bm.verts:
            d = v.co.x * side                        # 0 (back) .. 0.35 (front)
            ok, loc, nrm, _ = probe.ob.ray_cast(Vector((side * 30.0, v.co.y, v.co.z)), Vector((-side, 0, 0)))
            v.co.x = (loc.x if ok else side * 8.0) + side * (0.15 + d)
        B.add(bm, "white_stencil")
    for s in (-1, 1):
        decal("DUST OFF", 3.2, -27.0, 15.4, s, 15.0)
        decal("68-1977", 2.6, 27.0, 29.6, s, 14.0)
    probe.free()
    root = B.finish(name, sharp_deg=55)

    # ---- main rotor (2 blades + hub)
    Rb = Builder()
    Rb.cyl(3.6, -1.0, 2.6, "steel_dark", segs=10)
    Rb.box((14.0, 3.0, 1.8), (0, 0, 0.8), "steel_dark", bevel=0.4)
    for s in (-1, 1):
        blade = [(4.0, -2.4), (65.0, -2.3), (65.0, 2.3), (4.0, 2.5)]
        Rb.add(_prism(blade, -0.45, 0.45, bevel=0.2), "rotor_black", R('Z', 0 if s > 0 else 180) @ T(0, 0, 1.0))
        Rb.box((4.0, 4.7, 1.0), (s * 62.6, 0, 1.0), "yellow_stencil")      # painted tips
    Rb.lathe([(0, 2.6), (2.4, 2.6), (0, 5.2)], "steel_dark", segs=8)
    Rb.finish(name + "_rotor", origin=(0, -2.0, 46.5), parent=root)

    # ---- tail rotor (left side of the fin), spins about X
    Tr = Builder()
    Tr.cyl(1.8, -1.2, 1.2, "steel_dark", segs=8, M=R('Y', 90))
    for s in (-1, 1):
        Tr.box((0.7, 3.0, 10.5), (0, 0, s * 5.6), "rotor_black", bevel=0.15)
        Tr.box((0.75, 3.1, 1.6), (0, 0, s * 10.0), "white_stencil")
    Tr.finish(name + "_tail_rotor", origin=(-3.9, 65.8, 44.0), parent=root)

    # ---- beacon
    Be = Builder()
    Be.sphere(1.9, (0, 0, 0), "glow_redbeacon", u=10, v=6)
    Be.finish(name + "_beacon", origin=(0, 8.0, 42.4), parent=root)
    return root


# ==============================================================================================
# 3. Watchtower (the ball is shot between its front legs)
# ==============================================================================================
def make_watchtower(name="roxy", flag=True):
    """Bamboo watchtower. Root: legs, bracing, ladder. Children: {name}_torso (platform, hut,
    roof; pivot platform centre) > {name}_head (searchlight, pivot at its yoke) and
    {name}_arm_R (signal flag, pivot at the pole base). flag=False leaves the flag out
    (use a separate make_flagpole next to it instead)."""
    X = TOWER_X
    YB = 34.0               # back legs
    ZP = 92.0               # platform underside
    B = Builder()
    # legs: lashed bamboo, slightly splayed at the top inward (only above z=46)
    for s in (-1, 1):
        for y, r in ((0.0, 3.6), (YB, 3.0)):
            _bamboo(B, (s * X, y, 0.0), (s * X, y, 47.0), r)
            _bamboo(B, (s * X, y, 47.0), (s * (X - 3.5), y + (2.0 if y == 0 else -1.0), ZP + 1.0), r * 0.96)
            # stone/sandbag footing
            B.lathe([(r + 2.2, 0), (r + 2.0, 1.8), (r + 0.6, 2.6)], "sandbag_dark", segs=6, M=T(s * X, y, 0),
                    cap_start=False, cap_end=True)
        # side X-bracing in the leg planes (|x| ~ 26, allowed everywhere)
        for (z0, z1) in ((8, 44), (44, 8), (50, 86), (86, 50)):
            _bamboo(B, (s * (X - 0.2), 1.5, z0), (s * (X - 0.2 - (2.5 if z1 > 46 or z0 > 46 else 0)), YB - 1.5, z1), 1.4,
                    "bamboo_dark", node_every=30, segs=5)
        # rope lashings at the joints
        for y in (0.0, YB):
            B.add(A._torus(4.3, 0.9, 8, 3), "canvas", T(s * X, y, 46.6))
    # front and back cross bracing only above the ball tunnel
    for y in (1.0, YB - 1.0):
        _bamboo(B, (-X + 2.0, y, 52.0), (X - 2.0, y, 82.0), 1.4, "bamboo_dark", node_every=30, segs=5)
        _bamboo(B, (X - 2.0, y, 52.0), (-X + 2.0, y, 82.0), 1.4, "bamboo_dark", node_every=30, segs=5)
        _bamboo(B, (-X, y, 49.0), (X, y, 49.0), 1.6, "bamboo_dark", node_every=20, segs=5)
    # ladder on the back-left, outside the tunnel
    for xr in (-31.5, -23.5):
        _bamboo(B, (xr, YB + 18.0, 0.4), (xr, YB + 6.0, ZP + 2.0), 1.3, "bamboo_dark", node_every=24, segs=5)
    for i in range(1, 9):
        t = i / 9.0
        y = YB + 18.0 - 12.0 * t
        z = (ZP + 2.0) * t
        _bamboo(B, (-32.5, y, z), (-22.5, y, z), 0.9, "bamboo", node_every=40, segs=5)
    root = B.finish(name, sharp_deg=50)
    root.data.name = name

    # ---- platform, railing, hut and thatched roof (sways)
    PIV = (0.0, YB / 2, ZP + 3.0)
    Tb = Builder()
    # floor planks (bamboo poles side by side)
    for i in range(10):
        y = -10.0 + i * 5.65
        Tb.add(_limb((-33.5, y, ZP + 1.6), (33.5, y, ZP + 1.6), 2.3, 2.3, 5), "bamboo" if i % 3 else "bamboo_dark")
    Tb.box((70, 4.0, 3.0), (0, -12.0, ZP - 0.4), "bamboo_dark", bevel=0.6)
    Tb.box((70, 4.0, 3.0), (0, YB + 12.0, ZP - 0.4), "bamboo_dark", bevel=0.6)
    # railing posts and rails (front and sides), open gap at the back-left for the ladder
    rail_z = (ZP + 11.0, ZP + 18.5)
    posts = [(-32, -11), (-11, -11), (11, -11), (32, -11), (32, 15), (32, 44), (-32, 15)]
    for (x, y) in posts:
        _bamboo(Tb, (x, y, ZP + 3.0), (x, y, ZP + 21.0), 1.5, "bamboo_dark", node_every=40, segs=5)
    for z in rail_z:
        _bamboo(Tb, (-32, -11, z), (32, -11, z), 1.2, "bamboo", node_every=40, segs=5)
        _bamboo(Tb, (32, -11, z), (32, 44, z), 1.2, "bamboo", node_every=40, segs=5)
        _bamboo(Tb, (-32, -11, z), (-32, 15, z), 1.2, "bamboo", node_every=40, segs=5)
    # sandbags lining the front rail
    for i, x in enumerate((-22, -6, 10, 24)):
        _bag(Tb, (x, -8.5, ZP + 7.6), 0, 15.5, 7.0, 7.4, "sandbag" if i % 2 else "sandbag_dark", None)
    # hut: woven back wall + side walls (canvas / bamboo slats)
    Tb.box((58, 2.0, 30), (0, YB + 8.0, ZP + 18.0), "bamboo_dark", bevel=0.5)
    for i in range(9):
        Tb.box((1.6, 2.4, 30.5), (-26 + i * 6.5, YB + 6.8, ZP + 18.0), "bamboo", bevel=0.3)
    for s in (-1, 1):
        Tb.box((2.0, 26.0, 24.0), (s * 29.5, YB - 4.0, ZP + 15.0), "canvas", bevel=0.5)
    # corner roof posts
    for (x, y) in ((-30, -9), (30, -9), (-30, YB + 8), (30, YB + 8)):
        _bamboo(Tb, (x, y, ZP + 3.0), (x * 0.92, y + (1.0 if y < 0 else -0.5), ZP + 40.0), 1.6, "bamboo_dark",
                node_every=40, segs=6)
    # thatched roof: two overlapping hip layers with a ragged hem
    rng = random.Random(77)

    def thatch(top_z, base_z, half_x, half_y, cy, sag):
        """Hip roof: a squared-off lathe with a ragged, drooping hem; double sided."""
        prof = [(1.0, base_z - 0.0), (0.8, base_z + (top_z - base_z) * 0.22), (0.5, base_z + (top_z - base_z) * 0.6),
                (0.2, top_z - 1.5), (0.0, top_z)]
        bm = _lathe(prof, 20, cap_start=False, cap_end=False)
        for v in bm.verts:
            x, y, z = v.co
            r = math.hypot(x, y)
            if r < 1e-6:
                continue
            a = math.atan2(y, x)
            c, s_ = math.cos(a), math.sin(a)
            sq = max(abs(c), abs(s_))                 # superellipse-ish square plan
            v.co.x = c / sq * r * half_x * (0.92 + 0.08 * sq)
            v.co.y = s_ / sq * r * half_y * (0.92 + 0.08 * sq) + cy
            if abs(z - base_z) < 1e-6:
                v.co.z -= rng.uniform(0.0, sag)
                v.co.x *= 1 + rng.uniform(-0.03, 0.03)
            else:
                v.co.z += rng.uniform(-0.5, 0.5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        if sum(f.normal.z for f in bm.faces) < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        dup = bmesh.ops.duplicate(bm, geom=list(bm.faces))
        new_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
        bmesh.ops.reverse_faces(bm, faces=new_faces)
        moved = set()
        for f in new_faces:
            for v in f.verts:
                if v not in moved:
                    v.co.z -= 0.6
                    moved.add(v)
        return bm
    def banded(bm):
        # alternate light and dark bands of straw, read from the height of each face
        i0, i1 = Tb.mi("thatch"), Tb.mi("thatch_dark")
        for f in bm.faces:
            z = f.calc_center_median().z
            f.material_index = i1 if int((z - ZP) / 6.5) % 2 else i0
        return bm
    Tb.add(banded(thatch(ZP + 66.0, ZP + 38.0, 41.0, 31.0, YB / 2, 4.0)))
    Tb.add(banded(thatch(ZP + 70.0, ZP + 53.0, 27.0, 19.0, YB / 2, 3.0)))
    Tb.add(_tube([(-12, YB / 2, ZP + 69.6), (12, YB / 2, ZP + 69.6)], 1.4, sides=5), "bamboo_dark")
    # field radio crate and a lantern hook on the platform
    Tb.box((12, 8, 8), (20.0, 26.0, ZP + 7.0), "olive_drab", bevel=0.8)
    Tb.add(_tube([(23.5, 28.0, ZP + 11.0), (24.5, 28.5, ZP + 40.0)], 0.35, sides=4), "steel_dark")
    torso = Tb.finish(name + "_torso", origin=PIV, parent=root)
    for v in torso.data.vertices:
        v.co -= Vector(PIV) * MM

    # ---- searchlight on the front rail (head), pivot at its yoke
    YK = (12.0, -12.5, ZP + 21.0)
    H = Builder()
    H.cyl(1.2, -2.5, 0.0, "steel_dark", segs=6)                   # spindle down to the rail
    H.add(_tube([(-7.6, 0, 0), (-7.6, 0, 5.5), (7.6, 0, 5.5), (7.6, 0, 0)], 0.9, sides=5), "olive_dark")
    aim = T(0, 0, 5.5) @ R('X', 90 + 12)                         # barrel along -Y, tilted 12 deg down
    H.lathe([(0, -9), (5.0, -9), (6.4, -6.5), (6.6, 6.0), (7.2, 6.0), (7.2, 7.4), (6.2, 7.4)], "olive_drab", segs=12,
            M=aim, cap_end=False)
    for z in (-3.0, 1.5):
        H.lathe([(6.6, z), (7.3, z), (7.3, z + 1.0), (6.6, z + 1.0)], "olive_dark", segs=10, M=aim,
                cap_start=False, cap_end=False)
    H.lathe([(6.2, 7.0), (3.5, 7.4), (0, 7.6)], "glow_searchlight", segs=12, M=aim, cap_start=False)
    head = H.finish(name + "_head", origin=YK, parent=torso)
    head.location = (Vector(YK) - Vector(PIV)) * MM

    if not flag:
        _check_tower(root)
        return root
    # ---- signal flag on a short pole (arm), pivot at the pole base, waves about Y
    FP = (8.0, YB / 2, ZP + 67.0)          # on the roof ridge
    F = Builder()
    F.cyl(0.9, -3.0, 32.0, "bamboo_dark", segs=6)
    F.lathe([(0, 32.0), (1.5, 32.0), (0, 34.2)], "bamboo_dark", segs=6, cap_start=False)
    cloth = bmesh.new()
    cols, rows_ = 6, 3
    grid = [[None] * (cols + 1) for _ in range(rows_ + 1)]
    for r_ in range(rows_ + 1):
        for c_ in range(cols + 1):
            x = 1.0 + c_ * 3.4
            z = 31.0 - r_ * 4.6
            y = 1.3 * math.sin(c_ * 1.1) * (c_ / cols)
            grid[r_][c_] = cloth.verts.new((x, y, z - 0.25 * c_))
    faces = []
    for r_ in range(rows_):
        for c_ in range(cols):
            faces.append(cloth.faces.new((grid[r_][c_], grid[r_ + 1][c_], grid[r_ + 1][c_ + 1], grid[r_][c_ + 1])))
    bmesh.ops.recalc_face_normals(cloth, faces=cloth.faces)
    _double_side(cloth, 0.2)
    F.add(cloth, "yellow_stencil")
    # a green stripe on the flag
    F.box((20.4, 0.25, 2.6), (11.2, 0.0, 24.6), "glow_green")
    flag = F.finish(name + "_arm_R", origin=FP, parent=torso, smooth=False)
    flag.location = (Vector(FP) - Vector(PIV)) * MM

    # the shading call in finish() expects the root geometry centred; keep the origin on the floor
    _check_tower(root)
    return root


# ==============================================================================================
# 4. Fuel drum pop bumper
# ==============================================================================================
def _star(r_out, r_in, n=5):
    pts = []
    for i in range(2 * n):
        a = math.pi / 2 + i * math.pi / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def make_drum_bumper(name="bumper"):
    """Olive fuel drum. Same contract as assets.make_bumper: children {name}_ring (z=24),
    {name}_cap (origin z=38)."""
    B = Builder()
    B.lathe([(24, 3), (30, 3), (30, 4.4), (29.2, 5), (24, 5)], "khaki", segs=28, cap_start=False, cap_end=False)
    B.cyl(24, 0, 30, "olive_drab", segs=28, cap_start=False)
    for z in (9.5, 20.5):           # rolling hoops
        B.lathe([(24, z - 1.3), (25.3, z - 0.6), (25.3, z + 0.6), (24, z + 1.3)], "olive_dark", segs=28,
                cap_start=False, cap_end=False)
    B.lathe([(24.05, 12.4), (24.2, 12.4), (24.2, 17.6), (24.05, 17.6)], "yellow_stencil", segs=28,
            cap_start=False, cap_end=False)
    B.lathe([(24, 28.4), (25.0, 29.0), (25.0, 30.6), (23.5, 30.6)], "olive_dark", segs=28, cap_start=False, cap_end=False)
    B.cyl(13, 30, 38, "steel_dark", segs=16, cap_start=False, cap_end=False)
    root = B.finish(name)

    G = Builder()
    G.torus(31, 2, "steel", segs=28, sides=6)
    G.finish(name + "_ring", origin=(0, 0, 24), parent=root)

    C = Builder()
    C.lathe([(13, 0), (34, 0), (34, 9.5), (32.8, 11.2), (30.6, 11.2), (30.6, 9.6)], "olive_dark", segs=32,
            cap_start=False, cap_end=False)
    C.lathe([(30.6, 9.6), (20, 10.3), (0, 10.6)], "glow_amber_rotor", segs=32, cap_start=False)
    C.prism(_star(14.5, 6.0), 10.3, 12.0, "white_stencil", bevel=0.4, cap_bottom=False)
    for i in range(6):              # bung caps / bolts on the rim
        a = math.radians(i * 60 + 30)
        C.cyl(1.9, 9.5, 12.2, "steel", segs=6, M=T(32.2 * math.cos(a), 32.2 * math.sin(a), 0), cap_start=False)
    C.finish(name + "_cap", origin=(0, 0, 38), parent=root)
    return root


# ==============================================================================================
# 5. Drop target with stencil letter
# ==============================================================================================
def make_drop_target_stencil(name="droptarget", letter="E"):
    B = Builder()
    B.box((24, 6, 30), (0, 0, 17), "khaki", bevel=1.2)
    B.box((25.2, 6.6, 2.4), (0, 0, 31.0), "olive_dark", bevel=0.5)
    B.box((20, 8, 2), (0, 0, 1), "steel_dark")
    if letter == "*":
        # red five-pointed star instead of a letter
        pts = [(math.cos(math.radians(90 + k * 36)) * (8.5 if k % 2 == 0 else 3.4),
                math.sin(math.radians(90 + k * 36)) * (8.5 if k % 2 == 0 else 3.4)) for k in range(10)]
        B.add(_prism(pts, 0.0, 1.0), "glow_redbeacon", T(0, -3.0, 16.5) @ FACE_FRONT)
        return B.finish(name)
    bm, w = _text_piece(letter, 18.0, depth=1.0, max_points=90)
    if w > 18.0:
        k = 18.0 / w
        bmesh.ops.scale(bm, vec=(k, k, 1.0), verts=bm.verts)
    B.add(bm, "glow_amber_rotor", T(0, -3.0, 16.5) @ FACE_FRONT)
    return B.finish(name)


# ==============================================================================================
# 6. Radio station (replaces the amp stack)
# ==============================================================================================
def _crate(B, size, centre, m="wood_crate", batten="timber_dark", yaw=0.0):
    w, d, h = size
    M = T(*centre) @ R('Z', yaw)
    _lbox(B, (w, d, h), (0, 0, 0), m, 0.6, M)
    # battens on the front and back faces + corner posts
    for sy in (-1, 1):
        for sz in (-1, 1):
            _lbox(B, (w + 0.8, 1.2, 2.6), (0, sy * (d / 2 + 0.2), sz * (h / 2 - 1.6)), batten, 0.3, M)
        for sx in (-1, 1):
            _lbox(B, (2.6, 1.2, h - 0.4), (sx * (w / 2 - 1.6), sy * (d / 2 + 0.2), 0), batten, 0.3, M)


def make_radio_station(name="amp"):
    """Stacked supply crates with a field radio on top. Footprint ~110 x 55, faces -Y.
    Children: {name}_cone_0/_1 (speaker grilles), {name}_logo_glow (dial window)."""
    B = Builder()
    _crate(B, (110, 54, 52), (0, 0, 26))
    _label(B, "SUPPLY", 9.0, T(0, -27.6, 30.0) @ FACE_FRONT, "white_stencil", depth=0.4, max_points=200, max_width=70)
    _label(B, "68-11-04", 4.2, T(0, -27.6, 17.0) @ FACE_FRONT, "white_stencil", depth=0.35, max_points=160,
           max_width=40)
    _crate(B, (56, 46, 36), (-24, 2, 52 + 18), yaw=3)
    _label(B, "RADIO", 7.0, T(-24, -21.8, 72) @ R('Z', 3) @ FACE_FRONT, "yellow_stencil", depth=0.35, max_points=160,
           max_width=40)
    _crate(B, (44, 40, 26), (30, 4, 52 + 13), yaw=-5)
    _label(B, "RATIONS", 4.6, T(30, -16.4, 66.0) @ R('Z', -5) @ FACE_FRONT, "white_stencil", depth=0.35,
           max_points=160, max_width=34)
    # field radio set on the upper crate
    RX, RY, RZ = -24.0, -2.0, 88.0
    B.box((50, 30, 34), (RX, RY, RZ + 17), "olive_drab", bevel=1.6)
    B.box((52, 31.5, 3.0), (RX, RY, RZ + 34.5), "olive_dark", bevel=0.8)               # lid lip
    B.box((44, 0.8, 24), (RX, RY - 15.2, RZ + 18), "olive_dark", bevel=0.3)           # front panel
    for i, x in enumerate((-12.0, -4.0, 4.0)):
        B.cyl(2.1, 0, 2.6, "black_plastic", segs=8, M=T(RX + x, RY - 15.4, RZ + 10.5) @ R('X', 90))
    for x in (8.0, 14.0):
        B.box((2.0, 2.0, 5.0), (RX + x, RY - 16.0, RZ + 10.0), "steel_dark", bevel=0.3)   # toggle switches
    for s in (-1, 1):                                                                   # carry handles
        B.add(_tube([(RX + s * 25.6, RY - 7, RZ + 22), (RX + s * 28.0, RY - 7, RZ + 26), (RX + s * 28.0, RY + 7, RZ + 26),
                     (RX + s * 25.6, RY + 7, RZ + 22)], 0.9, sides=5), "steel_dark")
    # whip antenna on its base
    B.cyl(2.6, 0, 4.0, "black_plastic", segs=8, M=T(RX + 18, RY + 9, RZ + 36))
    B.add(_tube([(RX + 18, RY + 9, RZ + 39), (RX + 19.5, RY + 10.5, RZ + 62), (RX + 22.5, RY + 13, RZ + 88)], 0.55,
                sides=4), "rotor_black")
    B.sphere(1.3, (RX + 22.5, RY + 13, RZ + 88.5), "rotor_black", u=6, v=4)
    # handset hanging off the side on its coiled cord
    hx, hy = RX - 27.2, RY - 6.0
    B.add(_limb((hx, hy, RZ + 26.0), (hx, hy, RZ + 8.0), 1.8, 1.8, 6), "black_plastic")
    B.sphere(3.0, (hx, hy, RZ + 27.0), "black_plastic", u=8, v=5, scale=(0.9, 1.0, 1.25))
    B.sphere(3.0, (hx, hy, RZ + 7.0), "black_plastic", u=8, v=5, scale=(0.9, 1.0, 1.25))
    coil = []
    for i in range(40):
        t = i / 39
        a = t * 14 * math.pi
        coil.append((RX - 25.2 + 1.2 * math.cos(a), RY + 4 - 10 * t + 1.2 * math.sin(a), RZ + 24 - 8 * math.sin(t * math.pi)))
    B.add(_tube(coil, 0.35, sides=3), "black_plastic")
    # canvas tarp draped over the right crate corner
    B.box((26, 22, 1.2), (36, 10, 79.0), "canvas", bevel=0.4, M=R('Y', 0))
    root = B.finish(name, sharp_deg=40)

    for k, x in enumerate((-13.5, -3.0)):
        Cn = Builder()
        Cn.lathe([(0, 0), (4.8, 0), (4.8, 0.6), (4.0, 0.9)], "olive_dark", segs=14, M=R('X', 90), cap_start=False)
        Cn.lathe([(4.0, 0.9), (0, 0.4)], "grille", segs=14, M=R('X', 90), cap_start=False)
        for j in (-2.0, 0.0, 2.0):
            Cn.box((7.0, 0.5, 0.5), (0, -0.9, j), "steel_dark")
        Cn.finish("%s_cone_%d" % (name, k), origin=(RX + x, RY - 15.6, RZ + 23.0), parent=root)
    G = Builder()
    G.box((13.0, 0.6, 7.0), (0, 0, 0), "glow_amber_rotor", bevel=0.2)
    for j in range(5):
        G.box((0.3, 0.7, 4.6), (-5.0 + j * 2.5, -0.15, 0), "black_plastic")
    G.finish(name + "_logo_glow", origin=(RX + 11.0, RY - 15.8, RZ + 23.0), parent=root)
    return root


# ==============================================================================================
# 7. Antenna mast (replaces the tesla coil)
# ==============================================================================================
def make_antenna_mast(name="tesla"):
    rng = random.Random(5)
    B = Builder()
    for i in range(6):
        a = i * 60 + 15
        r = 10.5
        _bag(B, (r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), 3.0), a + 90, 11.5, 6.5, 6.0,
             "sandbag" if i % 2 else "sandbag_dark", rng, u=8, v=4)
    for i in range(3):
        a = i * 120 + 45
        r = 10.0
        _bag(B, (r * 0.55 * math.cos(math.radians(a)), r * 0.55 * math.sin(math.radians(a)), 8.2), a + 90, 10.5, 6.0,
             5.0, "sandbag", rng, u=8, v=4)
    # three-legged lattice mast
    legs = [(4.2 * math.cos(math.radians(90 + 120 * i)), 4.2 * math.sin(math.radians(90 + 120 * i))) for i in range(3)]
    top = 1.4
    for (x, y) in legs:
        B.add(_tube([(x, y, 6.0), (x * top / 4.2, y * top / 4.2, 74.0)], 0.75, sides=4), "olive_dark")
    for k in range(7):
        z0, z1 = 8.0 + k * 9.4, 8.0 + (k + 1) * 9.4
        f0, f1 = 1 - (z0 - 6) / 68 * (1 - top / 4.2), 1 - (z1 - 6) / 68 * (1 - top / 4.2)
        for i in range(3):
            a, b = legs[i], legs[(i + 1) % 3]
            B.add(_tube([(a[0] * f0, a[1] * f0, z0), (b[0] * f1, b[1] * f1, z1)], 0.35, sides=3), "steel_dark")
    B.cyl(1.0, 74, 79, "steel_dark", segs=6)
    # dipole arms near the top
    for a in (0, 120, 240):
        B.add(_tube([(0, 0, 66), (9 * math.cos(math.radians(a)), 9 * math.sin(math.radians(a)), 63.5)], 0.45, sides=4),
              "steel_dark")
    # guy wires to pegs
    for i in range(3):
        a = math.radians(30 + 120 * i)
        px, py = 15.5 * math.cos(a), 15.5 * math.sin(a)
        B.add(_tube([(0.6 * math.cos(a), 0.6 * math.sin(a), 58), (px, py, 0.8)], 0.22, sides=3), "steel_dark")
        B.cyl(0.7, 0, 2.2, "steel_dark", segs=4, M=T(px, py, 0))
    # stencil band on the base bags
    root = B.finish(name, sharp_deg=55)
    G = Builder()
    G.sphere(5.0, (0, 0, 0), "glow_redbeacon", u=12, v=8)
    G.finish(name + "_glow", origin=(0, 0, 80), parent=root)
    # beacon cage
    return root


# ==============================================================================================
# 8. Smoke canister (replaces the flame pot)
# ==============================================================================================
def make_smoke_canister(name="flamepot"):
    rng = random.Random(11)
    B = Builder()
    for i in range(4):
        a = i * 90 + 45
        _bag(B, (7.0 * math.cos(math.radians(a)), 7.0 * math.sin(math.radians(a)), 2.6), a + 90, 9.0, 5.2, 5.0,
             "sandbag" if i % 2 else "sandbag_dark", rng, u=6, v=4)
    B.lathe([(0, 2.0), (5.2, 2.0), (5.2, 16.2), (4.6, 16.8), (4.6, 18.4), (3.8, 18.4)], "olive_drab", segs=12,
            cap_end=False)
    B.lathe([(5.25, 8.6), (5.4, 8.6), (5.4, 12.2), (5.25, 12.2)], "glow_green", segs=12, cap_start=False, cap_end=False)
    B.lathe([(3.8, 18.4), (3.8, 18.9), (3.0, 18.9)], "steel_dark", segs=12, cap_start=False, cap_end=False)
    B.add(_tube([(5.2, 0, 14.5), (6.6, 0, 16.0), (6.6, 0, 18.6), (2.0, 0, 19.6)], 0.4, sides=3), "steel_dark")   # spoon
    root = B.finish(name)
    G = Builder()
    G.lathe([(3.0, 0), (0, 0.3)], "glow_green", segs=10, cap_start=False)
    G.finish(name + "_glow", origin=(0, 0, 19.0), parent=root)
    return root


# ==============================================================================================
# 9. Palm tree
# ==============================================================================================
def make_palm(name="palm", height=240, seed=3):
    rng = random.Random(seed)
    B = Builder()
    # trunk: curved, tapering, ringed
    n = 22
    lean = rng.uniform(18, 30)
    yaw = rng.uniform(0, 2 * math.pi)
    centres = []
    for i in range(n + 1):
        t = i / n
        off = lean * t * t
        centres.append(Vector((off * math.cos(yaw), off * math.sin(yaw), height * 0.92 * t)))
    bm = bmesh.new()
    sides = 8
    rings = []
    for i, c in enumerate(centres):
        t = i / n
        r = (7.0 - 3.0 * t) * (1.08 if i % 2 else 0.96)
        if i < 2:
            r *= 1.35 - 0.15 * i
        d = (centres[min(n, i + 1)] - centres[max(0, i - 1)]).normalized()
        q = Vector((0, 0, 1)).rotation_difference(d)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(bm.verts.new(c + q @ Vector((r * math.cos(a), r * math.sin(a), 0))))
        rings.append(ring)
    for i in range(n):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    B.add(bm, "palm_trunk")
    crown = centres[-1] + Vector((0, 0, 2))
    for i in range(4):
        a = i * 1.7
        B.sphere(3.4, tuple(crown + Vector((4.2 * math.cos(a), 4.2 * math.sin(a), -4.5))), "palm_trunk", u=8, v=5)
    # fronds
    nf = 11
    for f in range(nf):
        az = 2 * math.pi * f / nf + rng.uniform(-0.2, 0.2)
        length = rng.uniform(78, 100)
        up = rng.uniform(0.45, 0.9) if f % 2 else rng.uniform(0.15, 0.45)
        segs = 9
        rib = []
        for s in range(segs + 1):
            t = s / segs
            horiz = length * t
            z = length * (up * t - 0.95 * t * t)
            rib.append(crown + Vector((horiz * math.cos(az), horiz * math.sin(az), z)))
        B.add(_tube(rib, 0.9, sides=3), "palm_trunk")
        leaf = bmesh.new()
        side_dir = Vector((-math.sin(az), math.cos(az), 0))
        for s in range(1, segs + 1):
            t = s / segs
            p0, p1 = rib[s - 1], rib[s]
            w = 19.0 * math.sin(min(1.0, t * 1.1) * math.pi) + 3.0
            for sg in (-1, 1):
                tip = p1 + side_dir * (sg * w) + Vector((0, 0, -w * 0.55))
                a = leaf.verts.new(p0)
                b = leaf.verts.new(p1)
                c = leaf.verts.new(tip)
                fc = leaf.faces.new((a, b, c) if sg > 0 else (b, a, c))
        bmesh.ops.recalc_face_normals(leaf, faces=leaf.faces)
        for fc in leaf.faces:
            fc.normal_update()
            if fc.normal.z < 0:
                fc.normal_flip()
        _double_side(leaf, 0.25)
        B.add(leaf, "palm_leaf")
    root = B.finish(name, sharp_deg=70)
    return root


# ==============================================================================================
# 10. Searchlight (replaces the PAR can)
# ==============================================================================================
def make_searchlight(name="par"):
    """Origin = mount point (top). Points -Y, 35 deg downward. Child {name}_glow (lens)."""
    B = Builder()
    pivot = Vector((0, 0, -30))
    aim = T(*pivot) @ R('X', 90 + 35)
    B.lathe([(0, -17), (9.5, -17), (14.5, -12), (17.5, -6), (17.5, 15.5), (18.6, 15.5), (18.6, 18.0), (16.4, 18.0),
             (16.4, 16.0)], "olive_drab", segs=12, M=aim, cap_end=False)
    for z in (-8.0, -3.0):                # cooling ribs
        B.lathe([(17.5, z), (18.6, z), (18.6, z + 1.4), (17.5, z + 1.4)], "olive_dark", segs=12, M=aim,
                cap_start=False, cap_end=False)
    for i in range(5):                    # louvres across the lens
        x = -12 + i * 6
        chord = 2 * math.sqrt(max(0.0, 16.6 ** 2 - x * x))
        _lbox(B, (1.0, chord, 1.4), (x, 0, 17.6), "olive_dark", 0.0, aim)
    B.tube([(-21.0, 0, -30), (-21.0, 0, -6), (-16, 0, -2), (16, 0, -2), (21.0, 0, -6), (21.0, 0, -30)], 1.7,
           "olive_dark", sides=5)
    B.cyl(2.6, -2, 0, "steel_dark", segs=8)
    for s in (-1, 1):
        B.cyl(3.4, 0, 2.4, "steel_dark", segs=6, M=T(s * 21.0, 0, -30) @ R('Y', s * 90), cap_start=False)
    root = B.finish(name)
    G = Builder()
    G.lathe([(16.4, 0), (9, 0.8), (0, 1.2)], "glow_searchlight", segs=16, M=R('X', 90 + 35), cap_start=False)
    lens = pivot + (R('X', 90 + 35).to_3x3() @ Vector((0, 0, 16.2)))
    G.finish(name + "_glow", origin=tuple(lens), parent=root)
    return root


# ==============================================================================================
# 11. Logo in stencil letters
# ==============================================================================================
def make_logo_stencil(name="logo", text="ROTORSTURM", width=420):
    depth = 8.0
    with _stencil():
        txt, w, h = A._text_solid(text, max_points=1600, depth=1.0)
    k = width / w
    bmesh.ops.transform(txt, matrix=R('X', 90) @ S(k, k, depth), verts=txt.verts)
    for f in txt.faces:
        f.normal_update()
    front = bmesh.new()
    vmap = {}
    front_faces = [f for f in txt.faces if f.normal.y < -0.95]
    for f in front_faces:
        vs = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = front.verts.new(v.co)
            vs.append(vmap[v])
        front.faces.new(vs)
    bmesh.ops.delete(txt, geom=front_faces, context='FACES')
    bmesh.ops.delete(txt, geom=[f for f in txt.faces if f.normal.y > 0.95], context='FACES')
    B = Builder()
    B.add(txt, "steel")
    root = B.finish(name, sharp_deg=30)
    G = Builder()
    G.add(front, "glow_amber_rotor")
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root, smooth=False)
    return root


# ==============================================================================================
# 12. Crate stack  /  13. Sandbag wall
# ==============================================================================================
def _arrow(B, M, m="white_stencil", size=6.0):
    pts = [(0, size), (size * 0.75, size * 0.2), (size * 0.28, size * 0.2), (size * 0.28, -size),
           (-size * 0.28, -size), (-size * 0.28, size * 0.2), (-size * 0.75, size * 0.2)]
    B.add(_prism(pts, 0, 0.4), m, M)


def make_crate_stack(name="crates"):
    B = Builder()
    B.box((40, 30, 22), (-8, 0, 11), "wood_crate", bevel=0.6)
    for sy in (-1, 1):
        for sz in (-1, 1):
            B.box((40.6, 1.0, 2.2), (-8, sy * 15.2, 11 + sz * 9.2), "timber_dark", bevel=0.25)
    _label(B, "SUPPLY", 5.2, T(-8, -15.75, 11.0) @ FACE_FRONT, "white_stencil", depth=0.35, max_points=150,
           max_width=30)
    B.box((26, 22, 18), (-12, 2, 31), "olive_drab", bevel=0.8, M=R('Z', 0))
    B.box((27, 23, 1.6), (-12, 2, 39.4), "olive_dark", bevel=0.4)
    _label(B, "MED", 6.0, T(-12, -9.2, 31.0) @ FACE_FRONT, "white_stencil", depth=0.35, max_points=90, max_width=18)
    B.box((20, 26, 16), (22, -1, 8), "wood_crate", bevel=0.6, M=T(0, 0, 0) @ R('Z', 0))
    for sz in (-1, 1):
        B.box((20.6, 26.6, 1.6), (22, -1, 8 + sz * 6.6), "timber_dark", bevel=0.25)
    _arrow(B, T(22, -14.4, 8) @ FACE_FRONT, size=4.4)
    B.box((14, 10, 7), (20, 2, 19.5), "olive_drab", bevel=0.8)      # ammo-box sized supply tin (closed)
    B.add(_tube([(15, 2, 23.0), (15, 2, 24.6), (25, 2, 24.6), (25, 2, 23.0)], 0.5, sides=4), "steel_dark")
    return B.finish(name, sharp_deg=40)


def make_sandbag_wall(name="sandbags", length=120):
    rng = random.Random(length)
    B = Builder()
    rows = 3
    h = 7.4
    sag = 10.0
    bag_len = 15.5
    for k in range(rows):
        off = bag_len / 2 if k % 2 else 0.0
        n = int(length // bag_len) - (k % 2) - (1 if k == rows - 1 else 0)
        x0 = -(n * bag_len) / 2 + bag_len / 2
        for i in range(n):
            x = x0 + bag_len * i
            t = x / (length / 2)
            y = sag * (1 - t * t)
            dy = -2 * sag * t / (length / 2)
            yaw = math.degrees(math.atan(dy))
            m = "sandbag_dark" if rng.random() < 0.3 else "sandbag"
            _bag(B, (x, y + k * 0.8, h / 2 + k * h), yaw, bag_len * 1.04, 10.0 - k * 0.8, h, m, rng, u=8, v=4)
    return B.finish(name, sharp_deg=62)


# ==============================================================================================
# ROTORSTURM, redesigned table: dioramas and toys (village, Cu Chi arch, helmet saucer,
# M16 diverter, helipad, star bumpers, bushes, flagpole, signboards, scoop bunker)
# ==============================================================================================
materials.SPECS.update({
    "rock":             ((0.22, 0.19, 0.15), 0.00, 0.90, None),
    "rock_dark":        ((0.11, 0.095, 0.075), 0.00, 0.92, None),
    "grass":            ((0.15, 0.23, 0.06), 0.00, 0.85, None),
    "weave":            ((0.42, 0.31, 0.14), 0.00, 0.90, None),
    "clay":             ((0.46, 0.24, 0.11), 0.00, 0.65, None),
    "leaf_light":       ((0.17, 0.34, 0.07), 0.00, 0.55, None),
    "leaf_dark":        ((0.035, 0.11, 0.03), 0.00, 0.60, None),
    "leaf_yellow":      ((0.34, 0.37, 0.08), 0.00, 0.60, None),
    "camo_brown":       ((0.24, 0.17, 0.08), 0.00, 0.80, None),
    "gun_grey":         ((0.06, 0.06, 0.06), 0.55, 0.42, None),
    "gun_black":        ((0.025, 0.025, 0.025), 0.10, 0.60, None),
    "psp_steel":        ((0.34, 0.35, 0.31), 0.70, 0.55, None),
    "psp_dark":         ((0.15, 0.155, 0.13), 0.70, 0.60, None),
    "psp_hole":         ((0.01, 0.01, 0.01), 0.00, 0.90, None),
    "corrugated":       ((0.30, 0.29, 0.25), 0.65, 0.55, None),
    "sign_face":        ((0.74, 0.66, 0.48), 0.00, 0.80, None),
    "flag_cloth":       ((0.90, 0.90, 0.88), 0.00, 0.80, None),
    "star_yellow":      ((0.95, 0.74, 0.05), 0.30, 0.35, None),
    "glow_cap_red":     ((0.0, 0.0, 0.0), 0.00, 0.40, (1.00, 0.04, 0.02)),
    "glow_cap_olive":   ((0.0, 0.0, 0.0), 0.00, 0.40, (0.36, 0.44, 0.10)),
    "glow_star_yellow": ((0.0, 0.0, 0.0), 0.00, 0.40, (1.00, 0.72, 0.05)),
    "glow_lantern":     ((0.0, 0.0, 0.0), 0.00, 0.50, (1.00, 0.52, 0.12)),
    "glow_lamp_dim":    ((0.0, 0.0, 0.0), 0.00, 0.50, (0.55, 0.22, 0.05)),
})


# ------------------------------------------------------------------------------ helpers
def _finish_at(B, name, pivot, parent=None, parent_pivot=(0.0, 0.0, 0.0), smooth=True, sharp_deg=38.0):
    """Finish a Builder whose geometry is in world mm, so that the object origin sits on `pivot`
    (world mm) and its location is expressed in the parent's space."""
    ob = B.finish(name, parent=parent, smooth=smooth, sharp_deg=sharp_deg)
    off = Vector(pivot) * MM
    for v in ob.data.vertices:
        v.co -= off
    ob.location = (Vector(pivot) - Vector(parent_pivot)) * MM
    return ob


def _uv_obj(name, verts, faces, uvs, mat_name, parent=None, pivot=(0.0, 0.0, 0.0), parent_pivot=(0.0, 0.0, 0.0)):
    """Mesh with one UV map (uvs indexed per vertex). verts in world mm; origin at `pivot`."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(v) - Vector(pivot)) for v in verts]
    uv = bm.loops.layers.uv.new("UVMap")
    for f in faces:
        face = bm.faces.new([vs[i] for i in f])
        face.smooth = False
        for loop, i in zip(face.loops, f):
            loop[uv].uv = uvs[i]
    bmesh.ops.scale(bm, vec=(MM, MM, MM), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat(mat_name))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (Vector(pivot) - Vector(parent_pivot)) * MM
    if parent is not None:
        ob.parent = parent
    return ob


def _quad(B, centre, w, h, m, yaw=0.0, z_up=True):
    """Flat quad on a horizontal plane facing +Z."""
    bm = bmesh.new()
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    bm.faces.new(vs)
    B.add(bm, m, T(*centre) @ R('Z', yaw))


def _face_up(bm):
    bm.normal_update()
    if sum(f.normal.z * f.calc_area() for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))


def _leaf(B, base, az, elev, length, width, droop=0.7, m="leaf_light", segs=4, fold=0.22, roll=0.0):
    """Leaf blade (double sided): a strip along a curved midrib, folded slightly along the rib."""
    a, e = math.radians(az), math.radians(elev)
    fwd = Vector((math.cos(a), math.sin(a), 0.0))
    side = Vector((-math.sin(a), math.cos(a), 0.0))
    base = Vector(base)
    bm = bmesh.new()
    rows = []
    for i in range(segs):
        t = i / segs
        p = base + fwd * (length * t * math.cos(e)) + Vector((0, 0, length * (math.sin(e) * t - droop * t * t)))
        w = width * 0.5 * (math.sin(math.pi * (0.12 + 0.88 * t)) ** 0.7)
        lift = Vector((0, 0, fold * w))
        sd = side * w + Vector((0, 0, roll * w))
        rows.append((bm.verts.new(p - sd - lift * 0.0 + Vector((0, 0, -fold * w))), bm.verts.new(p + lift * 0.4),
                     bm.verts.new(p + sd + Vector((0, 0, -fold * w)))))
    t = 1.0
    tip = bm.verts.new(base + fwd * (length * math.cos(e)) + Vector((0, 0, length * (math.sin(e) - droop))))
    for i in range(segs - 1):
        l0, m0, r0 = rows[i]
        l1, m1, r1 = rows[i + 1]
        bm.faces.new((l0, m0, m1, l1))
        bm.faces.new((m0, r0, r1, m1))
    l0, m0, r0 = rows[-1]
    bm.faces.new((l0, m0, tip))
    bm.faces.new((m0, r0, tip))
    _face_up(bm)
    _double_side(bm, 0.25)
    B.add(bm, m)


def _boulder(rng, centre, radii, noise=0.22, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    ph = [rng.uniform(0, 6.3) for _ in range(3)]
    for v in bm.verts:
        d = v.co.normalized()
        k = 1.0 + noise * (math.sin(3.1 * d.x + ph[0]) * math.sin(2.7 * d.y + ph[1]) + 0.6 * math.sin(4.3 * d.z + ph[2]))
        v.co = Vector((d.x * radii[0] * k, d.y * radii[1] * k, d.z * radii[2] * k)) + Vector(centre)
    return bm


def _terrain(B, xs, ys, hfun, skip=None, grass_above=4.0):
    """Height field mound (faces up). Faces whose centre `skip(x, y)` are left out."""
    bm = bmesh.new()
    grid = {}
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            grid[i, j] = bm.verts.new((x, y, hfun(x, y)))
    i_g, i_m = B.mi("grass"), B.mi("mud")
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if skip and skip(cx, cy):
                continue
            f = bm.faces.new((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
            f.normal_update()
            z = f.calc_center_median().z
            f.material_index = i_g if (z > grass_above and f.normal.z > 0.55) else i_m
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    B.add(bm, None)


def _check_clear(root, box, label, ignore=()):
    (x0, x1), (y0, y1), (z0, z1) = box
    for p, name in _world_verts(root):
        if any(name.endswith(s) for s in ignore):
            continue
        if x0 < p.x < x1 and y0 < p.y < y1 and z0 < p.z < z1:
            raise RuntimeError("%s: clearance obstructed by %s at %s" % (label, name, tuple(round(c, 1) for c in p)))


def _lin(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


# ==============================================================================================
# 14. Village with a scoop
# ==============================================================================================
def _village_h(x, y):
    u, v = (x + 48.0) / 100.0, (y + 34.0) / 94.0
    if u <= 0 or u >= 1 or v <= 0 or v >= 1:
        return 0.0
    win = (math.sin(math.pi * u) ** 1.1) * (math.sin(math.pi * v) ** 1.0)
    base = 36.0 * win * (0.55 + 0.45 * math.exp(-(x / 40.0) ** 2 - ((y - 30.0) / 30.0) ** 2))
    noise = 1.6 * math.sin(x * 0.21 + y * 0.13) + 1.2 * math.sin(y * 0.27 - x * 0.11)
    return max(0.0, base + noise * win)


def _thatch_gable(B, M, half_x, half_y, eave_z, ridge_z, rng, overhang=7.0):
    """Gabled thatch roof in the hut frame M (ridge along local X), double sided, banded."""
    i0, i1 = B.mi("thatch"), B.mi("thatch_dark")
    for sy in (-1, 1):
        bm = bmesh.new()
        cols, rows = 6, 3
        grid = {}
        for c in range(cols + 1):
            for r in range(rows + 1):
                x = -half_x - overhang + (2 * (half_x + overhang)) * c / cols
                t = r / rows                      # 0 at the ridge, 1 at the eave
                y = sy * (half_y + overhang) * t
                z = ridge_z + (eave_z - ridge_z) * t - 0.8 * math.sin(math.pi * t)
                if r == rows:
                    z -= rng.uniform(0.0, 2.5)
                    y += sy * rng.uniform(-0.6, 1.2)
                grid[c, r] = bm.verts.new(M @ Vector((x, y, z)))
        for c in range(cols):
            for r in range(rows):
                f = bm.faces.new((grid[c, r], grid[c + 1, r], grid[c + 1, r + 1], grid[c, r + 1]))
                f.material_index = i1 if r % 2 else i0
        _face_up(bm)
        _double_side(bm, 0.7)
        B.add(bm, None)
    # ridge bundle
    B.add(_tube([tuple(M @ Vector((-half_x - overhang, 0, ridge_z + 0.6))), tuple(M @ Vector((half_x + overhang, 0, ridge_z + 0.6)))],
                1.6, sides=5), "thatch_dark")
    # gable walls (woven), double sided
    for sx in (-1, 1):
        bm = bmesh.new()
        a = bm.verts.new(M @ Vector((sx * half_x, -half_y, eave_z + 1.5)))
        b = bm.verts.new(M @ Vector((sx * half_x, half_y, eave_z + 1.5)))
        c = bm.verts.new(M @ Vector((sx * half_x, 0, ridge_z - 1.0)))
        bm.faces.new((a, b, c))
        bm.normal_update()
        _double_side(bm, 0.5)
        B.add(bm, "weave")


def _thatch_hip(B, M, half_x, half_y, base_z, top_z, rng, sag=3.0, base_ref=None):
    """Steep hip roof of thatch (squared lathe with a ragged hem), double sided, banded."""
    prof = [(1.0, base_z), (0.78, base_z + (top_z - base_z) * 0.25), (0.48, base_z + (top_z - base_z) * 0.6),
            (0.18, top_z - 1.2), (0.0, top_z)]
    bm = _lathe(prof, 16, cap_start=False, cap_end=False)
    for v in bm.verts:
        x, y, z = v.co
        r = math.hypot(x, y)
        if r < 1e-6:
            continue
        a = math.atan2(y, x)
        c, s_ = math.cos(a), math.sin(a)
        sq = max(abs(c), abs(s_))
        v.co.x = c / sq * r * half_x * (0.9 + 0.1 * sq)
        v.co.y = s_ / sq * r * half_y * (0.9 + 0.1 * sq)
        if abs(z - base_z) < 1e-6:
            v.co.z -= rng.uniform(0.0, sag)
        else:
            v.co.z += rng.uniform(-0.4, 0.4)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    _face_up(bm)
    i0, i1 = B.mi("thatch"), B.mi("thatch_dark")
    for f in bm.faces:
        f.material_index = i1 if int((f.calc_center_median().z - base_z) / 5.0) % 2 else i0
    _double_side(bm, 0.6)
    B.add(bm, None)


def _hut(B, G, rng, cx, cy, w, d, stilt, wall_h, roof_h, yaw, ladder=True, lantern=False):
    M = T(cx, cy, 0) @ R('Z', yaw)
    gz = min(_village_h(*(M @ Vector((sx * (w / 2 - 2), sy * (d / 2 - 2), 0))).xy) for sx in (-1, 1) for sy in (-1, 1))
    floor_z = gz + stilt
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = M @ Vector((sx * (w / 2 - 2), sy * (d / 2 - 2), 0))
            g = _village_h(p.x, p.y)
            _bamboo(B, (p.x, p.y, max(0.0, g - 2.0)), (p.x, p.y, floor_z + 0.5), 1.5, "bamboo_dark", node_every=12, segs=5)
    _lbox(B, (w + 5, d + 5, 2.2), (0, 0, floor_z + 1.1), "bamboo_dark", 0.4, M)
    B.add(_limb(tuple(M @ Vector((-w / 2 - 2.5, -d / 2 - 2.6, floor_z + 2.4))),
                tuple(M @ Vector((w / 2 + 2.5, -d / 2 - 2.6, floor_z + 2.4))), 0.9, 0.9, 4), "bamboo")     # porch edge pole
    wz = floor_z + 2.2
    _lbox(B, (w, d, wall_h), (0, 0, wz + wall_h / 2), "weave", 0.4, M)
    for i in range(7):                                       # vertical slats on the front
        _lbox(B, (1.3, 0.8, wall_h + 0.4), (-w / 2 + 1.5 + i * (w - 3) / 6, -d / 2 - 0.35, wz + wall_h / 2), "bamboo", 0.2, M)
    _lbox(B, (6.5, 0.6, 10.0), (-w / 2 + 6.5, -d / 2 - 0.85, wz + 5.0), "black_plastic", 0.0, M)       # doorway
    # window glow
    _lbox(G, (5.5, 0.5, 4.2), (w / 2 - 6.0, -d / 2 - 0.9, wz + wall_h * 0.6), "glow_lantern", 0.0, M)
    for k in range(2):
        _lbox(B, (0.6, 0.7, 4.6), (w / 2 - 7.5 + k * 3.0, -d / 2 - 1.15, wz + wall_h * 0.6), "bamboo_dark", 0.0, M)
    _thatch_hip(B, M, w / 2 + 7.0, d / 2 + 7.0, wz + wall_h - 2.0, wz + wall_h + roof_h, rng)
    B.add(_limb(tuple(M @ Vector((0, 0, wz + wall_h + roof_h - 1.0))), tuple(M @ Vector((0, 0, wz + wall_h + roof_h + 4.0))), 1.2, 0.4, 5), "bamboo_dark")
    if ladder:
        foot = M @ Vector((-w / 2 + 6.5, -d / 2 - 13.0, 0))
        gl = _village_h(foot.x, foot.y)
        for dx in (-3.0, 3.0):
            a = M @ Vector((-w / 2 + 6.5 + dx, -d / 2 - 13.0, 0))
            b = M @ Vector((-w / 2 + 6.5 + dx, -d / 2 - 2.5, 0))
            B.add(_limb((a.x, a.y, gl - 1.0), (b.x, b.y, floor_z + 2.2), 0.8, 0.8, 4), "bamboo")
        for k in range(1, 5):
            t = k / 5
            a = M @ Vector((-w / 2 + 3.0, -d / 2 - 13.0 + 10.5 * t, 0))
            b = M @ Vector((-w / 2 + 10.0, -d / 2 - 13.0 + 10.5 * t, 0))
            z = gl + (floor_z + 2.2 - gl) * t
            B.add(_limb((a.x, a.y, z), (b.x, b.y, z), 0.55, 0.55, 4), "bamboo_dark")
    if lantern:
        p = M @ Vector((w / 2 + 1.0, -d / 2 - 3.5, wz + wall_h - 3.0))
        B.add(_tube([(p.x, p.y, p.z + 6.0), (p.x, p.y, p.z + 2.2)], 0.25, sides=3), "steel_dark")
        B.cyl(2.4, p.z + 2.0, p.z + 2.8, "steel_dark", segs=8, r2=1.2, M=T(p.x, p.y, 0))
        G.sphere(2.0, (p.x, p.y, p.z), "glow_lantern", u=8, v=5, scale=(1, 1, 1.25))


def _banana(B, rng, x, y, ground, h=22.0, n=5, scale=1.0):
    top = (x, y, ground + h)
    B.add(_limb((x, y, ground - 1.0), top, 2.6 * scale, 1.7 * scale, 6), "palm_trunk")
    for i in range(n):
        az = i * 360.0 / n + rng.uniform(-20, 20)
        _leaf(B, top, az, rng.uniform(35, 60), rng.uniform(30, 42) * scale, rng.uniform(11, 15) * scale,
              droop=rng.uniform(0.8, 1.1), m=rng.choice(("leaf_light", "leaf_light", "palm_leaf", "leaf_yellow")), segs=4)


def make_village(name="village"):
    """Thatched huts on stilts on a mound, with a ground-level scoop.
    Origin = centre of the scoop hole. Clear scoop: x -18..18, z 0..32, y -32..+6.
    Child {name}_glow: lanterns and lit windows."""
    rng = random.Random(1968)
    B = Builder()
    G = Builder()
    xs = sorted(set(_lin(-48.0, 52.0, 14) + [-21.0, 21.0]))
    ys = sorted(set(_lin(-34.0, 60.0, 13) + [9.0]))
    _terrain(B, xs, ys, _village_h, skip=lambda x, y: abs(x) < 21.0 and y < 9.0, grass_above=1.5)
    # scoop: timber revetment walls, dark back wall and ceiling, log lintel, earth cap
    for sx in (-1, 1):
        B.box((3.0, 41.0, 33.0), (sx * 19.5, -12.5, 16.5), "timber_dark", bevel=0.4)
        for k in range(5):
            B.box((0.8, 1.6, 33.4), (sx * 21.4, -30.0 + k * 8.5, 16.7), "bamboo_dark")
        B.add(_limb((sx * 20.6, -31.0, 0.0), (sx * 20.6, -31.0, 37.5), 2.4, 2.1, 7), "timber_dark")
    B.box((42.0, 3.0, 34.0), (0, 7.5, 17.0), "black_plastic")
    B.box((42.0, 41.0, 2.5), (0, -12.5, 33.25), "timber_dark")
    B.add(_limb((-25.0, -31.0, 35.8), (25.0, -31.0, 35.8), 2.6, 2.6, 8), "timber_dark")
    cap = _pillow(54.0, 46.0, 17.0, u=14, v=8, power=0.7)
    i_g, i_m = B.mi("grass"), B.mi("mud")
    for f in cap.faces:
        f.material_index = i_g if f.calc_center_median().z > -2.0 else i_m
    B.add(cap, None, T(0, -10.0, 41.5))
    for i in range(9):
        x = -20 + i * 5.0 + rng.uniform(-1.2, 1.2)
        _leaf(B, (x, -12.0 + rng.uniform(-9, 9), 48.5), rng.uniform(0, 360), 30, rng.uniform(10, 14), rng.uniform(4, 6),
              droop=0.9, m=rng.choice(("grass", "leaf_light", "leaf_yellow")), segs=3)
    # huts
    _hut(B, G, rng, -24.0, 34.0, 32.0, 23.0, 19.0, 16.0, 27.0, -8.0, ladder=True, lantern=True)
    _hut(B, G, rng, 27.0, 40.0, 26.0, 20.0, 16.0, 14.0, 23.0, 11.0, ladder=False)
    # rice straw stack
    sx_, sy_ = -37.0, -12.0
    g = _village_h(sx_, sy_)
    piece = _lathe([(0, 0), (9.0, 0), (10.0, 5.0), (9.2, 12.0), (6.5, 17.0), (2.5, 21.5), (0, 23.0)], 12, cap_start=False)
    i0, i1 = B.mi("thatch"), B.mi("thatch_dark")
    for f in piece.faces:
        f.material_index = i1 if int(f.calc_center_median().z / 4.0) % 2 else i0
    B.add(piece, None, T(sx_, sy_, g - 1.0))
    B.add(_limb((sx_, sy_, g + 21.0), (sx_, sy_, g + 27.0), 0.7, 0.4, 4), "bamboo_dark")
    # water jar and a basket by the scoop
    jx, jy = 35.0, -20.0
    g = _village_h(jx, jy)
    B.lathe([(0, 0), (5.0, 0), (7.4, 3.6), (8.0, 8.0), (6.6, 12.0), (4.0, 14.0), (4.4, 15.4), (0, 15.4)],
            "clay", segs=12, M=T(jx, jy, g - 0.8))
    B.lathe([(3.6, 15.5), (0, 15.5)], "psp_hole", segs=12, M=T(jx, jy, g - 0.8), cap_start=False)
    g = _village_h(44.0, -6.0)
    B.lathe([(0, 0), (5.5, 0), (6.5, 5.5), (6.2, 6.0)], "weave", segs=10, M=T(44.0, -6.0, g - 0.5), cap_end=False)
    # banana plants and ferns
    _banana(B, rng, 36.0, 20.0, _village_h(36.0, 20.0), 24.0, 5, 0.75)
    _banana(B, rng, -36.0, 48.0, _village_h(-36.0, 48.0), 20.0, 5, 0.7)
    _banana(B, rng, 4.0, 50.0, _village_h(4.0, 50.0), 18.0, 4, 0.65)
    for (x, y) in ((-33.0, -26.0), (31.0, -29.0), (-44.0, 18.0), (47.0, 46.0), (0.0, 20.0)):
        g = _village_h(x, y)
        for k in range(5):
            _leaf(B, (x, y, g), k * 72 + rng.uniform(-15, 15), rng.uniform(30, 55), rng.uniform(11, 16), rng.uniform(4, 6),
                  droop=0.9, m=rng.choice(("leaf_dark", "leaf_light", "palm_leaf")), segs=3)
    root = B.finish(name, sharp_deg=50)
    for v in root.data.vertices:          # keep stray leaf tips inside the footprint
        v.co.x = min(max(v.co.x, -48 * MM), 52 * MM)
        v.co.y = min(max(v.co.y, -34 * MM), 60 * MM)
        v.co.z = min(max(v.co.z, 0.0), 95 * MM)
    _finish_at(G, name + "_glow", (0.0, 0.0, 0.0), parent=root, smooth=False)
    _check_clear(root, ((-18.0, 18.0), (-32.0, 6.0), (0.3, 32.0)), "village scoop")
    return root


# ==============================================================================================
# 15. Cu Chi tunnel arch over an orbit lane
# ==============================================================================================
def make_cuchi_arch(name="cuchi"):
    """Rock and earth arch with a timber frame. Clear passage x -21..21, z 0..36, y -16..16.
    Children: {name}_glow (dim lamp inside, origin at the lamp), {name}_door (spider-hole lid on
    the floor, hinge along its +Y edge at floor level; rotate about X, negative lifts it)."""
    rng = random.Random(1965)
    B = Builder()
    HX, HZ, HY = 21.0, 36.0, 16.0
    # earth cores
    for sx in (-1, 1):
        B.box((13.0, 26.0, 42.0), (sx * 30.5, 1.0, 21.0), "rock_dark", bevel=3.0)
    B.box((72.0, 26.0, 18.0), (0, 1.0, 50.0), "rock_dark", bevel=4.0)
    B.box((44.0, 31.0, 3.0), (0, 0, 39.5), "timber_dark")                 # passage ceiling
    for sx in (-1, 1):
        B.box((0.8, 32.0, 36.0), (sx * 22.2, 0, 18.0), "rock_dark")      # dark inner walls
    # boulders over the cores, kept out of the passage and inside the footprint
    spots = []
    for sx in (-1, 1):
        for z in (6.0, 18.0, 30.0, 41.0):
            spots.append(((sx * rng.uniform(29, 32), -12.0, z + rng.uniform(-1.5, 1.5)), (rng.uniform(9, 11), 8.0, rng.uniform(7.5, 9))))
        for z in (9.0, 27.0, 44.0):
            spots.append(((sx * 33.5, rng.uniform(-6, 6), z), (7.5, rng.uniform(11, 13), rng.uniform(9, 11))))
        spots.append(((sx * 32.0, 12.0, 18.0), (8.0, 8.0, 14.0)))
    for x in (-32.0, -19.0, -6.0, 7.0, 20.0, 32.0):
        spots.append(((x + rng.uniform(-2, 2), -12.0, rng.uniform(46, 51)), (rng.uniform(8.5, 10.5), 8.0, rng.uniform(7.5, 9.5))))
    for x in (-22.0, 0.0, 22.0):
        spots.append(((x, rng.uniform(-4, 4), 54.0), (rng.uniform(13, 16), rng.uniform(13, 15), 7.0)))
    i_r, i_d = B.mi("rock"), B.mi("rock_dark")
    for (c, rad) in spots:
        bm = _boulder(rng, c, rad, noise=0.25, subdiv=1)
        mi = i_r if rng.random() < 0.65 else i_d
        for f in bm.faces:
            f.material_index = mi
        for v in bm.verts:
            p = v.co
            if abs(p.x) < HX + 1.6 and p.z < HZ + 1.6 and abs(p.y) < HY + 1.0:
                dx, dz = HX + 1.6 - abs(p.x), HZ + 1.6 - p.z
                if dx < dz:
                    p.x = math.copysign(HX + 1.6, p.x if p.x != 0 else 1.0)
                else:
                    p.z = HZ + 1.6
            p.x = max(-40.0, min(40.0, p.x))
            p.y = max(-20.0, min(20.0, p.y))
            p.z = max(0.0, min(66.0, p.z))
        B.add(bm, None)
    cap = _pillow(76.0, 36.0, 10.0, u=16, v=6, power=0.6)
    for v in cap.verts:
        v.co.z += 0.9 * math.sin(v.co.x * 0.3) * math.cos(v.co.y * 0.4)
    B.add(cap, "grass", T(0, 0, 60.0))
    # timber frame
    for sx in (-1, 1):
        for y in (-15.5, 15.5):
            B.box((3.6, 3.6, 38.0), (sx * 23.6, y, 19.0), "timber_dark", bevel=0.4)
    for y in (-15.5, 15.5):
        B.add(_limb((-27.0, y, 39.0), (27.0, y, 39.0), 2.3, 2.3, 7), "timber_dark")
    # roots hanging over the face, kept above the passage
    for k in range(7):
        x = -34.0 + k * 11.3 + rng.uniform(-2, 2)
        low = 41.0 if abs(x) < 27 else rng.uniform(6, 20)
        pts = []
        for i in range(6):
            t = i / 5
            pts.append((x + math.sin(t * 5 + k) * 2.2, -19.0 - 0.6 * math.sin(t * 3.0), 62.0 - (62.0 - low) * t))
        B.add(_tube(pts, 0.75 - 0.05 * (k % 3), sides=4), "palm_trunk")
    # ferns on top
    for (x, y) in ((-28.0, -6.0), (-10.0, 7.0), (6.0, -8.0), (22.0, 6.0), (33.0, -9.0)):
        for k in range(6):
            _leaf(B, (x, y, 63.0), k * 72 + rng.uniform(-15, 15), rng.uniform(25, 50), rng.uniform(12, 17), rng.uniform(4, 6),
                  droop=0.95, m=rng.choice(("leaf_light", "leaf_dark", "palm_leaf")), segs=3)
    # lamp bracket on the left post (inside the arch, outside the passage)
    LP = (-24.2, -6.0, 27.0)
    B.box((1.4, 1.4, 5.0), (-24.2, -6.0, 31.5), "steel_dark")
    B.cyl(2.2, 29.2, 30.2, "steel_dark", segs=8, r2=1.2, M=T(LP[0], LP[1], 0))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        B.add(_tube([(LP[0] + 2.2 * math.cos(a), LP[1] + 2.2 * math.sin(a), 24.4),
                     (LP[0] + 2.2 * math.cos(a), LP[1] + 2.2 * math.sin(a), 29.4)], 0.2, sides=3), "steel_dark")
    # the spider hole under the lid (flat, on the floor)
    _quad(B, (0.0, 0.0, 0.05), 27.0, 27.0, "psp_hole")
    root = B.finish(name, sharp_deg=55)
    for v in root.data.vertices:
        v.co.x = min(max(v.co.x, -40 * MM), 40 * MM)
        v.co.y = min(max(v.co.y, -20 * MM), 20 * MM)
        v.co.z = min(max(v.co.z, 0.0), 70 * MM)
    G = Builder()
    G.sphere(2.0, LP, "glow_lamp_dim", u=8, v=5, scale=(1, 1, 1.3))
    _finish_at(G, name + "_glow", LP, parent=root)
    # trapdoor lid: 30 x 30, hinge along +Y at floor level
    D = Builder()
    D.box((30.0, 30.0, 2.4), (0, 0, 1.2), "timber_dark", bevel=0.4)
    D.box((30.4, 30.4, 0.8), (0, 0, 2.6), "mud", bevel=0.3)
    for k in range(9):
        _leaf(D, (rng.uniform(-8, 8), rng.uniform(-8, 8), 3.0), rng.uniform(0, 360), 4, rng.uniform(6, 8),
              rng.uniform(3.5, 5), droop=0.05, m=rng.choice(("leaf_dark", "leaf_yellow", "camo_brown")), segs=3)
    D.box((3.0, 1.6, 1.4), (0, -13.5, 3.4), "steel_dark")                  # finger pull
    _finish_at(D, name + "_door", (0.0, 15.0, 0.0), parent=root)
    _check_clear(root, ((-HX, HX), (-HY, HY), (0.4, HZ)), "cu chi passage", ignore=("_door",))
    return root


# ==============================================================================================
# 16. Upturned steel helmet as a kickout saucer
# ==============================================================================================
def make_helmet_saucer(name="helmet"):
    """M1 steel helmet sunk upside down: brim flush with the playfield (z 0..3), bowl to z -24,
    inner opening r 21 (oval x1.08, y0.94). Child {name}_glow: ring just inside the brim."""
    OX, OY = 1.08, 0.94
    B = Builder()
    camo = [B.mi("olive_drab"), B.mi("olive_dark"), B.mi("khaki"), B.mi("camo_brown")]

    def patch(f):
        c = f.calc_center_median()
        a = math.atan2(c.y, c.x)
        r = math.hypot(c.x, c.y)
        n = math.sin(3.0 * a + 0.13 * r) + 0.8 * math.sin(5.0 * a - 0.21 * r + 1.3) + 0.5 * math.sin(0.4 * r + 2 * a)
        return camo[0] if n < -0.5 else camo[1] if n < 0.4 else camo[2] if n < 1.1 else camo[3]

    # brim / cover seen from above (flush flange around the opening)
    flange = _lathe([(29.6, 0.0), (28.6, 2.3), (25.0, 3.0), (22.2, 2.9), (21.0, 1.6), (21.0, 0.0)], 40,
                    cap_start=False, cap_end=False)
    _face_up(flange)
    for f in flange.faces:
        f.material_index = patch(f)
    B.add(flange, None)
    # bowl (the inside of the helmet: liner olive), faces up / inward
    bowl = _lathe([(21.0, 0.0), (20.6, -5.0), (19.2, -11.0), (16.4, -16.0), (11.8, -20.5), (6.0, -23.2), (0.0, -24.0)], 32,
                  cap_start=False, cap_end=False)
    _face_up(bowl)
    B.add(bowl, "olive_drab")
    # sweatband and suspension webbing inside
    band = _lathe([(20.4, -3.0), (20.1, -6.5)], 32, cap_start=False, cap_end=False)
    B.add(band, "timber_dark")
    for k in range(3):
        a = math.radians(30 + 120 * k)
        pts = []
        for (r, z) in ((19.9, -6.0), (18.7, -11.5), (15.8, -16.2), (11.2, -20.4), (5.0, -23.0), (0.0, -23.7)):
            pts.append((r * math.cos(a), r * math.sin(a), z + 0.45))
        B.add(_tube(pts, 0.7, sides=4), "canvas")
    # net over the cover: two families of strands (diamond mesh)
    def flange_z(r):
        return 0.0 if r >= 29.6 else 2.3 + (r - 28.6) * -2.3 if r >= 28.6 else 3.0 - abs(r - 25.0) * 0.05 if r >= 22.2 else 2.0
    for k in range(18):
        for s in (-1, 1):
            a0 = math.radians(k * 20.0)
            pts = []
            for i in range(4):
                t = i / 3
                r = 21.6 + 7.4 * t
                a = a0 + s * math.radians(14.0) * t
                pts.append((r * math.cos(a), r * math.sin(a), flange_z(r) + 0.35))
            B.add(_tube(pts, 0.28, sides=3), "khaki")
    # chin strap draped over the brim with its buckle on the playfield
    a = math.radians(205.0)
    path = [(17.5, -6.0), (20.0, -1.5), (21.4, 2.9), (25.0, 3.6), (28.6, 2.8), (31.5, 0.6), (37.0, 0.45), (44.0, 0.45)]
    pts = [(r * math.cos(a + 0.004 * r), r * math.sin(a + 0.004 * r), z) for (r, z) in path]
    strap = _tube(pts, 1.0, sides=4)
    bmesh.ops.scale(strap, vec=(1.0, 1.0, 1.0), verts=strap.verts)
    B.add(strap, "olive_dark")
    bx, by = 46.5 * math.cos(a), 46.5 * math.sin(a)
    B.add(A._torus(2.3, 0.45, 10, 4), "steel", T(bx, by, 0.5) @ S(1.0, 0.7, 1.0) @ R('Z', math.degrees(a)))
    B.box((1.0, 4.2, 0.9), (bx, by, 0.55), "steel", M=R('Z', math.degrees(a)))
    root = B.finish(name, sharp_deg=50)
    for v in root.data.vertices:
        v.co.x *= OX
        v.co.y *= OY
    G = Builder()
    ring = _lathe([(20.95, -0.6), (20.85, -1.6)], 40, cap_start=False, cap_end=False)
    G.add(ring, "glow_amber_rotor")
    glow = _finish_at(G, name + "_glow", (0.0, 0.0, 0.0), parent=root, smooth=False)
    for v in glow.data.vertices:
        v.co.x *= OX
        v.co.y *= OY
    return root


# ==============================================================================================
# 17. M16 on a turntable (wire-ramp diverter)
# ==============================================================================================
def _rifle(B, dx=6.0):
    """M16A1-style rifle lying on its side: barrel toward +X, its top toward -Y, z 0..5."""
    def P(pts, z0, z1, m, bevel=0.25):
        B.add(_prism([(x + dx, -u) for (x, u) in pts], z0, z1, bevel=bevel), m)
    P([(-60, 3.6), (-31, 3.6), (-31, -1.2), (-60, -8.0)], 0.3, 4.7, "gun_black")                 # A1 stock
    P([(-61.3, 4.1), (-60, 4.1), (-60, -8.5), (-61.3, -8.5)], 0.2, 4.8, "gun_grey", 0.15)          # butt plate
    P([(-31, 0.6), (-2, 0.6), (-2, -3.2), (-8, -3.2), (-16, -2.2), (-31, -1.4)], 0.3, 4.7, "gun_grey")   # lower
    P([(-31, 0.4), (0, 0.4), (0, 5.2), (-31, 5.2)], 0.0, 5.0, "gun_grey")                           # upper receiver
    P([(-25, 9.6), (-3, 9.6), (-3, 11.2), (-25, 11.2)], 1.2, 3.8, "gun_grey", 0.2)                  # carry handle
    P([(-26.5, 5.2), (-21, 5.2), (-21, 12.6), (-26.5, 12.6)], 1.0, 4.0, "gun_grey", 0.2)           # rear sight
    P([(-5.2, 5.2), (-2.6, 5.2), (-2.6, 11.2), (-5.2, 11.2)], 1.2, 3.8, "gun_grey", 0.2)
    P([(-33, 4.0), (-30.6, 4.0), (-30.6, 6.2), (-33, 6.2)], 1.6, 3.4, "gun_grey", 0.1)             # charging handle
    P([(-19, -2.2), (-14.5, -2.2), (-17.5, -12.0), (-22.5, -11.2)], 0.5, 4.5, "gun_black")         # pistol grip
    P([(-11.5, -3.2), (-4.5, -3.2), (-4.0, -17.0), (-11.0, -17.0)], 0.4, 4.6, "gun_grey", 0.3)     # 20-rd magazine
    P([(-11.2, -15.6), (-4.1, -15.6), (-4.0, -17.0), (-11.0, -17.0)], 0.35, 4.65, "gun_black", 0.1)
    B.add(_tube([(-14.0 + dx, 3.0, 2.5), (-14.0 + dx, 6.2, 2.5), (-6.0 + dx, 6.2, 2.5), (-6.0 + dx, 3.4, 2.5)], 0.45, sides=4),
          "gun_grey")                                                                                  # trigger guard
    B.box((1.0, 2.6, 1.2), (-11.5 + dx, 4.0, 2.5), "gun_grey")                                     # trigger
    # triangular handguard along X (bore at u = 2.6 -> world y = -2.6), tapering
    hg = _lathe([(0, 0), (4.6, 0), (4.6, 1.6), (4.1, 2.2), (3.9, 28.0), (4.3, 28.6), (4.3, 30.0), (0, 30.0)], 3)
    B.add(hg, "gun_black", T(dx, -2.6, 2.5) @ R('Y', 90) @ R('Z', 30))
    for k in range(5):                                                                              # vent ribs
        B.box((0.6, 6.4, 0.4), (dx + 5.0 + k * 4.5, -2.6, 5.4), "gun_grey")
    B.add(_limb((dx + 30.0, -2.6, 2.5), (dx + 54.0, -2.6, 2.5), 1.25, 1.15, 8), "gun_grey")       # barrel
    P([(30, 1.0), (36, 1.0), (34.5, 9.6), (33.0, 9.6)], 1.3, 3.7, "gun_grey", 0.2)                  # front sight
    fh = _lathe([(0, 0), (1.9, 0), (1.9, 1.0), (1.6, 1.3), (1.9, 1.6), (1.9, 2.4), (1.6, 2.7), (1.9, 3.0), (1.9, 4.4),
                 (1.6, 4.7), (1.9, 5.0), (1.9, 6.0), (0.9, 6.0)], 10, cap_end=True)               # birdcage flash hider
    B.add(fh, "gun_grey", T(dx + 54.0, -2.6, 2.5) @ R('Y', 90))
    # sling lying on the turntable from the front swivel to the stock swivel
    pts = [(dx + 33.0, 1.2, 0.5), (dx + 18.0, 8.0, 0.4), (dx - 2.0, 13.5, 0.4), (dx - 25.0, 16.0, 0.4), (dx - 45.0, 12.5, 0.4),
           (dx - 55.0, 8.4, 0.6)]
    B.add(_tube(pts, 0.75, sides=4), "olive_dark")
    for (x, y) in ((33.0, 1.2), (-55.0, 8.4)):
        B.add(A._torus(1.2, 0.3, 8, 3), "steel", T(x + dx, y, 0.9))


def make_m16_diverter(name="m16", height=86):
    """Rifle on a turntable on a post. Child {name}_gun: pivot on the post axis at z=height,
    barrel along +X, rotates about the vertical axis."""
    rng = random.Random(16)
    B = Builder()
    for i in range(6):
        a = i * 60 + 10
        _bag(B, (9.5 * math.cos(math.radians(a)), 9.5 * math.sin(math.radians(a)), 3.0), a + 90, 11.0, 6.5, 6.0,
             "sandbag" if i % 2 else "sandbag_dark", rng, u=6, v=4)
    for i in range(3):
        a = i * 120 + 40
        _bag(B, (5.0 * math.cos(math.radians(a)), 5.0 * math.sin(math.radians(a)), 8.6), a + 90, 10.0, 6.0, 5.2,
             "sandbag", rng, u=6, v=4)
    B.cyl(2.3, 4.0, height - 2.0, "steel_dark", segs=10)
    B.cyl(3.4, height - 6.0, height - 2.0, "steel", segs=10)
    B.lathe([(0, height - 2.0), (9.5, height - 2.0), (9.5, height - 0.6), (9.0, height), (0, height)], "steel_dark", segs=20)
    root = B.finish(name, sharp_deg=45)
    Gn = Builder()
    _rifle(Gn, dx=6.0)
    Gn.cyl(2.2, -0.1, 0.4, "steel", segs=8)
    gun = Gn.finish(name + "_gun", sharp_deg=35)
    gun.location = (0, 0, height * MM)
    gun.parent = root
    return root


# ==============================================================================================
# 18. Raised helipad (level 2)
# ==============================================================================================
def _poly_solid(poly, z0, z1):
    from mathutils.geometry import tessellate_polygon
    bm = bmesh.new()
    polys = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
    for pg in polys:
        if pg.is_empty:
            continue
        loops = [list(pg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in pg.interiors]
        top, bot, flat = [], [], []
        for lp in loops:
            vt = [bm.verts.new((x, y, z1)) for x, y in lp]
            vb = [bm.verts.new((x, y, z0)) for x, y in lp]
            n = len(lp)
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
            top.extend(vt)
            bot.extend(vb)
            flat.append([Vector((x, y, 0.0)) for x, y in lp])
        for t in tessellate_polygon(flat):
            if len(set(t)) == 3:
                try:
                    bm.faces.new([top[i] for i in t])
                    bm.faces.new([bot[i] for i in reversed(t)])
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


HELIPAD_EXAMPLE = [(50, 835), (195, 835), (195, 955), (150, 990), (85, 975), (50, 930)]
HELIPAD_SLOTS = [(150, 870), (125, 868), (100, 866)]


def make_helipad(name="pad", poly=None, slots=None, deck_z=60.0, h_centre=None, open_edges=(0,)):
    """Raised platform built at TABLE coordinates (origin 0,0,0). Deck top at deck_z, 6 thick,
    PSP planking, painted H circle, sandbag rim (not on `open_edges`, edge i = poly[i] -> poly[i+1]),
    posts with sandbag feet, crates and a fuel drum, chrome-railed trough (inner width 29) through `slots`."""
    from shapely.geometry import Polygon, LineString, Point, box as sbox
    poly = list(poly or HELIPAD_EXAMPLE)
    slots = list(slots if slots is not None else HELIPAD_SLOTS)
    rng = random.Random(len(poly) * 31 + int(deck_z))
    PG = Polygon(poly)
    if not PG.exterior.is_ccw:
        poly = poly[::-1]
        PG = Polygon(poly)
        n = len(poly)
        open_edges = tuple((n - 2 - i) % n for i in open_edges)
    B = Builder()
    z1 = deck_z
    B.add(_poly_solid(PG, z1 - 6.0, z1 - 0.8), "steel_dark")
    B.add(_poly_solid(PG.buffer(0.9, join_style=2).difference(PG.buffer(-1.6, join_style=2)), z1 - 6.6, z1 + 0.9), "steel")
    # PSP planking: strips along the long axis, alternating tone, punched holes
    minx, miny, maxx, maxy = PG.bounds
    along_x = (maxx - minx) >= (maxy - miny)
    inner = PG.buffer(-2.0, join_style=2)
    pitch, wid = 8.6, 7.4
    k = 0
    lo, hi = (miny, maxy) if along_x else (minx, maxx)
    c = lo + 2.0
    while c < hi - 2.0:
        band = sbox(minx - 5, c, maxx + 5, c + wid) if along_x else sbox(c, miny - 5, c + wid, maxy + 5)
        cut = band.intersection(inner)
        if not cut.is_empty and cut.area > 4:
            B.add(_poly_solid(cut, z1 - 0.8, z1), "psp_steel" if k % 2 == 0 else "psp_dark")
            # holes along the strip
            mid = c + wid / 2
            s0, s1 = (minx, maxx) if along_x else (miny, maxy)
            t = s0 + 4.0 + (k % 2) * 6.0
            while t < s1 - 4:
                px, py = (t, mid) if along_x else (mid, t)
                if inner.buffer(-3.0).contains(Point(px, py)):
                    _quad(B, (px, py, z1 + 0.06), 4.2 if along_x else 2.6, 2.6 if along_x else 4.2, "psp_hole")
                t += 12.0
        c += pitch
        k += 1
    # painted helipad circle with an H
    hc = Point(h_centre) if h_centre else PG.centroid
    Rr = min(34.0, PG.exterior.distance(hc) * 0.85)
    ring = bmesh.new()
    segs = 40
    vi, vo = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        vi.append(ring.verts.new((hc.x + (Rr - 3.0) * math.cos(a), hc.y + (Rr - 3.0) * math.sin(a), z1 + 0.12)))
        vo.append(ring.verts.new((hc.x + Rr * math.cos(a), hc.y + Rr * math.sin(a), z1 + 0.12)))
    for i in range(segs):
        j = (i + 1) % segs
        ring.faces.new((vi[i], vo[i], vo[j], vi[j]))
    _face_up(ring)
    B.add(ring, "white_stencil")
    bm, w = _text_piece("H", Rr * 1.05, depth=0.3, max_points=60)
    B.add(bm, "white_stencil", T(hc.x, hc.y, z1 + 0.05))
    # trough for locked balls
    if slots:
        path = [Vector((x, y)) for (x, y) in slots]
        if len(path) == 1:
            path = [path[0] + Vector((-15, 0)), path[0] + Vector((15, 0))]
        d0 = (path[0] - path[1]).normalized()
        d1 = (path[-1] - path[-2]).normalized()
        path = [path[0] + d0 * 16.0] + path + [path[-1] + d1 * 16.0]
        line = LineString([tuple(p) for p in path])
        floor = line.buffer(14.5, cap_style=2, join_style=2)
        B.add(_poly_solid(floor.intersection(PG.buffer(-1.0)), z1, z1 + 0.25), "psp_hole")
        for side in (-1, 1):
            off = line.offset_curve(side * (14.5 + 1.3), join_style=2)
            if off.geom_type != "LineString":
                from shapely.ops import linemerge
                off = linemerge(off)
                if off.geom_type != "LineString":
                    off = max(off.geoms, key=lambda g: g.length)
            coords = list(off.coords)
            B.add(_tube([(x, y, z1 + 3.4) for (x, y) in coords], 1.3, sides=6), "chrome")
            L = off.length
            t = 0.0
            while t <= L + 0.01:
                p = off.interpolate(t)
                B.cyl(0.8, z1, z1 + 3.4, "chrome", segs=5, M=T(p.x, p.y, 0), cap_start=False)
                t += 18.0
        # end stop at the far end of the row
        e = path[-1]
        n_ = Vector((-d1.y, d1.x))
        a, b = e + n_ * 15.8, e - n_ * 15.8
        B.add(_tube([(a.x, a.y, z1 + 3.4), (e.x + d1.x * 3, e.y + d1.y * 3, z1 + 3.4), (b.x, b.y, z1 + 3.4)], 1.3, sides=6),
              "chrome")
        avoid = line.buffer(22.0)
    else:
        avoid = Point(-9999, -9999).buffer(1)
    # sandbag rim
    n = len(poly)
    for i in range(n):
        if i in open_edges:
            continue
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        d = b - a
        L = d.length
        if L < 10:
            continue
        u = d / L
        inward = Vector((-u.y, u.x))
        yaw = math.degrees(math.atan2(u.y, u.x))
        for layer in range(2):
            m = int((L - 8) // 15.5)
            for j in range(m):
                t = 4 + 15.5 * (j + 0.5) + (7.7 if layer else 0.0)
                if t > L - 4:
                    continue
                p = a + u * t + inward * 5.6
                if avoid.contains(Point(p.x, p.y)):
                    continue
                _bag(B, (p.x, p.y, z1 + 3.4 + layer * 6.6), yaw, 15.5, 8.0, 6.8,
                     "sandbag_dark" if rng.random() < 0.3 else "sandbag", rng, u=6, v=4)
    # posts with sandbag feet at the corners
    for i in range(n):
        p = Vector(poly[i])
        prev, nxt = Vector(poly[i - 1]), Vector(poly[(i + 1) % n])
        bis = ((prev - p).normalized() + (nxt - p).normalized())
        if bis.length < 1e-6:
            bis = Vector((0, 1))
        q = p + bis.normalized() * 8.0
        if not PG.contains(Point(q.x, q.y)):
            q = p - bis.normalized() * 8.0
        B.box((5.0, 5.0, z1 - 6.0), (q.x, q.y, (z1 - 6.0) / 2), "steel_dark", bevel=0.4)
        B.box((7.0, 7.0, 1.2), (q.x, q.y, z1 - 6.6), "steel", bevel=0.2)
        for k2 in range(4):
            a2 = k2 * 90 + 45
            _bag(B, (q.x + 6.5 * math.cos(math.radians(a2)), q.y + 6.5 * math.sin(math.radians(a2)), 3.0), a2 + 90, 10.0, 6.0, 5.6,
                 "sandbag" if k2 % 2 else "sandbag_dark", rng, u=6, v=4)
    # crates and a fuel drum at the corners furthest from the slots and the H
    cand = []
    for i in range(n):
        p = Vector(poly[i])
        prev, nxt = Vector(poly[i - 1]), Vector(poly[(i + 1) % n])
        q = p + ((prev - p).normalized() + (nxt - p).normalized()).normalized() * 17.0
        if not PG.buffer(-8).contains(Point(q.x, q.y)):
            continue
        score = min([avoid.exterior.distance(Point(q.x, q.y)) if not avoid.contains(Point(q.x, q.y)) else -1.0])
        score += Point(q.x, q.y).distance(hc) * 0.3
        cand.append((score, q))
    cand.sort(key=lambda t: -t[0])
    for k2, (_, q) in enumerate(cand[:3]):
        if k2 == 1:
            B.lathe([(0, 0), (6.2, 0), (6.2, 13.0), (5.6, 13.6), (0, 13.6)], "olive_drab", segs=14, M=T(q.x, q.y, z1))
            for zz in (4.3, 8.7):
                B.lathe([(6.2, zz - 0.6), (6.7, zz - 0.3), (6.7, zz + 0.3), (6.2, zz + 0.6)], "olive_dark", segs=14,
                        M=T(q.x, q.y, z1), cap_start=False, cap_end=False)
            B.lathe([(6.21, 5.6), (6.25, 5.6), (6.25, 7.4), (6.21, 7.4)], "yellow_stencil", segs=14, M=T(q.x, q.y, z1),
                    cap_start=False, cap_end=False)
        else:
            yaw = rng.uniform(-20, 20)
            _crate(B, (16.0, 10.0, 8.0), (q.x, q.y, z1 + 4.0), yaw=yaw)
            _crate(B, (12.0, 9.0, 6.0), (q.x + 1.0, q.y, z1 + 11.0), m="olive_drab", batten="olive_dark", yaw=yaw + 12)
    return B.finish(name, sharp_deg=45)


# ==============================================================================================
# 19. Star pop bumper
# ==============================================================================================
def make_star_bumper(name="bumper", cap="red", star="yellow"):
    """Polished military pop bumper. Same contract as make_drum_bumper: {name}_ring (z=24),
    {name}_cap (origin z=38, glowing head with a raised five-pointed star)."""
    B = Builder()
    B.lathe([(23, 3.0), (30, 3.0), (30, 4.6), (29.2, 5.2), (23, 5.2)], "black_plastic", segs=24, cap_start=False, cap_end=False)
    B.cyl(23.5, 0, 30, "olive_drab", segs=24, cap_start=False)
    for z in (6.0, 28.0):
        B.lathe([(23.5, z - 1.4), (24.6, z - 0.8), (24.6, z + 0.8), (23.5, z + 1.4)], "chrome", segs=24, cap_start=False, cap_end=False)
    for i in range(8):                                   # chrome lugs like drum hardware
        a = math.radians(i * 45 + 22.5)
        B.box((2.6, 2.2, 14.0), (24.4 * math.cos(a), 24.4 * math.sin(a), 17.0), "chrome", bevel=0.5, M=R('Z', i * 45 + 22.5))
    B.lathe([(23.6, 15.2), (23.8, 15.2), (23.8, 18.8), (23.6, 18.8)], "yellow_stencil", segs=24, cap_start=False, cap_end=False)
    B.cyl(12.5, 30, 38, "chrome", segs=16, cap_start=False, cap_end=False)
    root = B.finish(name)
    G = Builder()
    G.torus(31, 2.0, "chrome", segs=24, sides=6)
    G.finish(name + "_ring", origin=(0, 0, 24), parent=root)
    capm = {"red": "glow_cap_red", "olive": "glow_cap_olive"}.get(cap, "glow_cap_red")
    starm = {"yellow": "glow_star_yellow", "white": "white_stencil"}.get(star, "glow_star_yellow")
    C = Builder()
    C.lathe([(12.5, 0), (34, 0), (34, 8.6), (33.4, 10.4), (31.6, 11.4), (30.2, 10.6)], "chrome", segs=28, cap_start=False,
            cap_end=False)
    C.lathe([(30.2, 10.6), (22.0, 11.2), (0, 11.6)], capm, segs=28, cap_start=False)
    C.lathe([(29.0, 10.75), (29.0, 11.1), (27.6, 11.25), (27.6, 10.9)], "chrome", segs=28, cap_start=False, cap_end=False)
    C.prism(_star(17.0, 7.0), 11.2, 13.6, starm, bevel=0.6, cap_bottom=False)
    C.prism(_star(18.2, 7.6), 11.1, 11.9, "chrome", bevel=0.2, cap_bottom=False)
    for i in range(6):
        a = math.radians(i * 60 + 30)
        C.sphere(1.1, (32.6 * math.cos(a), 32.6 * math.sin(a), 9.2), "chrome", u=6, v=4)
    C.finish(name + "_cap", origin=(0, 0, 38), parent=root)
    return root


# ==============================================================================================
# 20. Jungle bush
# ==============================================================================================
def make_bush(name="bush", size=60, seed=0):
    """Dome-shaped jungle plant, origin at base centre. seed % 3: 0 fern clump, 1 broad-leaf
    (banana) bush, 2 dense round shrub; the rest of the seed varies the details."""
    rng = random.Random(seed * 7919 + 11)
    style = seed % 3
    k = size / 60.0
    B = Builder()
    pal = ("leaf_light", "leaf_dark", "palm_leaf", "leaf_yellow")
    if style == 0:
        n = 18
        for i in range(n):
            az = i * 360.0 / n + rng.uniform(-10, 10)
            _leaf(B, (rng.uniform(-3, 3) * k, rng.uniform(-3, 3) * k, 1.0), az, rng.uniform(55, 75), rng.uniform(36, 44) * k,
                  rng.uniform(7.0, 9.0) * k, droop=rng.uniform(0.9, 1.15), m=rng.choice(pal[:3]), segs=4)
        for i in range(6):
            _leaf(B, (0, 0, 1.0), rng.uniform(0, 360), rng.uniform(72, 84), rng.uniform(24, 30) * k, 6.0 * k, droop=0.45,
                  m="leaf_light", segs=3)
    elif style == 1:
        B.add(_limb((0, 0, 0), (0, 0, 14 * k), 2.0 * k, 1.4 * k, 6), "palm_trunk")
        for i in range(7):
            az = i * 360.0 / 7 + rng.uniform(-12, 12)
            _leaf(B, (0, 0, rng.uniform(10, 16) * k), az, rng.uniform(35, 60), rng.uniform(32, 38) * k, rng.uniform(15, 19) * k,
                  droop=rng.uniform(0.85, 1.05), m=rng.choice(("leaf_light", "leaf_light", "leaf_yellow", "palm_leaf")), segs=4)
        for i in range(9):
            az = rng.uniform(0, 360)
            r = rng.uniform(8, 16) * k
            _leaf(B, (r * math.cos(math.radians(az)), r * math.sin(math.radians(az)), 0.5), az, rng.uniform(20, 45),
                  rng.uniform(12, 16) * k, rng.uniform(5, 7) * k, droop=0.9, m=rng.choice(("leaf_dark", "palm_leaf")), segs=3)
    else:
        for i in range(34):
            phi = math.acos(rng.uniform(0.15, 1.0))
            az = rng.uniform(0, 360)
            rr = 19.0 * k
            c = (rr * math.sin(phi) * math.cos(math.radians(az)) * 0.7, rr * math.sin(phi) * math.sin(math.radians(az)) * 0.7,
                 rr * math.cos(phi) * 0.85 + 2.0 * k)
            _leaf(B, c, az + rng.uniform(-30, 30), rng.uniform(-10, 40), rng.uniform(11, 15) * k, rng.uniform(6, 8) * k,
                  droop=rng.uniform(0.3, 0.7), m=rng.choice(pal), segs=3)
        B.sphere(1.0, (0, 0, 11.0 * k), "leaf_dark", u=10, v=6, scale=(16 * k, 16 * k, 12 * k))
    root = B.finish(name, sharp_deg=80)
    for v in root.data.vertices:
        v.co.z = max(v.co.z, 0.2 * MM)
    return root


# ==============================================================================================
# 21. Flagpole with a paintable flag
# ==============================================================================================
def make_flagpole(name="flag", height=110):
    """Pole with a finial; child {name}_cloth (42 x 26, UV u along the fly, v up), origin at the
    top attach point on the pole."""
    B = Builder()
    B.lathe([(0, 0), (4.0, 0), (4.0, 1.6), (1.6, 2.6), (1.05, 3.0), (1.0, height), (0, height)], "steel_dark", segs=8)
    B.sphere(2.0, (0, 0, height + 1.6), "gold", u=8, v=5)
    B.add(_tube([(1.0, 0, height - 3.0), (1.4, 0.5, height * 0.55), (1.0, 0, 10.0)], 0.15, sides=3), "canvas")   # halyard
    B.box((3.0, 1.2, 3.0), (1.6, 0, 12.0), "steel", bevel=0.3)                                     # cleat
    root = B.finish(name, sharp_deg=40)
    top = Vector((1.2, 0.0, height - 3.0))
    cols, rows = 8, 4
    W_, H_ = 42.0, 26.0
    verts, uvs, faces = [], [], []
    for side in (0, 1):
        base = len(verts)
        for r in range(rows + 1):
            for c in range(cols + 1):
                u, v = c / cols, 1.0 - r / rows
                x = W_ * u
                y = 2.4 * math.sin(u * 5.2 + 0.4) * u + (0.3 if side else 0.0)
                z = -H_ * (1 - v) - 1.8 * u * u - 0.6 * math.sin(u * 4.0) * u
                verts.append(tuple(top + Vector((x, y, z))))
                uvs.append((u, v))
        for r in range(rows):
            for c in range(cols):
                a = base + r * (cols + 1) + c
                quad = (a, a + cols + 1, a + cols + 2, a + 1)
                faces.append(quad if side == 0 else quad[::-1])
    cloth = _uv_obj(name + "_cloth", verts, faces, uvs, "flag_cloth", parent=root, pivot=tuple(top))
    # front side must face -Y (the player)
    cloth.data.update()
    return root


# ==============================================================================================
# 22. Signboard with a paintable face
# ==============================================================================================
def make_signboard(name="sign", w=70, h=26, posts=True):
    """Weathered board on two posts (or one), tilted back 10 deg. Child {name}_face: front face
    plane (UV 0..1, u left->right, v bottom->top), origin at the board centre."""
    tilt = 10.0
    zc = 16.0 + h / 2
    Mb = T(0, 0, zc) @ R('X', -tilt)
    B = Builder()
    _lbox(B, (w, 3.0, h), (0, 0, 0), "timber_dark", 0.6, Mb)
    for zz in (-h / 2 + 0.8, h / 2 - 0.8):
        _lbox(B, (w + 1.0, 3.4, 1.4), (0, 0, zz), "wood_crate", 0.3, Mb)
    xs = (-(w / 2 - 7.0), (w / 2 - 7.0)) if posts else (0.0,)
    for x in xs:
        top = Mb @ Vector((x, 2.6, h / 2 + 3.0))
        B.add(_limb((x, 2.6, 0.0), tuple(top), 1.9, 1.7, 6), "wood_crate")
        B.sphere(0.8, tuple(Mb @ Vector((x, -1.7, h / 2 - 4.0))), "steel_dark", u=5, v=3)
        B.sphere(0.8, tuple(Mb @ Vector((x, -1.7, -h / 2 + 4.0))), "steel_dark", u=5, v=3)
    root = B.finish(name, sharp_deg=40)
    fw, fh = w - 3.0, h - 3.2
    pts = [(-fw / 2, -fh / 2), (fw / 2, -fh / 2), (fw / 2, fh / 2), (-fw / 2, fh / 2)]
    verts = [tuple(Mb @ Vector((x, -1.62, z))) for (x, z) in pts]
    centre = tuple(Mb @ Vector((0, -1.62, 0)))
    face = _uv_obj(name + "_face", verts, [(0, 1, 2, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)], "sign_face", parent=root,
                   pivot=centre)
    return root


# ==============================================================================================
# 23. Scoop bunker facade
# ==============================================================================================
def make_scoop_bunker(name="khesanh"):
    """Sandbagged bunker around a scoop pocket: opening x -18..18, z 0..30, y 0..32 (faces -Y),
    origin at the opening's floor centre. Child {name}_glow: red warning lamp above the entrance."""
    rng = random.Random(1968 + 1)
    B = Builder()
    # pocket lining
    for sx in (-1, 1):
        B.box((1.5, 33.0, 30.0), (sx * 18.8, 16.5, 15.0), "timber_dark")
    B.box((38.0, 2.0, 31.0), (0, 33.0, 15.5), "black_plastic")
    B.box((38.0, 34.0, 2.0), (0, 16.0, 31.0), "timber_dark")
    # sandbag cores and faces
    for sx in (-1, 1):
        B.box((22.0, 42.0, 28.0), (sx * 30.5, 18.0, 14.0), "sandbag_dark", bevel=2.0)
        for layer in range(4):
            for j, x in enumerate((24.8, 35.2)):
                xx = x + (0.8 if layer % 2 else 0.0)
                _bag(B, (sx * xx, -2.0, 3.7 + layer * 7.0), 0.0, 12.0, 6.6, 7.0,
                     "sandbag_dark" if rng.random() < 0.3 else "sandbag", rng, u=6, v=4)
        for j in range(2):
            for i in range(3):
                _bag(B, (sx * (24.0 + j * 11.0), 4.0 + i * 13.0, 31.4), 90.0, 13.0, 9.0, 6.4,
                     "sandbag_dark" if rng.random() < 0.3 else "sandbag", rng, u=6, v=4)
    B.box((84.0, 8.0, 32.0), (0, 36.0, 16.0), "sandbag_dark", bevel=2.0)
    # lintel log and roof planks
    B.add(_limb((-27.0, -1.2, 33.4), (27.0, -1.2, 33.4), 3.3, 3.1, 8), "timber_dark")
    for i in range(9):
        B.box((7.6, 40.0, 1.6), (-34.0 + i * 8.5, 18.0, 37.6), "wood_crate" if i % 2 else "timber_dark", bevel=0.3)
    # corrugated sheet on the roof
    cols, rows = 26, 3
    sheet = bmesh.new()
    grid = {}
    for c in range(cols + 1):
        for r in range(rows + 1):
            x = -36.0 + 72.0 * c / cols
            y = -3.0 + 40.0 * r / rows
            z = 40.0 + 0.9 * math.sin(c * math.pi) + 2.2 * (r / rows)
            grid[c, r] = sheet.verts.new((x, y, z))
    for c in range(cols):
        for r in range(rows):
            sheet.faces.new((grid[c, r], grid[c + 1, r], grid[c + 1, r + 1], grid[c, r + 1]))
    _face_up(sheet)
    _double_side(sheet, 0.3)
    B.add(sheet, "corrugated")
    for i, x in enumerate((-26.0, -10.0, 8.0, 25.0)):
        _bag(B, (x, 33.0, 46.0), 0.0, 15.0, 9.0, 6.8, "sandbag" if i % 2 else "sandbag_dark", rng, u=6, v=4)
    _bag(B, (-30.0, 10.0, 45.6), 90.0, 15.0, 9.0, 6.4, "sandbag", rng, u=6, v=4)
    # ammo crates
    _crate(B, (12.0, 5.6, 7.0), (-35.0, -3.0, 3.5), m="olive_drab", batten="olive_dark")
    _crate(B, (14.0, 9.0, 8.0), (27.0, 22.0, 46.5), yaw=-8)
    _label(B, "AMMO", 2.6, T(-35.0, -5.85, 3.6) @ FACE_FRONT, "yellow_stencil", depth=0.25, max_points=80, max_width=9)
    # warning lamp housing on the lintel
    LP = (0.0, -2.0, 40.0)
    B.cyl(2.2, 36.4, 37.8, "steel_dark", segs=10)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        B.add(_tube([(2.3 * math.cos(a), -2.0 + 2.3 * math.sin(a), 37.6), (2.3 * math.cos(a), -2.0 + 2.3 * math.sin(a), 42.4),
                     (0.0, -2.0, 43.3)], 0.22, sides=3), "steel_dark")
    root = B.finish(name, sharp_deg=55)
    G = Builder()
    G.sphere(2.2, LP, "glow_redbeacon", u=10, v=6, scale=(1, 1, 1.15))
    _finish_at(G, name + "_glow", LP, parent=root)
    _check_clear(root, ((-18.0, 18.0), (0.05, 32.0), (0.3, 30.0)), "scoop bunker")
    return root


ROTOR_ASSETS = {
    "lz_bunker": make_lz_bunker,
    "heli": make_heli,
    "watchtower": make_watchtower,
    "drum_bumper": make_drum_bumper,
    "droptarget_stencil": make_drop_target_stencil,
    "radio_station": make_radio_station,
    "antenna_mast": make_antenna_mast,
    "smoke_canister": make_smoke_canister,
    "palm": make_palm,
    "searchlight": make_searchlight,
    "logo_stencil": make_logo_stencil,
    "crates": make_crate_stack,
    "sandbags": make_sandbag_wall,
    "village": make_village,
    "cuchi_arch": make_cuchi_arch,
    "helmet_saucer": make_helmet_saucer,
    "m16_diverter": make_m16_diverter,
    "helipad": make_helipad,
    "star_bumper": make_star_bumper,
    "bush": make_bush,
    "flagpole": make_flagpole,
    "signboard": make_signboard,
    "scoop_bunker": make_scoop_bunker,
}

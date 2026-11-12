"""RIFFGEWITTER: extra toys for the denser rock table.

Same conventions as assets.py: mm in code, metres in meshes, +Z up, playfield z=0,
front faces -Y, animated parts are children `{name}_{part}` with their origin on the pivot.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import materials
import assets as A
from assets import Builder, T, R, S, MM, _lathe, _torus, _prism, _box, _sphere, tri_count, bounds_mm  # noqa: F401

materials.SPECS.update({
    "vinyl":        ((0.008, 0.008, 0.01), 0.0, 0.12, None),
    "vinyl_groove": ((0.02, 0.02, 0.024),  0.0, 0.45, None),
    "label_red":    ((0.62, 0.04, 0.03),   0.0, 0.40, None),
    "aluminium":    ((0.78, 0.78, 0.80),   1.0, 0.28, None),
    "bus_black":    ((0.012, 0.012, 0.014), 0.5, 0.22, None),
    "case_black":   ((0.025, 0.025, 0.028), 0.0, 0.55, None),
    "glass_tint":   ((0.01, 0.012, 0.02),  0.2, 0.05, None),
    "stencil_bone": ((0.86, 0.82, 0.72),   0.0, 0.50, None),
})

CYCLIC = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # (u, v, w) -> (x=w, y=u, z=v)


def _ring(r0, r1, z0, z1, segs=48):
    """Flat annulus solid (rectangular section) around Z."""
    prof = [(r0, z0), (r1, z0), (r1, z1), (r0, z1), (r0, z0)]
    bm = _lathe(prof, segs, cap_start=False, cap_end=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _seg(B, a, b, r, m, sides=4):
    """Open tube segment between two points (no caps): cheap lattice members."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    ln = d.length
    if ln < 1e-6:
        return
    bm = _lathe([(r, 0.0), (r, ln)], sides, cap_start=False, cap_end=False)
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    B.add(bm, m, T(*a) @ rot)


def _text_mm(text, height, depth=1.0, max_points=120):
    """Rock lettering as a solid, front at +Z, reading along +X, cap height `height` mm."""
    bm, w, h = A._text_solid(text, max_points=max_points, depth=1.0)
    k = height / h
    bmesh.ops.transform(bm, matrix=S(k, k, depth) @ T(0, 0, 0.5), verts=bm.verts)
    return bm, w * k


FACE_FRONT = R('X', 90)   # +Z front -> -Y


# ==============================================================================================
# 1. Turntable sunk into the playfield
# ==============================================================================================
def _lathe_bands(B, profile, mats, segs, M=None):
    """Lathe without caps; band i (profile[i] -> profile[i+1]) gets mats[i]."""
    bm = _lathe(profile, segs, cap_start=False, cap_end=False)
    bm.faces.ensure_lookup_table()
    for k, f in enumerate(bm.faces):
        f.material_index = B.mi(mats[min(k // segs, len(mats) - 1)])
    B.add(bm, None, M)


def make_turntable(name="vinyl", r=32):
    B = Builder()
    bx, by = r + 14, r - 4
    # chrome rim flush with the playfield, black trim ring outside it (no hidden bottom)
    _lathe_bands(B, [(r + 6.0, 0.0), (r + 6.0, 0.35), (r + 3.0, 0.35), (r + 3.0, 1.0), (r + 0.3, 1.0), (r + 0.3, 0.0)],
                 ["black_plastic", "black_plastic", "chrome", "chrome", "chrome"], 40)
    # plinth corner outside the ball area: tone arm and pitch section
    B.box((24, 30, 6), (bx + 4, by - 1, 3), "black_plastic", bevel=1.2)
    B.box((20, 26, 0.6), (bx + 4, by - 1, 6.2), "chrome_dark")
    # tone-arm base, post and gimbal
    B.lathe([(7.5, 6.5), (7.5, 9.0), (6.4, 10.0), (5.0, 10.0), (5.0, 12.0), (2.2, 12.0), (2.2, 35.5), (0, 35.5)],
            "chrome", segs=16, M=T(bx, by, 0), cap_start=False, cap_end=False)
    B.sphere(3.4, (bx, by, 37.5), "chrome_dark", u=10, v=6)
    # arm: gentle S curve from the gimbal to the headshell, everything over the disc stays above z=30
    piv = Vector((bx, by, 37.5))
    head = Vector((9.0, 3.0, 33.0))
    ctrl = Vector((24.0, 24.0, 36.0))
    pts = []
    for i in range(8):
        t = i / 7
        p = (1 - t) ** 2 * piv + 2 * (1 - t) * t * ctrl + t * t * head
        pts.append(tuple(p))
    B.tube(pts, 1.3, "chrome", sides=8)
    back = (piv - Vector(pts[1])).normalized()
    stub_end = piv + back * 9.0
    B.tube([tuple(piv), tuple(stub_end)], 1.3, "chrome", sides=8)
    cw = stub_end + back * 2.0
    cw_rot = back.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    B.cyl(4.4, -3.5, 3.5, "chrome_dark", segs=16, M=T(*cw) @ cw_rot)
    B.add(_torus(4.4, 0.6, 16, 4), "chrome", T(*cw) @ cw_rot @ T(0, 0, 3.4))
    # headshell and cartridge, aligned to the last arm segment (cartridge bottom >= 30.2)
    d = Vector(pts[-1]) - Vector(pts[-2])
    ang = math.degrees(math.atan2(d.y, d.x))
    Hm = T(head.x, head.y, 0) @ R('Z', ang)
    B.add(_box(12, 7.5, 1.8, 0.5), "black_plastic", Hm @ T(1.5, 0, 32.7))
    B.add(_box(6.5, 4.6, 1.6), "red_paint", Hm @ T(2.0, 0, 31.0))
    B.add(_box(4.0, 1.0, 1.0), "chrome", Hm @ T(-2.5, -4.5, 33.0))       # finger lift
    # arm rest
    B.cyl(1.2, 6.5, 30, "chrome_dark", segs=8, M=T(bx - 10, by - 14, 0), cap_start=False)
    B.box((5, 3, 2), (bx - 10, by - 14, 31.0), "rubber_black", bevel=0.4)
    # pitch slider plate and two knobs
    px, py = r + 16, -r + 6
    B.box((15, 32, 3), (px, py, 1.5), "black_plastic", bevel=1.0)
    B.box((2.4, 22, 0.6), (px, py + 3, 3.2), "chrome_dark")
    B.box((7, 3.5, 3), (px, py + 6, 4.8), "chrome", bevel=0.8)
    for k, (ox, oy) in enumerate(((px - 4, py - 12), (px + 4, py - 12))):
        B.cyl(2.6, 3, 7.0, "chrome" if k else "red_paint", segs=14, M=T(ox, oy, 0), cap_start=False)
        B.box((0.6, 2.4, 0.4), (ox, oy + 1.2, 7.2), "glow_orange")
    root = B.finish(name)

    # spinning record (child), flush: playing surface z 0.8, label z 0.9
    D = Builder()
    prof = [(r, 0.0), (r, 0.8)]
    mats = ["vinyl", "vinyl"]
    for a, b in ((29.0, 31.0), (24.8, 27.2), (20.5, 22.8), (15.6, 18.4)):
        prof += [(b, 0.8), (b, 0.66), (a, 0.66), (a, 0.8)]
        mats += ["vinyl", "vinyl", "vinyl_groove", "vinyl"]
    prof += [(11.0, 0.8), (11.0, 0.9), (3.0, 0.9), (3.0, 1.05), (1.1, 1.05), (1.1, 2.4), (0.0, 2.4)]
    mats += ["vinyl", "label_red", "label_red", "glow_orange", "glow_orange", "chrome", "chrome"]
    _lathe_bands(D, prof, mats, 40)
    # printed lightning bolt on the label makes the rotation readable
    bolt = [(0.6, 6.5), (-2.4, 0.5), (-0.4, 0.5), (-1.6, -6.0), (2.6, 1.0), (0.6, 1.0), (2.4, 6.5)]
    D.prism(bolt, 0.9, 0.98, "stencil_bone", M=T(6.0, 0, 0) @ R('Z', 90))
    D.finish(name + "_disc", origin=(0, 0, 0), parent=root)
    return root

# ==============================================================================================
# 2. Microphone stand (ball target that wobbles)
# ==============================================================================================
def make_mic_stand(name="mic"):
    B = Builder()
    B.lathe([(0, 0), (9.0, 0), (9.0, 2.2), (7.0, 4.0), (2.6, 4.0), (0, 4.0)], "chrome", segs=20)
    B.add(_ring(8.0, 9.2, 0.0, 0.8, 20), "rubber_black")
    root = B.finish(name)

    P = Builder()  # local coordinates: pivot at the base centre, z=4 world -> 0 local
    P.cyl(4.0, 0.0, 26.0, "black_plastic", segs=12, cap_start=False, cap_end=False)
    P.cyl(4.6, 22.0, 27.5, "chrome", segs=12)                    # clutch
    P.cyl(2.4, 27.5, 56.0, "chrome", segs=10, cap_start=False, cap_end=False)                    # upper tube
    P.sphere(3.6, (0, 0, 56.5), "black_plastic", u=10, v=6)      # boom joint
    P.box((2.0, 10, 4), (3.6, 0, 56.5), "chrome", bevel=0.5)     # joint knob
    boom = [(0, 4, 57.5), (0, -8, 64.0), (0, -20, 70.5), (0, -30, 76.0)]
    P.tube(boom, 1.5, "black_plastic", sides=8)
    P.tube([(0, 6, 56.0), (0, 13, 52.5)], 1.3, "black_plastic", sides=8)
    P.sphere(3.0, (0, 14, 52.0), "chrome_dark", u=8, v=6)        # counterweight
    # microphone: handle tilting forward-down, ball head with chrome grille band
    P.cyl(2.4, 0, 9, "black_plastic", segs=14, r2=3.2, M=T(0, -30, 76.0) @ R('X', 51))
    P.sphere(6.6, (0, -40.5, 84.5), "chrome", u=16, v=10)
    P.add(_torus(6.6, 0.9, 16, 4), "chrome_dark", T(0, -40.5, 84.5) @ R('X', 51))
    # coiled cable around the post (stays inside r 9 below the clutch)
    coil = []
    for i in range(34):
        a = i * 0.95
        coil.append((5.4 * math.cos(a), 5.4 * math.sin(a), 6 + i * 0.57))
    coil += [(5.4, 0, 26.5), (4.0, -2, 40), (3.0, -6, 58), (0, -16, 68), (0, -27, 77.5)]
    P.tube(coil, 0.8, "rubber_red", sides=4)
    P.finish(name + "_stand", origin=(0, 0, 4.0), parent=root)
    return root


# ==============================================================================================
# 3. Backstage scoop: rear of the tour bus with stage door, flight cases and a glowing sign
# ==============================================================================================
def make_backstage(name="backstage"):
    B = Builder()
    # bus body around the open tunnel (x -18..18, z 0..32, from y -32 back to y +6)
    B.box((20, 58, 34), (-29, 27, 17), "bus_black", bevel=2.0)          # left of the opening
    B.box((24, 58, 34), (31, 27, 17), "bus_black", bevel=2.0)           # right of the opening
    B.box((84, 60, 46), (1, 26, 57), "bus_black", bevel=4.0)            # upper body
    B.box((36, 50, 32), (0, 32, 16), "black_plastic")                   # dark tunnel back
    B.box((38, 8, 2.4), (0, 2, 33.2), "black_plastic")                  # tunnel ceiling
    # chrome frame around the mouth
    for sx in (-1, 1):
        B.box((1.6, 1.4, 33), (sx * 19.6, -2.6, 16.5), "chrome", bevel=0.4)
    B.box((66, 2, 4), (0, -3.6, 35.4), "chrome", bevel=0.6)             # bumper / lintel
    # red band with the band name, rear window with chrome frame, roof rim
    B.box((84, 0.8, 9), (1, -4.2, 57.5), "red_paint", bevel=0.3)
    txt, tw = _text_mm("RIFFGEWITTER", 5.6, depth=0.6, max_points=260)
    k = min(1.0, 70.0 / tw)
    B.add(txt, "stencil_bone", T(1, -4.5, 57.5) @ FACE_FRONT @ S(k, k, 1))
    B.box((68, 1.0, 12), (1, -4.1, 69), "glass_tint", bevel=0.3)
    for z in (62.6, 75.4):
        B.box((70, 1.4, 1.2), (1, -4.3, z), "chrome")
    for x in (-34.4, 36.4):
        B.box((1.2, 1.4, 13.6), (x, -4.3, 69), "chrome")
    B.box((86, 61, 2), (1, 26, 80.5), "chrome_dark", bevel=0.6)         # roof rim
    # ladder on the right edge
    for z in range(42, 80, 6):
        B.box((6, 1.2, 1.2), (39, -5.0, z), "chrome")
    for x in (36, 42):
        B.box((1.2, 2.4, 40), (x, -4.6, 60), "chrome")
    # stage door on the right lower block: steel panel, small window, push bar
    B.box((18, 1.2, 28), (31, -2.4, 15), "steel", bevel=0.5)
    B.box((6, 0.8, 7), (31, -3.1, 22), "glass_tint")
    B.box((12, 1.4, 1.6), (31, -3.4, 13), "chrome", bevel=0.3)
    txt, tw = _text_mm("STAGE", 2.6, depth=0.4)
    B.add(txt, "red_paint", T(31, -3.2, 27) @ FACE_FRONT)
    # loading plate in front of the tunnel (flush, the ball rolls over it)
    B.box((40, 30, 0.8), (0, -17, 0.4), "steel_dark")
    for k in range(5):
        B.box((36, 1.0, 0.2), (0, -29 + k * 6, 0.85), "chrome_dark")
    # flight cases with chrome corners and stencils
    cases = ((-30, -22, 0, 18, 18, 14, "TOUR"), (-30, -22, 14, 16, 16, 12, "CREW"), (34, -22, 0, 16, 16, 11, None))
    for cx, cy, cz, w, d, h, label in cases:
        B.box((w, d, h), (cx, cy, cz + h / 2), "case_black", bevel=0.8)
        for sx in (-1, 1):
            for sz in (0, 1):
                B.box((3.2, d + 0.6, 3.2), (cx + sx * (w / 2 - 1.3), cy, cz + 1.3 + sz * (h - 2.6)), "chrome", bevel=0.4)
        B.box((w - 6, 0.6, 1.8), (cx, cy - d / 2 - 0.2, cz + h * 0.25), "chrome_dark")
        if label:
            txt, tw = _text_mm(label, 4.4, depth=0.5)
            B.add(txt, "stencil_bone", T(cx, cy - d / 2 - 0.4, cz + h * 0.6) @ FACE_FRONT)
    # exhaust pipe
    B.tube([(-36, 50, 6), (-36, 50, 86)], 1.6, "chrome", sides=8)
    root = B.finish(name)

    # glowing parts: BACKSTAGE sign above the door, tail lights, rope light along the roof edge
    G = Builder()
    G.box((50, 2.4, 11), (0, -5.0, 47), "black_plastic", bevel=0.8)
    txt, tw = _text_mm("BACKSTAGE", 6.5, depth=0.8, max_points=220)
    k = min(1.0, 44.0 / tw)
    G.add(txt, "glow_red", T(0, -6.3, 47) @ FACE_FRONT @ S(k, k, 1))
    for sx in (-1, 1):
        G.box((6, 1.2, 10), (sx * 30, -4.4, 46), "glow_red", bevel=0.4)
        G.box((6, 1.2, 3.4), (sx * 30, -4.4, 39.4), "glow_amber", bevel=0.3)
    rope = [(-41, -4.6, 79), (43, -4.6, 79)]
    G.tube(rope, 0.8, "glow_orange", sides=6)
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root)
    return root


# ==============================================================================================
# 4. Lighting truss arch with moving heads and a banner
# ==============================================================================================
def _tower(B, cx, height, sec=18.0, bay=18.0):
    h = sec / 2
    corners = [(-h, -h), (h, -h), (h, h), (-h, h)]
    top = height + h
    for x, y in corners:
        _seg(B, (cx + x, y, 3), (cx + x, y, top), 1.5, "aluminium", sides=6)
    n = int((top - 6) // bay)
    for i in range(n + 1):
        z = 3 + i * (top - 3) / n
        for j in range(4):
            (x0, y0), (x1, y1) = corners[j], corners[(j + 1) % 4]
            _seg(B, (cx + x0, y0, z), (cx + x1, y1, z), 0.8, "aluminium")
            if i < n:
                z2 = 3 + (i + 1) * (top - 3) / n
                if j % 2 == i % 2:
                    _seg(B, (cx + x0, y0, z), (cx + x1, y1, z2), 0.7, "aluminium")
                else:
                    _seg(B, (cx + x1, y1, z), (cx + x0, y0, z2), 0.7, "aluminium")
    B.box((32, 32, 3), (cx, 0, 1.5), "steel_dark", bevel=0.8)
    for x, y in corners:
        B.cyl(1.4, 3, 5, "chrome", segs=6, M=T(cx + x * 1.4, y * 1.4, 0))


def make_truss_arch(name="truss", span=420, height=150):
    B = Builder()
    sx = span / 2
    _tower(B, -sx, height)
    _tower(B, sx, height)
    # horizontal box truss along X at z = height, y = 0
    h = 9.0
    x0, x1 = -sx - h, sx + h
    chords = [(-h, -h), (h, -h), (h, h), (-h, h)]  # (y, z offsets)
    for y, z in chords:
        _seg(B, (x0, y, height + z), (x1, y, height + z), 1.5, "aluminium", sides=6)
    n = int((x1 - x0) // 20)
    for i in range(n + 1):
        x = x0 + i * (x1 - x0) / n
        for j in range(4):
            (ya, za), (yb, zb) = chords[j], chords[(j + 1) % 4]
            _seg(B, (x, ya, height + za), (x, yb, height + zb), 0.8, "aluminium")
            if i < n:
                xn = x0 + (i + 1) * (x1 - x0) / n
                if (i + j) % 2:
                    _seg(B, (x, ya, height + za), (xn, yb, height + zb), 0.7, "aluminium")
                else:
                    _seg(B, (x, yb, height + zb), (xn, ya, height + za), 0.7, "aluminium")
    # corner blocks
    for cx in (-sx, sx):
        B.box((22, 22, 22), (cx, 0, height), "aluminium", bevel=1.0)
    # static PAR cans with coloured lenses
    for k, px in enumerate((-192, -122, 122, 192)):
        z = height - h - 2
        B.box((3, 4, 4), (px, 0, z), "black_plastic")
        B.cyl(6.2, -8, 8, "black_plastic", segs=16, M=T(px, -2, z - 9) @ R('X', -30))
        lens = "glow_red" if k % 2 == 0 else "glow_amber"
        B.add(_lathe([(0, 0), (5.4, 0), (5.4, 0.6), (0, 0.6)], 16), lens, T(px, -2, z - 9) @ R('X', -30) @ T(0, 0, -8.6))
    # banner cables
    for bx in (-62, 62):
        _seg(B, (bx, -10, height - h), (bx, -10, height - 40), 0.4, "steel", sides=4)
    root = B.finish(name)

    # moving heads: pivot at the clamp under the bottom chords
    for i, hx in enumerate((-160, -85, 85, 160)):
        z = height - h - 1.5
        H = Builder()
        H.box((8, 6, 3), (0, 0, -1.5), "black_plastic", bevel=0.5)          # clamp
        H.cyl(5.5, -6, -3, "black_plastic", segs=18)                         # base
        H.box((20, 4, 3), (0, 0, -7.5), "black_plastic", bevel=0.6)          # yoke top
        for s in (-1, 1):
            H.box((3, 5, 14), (s * 8.5, 0, -14), "black_plastic", bevel=0.6)  # yoke arms
        # head body pointing down and a little forward (-Y)
        body = T(0, 0, -17) @ R('X', -28)
        H.add(_lathe([(0, -9), (6.0, -9), (6.8, -4), (6.8, 6), (5.4, 9), (0, 9)], 20), "black_plastic", body)
        H.add(_torus(6.9, 0.7, 20, 6), "chrome", body @ T(0, 0, -6))
        H.add(_lathe([(0, 0), (5.0, 0), (5.0, 0.6), (0, 0.6)], 18), "glow_white", body @ T(0, 0, -9.6))
        H.finish("%s_head_%d" % (name, i), origin=(hx, 0, z), parent=root)

    # banner plate (front face UV 0..1), hangs in front of the truss
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    w, ht = 140.0, 34.0
    yb = -10.0
    zc = height - 40 - ht / 2
    vs = [bm.verts.new((x, yb, z)) for x, z in ((-w / 2, -ht / 2), (w / 2, -ht / 2), (w / 2, ht / 2), (-w / 2, ht / 2))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    for lo in f.loops:
        lo[uv].uv = ((lo.vert.co.x + w / 2) / w, (lo.vert.co.z + ht / 2) / ht)
    # back of the banner (dark), slightly behind
    vb = [bm.verts.new((x, yb + 0.6, z)) for x, z in ((-w / 2, -ht / 2), (w / 2, -ht / 2), (w / 2, ht / 2), (-w / 2, ht / 2))]
    fb = bm.faces.new(vb)
    fb.normal_update()
    if fb.normal.y < 0:
        fb.normal_flip()
    fb.material_index = 1
    for lo in fb.loops:
        lo[uv].uv = (0.0, 0.0)
    bmesh.ops.translate(bm, vec=(0, 0, zc), verts=bm.verts)
    bmesh.ops.scale(bm, vec=(MM, MM, MM), verts=bm.verts)
    me = bpy.data.meshes.new(name + "_banner")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat("white_plastic"))
    me.materials.append(materials.mat("black_plastic"))
    ob = bpy.data.objects.new(name + "_banner", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    return root


# ==============================================================================================
# 5. Flame cannon  /  6. Floor wedge
# ==============================================================================================
def make_flame_cannon(name="flamecan"):
    B = Builder()
    B.box((22, 22, 14), (0, 0, 7), "black_plastic", bevel=1.4)
    B.box((23, 23, 1.6), (0, 0, 13.4), "chrome_dark", bevel=0.4)
    B.box((14, 0.6, 3), (0, -11.2, 6), "glow_red")
    B.lathe([(0, 14), (7.2, 14), (7.2, 16), (5.8, 16.6), (4.8, 24), (4.0, 24), (3.6, 17)], "chrome", segs=20)
    root = B.finish(name)
    G = Builder()
    G.add(_lathe([(0, 0), (3.9, 0), (3.9, 0.5), (0, 0.5)], 16), "glow_orange")
    G.finish(name + "_glow", origin=(0, 0, 23.0), parent=root)
    return root


def make_speaker_wedge(name="wedge"):
    B = Builder()
    side = [(-17, 0), (17, 0), (17, 26), (8, 26), (-17, 6)]           # (y, z)
    B.add(_prism(side, -30, 30, bevel=1.4, bevel_bottom=True), "tolex", CYCLIC)
    # front grille on the sloped face
    d = Vector((25, 20)).normalized()
    nrm = Vector((-d.y, d.x))
    tilt = math.degrees(math.atan2(20, 25))
    mid = Vector((-4.5, 16)) + nrm * 0.45
    B.box((54, 28, 0.8), (0, mid.x, mid.y), "grille", M=R('X', tilt))
    for e in (-14.2, 14.2):
        B.box((56, 1.4, 1.2), (0, mid.x + nrm.x * 0.2, mid.y + nrm.y * 0.2), "chrome", M=R('X', tilt) @ T(0, e, 0))
    for cx in (-30, 30):
        for cy, cz in ((-17, 0), (17, 0), (17, 26), (8, 26), (-17, 6)):
            B.box((3.4, 3.4, 3.4), (cx * 0.985, cy * 0.96, max(1.6, min(cz, 24.4))), "chrome", bevel=0.5)
    # horn on the right (flare facing out of the grille)
    B.add(_lathe([(0, 0), (7, 0), (7, 0.5), (3.2, 2.5), (2.0, 4.0), (0, 4.0)], 18), "black_plastic",
          T(15, mid.x + nrm.x * 1.3, mid.y + nrm.y * 1.3) @ R('X', tilt) @ S(1, 1, -1))
    root = B.finish(name)
    # woofer cone: child, origin at its centre on the face, facing out of the grille
    C = Builder()
    face_rot = R('X', tilt)   # +Z -> outward normal of the sloped face (-Y and up)
    C.add(_lathe([(0, 0), (11.2, 0), (11.2, 1.2), (10.2, 1.0), (3.0, 0.3), (2.2, 1.2), (0, 1.4)], 24), "cone", face_rot)
    C.add(_torus(10.6, 0.8, 24, 6), "chrome", face_rot @ T(0, 0, 1.0))
    C.finish(name + "_cone", origin=(-10, mid.x + nrm.x * 0.85, mid.y + nrm.y * 0.85), parent=root)
    return root


RIFF2_ASSETS = {
    "turntable": make_turntable,
    "mic": make_mic_stand,
    "backstage": make_backstage,
    "truss": make_truss_arch,
    "flamecan": make_flame_cannon,
    "wedge": make_speaker_wedge,
}

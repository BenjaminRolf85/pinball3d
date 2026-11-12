"""Assembles a complete pinball table in Blender and exports assets/<table>/table.glb.

Run:  node tools/export-layout.mjs <table> && python3 blender/build_table.py --table <table>
      (<table> = riff | rotor)
Input: build/layout-<table>.json (shared with the physics), blender/assets.py (model library).
Units: layout in mm, Blender scene in metres, +Y up-table, +Z up.
"""
import json
import math
import os
import re
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon
from shapely.geometry import LineString, Point, Polygon, box as sbox

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

TABLE = sys.argv[sys.argv.index("--table") + 1] if "--table" in sys.argv else "riff"
ROTOR = TABLE == "rotor"
ALIEN = TABLE == "alien"

bpy.ops.wm.read_factory_settings(use_empty=True)

import materials  # noqa: E402
import assets as A  # noqa: E402
from assets import Builder, T, R, S, MM  # noqa: E402
if ROTOR:
    import assets_rotor as AR  # noqa: E402
elif ALIEN:
    import assets_alien as AA  # noqa: E402
    import assets_human as AH  # noqa: E402
else:
    import assets_riff2 as A2  # noqa: E402

materials.SPECS.update({
    "playfield":     ((1.0, 1.0, 1.0),       0.0, 0.30, None),
    "cab_red":       ((0.20, 0.008, 0.008),  0.5, 0.35, None),
    "backdrop":      ((0.022, 0.016, 0.024), 0.4, 0.55, None),
    "rubber_white":  ((0.85, 0.85, 0.80),    0.0, 0.60, None),
    "plastic_ember": ((0.03, 0.008, 0.0),    0.0, 0.25, (1.0, 0.28, 0.04)),
    "plastic_blood": ((0.03, 0.0, 0.0),      0.0, 0.25, (1.0, 0.04, 0.03)),
    "plastic_volt":  ((0.0, 0.01, 0.03),     0.0, 0.25, (0.25, 0.65, 1.0)),
    "cab_olive":     ((0.06, 0.07, 0.03),    0.3, 0.55, None),
    "backdrop_jungle": ((0.012, 0.02, 0.01), 0.1, 0.8, None),
    "plastic_signal": ((0.03, 0.02, 0.0),    0.0, 0.25, (1.0, 0.62, 0.08)),
    "plastic_smoke": ((0.01, 0.02, 0.005),   0.0, 0.3, (0.09, 0.26, 0.05)),
    "glow_amber_bar": ((0.0, 0.0, 0.0),      0.0, 0.5, (1.0, 0.55, 0.08)),
    "olive_flipper": ((0.12, 0.14, 0.05),    0.2, 0.45, None),
    "cab_space":     ((0.035, 0.02, 0.07),   0.6, 0.35, None),
    "backdrop_space": ((0.012, 0.01, 0.025), 0.3, 0.6, None),
    "plastic_acid":  ((0.01, 0.03, 0.0),     0.0, 0.25, (0.4, 1.0, 0.15)),
    "plastic_violet": ((0.02, 0.0, 0.04),    0.0, 0.25, (0.55, 0.2, 1.0)),
    "glow_ea_cyan":  ((0.0, 0.0, 0.0),       0.0, 0.5, (0.2, 0.9, 1.0)),
    "glow_ea_acid":  ((0.0, 0.0, 0.0),       0.0, 0.5, (0.45, 1.0, 0.15)),
    "space_flipper": ((0.6, 0.62, 0.7),      0.8, 0.25, None),
})
for n in ("plastic_ember", "plastic_blood", "plastic_volt", "plastic_signal", "plastic_smoke", "plastic_acid", "plastic_violet"):
    materials._principled(materials.mat(n)).inputs["Emission Strength"].default_value = 1.4

with open(os.path.join(ROOT, "build", "layout-%s.json" % TABLE)) as f:
    L = json.load(f)
W, LEN = L["table"]["W"], L["table"]["L"]
BALL_R = L["ballR"]


# ----------------------------------------------------------------------------- helpers
def poly_bm(poly, z0, z1):
    """Extrude a shapely polygon (holes allowed) into a closed solid (mm)."""
    bm = bmesh.new()
    polys = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
    for pg in polys:
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


def arc(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def place(ob, x, y, z=0.0, rot=0.0, scale=None):
    ob.location = (x * MM, y * MM, z * MM)
    ob.rotation_euler = (0.0, 0.0, math.radians(rot))
    if scale:
        ob.scale = scale
    return ob


def set_matrix(ob, m_mm):
    """World matrix given in mm translation units."""
    m = m_mm.copy()
    m.translation = m.translation * MM
    ob.matrix_world = m
    return ob


# ----------------------------------------------------------------------------- playfield
def build_playfield():
    me = bpy.data.meshes.new("playfield")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new((x * MM, y * MM, 0.0)) for x, y in ((0, 0), (W, 0), (W, LEN), (0, LEN))]
    f = bm.faces.new(vs)
    for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = (u, v)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat("playfield"))
    ob = bpy.data.objects.new("playfield", me)
    bpy.context.scene.collection.objects.link(ob)


# ----------------------------------------------------------------------------- cabinet, frame, apron
def build_cabinet():
    a = L["arch"]
    play = Polygon([(0, 0), (W, 0), (W, a["cy"])] + arc(a["cx"], a["cy"], a["r"], 0, 180)[1:] + [(30, 430), (0, 395)])
    outer = sbox(-24, -70, W + 24, LEN + 20)
    B = Builder()
    B.add(poly_bm(outer.difference(play), -2, 40), "black_plastic")
    # chrome trim following the play-area edge and the outer side rails
    B.add(poly_bm(play.buffer(4.5, 6).difference(play.buffer(0.6, 6)), 40, 42.5), "chrome")
    B.add(poly_bm(outer.difference(outer.buffer(-8, join_style=2)), 38, 46), "chrome")
    # lockdown bar
    B.box((W + 48, 34, 14), (W / 2, -52, 45), "chrome", bevel=4)
    # body and legs
    B.box((W + 48, LEN + 90, 430), (W / 2, LEN / 2 - 25, -217), "cab_olive" if ROTOR else "cab_space" if ALIEN else "cab_red", bevel=5)
    B.box((W + 52, LEN + 94, 26), (W / 2, LEN / 2 - 25, -420), "black_plastic", bevel=3)
    for sx in (0, 1):
        for sy in (0, 1):
            x = -24 + 34 if sx == 0 else W + 24 - 34
            y = -70 + 44 if sy == 0 else LEN + 20 - 44
            B.box((46, 46, 500), (x, y, -670), "chrome", bevel=5)
            B.cyl(30, -922, -912, "black_plastic", segs=12, M=T(x, y, 0))
    # stage backdrop
    bp = L["decor"]["backPanel"]
    B.box((W + 48, 26, bp["h"] + 20), (W / 2, bp["y"] + 13, 40 + (bp["h"] + 20) / 2), "backdrop_jungle" if ROTOR else "backdrop_space" if ALIEN else "backdrop", bevel=3)
    B.box((W + 48, 30, 10), (W / 2, bp["y"] + 11, 40 + bp["h"] + 22), "chrome", bevel=2)
    B.tube([(-14, bp["y"] - 8, bp["h"] + 4), (W + 14, bp["y"] - 8, bp["h"] + 4)], 5, "chrome", sides=8)
    for x in (-14, W + 14):
        B.tube([(x, bp["y"] - 8, bp["h"] + 4), (x, bp["y"] + 4, bp["h"] + 4)], 4, "chrome", sides=6)
    B.finish("cabinet")

    # glowing border on the backdrop
    G = Builder()
    y = bp["y"] - 1.2
    for x in (2, W - 2):
        G.box((5, 2.4, bp["h"] - 40), (x, y, 40 + bp["h"] / 2), "glow_amber_bar" if ROTOR else "glow_ea_acid" if ALIEN else "glow_red")
    G.box((W - 30, 2.4, 4), (W / 2, y, 52), "glow_amber_bar" if ROTOR else "glow_ea_acid" if ALIEN else "glow_red")
    G.finish("backpanel_glow")

    # apron: a raised cover the drained ball rolls under
    ap = [(0, 0), (480, 0), (480, 104), (420, 104), (340, 96), (275, 74), (240, 66), (205, 74), (140, 96), (60, 104), (0, 104)]
    Ap = Builder()
    Ap.prism(ap, 29.5, 37.5, "steel_dark", bevel=1.5)
    for x in (() if ROTOR or ALIEN else (88, 392)):
        Ap.box((84, 46, 1.0), (x, 40, 38.0), "steel", bevel=0.4)
        Ap.box((70, 5, 0.6), (x, 52, 38.7), "rubber_red")
        for k in range(3):
            Ap.box((70, 2.2, 0.5), (x, 42 - k * 7, 38.7), "steel_dark")
    for x in (10, 470, 160, 320):
        Ap.add(A._lathe([(3.2, 37.5), (3.2, 38.8), (0, 39.2)], 6), "chrome", T(x, 12, 0))
    Ap.finish("apron")
    if not ROTOR and not ALIEN:
        logo = (AR.make_logo_stencil(name="apronlogo", text="ROTORSTURM", width=150) if ROTOR
                else A.make_logo(name="apronlogo", text="RIFFGEWITTER", width=170))
        set_matrix(logo, T(240, 30, 38.4) @ R('X', -90))


# ----------------------------------------------------------------------------- walls, islands, guides
def build_walls():
    B = Builder()
    for w in L["walls"]:
        kind = w["kind"]
        if kind == "wall":
            line = LineString(w["pts"])
            B.add(poly_bm(line.buffer(w["r"], 3), 0, w["h"]), "steel")
            B.add(poly_bm(line.buffer(max(0.8, w["r"] - 1.1), 2), w["h"], w["h"] + 0.9), "chrome")
        elif kind == "guide":
            g = A.make_lane_guide(name="laneguide", length=w["pts"][1][1] - w["pts"][0][1])
            place(g, w["pts"][0][0], w["pts"][0][1])
    B.finish("walls")

    plastics = ({"left": "plastic_signal", "right": "plastic_signal", "strip": "plastic_smoke"} if ROTOR
                else {"left": "plastic_acid", "right": "plastic_acid", "strip": "plastic_violet"} if ALIEN
                else {"left": "plastic_ember", "right": "plastic_ember", "strip": "plastic_blood"})
    for isl in L["islands"]:
        poly = Polygon(isl["pts"]).buffer(2.0, 3)
        if ROTOR:
            # earth mound ringed with sandbags (no glowing plastic on this table)
            Bi = Builder()
            Bi.add(poly_bm(poly, 0, isl["h"] - 4), "mud")
            Bi.add(poly_bm(poly.buffer(-3, 2), isl["h"] - 4, isl["h"] - 1), "sandbag_dark")
            ring = list(poly.exterior.coords)
            for i in range(len(ring) - 1):
                (x0, y0), (x1, y1) = ring[i], ring[i + 1]
                seg = math.hypot(x1 - x0, y1 - y0)
                for k in range(int(seg // 13)):
                    t = (k + 0.5) / max(1, int(seg // 13))
                    cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
                    Bi.box((12.5, 7.5, 5.5), (cx, cy, isl["h"] - 1 + (k % 2) * 0.6), "sandbag", bevel=2.2, M=R('Z', ang))
            Bi.finish("island_%s" % isl["id"])
            continue
        Bi = Builder()
        Bi.add(poly_bm(poly, 0, isl["h"] - 2), "black_plastic")
        Bi.add(poly_bm(poly.buffer(0.6, 2).difference(poly.buffer(-1.6, 2)), isl["h"] - 2, isl["h"] + 1.2), "chrome")
        Bi.finish("island_%s" % isl["id"])
        P = Builder()
        P.add(poly_bm(poly.buffer(-1.6, 2), isl["h"] - 2, isl["h"]), plastics[isl["id"]])
        P.finish("island_%s_plastic" % isl["id"], smooth=False)

    for i, p in enumerate(L["posts"]):
        k = p["r"] / 7.5
        place(A.make_post(name="post_%d" % i), p["x"], p["y"], scale=(k, k, 1.0))


def build_slings():
    for s in L["slings"]:
        tri = Polygon([s["A"], s["B"], s["C"]])
        B = Builder()
        ring = tri.buffer(s["r"], 5)
        B.add(poly_bm(ring.difference(tri.buffer(s["r"] - 2.4, 5)), 9, 17), "rubber_white")
        B.add(poly_bm(tri.buffer(-3, join_style=2), 0, 6), "black_plastic")
        B.finish("sling_%s" % s["id"])
        for k, key in enumerate("ABC"):
            sc = s["r"] / 7.5 * 0.82
            place(A.make_post(name="slingpost_%s%d" % (s["id"], k)), s[key][0], s[key][1], scale=(sc, sc, 1.0))
        P = Builder()
        P.add(poly_bm(tri.buffer(3.5, 4), 26.5, 28.6), "olive_drab" if ROTOR else "plastic_violet" if ALIEN else "plastic_ember")
        P.finish(("sling_%s" if ROTOR else "sling_%s_plastic") % (s["id"] + ("_top" if ROTOR else "")), smooth=False)


# ----------------------------------------------------------------------------- ramp
def build_ramp():
    pts = [Vector(p) for p in L["ramp"]["samples"]]
    n = len(pts)
    lo_l, lo_r, hi_l, hi_r, centres = [], [], [], [], []
    for i, p in enumerate(pts):
        t = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)])
        side = Vector((t.y, -t.x, 0.0)).normalized()
        c = Vector((p.x, p.y, BALL_R + p.z))
        lo = max(2.0, c.z - 8.5)
        lo_l.append((c.x - side.x * 11.5, c.y - side.y * 11.5, lo))
        lo_r.append((c.x + side.x * 11.5, c.y + side.y * 11.5, lo))
        hi_l.append((c.x - side.x * 15.5, c.y - side.y * 15.5, lo + 13))
        hi_r.append((c.x + side.x * 15.5, c.y + side.y * 15.5, lo + 13))
        centres.append(c)
    B = Builder()
    B.tube(lo_l, 1.7, "chrome", sides=6)
    B.tube(lo_r, 1.7, "chrome", sides=6)
    # guard rails start after the entrance and stop before the drop
    B.tube(hi_l[5:-2], 1.3, "chrome", sides=5)
    B.tube(hi_r[5:-2], 1.3, "chrome", sides=5)
    for i in range(6, n - 2, 5):
        B.tube([hi_l[i], lo_l[i], lo_r[i], hi_r[i]], 1.2, "chrome", sides=5)
    # entrance flap
    m = L["ramp"]["mouth"]
    d = L["ramp"]["dir"]
    ang = math.degrees(math.atan2(d[1], d[0])) - 90
    B.box((46, 34, 1.2), (m[0] + d[0] * 14, m[1] + d[1] * 14, 1.4), "steel", M=R('Z', ang) @ R('X', 4))
    # supports: posts standing on walls / islands with an arm to the rail
    for bx, by, bz in ((408, 700, 24), (408, 800, 24), (72, 800, 24), (72, 660, 24), (76, 530, 24), (392, 958, 28), (122, 948, 28), (275, 1000, 0)):
        j = min(range(n), key=lambda k: (pts[k].x - bx) ** 2 + (pts[k].y - by) ** 2)
        c = centres[j]
        top = c.z - 11.5
        B.tube([(bx, by, bz), (bx, by, top), (c.x, c.y, top)], 1.8, "steel", sides=6)
    B.finish("ramp")


# ----------------------------------------------------------------------------- toys and mechanisms
def build_shared_mechs():
    # only the main pair here; extra flippers (third flipper, tunnel flipper) are built by their table
    for f in L["flippers"]:
        if f["id"] not in ("L", "R"):
            continue
        place(A.make_flipper(name="flipper_%s" % f["id"]), f["x"], f["y"], rot=math.degrees(f["rest"]),
              scale=(f["len"] / 78.0, 1.0, 1.0))
    sp = L["spinner"]
    place(A.make_spinner(name="spinner"), sp["x"], sp["y"])
    for g in L["gates"]:
        a, b = g["a"], g["b"]
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        place(A.make_gate(name="gate_%s" % g["id"]), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2,
              rot=math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])), scale=(ln / 40.0, 1.0, 1.0))
    pl = L["plunger"]
    place(A.make_plunger(name="plunger"), pl["x"], pl["y"])


def build_mechs():
    build_shared_mechs()
    for b in L["bumpers"]:
        place(A.make_bumper(name="bumper_%d" % b["id"]), b["x"], b["y"])
    for t in L["dropTargets"]:
        place(A.make_drop_target(name="droptarget_%d" % t["id"], letter=t["letter"]), t["x"], t["y"], rot=math.degrees(t["angle"]))
    for t in L["standups"]:
        place(A.make_drop_target(name="standup_%d_glow" % t["id"], letter="1"), t["x"], t["y"], rot=math.degrees(t["angle"]))
    rx = L["roxy"]
    place(A.make_pinup(name="roxy"), rx["x"], rx["y"])
    sk = L["skull"]
    try:
        skull = A.make_skull(name="skull")
    except Exception as exc:  # keep the pipeline alive with a stand-in
        print("WARNING skull fallback:", exc)
        Bs = Builder()
        Bs.sphere(50, (0, 0, 50), "chrome_dark", u=16, v=10)
        skull = Bs.finish("skull")
    place(skull, sk["x"], sk["y"])

    d = L["decor"]
    for i, a in enumerate(d["amps"]):
        place(A.make_amp_stack(name="amp_%d" % i), a["x"], a["y"], a["z"], rot=a["rot"])
    for i, t in enumerate(d["tesla"]):
        place(A.make_tesla_coil(name="tesla_%d" % i), t["x"], t["y"], t["z"])
    for i, fp in enumerate(d["flamePots"]):
        place(A.make_flame_pot(name="flamepot_%d" % i), fp["x"], fp["y"], fp["z"])
    lg = d["logo"]
    place(A.make_logo(name="logo", text="RIFFGEWITTER", width=lg["width"]), lg["x"], lg["y"], lg["z"])
    for i, g in enumerate(d["guitars"]):
        ob = A.make_guitar(name="guitar_%d" % i)
        set_matrix(ob, T(g["x"], g["y"], g["z"]) @ R('Y', g["rot"]) @ R('X', 90))
    for i, p in enumerate(d["parCans"]):
        place(A.make_par_can(name="par_%d" % i), p["x"], p["y"], p["z"])
    build_riff_stage()


def build_riff_stage():
    """The denser rock table: third flipper, second spinner, turntable, mic stand, backstage bus,
    light truss with moving heads, flame cannons on the side rails and chase bulbs."""
    for f in L["flippers"]:
        if f["id"] == "U":
            place(A.make_flipper(name="flipper_U"), f["x"], f["y"], rot=math.degrees(f["rest"]),
                  scale=(f["len"] / 78.0, f["rBase"] / 11.5, 1.0))
    for sp in L.get("spinners", [])[1:]:
        place(A.make_spinner(name="spinner_R"), sp["x"], sp["y"])
    for dsc in L.get("discs", []):
        # tone arm rests on the left orbit wall, clear of the ball
        place(A2.make_turntable(name="vinyl", r=dsc["r"]), dsc["x"], dsc["y"], rot=117.3)
    for m in L.get("bashes", []):
        place(A2.make_mic_stand(name="mic"), m["x"], m["y"])
    bs = L.get("backstage")
    if bs:
        place(A2.make_backstage(name="backstage"), bs["x"] - 2, bs["y"], scale=(0.78, 0.9, 0.6))  # low enough for the wire ramp above
    tr = L["decor"].get("truss")
    if tr:
        place(A2.make_truss_arch(name="truss", span=tr["span"], height=tr["height"]), tr["x"], tr["y"])
    for i, (x, y) in enumerate(((-12, 640), (-12, 880), (W + 12, 640), (W + 12, 880))):
        place(A2.make_flame_cannon(name="flamecan_%d" % i), x, y, L["table"]["wallH"])
    # warm chase bulbs along both side rails
    Bl = Builder()
    for side in (-11, W + 11):
        for k in range(24):
            if any(abs(70 + k * 40 - y) < 18 for y in (640, 880)):
                continue
            Bl.sphere(3.2, (side, 70 + k * 40, 43.5), "glow_orange", u=8, v=6)
    Bl.finish("raillamps_glow")


# ============================================================================= ROTORSTURM (own layout)
def build_playfield_rotor():
    """Playfield with a window for the tunnel (level 0) and a hole for the sunken helmet."""
    t = L["rotor"]["tunnel"]
    poly = sbox(0, 0, W, LEN).difference(sbox(t["x0"], t["y0"], t["x1"], t["y1"]))
    poly = poly.difference(Point(L["helmet"]["x"], L["helmet"]["y"]).buffer(22, 24))
    loops = [list(poly.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in poly.interiors]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    verts = []
    for lp in loops:
        verts += [bm.verts.new((x * MM, y * MM, 0.0)) for x, y in lp]
    flat = [[Vector((x, y, 0.0)) for x, y in lp] for lp in loops]
    for tri in tessellate_polygon(flat):
        try:
            f = bm.faces.new([verts[i] for i in tri])
        except ValueError:
            continue
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        for lo in f.loops:
            lo[uv].uv = (lo.vert.co.x / MM / W, lo.vert.co.y / MM / LEN)
    me = bpy.data.meshes.new("playfield")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat("playfield"))
    ob = bpy.data.objects.new("playfield", me)
    bpy.context.scene.collection.objects.link(ob)


def build_tunnel():
    t = L["rotor"]["tunnel"]
    z = t["z"]
    outer = sbox(t["x0"] - 8, t["y0"] - 8, t["x1"] + 8, t["y1"] + 8)
    win = sbox(t["x0"], t["y0"], t["x1"], t["y1"])
    B = Builder()
    B.add(poly_bm(outer, z - 6, z), "mud")
    # packed-earth floor texture: a few darker clods and roots
    import random as _r
    _r.seed(7)
    for _ in range(26):
        cx, cy = _r.uniform(t["x0"] + 6, t["x1"] - 6), _r.uniform(t["y0"] + 6, t["y1"] - 6)
        B.add(poly_bm(Point(cx, cy).buffer(_r.uniform(2, 5), 6), z, z + 0.6), "timber_dark")
    B.add(poly_bm(outer.difference(win), z, -0.6), "mud")
    for w in L["walls"]:
        if w.get("level") == 0:
            B.add(poly_bm(LineString(w["pts"]).buffer(max(2.2, w["r"]), 3), z, z + 24), "bamboo")
    # timber frames along the tunnel walls
    for x in (t["x0"] + 2, t["x1"] - 2):
        B.box((4, 6, 30), (x, (t["y0"] + t["y1"]) / 2, z + 15), "timber_dark")
    B.box((t["x1"] - t["x0"], 6, 4), ((t["x0"] + t["x1"]) / 2, t["y1"] - 2, z + 28), "timber_dark")
    ex = [c for c in L["scoops"] if c["id"] == "tunnelExit"][0]
    B.add(poly_bm(Point(ex["x"], ex["y"]).buffer(12, 16), z, z + 0.4), "black_plastic")
    B.finish("tunnel")
    G = Builder()
    G.add(poly_bm(win, -1.4, -0.4), "glass_dark")
    G.finish("glass", smooth=False)
    # tunnel flipper and the three lamps' targets under the glass
    for f in L["flippers"]:
        if f["id"] == "T":
            place(A.make_flipper(name="flipper_T"), f["x"], f["y"], z - 3, rot=math.degrees(f["rest"]),
                  scale=(f["len"] / 78.0, f["rBase"] / 11.5, 0.8))
    for tg in L["standups"]:
        if tg.get("level") == 0:
            ob = AR.make_drop_target_stencil(name="standup_%d_glow" % tg["id"], letter="CUC"[tg["id"] - 10])
            place(ob, tg["x"], tg["y"], z, rot=math.degrees(tg["angle"]), scale=(0.9, 0.9, 0.75))


def build_rails_rotor():
    pad_poly = Polygon(L["rotor"]["padPoly"]) if "rotor" in L else Polygon([(-9, -9), (-8, -9), (-8, -8)])
    pad_z = L["rotor"]["padZ"] if "rotor" in L else 0
    islands = [Polygon(i["pts"]) for i in L["islands"]]
    wall_lines = [LineString(w["pts"]) for w in L["walls"] if w["kind"] == "wall" and len(w["pts"]) > 1 and w.get("level", 1) == 1]
    for rail in L["rails"]:
        pts = [Vector(p) for p in rail["samples"]]
        n = len(pts)
        lo_l, lo_r, hi_l, hi_r, centres = [], [], [], [], []
        for i, p in enumerate(pts):
            tn = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)])
            side = Vector((tn.y, -tn.x, 0.0)).normalized()
            c = Vector((p.x, p.y, BALL_R + p.z))
            lo = max(2.0, c.z - 8.5)
            lo_l.append((c.x - side.x * 11.5, c.y - side.y * 11.5, lo))
            lo_r.append((c.x + side.x * 11.5, c.y + side.y * 11.5, lo))
            hi_l.append((c.x - side.x * 15.5, c.y - side.y * 15.5, lo + 13))
            hi_r.append((c.x + side.x * 15.5, c.y + side.y * 15.5, lo + 13))
            centres.append(c)
        B = Builder()
        B.tube(lo_l, 1.7, "chrome", sides=6)
        B.tube(lo_r, 1.7, "chrome", sides=6)
        start = 5 if rail.get("entry") else 0
        B.tube(hi_l[start:-2], 1.3, "chrome", sides=5)
        B.tube(hi_r[start:-2], 1.3, "chrome", sides=5)
        for i in range(start + 1, n - 2, 5):
            B.tube([hi_l[i], lo_l[i], lo_r[i], hi_r[i]], 1.2, "chrome", sides=5)
        if rail.get("entry"):
            d = rail["entry"]["dir"]
            m = rail["path"][0]
            ang = math.degrees(math.atan2(d[1], d[0])) - 90
            B.box((46, 34, 1.2), (m[0] + d[0] * 14, m[1] + d[1] * 14, 1.4), "steel", M=R('Z', ang) @ R('X', 4))
        # supports: down to an island, the helipad deck or the cabinet rail outside the play area
        last = -99
        for i in range(start + 4, n - 1):
            if i - last < 9:
                continue
            c = centres[i]
            q = Point(c.x, c.y)
            base = None
            if pad_poly.contains(q) and c.z > pad_z + 8:
                base = pad_z
            elif any(isl.contains(q) for isl in islands):
                base = 24
            elif c.x < 2 or c.x > W - 40 and c.y > 830:
                base = 40
            elif ALIEN and any(wl.distance(q) < 10 for wl in wall_lines):
                base = 24
            if base is not None and c.z - 11.5 > base + 6:
                B.tube([(c.x, c.y, base), (c.x, c.y, c.z - 11.5)], 1.8, "steel", sides=6)
                last = i
        B.finish("rail_%s" % rail["id"])


def build_mechs_rotor():
    build_shared_mechs()
    for f in L["flippers"]:
        if f["id"] == "U":
            place(A.make_flipper(name="flipper_U"), f["x"], f["y"], rot=math.degrees(f["rest"]),
                  scale=(f["len"] / 78.0, f["rBase"] / 11.5, 1.0))
    for b in L["bumpers"]:
        place(AR.make_star_bumper(name="bumper_%d" % b["id"], cap="red", star="yellow"), b["x"], b["y"])
    for t in L["dropTargets"]:
        place(AR.make_drop_target_stencil(name="droptarget_%d" % t["id"], letter=t["letter"]), t["x"], t["y"], rot=math.degrees(t["angle"]))
    for t in L["standups"]:
        if t.get("level", 1) == 1:
            place(AR.make_drop_target_stencil(name="standup_%d_glow" % t["id"], letter="R"), t["x"], t["y"], rot=math.degrees(t["angle"]))
    sp = L["spinners"][1]
    place(A.make_spinner(name="spinnerR"), sp["x"], sp["y"])
    # sunken helmet, Khe Sanh base, village, Cu Chi entrance
    h = L["helmet"]
    place(AR.make_helmet_saucer(name="helmet"), h["x"], h["y"], 0, rot=200)
    k = L["kheSanh"]
    place(AR.make_scoop_bunker(name="khesanh"), k["fx"], k["fy"], 0, rot=math.degrees(math.atan2(k["nx"], -k["ny"])), scale=(0.8, 0.8, 0.85))
    v = L["village"]
    place(AR.make_village(name="village"), v["x"] - 3, v["y"], 0, scale=(0.72, 0.72, 0.8))
    cu = L["cuchi"]
    place(AR.make_cuchi_arch(name="cuchi"), cu["fx"], cu["fy"], 0, rot=math.degrees(math.atan2(cu["nx"], -cu["ny"])), scale=(0.75, 0.75, 0.85))
    ar = L["tunnelArch"]
    place(AR.make_cuchi_arch(name="arch"), ar["x"], ar["y"] + 6, 0, scale=(0.95, 0.9, 1.0))
    # helipad with the helicopter and the lock trough
    AR.make_helipad(name="pad", poly=L["rotor"]["padPoly"], slots=L["rotor"]["lockSlots"], deck_z=L["rotor"]["padZ"], open_edges=(1,))
    hp = L["rotor"]["heli"]
    place(AR.make_heli(name="heli"), hp["x"], hp["y"], L["rotor"]["padZ"], rot=-20)
    # M16 diverter above the supply ramp apex
    place(AR.make_m16_diverter(name="m16", height=92), 462, 938, 0, rot=200)
    # watchtower and flag on the left island (US base), bushes everywhere
    place(AR.make_watchtower(name="tower", flag=False), 100, 600, 24, rot=-35, scale=(0.6, 0.6, 0.6))
    place(AR.make_flagpole(name="flag_us"), 84, 652, 24, rot=-20)
    for i, (x, y, z, sz, sd) in enumerate((
            (96, 520, 24, 34, 0), (80, 676, 24, 30, 1), (466, 700, 24, 30, 2), (466, 560, 24, 28, 0), (466, 445, 24, 26, 1),
            (24, 1030, 40, 64, 2), (496, 1030, 40, 64, 0), (8, 900, 40, 48, 1), (512, 900, 40, 48, 2),
            (150, 1075, 40, 56, 0), (380, 1075, 40, 56, 1), (210, 846, 0, 0, 0))):
        if sz:
            place(AR.make_bush(name="bush_%d" % i, size=sz, seed=sd), x, y, z)
    # sign boards
    signs = [("sign_huey", 122, 846, L["rotor"]["padZ"], 0, 0.95), ("sign_base", 92, 560, 24, 24, 0.7),
             ("sign_cuchi", 466, 520, 24, -30, 0.7), ("sign_village", 368, 968, 0, 0, 0.8)]
    for name, x, y, z, rot, sc in signs:
        place(AR.make_signboard(name=name, w=70, h=26), x, y, z, rot=rot, scale=(sc, sc, sc))
    # US army stars on the sling plastics
    for s in L["slings"]:
        cx = (s["A"][0] + s["B"][0] + s["C"][0]) / 3
        cy = (s["A"][1] + s["B"][1] + s["C"][1]) / 3
        pts = [(cx + math.cos(math.radians(90 + k * 36)) * (11 if k % 2 == 0 else 4.4),
                cy + math.sin(math.radians(90 + k * 36)) * (11 if k % 2 == 0 else 4.4)) for k in range(10)]
        S1 = Builder()
        S1.prism(pts, 28.6, 29.4, "white_stencil")
        S1.finish("slingstar_%s" % s["id"], smooth=False)

    d = L["decor"]
    for i, t in enumerate(d["tesla"]):
        place(AR.make_antenna_mast(name="tesla_%d" % i), t["x"], t["y"], t["z"])
    for i, fp in enumerate(d["flamePots"]):
        place(AR.make_smoke_canister(name="flamepot_%d" % i), fp["x"], fp["y"], fp["z"])
    build_backpanel_art()
    # machine-gun nest on a sandbag bunker at the top centre, watchtower at the back left
    place(AR.make_sandbag_wall(name="mgnest_wall", length=110), 205, 1062, 40)
    place(AR.make_sandbag_wall(name="mgnest_wall2", length=110), 315, 1062, 40, rot=180)
    place(AR.make_m16_diverter(name="mgnest", height=34), 260, 1066, 40, rot=-90, scale=(1.2, 1.2, 1.0))
    place(AR.make_watchtower(name="backtower", flag=False), 40, 1060, 40, rot=15, scale=(0.75, 0.75, 0.75))
    place(AR.make_crate_stack(name="crates_0"), 470, 1058, 40, rot=-12)
    for i, x in enumerate((110, 150, 370, 410)):
        place(AR.make_bush(name="backbush_%d" % i, size=50, seed=i % 3), x, 1075, 40)
    # warm bulbs along both side rails
    Bl = Builder()
    for side in (-11, W + 11):
        for k in range(24):
            Bl.sphere(3.2, (side, 70 + k * 40, 43.5), "glow_amber_rotor", u=8, v=6)
    Bl.finish("raillamps_glow")



def build_backpanel_art():
    """Back wall: a flat panel the game paints at runtime."""
    bp = L["decor"]["backPanel"]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    yb = bp["y"] - 0.6
    vs = [bm.verts.new((x * MM, yb * MM, z * MM)) for x, z in ((-20, 46), (W + 20, 46), (W + 20, 46 + bp["h"] - 30), (-20, 46 + bp["h"] - 30))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    for lo in f.loops:
        lo[uv].uv = ((lo.vert.co.x / MM + 20) / (W + 40), (lo.vert.co.z / MM - 46) / (bp["h"] - 30))
    me = bpy.data.meshes.new("backpanel_art")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat("playfield"))
    ob = bpy.data.objects.new("backpanel_art", me)
    bpy.context.scene.collection.objects.link(ob)


def build_apron_art():
    """Plane over the apron that the game paints (helicopters at sunset and the objectives card)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    x0, y0, x1, y1, z = 4, 4, 476, 64, 37.7
    vs = [bm.verts.new((x * MM, y * MM, z * MM)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    f = bm.faces.new(vs)
    for lo, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lo[uv].uv = (u, v)
    me = bpy.data.meshes.new("apron_art")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(materials.mat("playfield"))
    ob = bpy.data.objects.new("apron_art", me)
    bpy.context.scene.collection.objects.link(ob)



# ============================================================================= ERDABWEHR (own layout)
def build_mechs_alien():
    """Mothership with its tractor beam, war robot, tank emplacement, laser cannons, saucers, troops."""
    build_shared_mechs()
    AL = L["alien"]
    for b in L["bumpers"]:
        place(AA.make_saucer_bumper(name="bumper_%d" % b["id"]), b["x"], b["y"])
    for t in L["dropTargets"]:
        place(AA.make_alien_drop_target(name="droptarget_%d" % t["id"]), t["x"], t["y"], rot=math.degrees(t["angle"]))
    for t in L["standups"]:
        place(A.make_drop_target(name="standup_%d_glow" % t["id"], letter="S" if t["id"] < 2 else "L"), t["x"], t["y"], rot=math.degrees(t["angle"]))
    for sp in L.get("spinners", [])[1:]:
        place(A.make_spinner(name="spinner_R"), sp["x"], sp["y"])
    # the robot stands over its feet (the bash posts), the beam pad is set flush into the playfield
    rb = AL["robot"]
    place(AA.make_robot(name="robot"), rb["x"], rb["y"])
    bp = AL["beamPad"]
    place(AA.make_beam_pad(name="beampad"), bp["x"], bp["y"])
    tk = AL["tank"]
    place(AH.make_tank_bunker(name="tankpit"), tk["x"], tk["y"], scale=(0.82, 0.82, 0.82))
    # mothership hovering over the back; its beam is re-aimed at the beam pad
    sh = AL["ship"]
    ship = AA.make_mothership(name="mothership", r=sh["r"])
    place(ship, sh["x"], sh["y"], sh["z"])
    bpy.context.view_layer.update()
    beam = bpy.data.objects.get("mothership_beam")
    if beam is not None:
        src = Vector((sh["x"], sh["y"], sh["z"]))
        dst = Vector((bp["x"], bp["y"], 0.0))
        d = dst - src
        rot = Vector((0, 0, -1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        beam.parent = None
        set_matrix(beam, T(src.x, src.y, src.z) @ rot @ S(1.0, 1.0, d.length / 150.0))
    # human laser cannons on the top corners, radar, barricades, troopers, aliens, small saucers
    for i, t in enumerate(L["decor"]["tesla"]):
        place(AH.make_laser_cannon(name="laser_%d" % i), t["x"], t["y"], t["z"], rot=(-150 if i == 0 else 150))
    place(AH.make_radar(name="radar"), 452, 1060, 40, rot=-20)
    for i, (x, y, r) in enumerate(((170, 1060, 0), (352, 1062, 0))):
        place(AH.make_barricade(name="barricade_%d" % i, length=70), x, y, 40, rot=r)
    for i, (x, y, r, pose) in enumerate(((-12, 300, -90, "aim"), (-12, 560, -90, "kneel"), (532, 240, 90, "radio"), (532, 520, 90, "aim"))):
        place(AH.make_soldier_future(name="trooper_%d" % i, pose=pose), x, y, 40, rot=r)
    for i, (x, y, r, pose) in enumerate(((70, 1058, 20, "gun"), (122, 1066, 5, "point"), (404, 1066, -10, "crouch"))):
        place(AA.make_alien(name="alien_%d" % i, pose=pose), x, y, 40, rot=r)
    for i, s0 in enumerate(L["decor"]["saucers"]):
        place(AA.make_saucer_small(name="saucer_%d" % i, r=s0["r"]), s0["x"], s0["y"], s0["z"])
        Bs = Builder()
        Bs.cyl(1.2, 40, s0["z"] - 4, "glow_ea_acid", segs=6, M=T(s0["x"], s0["y"], 0))
        Bs.finish("saucerstalk_%d_glow" % i)
    place(AH.make_skyline(name="skyline", width=440, height=190), W / 2, L["decor"]["backPanel"]["y"] - 16, 40, scale=(1.0, 1.0, 0.66))
    # cyan bulbs along both side rails
    Bl = Builder()
    for side in (-11, W + 11):
        for k in range(24):
            y = 70 + k * 40
            if any(abs(y - q) < 22 for q in (240, 300, 520, 560, 760, 820)):
                continue
            Bl.sphere(3.2, (side, y, 43.5), "glow_ea_cyan", u=8, v=6)
    Bl.finish("raillamps_glow")

# ----------------------------------------------------------------------------- merge + export
DYNAMIC = re.compile(
    r"^(playfield|flipper_[LR]|bumper_\d_(ring|cap)|droptarget_\d|spinner_plate|spinner_R_plate|vinyl_disc|mic_stand|truss_head_\d|truss_banner|gate_(shooter|top)_flap|plunger|"
    r"skull|skull_eye_[LR]|roxy|roxy_torso|roxy_head|roxy_arm_R|roxy_skirt|amp_\d_cone_\d|heli|heli_rotor|heli_tail_rotor|heli_beacon|"
    r"flipper_[UT]|m16_gun|cuchi_door|glass|apron_art|backpanel_art|sign_\w+_face|flag_\w+_cloth|"
    r"mothership|mothership_ring|mothership_beam|robot_torso|robot_head|robot_arm_R|tank_turret|tank_barrel|"
    r"laser_\d_head|radar_dish|saucer_\d|alien_\d|"
    r".*_glow|.*_plastic)$")


def finalize():
    bpy.context.view_layer.update()
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # flatten the hierarchy (the skull keeps its eyes)
    for o in objs:
        if o.parent is not None and not re.match(r"^(skull_eye_|roxy_|heli_|robot_(head|arm_R|eye_glow|gun_glow)$|tank_(barrel|muzzle_glow)$|mothership_(ring|glow)$|laser_\d_glow$|saucer_\d_glow$)", o.name):
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    bpy.context.view_layer.update()

    static = [o for o in objs if not DYNAMIC.match(o.name)]
    big = bmesh.new()
    mats = []
    for o in static:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        remap = []
        for m in o.data.materials:
            if m.name not in mats:
                mats.append(m.name)
            remap.append(mats.index(m.name))
        for f in bm.faces:
            f.material_index = remap[f.material_index] if remap else 0
        bmesh.ops.transform(bm, matrix=o.matrix_world, verts=bm.verts)
        if o.matrix_world.to_3x3().determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        tmp = bpy.data.meshes.new("_tmp")
        bm.to_mesh(tmp)
        bm.free()
        big.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new("static")
    big.to_mesh(me)
    big.free()
    for m in mats:
        me.materials.append(bpy.data.materials[m])
    for o in static:
        A._remove(o)
    ob = bpy.data.objects.new("static", me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()

    total = 0
    rows = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            n = len(o.data.loop_triangles)
            total += n
            rows.append((n, o.name))
    rows.sort(reverse=True)
    print("objects: %d  triangles: %d" % (len(rows), total))
    for n, name in rows[:14]:
        print("  %6d  %s" % (n, name))

    out = os.path.join(ROOT, "assets", TABLE, "table.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=False,
                              export_animations=False, export_cameras=False, export_lights=False)
    print("exported %s (%.0f kB)" % (out, os.path.getsize(out) / 1024))
    if "--blend" in sys.argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "build", "table-%s.blend" % TABLE))


if ROTOR:
    build_playfield_rotor()
else:
    build_playfield()
build_cabinet()
build_walls()
build_slings()
if ROTOR:
    build_rails_rotor()
    build_tunnel()
    build_apron_art()
    build_mechs_rotor()
    # olive drab instead of red on the shared mechanics
    swap = {"red_paint": "olive_flipper", "rubber_red": "rubber_black", "glow_orange": "glow_amber_bar"}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and re.match(r"^(flipper_|post_|slingpost_|spinner|gate_|plunger)", o.name):
            for k, m in enumerate(o.data.materials):
                if m and m.name in swap:
                    o.data.materials[k] = materials.mat(swap[m.name])
elif ALIEN:
    build_rails_rotor()
    build_apron_art()
    build_backpanel_art()
    build_mechs_alien()
    # gunmetal flippers and dark rubbers on the shared mechanics
    swap = {"red_paint": "space_flipper", "rubber_red": "rubber_black"}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and re.match(r"^(flipper_|post_|slingpost_|spinner|gate_|plunger)", o.name):
            for k, m in enumerate(o.data.materials):
                if m and m.name in swap:
                    o.data.materials[k] = materials.mat(swap[m.name])
else:
    build_ramp()
    build_mechs()
finalize()

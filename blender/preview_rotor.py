"""Preview sheets for the ROTORSTURM assets (Cycles CPU) plus a test GLB.
Usage: python3 blender/preview_rotor.py [heli] [lz] [front] [small] [big] [toys] [close] [pad] [deco] [glb]
       [--fast] [--normals]"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import preview as P  # noqa: E402  (shared studio helpers)
import assets  # noqa: E402
import assets_rotor as AR  # noqa: E402

OUT = P.OUT
MM = 0.001


def report(tag, root):
    lo, hi = assets.bounds_mm(root)
    parts = [(c.name, tuple(round(v / MM, 1) for v in c.location)) for c in root.children]
    sub = []
    for c in root.children:
        for g in c.children:
            sub.append((g.name, tuple(round(v / MM, 1) for v in g.location)))
    print("ASSET %-18s tris=%5d  min=%s max=%s  parts=%s %s" % (tag, assets.tri_count(root), lo, hi, parts, sub))


def sheet_heli(normals):
    P.reset()
    P.ground()
    h = AR.make_heli("heli")
    report("heli", h)
    P.place(h, -120, -10, rz=-35)
    P.place(P.clone(h, "_b"), 15, 30, rz=-110)
    c = P.clone(h, "_c")
    P.place(c, 140, -10, rz=55)
    t = P.clone(h, "_t")
    P.place(t, 20, 175, rz=0)
    for ch in t.children:
        if ch.name.startswith("heli_rotor"):
            ch.rotation_euler.z = math.radians(30)
    P.lights((0, 0.05, 0.05), 0.6)
    P.camera((0.0, -0.46, 0.40), (0.0, 0.06, 0.025), lens=46)
    P.render("rotor_heli", 1300, 760, normals)


def sheet_lz(normals):
    P.reset()
    P.ground()
    b = AR.make_lz_bunker("skull")
    report("lz_bunker", b)
    P.place(b, -150, 0)
    P.place(P.clone(b, "_q"), -150, 200, rz=-35)
    w = AR.make_watchtower("roxy")
    report("watchtower", w)
    P.place(w, 120, 0)
    q = P.clone(w, "_q")
    P.place(q, 130, 200, rz=30)
    torso = next(c for c in q.children if "_torso" in c.name)
    torso.rotation_euler.x = math.radians(-5)
    for c in torso.children:
        if "_arm_R" in c.name:
            c.rotation_euler.y = math.radians(25)
        if "_head" in c.name:
            c.rotation_euler.x = math.radians(-12)
    heli = AR.make_heli("heliL")
    P.place(heli, -150, 200, z=47.8, rz=20)
    P.add_ball(-150, -60)
    P.add_ball(120, -10)
    P.lights((0, 0.05, 0.08), 0.8)
    P.camera((0.0, -0.62, 0.62), (-0.01, 0.07, 0.05), lens=46)
    P.render("rotor_lz", 1300, 820, normals)


def sheet_lz_front(normals):
    P.reset()
    P.ground()
    b = AR.make_lz_bunker("skull")
    P.place(b, -75, 0)
    w = AR.make_watchtower("roxy")
    P.place(w, 85, 0)
    P.add_ball(-75, -60)
    P.add_ball(85, 0)
    P.lights((0, 0, 0.06), 0.6)
    P.camera((0.0, -0.62, 0.12), (0.0, 0.0, 0.07), lens=55)
    P.render("rotor_lz_front", 1200, 640, normals)


def sheet_small(normals):
    P.reset()
    P.ground()
    items = [
        ("drum_bumper", AR.make_drum_bumper(), (-200, 60)),
        ("droptarget", AR.make_drop_target_stencil("dtE", "E"), (-125, 80)),
        ("smoke", AR.make_smoke_canister(), (-90, -20)),
        ("searchlight", AR.make_searchlight(), (-30, 70)),
        ("antenna", AR.make_antenna_mast(), (40, 40)),
        ("crates", AR.make_crate_stack(), (115, 60)),
        ("sandbags", AR.make_sandbag_wall(), (60, -70)),
    ]
    for i, ch in enumerate("VAC"):
        d = AR.make_drop_target_stencil("dt" + ch, ch)
        P.place(d, -95 + i * 28, 80)
    for tag, root, (x, y) in items:
        P.place(root, x, y, z=75 if tag == "searchlight" else 0)
        report(tag, root)
    P.lights((0, 0, 0.03), 0.5)
    P.camera((0.0, -0.58, 0.44), (-0.01, 0.03, 0.01), lens=56)
    P.render("rotor_small", 1300, 700, normals)


def sheet_big(normals):
    P.reset()
    P.ground()
    r = AR.make_radio_station()
    report("radio_station", r)
    P.place(r, -190, 80, rz=-15)
    pa = AR.make_palm()
    report("palm", pa)
    P.place(pa, 40, 200)
    P.place(AR.make_palm("palm2", height=200, seed=8), 150, 260)
    lo = AR.make_logo_stencil()
    report("logo", lo)
    P.place(lo, 60, 60, z=45, rz=-15)
    P.lights((0, 0.1, 0.08), 0.8)
    P.camera((0.0, -0.80, 0.56), (0.0, 0.12, 0.08), lens=46)
    P.render("rotor_big", 1300, 760, normals)


def ball(x, y, z=13.5):
    P.add_ball(x, y)
    b = [o for o in bpy.context.scene.objects if o.name.startswith("ball")][-1]
    b.location = (x * MM, y * MM, z * MM)
    return b


def hole_ground(holes, size=1.5):
    """Ground plane with oval holes (x, y, rx, ry in mm) so sunk toys show below the playfield."""
    import bmesh as _bm
    from shapely.geometry import Polygon, Point
    from shapely import affinity
    g = Polygon([(-size * 1000, -size * 1000), (size * 1000, -size * 1000), (size * 1000, size * 1000), (-size * 1000, size * 1000)])
    for (x, y, rx, ry) in holes:
        g = g.difference(affinity.scale(Point(x, y).buffer(1.0, 32), rx, ry))
    bm = AR._poly_solid(g, -0.4, 0.0)
    me = bpy.data.meshes.new("ground")
    _bm.ops.scale(bm, vec=(MM, MM, MM), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("ground")
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (0.06, 0.05, 0.05, 1)
    b.inputs["Roughness"].default_value = 0.45
    me.materials.append(m)
    return ob


def sheet_toys(normals):
    """(a) village, cu chi arch (door closed and open), helmet saucer with a ball, m16 diverter."""
    P.reset()
    hole_ground([(10, -60, 29.0 * 1.08, 29.0 * 0.94)])
    v = AR.make_village("village")
    report("village", v)
    P.place(v, -175, 60)
    c = AR.make_cuchi_arch("cuchi")
    report("cuchi_arch", c)
    P.place(c, -10, 120)
    c2 = AR.make_cuchi_arch("cuchiB")
    P.place(c2, 120, 175, rz=-20)
    door = next(ch for ch in c2.children if ch.name.endswith("_door"))
    door.rotation_euler.x = math.radians(-70)
    h = AR.make_helmet_saucer("helmet")
    report("helmet_saucer", h)
    P.place(h, 10, -60)
    ball(10, -60, -11.5)
    m = AR.make_m16_diverter("m16")
    report("m16_diverter", m)
    P.place(m, 165, -10)
    gun = next(ch for ch in m.children if ch.name.endswith("_gun"))
    gun.rotation_euler.z = math.radians(-25)
    P.lights((0, 0.05, 0.05), 0.7)
    P.camera((0.0, -0.66, 0.56), (0.0, 0.05, 0.03), lens=46)
    P.render("rotor_toys", 1300, 800, normals)


def sheet_toys_close(normals):
    """Closer look at the helmet saucer, the rifle and the arch from the player's angle."""
    P.reset()
    hole_ground([(-70, -10, 29.0 * 1.08, 29.0 * 0.94)])
    h = AR.make_helmet_saucer("helmet")
    P.place(h, -70, -10)
    ball(-70, -10, -11.5)
    m = AR.make_m16_diverter("m16", height=40)
    P.place(m, 50, 0)
    c = AR.make_cuchi_arch("cuchi")
    P.place(c, -10, 120)
    door = next(ch for ch in c.children if ch.name.endswith("_door"))
    door.rotation_euler.x = math.radians(-60)
    P.lights((0, 0.03, 0.03), 0.4)
    P.camera((0.0, -0.33, 0.28), (0.0, 0.03, 0.02), lens=50)
    P.render("rotor_toys_close", 1200, 760, normals)


def sheet_pad(normals):
    """(b) helipad with the example polygon and slots, three balls, the helicopter on the deck."""
    P.reset()
    P.ground()
    pad = AR.make_helipad("pad", AR.HELIPAD_EXAMPLE, AR.HELIPAD_SLOTS, deck_z=60)
    report("helipad", pad)
    off = (-122.0, -905.0)
    P.place(pad, off[0], off[1])
    heli = AR.make_heli("heli")
    P.place(heli, 130 + off[0], 915 + off[1], z=60.0, rz=-20)
    for (x, y) in AR.HELIPAD_SLOTS:
        ball(x + off[0], y + off[1], 60.0 + 13.5)
    # a ball rolling underneath for scale
    P.add_ball(-150, -120)
    P.lights((0, 0.0, 0.08), 0.6)
    P.camera((0.0, -0.42, 0.40), (0.0, 0.0, 0.05), lens=42)
    P.render("rotor_pad", 1200, 820, normals)


def sheet_deco(normals):
    """(c) star bumpers, three bushes, flagpole, signboards, scoop bunker."""
    P.reset()
    P.ground()
    s1 = AR.make_star_bumper("bumper", "red", "yellow")
    report("star_bumper", s1)
    P.place(s1, -190, 60)
    P.place(AR.make_star_bumper("bumperB", "olive", "white"), -120, 100)
    for i in range(3):
        bu = AR.make_bush("bush%d" % i, size=60, seed=i)
        report("bush%d" % i, bu)
        P.place(bu, -60 + i * 52, -40)
    f = AR.make_flagpole("flag")
    report("flagpole", f)
    P.place(f, 120, 120)
    s = AR.make_signboard("sign")
    report("signboard", s)
    P.place(s, 40, 60)
    P.place(AR.make_signboard("sign1", w=44, h=20, posts=False), 120, 20)
    k = AR.make_scoop_bunker("khesanh")
    report("scoop_bunker", k)
    P.place(k, -20, 140)
    P.add_ball(-20, 150)
    P.lights((0, 0.05, 0.05), 0.7)
    P.camera((0.0, -0.62, 0.52), (-0.02, 0.05, 0.03), lens=46)
    P.render("rotor_deco", 1300, 800, normals)


def sheet_khesanh(normals):
    P.reset()
    P.ground()
    k = AR.make_scoop_bunker("khesanh")
    P.place(k, 0, 0)
    ball(0, 14)
    P.lights((0, 0.02, 0.03), 0.3)
    P.camera((0.05, -0.17, 0.11), (0.0, 0.01, 0.022), lens=50)
    P.render("rotor_khesanh", 900, 600, normals)


def export_all():
    P.reset()
    total = 0
    x = 0
    for tag, fn in AR.ROTOR_ASSETS.items():
        root = fn()
        report(tag, root)
        root.location.x = x * MM
        x += 220
        total += assets.tri_count(root)
    path = os.path.join(OUT, "rotor_assets_test.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False, export_yup=True)
    print("GLB %s  %.1f kB   one-of-each tris=%d" % (path, os.path.getsize(path) / 1024, total))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    normals = "--normals" in sys.argv
    if "--fast" in sys.argv:
        _orig = P.reset

        def fast():
            sc = _orig()
            sc.cycles.samples = 12
            return sc
        P.reset = fast
    sheets = {"heli": sheet_heli, "lz": sheet_lz, "front": sheet_lz_front, "small": sheet_small, "big": sheet_big,
              "khesanh": sheet_khesanh, "toys": sheet_toys, "close": sheet_toys_close, "pad": sheet_pad, "deco": sheet_deco}
    for key in (args or list(sheets)):
        if key == "glb":
            continue
        sheets[key](normals)
    if not args or "glb" in args:
        export_all()

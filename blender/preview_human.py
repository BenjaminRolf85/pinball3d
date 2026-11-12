"""Preview sheets + checks for the ERDABWEHR human-side toys (assets_human.py).

Usage: python3 blender/preview_human.py [check tankpit tank_side troopers small skyline game glb] [--normals]
Renders go to OUT/human_*.png (Cycles CPU, 40 samples)."""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets  # noqa: E402
import assets_human as H  # noqa: E402
from preview import reset, ground, camera, lights, place, render, panel, OUT, MM  # noqa: E402,F401

BUDGET = {"tankpit": 9000, "trooper": 2500, "laser": 3500, "barricade": 1500, "skyline": 9000, "radar": 2500, "shield": 600}


def _components(ob):
    """(closed, signed volume) per connected component of a mesh object (object space)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    out = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack = [f0]
        seen.add(f0.index)
        faces = []
        while stack:
            f = stack.pop()
            faces.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        edges = {e for f in faces for e in f.edges}
        closed = all(len(e.link_faces) == 2 for e in edges)
        # consistent winding: the two loops on a manifold edge must start at different verts
        flipped = sum(1 for e in edges if len(e.link_loops) == 2 and e.link_loops[0].vert is e.link_loops[1].vert)
        if flipped:
            print("      WINDING %s: %d inconsistent edges in a %d-face component" % (ob.name, flipped, len(faces)))
        vol = 0.0
        ny = sum(f.normal.y * f.calc_area() for f in faces)
        for f in faces:
            vs = [v.co for v in f.verts]
            for i in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
        out.append((closed, vol / MM ** 3, len(faces), ny))
    bm.free()
    return out


def check_normals(root):
    bad, opened, total = [], 0, 0
    stack = [root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        for closed, vol, nf, ny in _components(ob):
            total += 1
            if not closed:
                opened += 1
                if ny > 0:
                    bad.append("%s(open, faces +Y)" % ob.name)
            elif vol < -1e-4:
                bad.append("%s(%d faces, vol %.2f)" % (ob.name, nf, vol))
    return total, opened, bad


def report(tag, root, budget_key=None):
    lo, hi = assets.bounds_mm(root)
    tris = assets.tri_count(root)
    parts = []
    stack = [(c, root) for c in root.children]
    while stack:
        c, p = stack.pop(0)
        parts.append("%s<%s @(%.1f,%.1f,%.1f)" % (c.name, p.name, c.location.x / MM, c.location.y / MM, c.location.z / MM))
        stack.extend((g, c) for g in c.children)
    total, opened, bad = check_normals(root)
    b = BUDGET.get(budget_key or tag)
    flag = "" if b is None or tris <= b else "  OVER BUDGET %d" % b
    print("ASSET %-14s tris=%5d%s  min=%s max=%s" % (tag, tris, flag, lo, hi))
    print("      parts: %s" % "; ".join(parts))
    print("      components=%d open(-Y quads)=%d inverted=%d %s" % (total, opened, len(bad), ", ".join(bad[:6])))


def ball(x, y, z=0.0, name="ball"):
    s = assets.Builder()
    s.sphere(13.5, (0, 0, 0), "chrome", u=32, v=20)
    ob = s.finish(name)
    ob.location = (x * MM, y * MM, (z + 13.5) * MM)
    return ob


def sheet_check(normals=False):
    reset()
    t = H.make_tank_bunker(); report("tankpit", t)
    H.check_clear(t, H.TANKPIT_OPENING, "tankpit")
    print("CHECK tankpit opening clear (triangle/box SAT)")
    for i, pose in enumerate(("aim", "kneel", "wave", "radio")):
        s = H.make_soldier_future("trooper_%d" % i, pose); report("trooper_" + pose, s, "trooper")
    report("laser", H.make_laser_cannon())
    report("barricade", H.make_barricade())
    report("skyline", H.make_skyline())
    report("radar", H.make_radar())
    sp = H.make_shield_post(); report("shield", sp)
    worst = max(math.hypot(v.co.x, v.co.y) / MM for v in sp.data.vertices if v.co.z / MM < 30)
    print("CHECK shield: max radius below z30 = %.2f (need <= 6)" % worst)


def sheet_tankpit(normals):
    reset()
    ground()
    t = H.make_tank_bunker()
    ball(0, 0)
    lights((0, 0, 0.04), 0.35)
    camera((0.10, -0.30, 0.20), (0.0, 0.012, 0.03), lens=50)
    render("human_tankpit", 1000, 720, normals)
    # player-ish view from low front
    sc = bpy.context.scene
    sc.camera.location = (0.0, -0.36, 0.17)
    sc.camera.rotation_euler = (Vector((0, 0.01, 0.03)) - Vector(sc.camera.location)).to_track_quat('-Z', 'Y').to_euler()
    render("human_tankpit_front", 900, 640, normals)


def sheet_tank_side(normals):
    reset()
    ground()
    t = H.make_tank_bunker()
    tur = bpy.data.objects["tank_turret"]
    tur.rotation_euler.z = math.radians(35)
    bar = bpy.data.objects["tank_barrel"]
    bar.rotation_euler.x = math.radians(12)
    ball(0, 0)
    lights((0, 0, 0.04), 0.35)
    camera((-0.24, 0.12, 0.20), (0.0, 0.01, 0.035), lens=50)
    render("human_tankpit_back", 900, 640, normals)


def sheet_troopers(normals):
    reset()
    ground()
    for i, pose in enumerate(("aim", "kneel", "wave", "radio")):
        s = H.make_soldier_future("trooper_%d" % i, pose)
        place(s, -75 + i * 50, 0)
    lights((0, 0, 0.03), 0.3)
    camera((0.0, -0.30, 0.11), (0.0, 0.0, 0.028), lens=55)
    render("human_troopers", 1100, 520, normals)
    sc = bpy.context.scene
    sc.camera.location = (-0.03, -0.11, 0.07)
    sc.camera.rotation_euler = (Vector((-0.05, 0.0, 0.04)) - Vector(sc.camera.location)).to_track_quat('-Z', 'Y').to_euler()
    render("human_troopers_close", 900, 600, normals)


def sheet_small(normals):
    reset()
    ground()
    l = H.make_laser_cannon(); place(l, -110, 10)
    l.children[0].rotation_euler.z = math.radians(-20)
    b = H.make_barricade(); place(b, -20, -20)
    r = H.make_radar(); place(r, 65, 10)
    r.children[0].rotation_euler.z = math.radians(30)
    for i, x in enumerate((130, 155)):
        place(H.make_shield_post("shield_%d" % i), x, -10)
    lights((0, 0, 0.03), 0.4)
    camera((0.0, -0.40, 0.22), (0.01, 0.0, 0.025), lens=48)
    render("human_small", 1200, 600, normals)


def sheet_skyline(normals):
    reset()
    ground()
    H.make_skyline()
    lights((0, 0, 0.1), 0.6)
    camera((0.0, -0.75, 0.16), (0.0, 0.0, 0.095), lens=40)
    render("human_skyline", 1200, 600, normals)


def sheet_game(normals):
    """Rough table-like arrangement seen from the player's camera."""
    reset()
    ground()
    sk = H.make_skyline(); place(sk, 0, 380)
    t = H.make_tank_bunker(); place(t, 90, 200)
    bpy.data.objects["tank_turret"].rotation_euler.z = math.radians(-20)
    l = H.make_laser_cannon(); place(l, -120, 230)
    r = H.make_radar(); place(r, -40, 300)
    b = H.make_barricade("barricade_0", 90); place(b, -100, 120, rz=10)
    for i, (pose, x, y, rz) in enumerate((("aim", -60, 160, 20), ("kneel", -30, 150, 5), ("wave", 160, 120, -30), ("radio", 30, 250, 0))):
        place(H.make_soldier_future("trooper_%d" % i, pose), x, y, rz=rz)
    for i, x in enumerate((-150, 150)):
        place(H.make_shield_post("shield_%d" % i), x, 40)
    ball(20, 60)
    lights((0, 0.2, 0.05), 0.7)
    camera((0.0, -0.45, 0.55), (0.0, 0.22, 0.0), lens=32)
    render("human_game", 1000, 1000, normals)


def glb():
    reset()
    x = 0
    for k, fn in H.HUMAN_ASSETS.items():
        r = fn()
        if k == "skyline":
            place(r, 0, 400)
        else:
            place(r, x, 0)
            x += 110
    path = os.path.join(OUT, "human_test.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False)
    print("GLB", path, os.path.getsize(path))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    nrm = "--normals" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    todo = args or ["check", "tankpit", "tank_side", "troopers", "small", "skyline", "game", "glb"]
    for s in todo:
        if s == "glb":
            glb()
        else:
            globals()["sheet_" + s](nrm)

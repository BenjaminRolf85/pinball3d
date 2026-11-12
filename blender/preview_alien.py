"""Preview sheets + contract checks for assets_alien toys (ERDABWEHR, alien side).
Usage: python3 blender/preview_alien.py [checks mothership robot aliens small game glb] [--normals]"""
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets  # noqa: E402
import assets_alien as AL  # noqa: E402
from preview import reset, ground, camera, lights, place, render, clone, OUT, MM  # noqa: E402

BUDGET = {"mothership": 10000, "saucer_bumper": 2500, "robot": 10000, "alien": 2500, "alien_droptarget": 1000,
          "saucer_small": 2000, "beampad": 1000}


def tree(root):
    out, stack = [], [root]
    while stack:
        ob = stack.pop()
        out.append(ob)
        stack.extend(ob.children)
    return out


def report(tag, root):
    bpy.context.view_layer.update()
    lo, hi = assets.bounds_mm(root)
    parts = []
    for c in tree(root)[1:]:
        p = c.matrix_world.translation / MM - root.matrix_world.translation / MM
        parts.append("%s(parent=%s)@(%.1f,%.1f,%.1f)" % (c.name, c.parent.name, p.x, p.y, p.z))
    n = assets.tri_count(root)
    lim = BUDGET.get(tag)
    flag = "" if lim is None or n <= lim else "  OVER BUDGET (%d)" % lim
    print("ASSET %-16s tris=%5d%s  min=%s max=%s\n      parts=%s" % (tag, n, flag, lo, hi, parts))
    return n


def world_verts(root, skip=()):
    bpy.context.view_layer.update()
    for ob in tree(root):
        if ob.type != 'MESH' or ob.name in skip:
            continue
        for v in ob.data.vertices:
            yield ob, (ob.matrix_world @ v.co) / MM


def box_bvh(lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    vs = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return BVHTree.FromPolygons([Vector(v) for v in vs], fs)


def obj_bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    mw = ob.matrix_world
    vs = [(mw @ v.co) / MM for v in ob.data.vertices]
    return BVHTree.FromPolygons(vs, [tuple(p.vertices) for p in ob.data.polygons])


def check_robot(root):
    X, Rr, Z = AL.ROBOT_LEG_X, AL.ROBOT_LEG_R, AL.ROBOT_LEG_Z
    gx, gy, gz = AL.ROBOT_GAP
    worst, inside = 0.0, 0
    for ob, p in world_verts(root):
        if p.z < Z:
            d = min(math.hypot(p.x - X, p.y), math.hypot(p.x + X, p.y))
            worst = max(worst, d)
        if abs(p.x) < gx and abs(p.y) < gy and 0 <= p.z < gz:
            inside += 1
    gap = box_bvh((-gx, -gy, 0.0), (gx, gy, gz))
    hits = sum(len(obj_bvh(ob).overlap(gap)) for ob in tree(root) if ob.type == 'MESH')
    zmin = min(p.z for _, p in world_verts(root))
    print("CHECK robot: leg radius below z%.0f = %.2f (<= %.1f)  gap verts=%d  gap face overlaps=%d  min z=%.2f  %s" % (
        Z, worst, Rr, inside, hits, zmin, "OK" if worst <= Rr and not inside and not hits and zmin > -0.01 else "FAIL"))


def check_bumper(root):
    body = max((math.hypot(p.x, p.y) for ob, p in world_verts(root, skip=(root.name + "_ring", root.name + "_cap"))
                if 5.05 < p.z < 30.0), default=0)
    apron = max(math.hypot(p.x, p.y) for ob, p in world_verts(root) if p.z <= 5.05)
    ref = assets.make_bumper("_refbump")
    rb = max(math.hypot(p.x, p.y) for ob, p in world_verts(ref, skip=("_refbump_ring", "_refbump_cap")) if 5.05 < p.z < 30.0)
    lo_r, hi_r = assets.bounds_mm(ref)
    for o in tree(ref):
        assets._remove(o)
    names = sorted(c.name for c in root.children)
    pivots = {c.name: tuple(round(v / MM, 2) for v in c.location) for c in root.children}
    print("CHECK bumper: body radius z5..30 = %.2f (orig %.2f, phys 26)  apron r=%.2f  children=%s pivots=%s  %s" % (
        body, rb, apron, names, pivots, "OK" if body <= 26.0 and apron <= 30.01 else "FAIL"))


def check_droptarget(root):
    ref = assets.make_drop_target("_refdt", "R")
    a, b = assets.bounds_mm(root), assets.bounds_mm(ref)
    assets._remove(ref)
    print("CHECK droptarget: alien bounds=%s  original bounds=%s  children=%d  %s" % (
        a, b, len(root.children), "OK" if a == b and not root.children else "DIFF"))


def check_beampad(root):
    zmax = max(p.z for _, p in world_verts(root))
    rmin = min(math.hypot(p.x, p.y) for _, p in world_verts(root))
    print("CHECK beampad: max z=%.2f (<=3)  min radius=%.2f (>=15)  %s" % (zmax, rmin, "OK" if zmax <= 3 and rmin >= 14.99 else "FAIL"))


def check_mothership(root):
    beam = next(c for c in root.children if c.name.endswith("_beam"))
    zmin = min(p.z for ob, p in world_verts(root, skip=(beam.name,)))
    zb = [p.z for _, p in world_verts(beam)]
    rb = [math.hypot(p.x, p.y) for _, p in world_verts(beam)]
    print("CHECK mothership: hull min z=%.2f  beam z %.1f..%.1f r %.1f..%.1f tris=%d mat=%s" % (
        zmin - root.location.z / MM, min(zb) - root.location.z / MM, max(zb) - root.location.z / MM, min(rb), max(rb),
        assets.tri_count(beam), [m.name for m in beam.data.materials]))


def ball(x, y, z=0.0):
    s = assets.Builder()
    s.sphere(13.5, (0, 0, 0), "chrome", u=32, v=20)
    ob = s.finish("ball")
    ob.location = (x * MM, y * MM, (z + 13.5) * MM)
    return ob


def stalk(x, y, z_top, name="stalk"):
    s = assets.Builder()
    s.cyl(1.0, 0, z_top, "glow_alien_green", segs=8, cap_start=False)
    s.cyl(5.0, 0, 1.2, "alien_panel", segs=16)
    ob = s.finish(name)
    ob.location = (x * MM, y * MM, 0)
    return ob


# ----------------------------------------------------------------------------------------------- sheets
def sheet_checks(normals):
    reset()
    for tag, fn in AL.ALIEN_ASSETS.items():
        r = fn()
        report(tag, r)
        {"robot": check_robot, "saucer_bumper": check_bumper, "alien_droptarget": check_droptarget,
         "beampad": check_beampad, "mothership": check_mothership}.get(tag, lambda r: None)(r)
        for o in tree(r):
            assets._remove(o)
    for p in ("point", "crouch"):
        r = AL.make_alien("alien_" + p, p)
        report("alien", r)


def sheet_mothership(normals):
    reset()
    ground()
    m = AL.make_mothership()
    place(m, 0, 0, z=150)
    m.children[0].rotation_euler.z = 0
    ball(0, -10)
    lights((0, 0, 0.12), 0.7)
    camera((0.0, -0.62, 0.36), (0.0, 0.0, 0.11), lens=42)
    render("alien_mothership", 1000, 700, normals)
    sc = bpy.context.scene
    sc.camera.location = (0.0, -0.40, 0.06)
    sc.camera.rotation_euler = (Vector((0, 0, 0.14)) - Vector((0.0, -0.40, 0.06))).to_track_quat('-Z', 'Y').to_euler()
    render("alien_mothership_low", 1000, 600, normals)


def pose_robot(root, twist=-25, lean=8, head=20, arm=-35):
    torso = next(c for c in root.children if c.name.endswith("_torso"))
    torso.rotation_euler = (math.radians(lean), 0, math.radians(twist))
    for c in torso.children:
        if c.name.endswith("_head"):
            c.rotation_euler.z = math.radians(head)
        if c.name.endswith("_arm_R"):
            c.rotation_euler.x = math.radians(arm)


def sheet_robot(normals):
    reset()
    ground()
    base = AL.make_robot("robot")
    place(base, -240, 0)
    for i, (rz, x) in enumerate(((-40, -120), (90, 0), (180, 120))):
        place(clone(base, "_%d" % i), x, 0, rz=rz)
    p = AL.make_robot("robotP")
    place(p, 245, 0, rz=-20)
    pose_robot(p)
    ball(-240, -30)
    lights((0, 0, 0.09), 0.8)
    camera((0.0, -1.05, 0.30), (0.0, 0.0, 0.085), lens=50)
    render("alien_robot", 1500, 600, normals)
    # game camera
    reset()
    ground()
    r = AL.make_robot("robot")
    place(r, 0, 0)
    ball(0, 0)
    p = AL.make_robot("robotP")
    place(p, 130, 20, rz=-15)
    pose_robot(p, twist=20, lean=10, head=-25, arm=-50)
    a = AL.make_alien("alien_0", "gun")
    place(a, -110, -20, rz=10)
    lights((0, 0, 0.08), 0.6)
    camera((0.0, -0.40, 0.62), (0.0, 0.02, 0.06), lens=55)
    render("alien_robot_game", 1000, 640, normals)
    # close-up of the cockpit
    reset()
    ground()
    r = AL.make_robot("robot")
    lights((0, 0, 0.12), 0.5)
    camera((0.06, -0.30, 0.20), (0.0, 0.0, 0.115), lens=60)
    render("alien_robot_close", 900, 700, normals)


def sheet_aliens(normals):
    reset()
    ground()
    x = -150
    for pose in ("gun", "point", "crouch"):
        a = AL.make_alien("alien_" + pose, pose)
        place(a, x, 0)
        place(clone(a, "_b"), x + 45, 0, rz=-55)
        x += 105
    ball(170, -20)
    lights((0, 0, 0.04), 0.4)
    camera((0.0, -0.62, 0.15), (0.0, 0.0, 0.03), lens=52)
    render("alien_aliens", 1500, 560, normals)
    reset()
    ground()
    a = AL.make_alien("alien_gun", "gun")
    place(a, -18, 0, rz=-20)
    b = AL.make_alien("alien_point", "point")
    place(b, 22, 6, rz=15)
    lights((0, 0, 0.05), 0.25)
    camera((0.0, -0.17, 0.075), (0.0, 0.0, 0.040), lens=55)
    render("alien_aliens_close", 900, 700, normals)


def sheet_small(normals):
    reset()
    ground()
    b = AL.make_saucer_bumper("bumper_0"); place(b, -170, 40)
    ob = assets.make_bumper("bumper_orig"); place(ob, -170, 130)
    hit = AL.make_saucer_bumper("bumper_1"); place(hit, -95, 120)
    hit.children[0].location.z -= 9 * MM if hit.children[0].name.endswith("_ring") else 0
    for i in range(3):
        d = AL.make_alien_drop_target("droptarget_%d" % i); place(d, -40 + i * 27, 40)
    o = assets.make_drop_target("dt_orig", "R"); place(o, -40 + 3 * 27, 40)
    s = AL.make_saucer_small("saucer_0"); place(s, 95, 60, z=70)
    stalk(95, 60, 70)
    s2 = AL.make_saucer_small("saucer_1", r=26); place(s2, 160, 130, z=55, rz=40)
    stalk(160, 130, 55, "stalk2")
    p = AL.make_beam_pad("beampad"); place(p, 140, -40)
    ball(-128, 40)
    lights((0, 0.03, 0.04), 0.5)
    camera((0.0, -0.56, 0.40), (0.0, 0.04, 0.03), lens=52)
    render("alien_small", 1300, 720, normals)
    # close-ups: bumper + drop target + pad
    sc = bpy.context.scene
    sc.camera.location = (-0.12, -0.17, 0.14)
    sc.camera.rotation_euler = (Vector((-0.12, 0.05, 0.03)) - Vector((-0.12, -0.17, 0.14))).to_track_quat('-Z', 'Y').to_euler()
    render("alien_small_close", 1100, 700, normals)
    sc.camera.location = (0.14, -0.13, 0.12)
    sc.camera.rotation_euler = (Vector((0.13, -0.03, 0.0)) - Vector((0.14, -0.13, 0.12))).to_track_quat('-Z', 'Y').to_euler()
    render("alien_small_pad", 900, 600, normals)


def sheet_game(normals):
    """Rough table mock-up seen from the phone camera."""
    reset()
    ground()
    m = AL.make_mothership(); place(m, 0, 330, z=150)
    for i, (x, y) in enumerate(((-60, 170), (60, 175), (0, 110))):
        place(AL.make_saucer_bumper("bumper_%d" % i), x, y)
    r = AL.make_robot(); place(r, -170, 60, rz=20)
    for i in range(4):
        place(AL.make_alien_drop_target("droptarget_%d" % i), 120 + i * 26, -20, rz=-30)
    for i, pose in enumerate(("gun", "point", "crouch")):
        place(AL.make_alien("alien_%d" % i, pose), -40 + i * 40, -120, rz=(i - 1) * 20)
    s = AL.make_saucer_small("saucer_0"); place(s, 200, 120, z=60); stalk(200, 120, 60)
    place(AL.make_beam_pad(), 30, 30)
    ball(-170, 40)
    ball(30, 30)
    lights((0, 0.1, 0.1), 0.9)
    camera((0.0, -0.75, 0.80), (0.0, 0.10, 0.04), lens=45)
    render("alien_game", 1000, 900, normals)


def glb():
    reset()
    x = 0
    for tag, fn in AL.ALIEN_ASSETS.items():
        r = fn()
        place(r, x, 0)
        x += 250
    for p in ("point", "crouch"):
        place(AL.make_alien("alien_" + p, p), x, 0)
        x += 100
    path = os.path.join(OUT, "alien_test.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False)
    print("GLB", path, os.path.getsize(path))
    import json
    import struct
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + n])
    for m in js["materials"]:
        if m["name"].startswith("glow_beam") or m["name"].startswith("glow_alien_dome"):
            print("  material", m["name"], m.get("alphaMode"), m.get("pbrMetallicRoughness", {}).get("baseColorFactor"),
                  m.get("extensions"))
    print("  nodes:", sorted(nd["name"] for nd in js["nodes"]))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    nrm = "--normals" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    todo = args or ["checks", "mothership", "robot", "aliens", "small", "game", "glb"]
    for s in todo:
        if s == "glb":
            glb()
        else:
            globals()["sheet_" + s](nrm)

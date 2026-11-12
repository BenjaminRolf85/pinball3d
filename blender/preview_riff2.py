"""Preview sheets for assets_riff2 toys.  Usage: python3 blender/preview_riff2.py [turntable small truss glb] [--normals]"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets  # noqa: E402
import assets_riff2 as R2  # noqa: E402
from preview import reset, ground, camera, lights, place, render, panel, OUT, MM  # noqa: E402,F401


def report(tag, root):
    lo, hi = assets.bounds_mm(root)
    parts = ["%s@(%.1f,%.1f,%.1f)" % (c.name, c.location.x / MM, c.location.y / MM, c.location.z / MM) for c in root.children]
    print("ASSET %-10s tris=%5d  min=%s max=%s  parts=%s" % (tag, assets.tri_count(root), lo, hi, parts))


def ball(x, y, z):
    s = assets.Builder()
    s.sphere(13.5, (0, 0, 0), "chrome", u=32, v=20)
    ob = s.finish("ball")
    ob.location = (x * MM, y * MM, (z + 13.5) * MM)
    return ob


def check_turntable(root):
    """Lowest point of root geometry above the disc (r <= r_rim)."""
    rim = 35.0
    low = 1e9
    for v in root.data.vertices:
        x, y, z = v.co.x / MM, v.co.y / MM, v.co.z / MM
        if math.hypot(x, y) <= rim and z > 3.0:
            low = min(low, z)
    print("CHECK turntable: lowest geometry over disc (r<=35, z>3) = %.2f mm (need >= 30)" % low)
    hi = max(v.co.z / MM for v in root.children[0].data.vertices)
    print("CHECK turntable: disc top z = %.2f" % hi)


def check_mic(root):
    st = root.children[0]
    worst = 0
    for v in st.data.vertices:
        z = v.co.z / MM + 4.0
        if z < 30:
            worst = max(worst, math.hypot(v.co.x / MM, v.co.y / MM))
    print("CHECK mic: max radius below z30 = %.2f (need <= 9)" % worst)


def check_backstage(root):
    bad = 0
    for ob in [root] + list(root.children):
        off = ob.location / MM if ob is not root else Vector()
        for v in ob.data.vertices:
            p = v.co / MM + off
            if -17.9 < p.x < 17.9 and -32 < p.y < 6 and 1.05 < p.z < 31.9:
                bad += 1
    print("CHECK backstage: verts intruding into the scoop tunnel = %d" % bad)


def sheet_turntable(normals):
    reset()
    ground()
    t = R2.make_turntable()
    report("turntable", t)
    check_turntable(t)
    t.children[0].rotation_euler.z = math.radians(30)
    ball(-12, -14, 0.8)
    lights((0, 0, 0.02), 0.25)
    camera((0.0, -0.20, 0.17), (0.008, 0.0, 0.005), lens=45)
    render("riff2_turntable", 1000, 640, normals)


def sheet_small(normals):
    reset()
    ground()
    m = R2.make_mic_stand(); place(m, -150, 10); report("mic", m); check_mic(m)
    b = R2.make_backstage(); place(b, -40, 30); report("backstage", b); check_backstage(b)
    ball(-40, 30 - 20, 0.8)
    f = R2.make_flame_cannon(); place(f, 60, -10); report("flamecan", f)
    w = R2.make_speaker_wedge(); place(w, 130, 10); report("wedge", w)
    lights((0, 0, 0.04), 0.4)
    camera((-0.01, -0.46, 0.27), (-0.005, 0.02, 0.03), lens=40)
    render("riff2_small", 1200, 640, normals)


def sheet_truss(normals):
    reset()
    ground()
    t = R2.make_truss_arch(); report("truss", t)
    for c in t.children:
        if "_head_" in c.name:
            i = int(c.name[-1])
            c.rotation_euler = (math.radians(-15 if i % 2 else 10), 0, math.radians(20 * (i - 1.5)))
    for k in range(6):
        ball(-150 + k * 60, -40 + (k % 2) * 30, 0)
    lights((0, 0, 0.08), 0.5)
    camera((0.0, -0.75, 0.10), (0.0, 0.0, 0.085), lens=35)
    render("riff2_truss_front", 1100, 620, normals)
    sc = bpy.context.scene
    sc.camera.location = (0.0, -0.62, 0.50)
    sc.camera.rotation_euler = (Vector((0, 0.05, 0.03)) - Vector((0.0, -0.62, 0.50))).to_track_quat('-Z', 'Y').to_euler()
    render("riff2_truss_game", 1100, 620, normals)


def glb():
    reset()
    roots = []
    for i, (k, fn) in enumerate(R2.RIFF2_ASSETS.items()):
        r = fn()
        place(r, i * 120, 0)
        roots.append(r)
    path = os.path.join(OUT, "riff2_test.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False)
    print("GLB", path, os.path.getsize(path))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    nrm = "--normals" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    todo = args or ["turntable", "small", "truss", "glb"]
    for s in todo:
        if s == "glb":
            glb()
        else:
            globals()["sheet_" + s](nrm)

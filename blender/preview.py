"""Build every asset, report size/triangles, export a test GLB and render
Cycles preview sheets.  Usage:  python3 blender/preview.py [sheet ...] [--normals]
Sheets: skull, small, big, rocker, rocker_game, pinup, pinup_close, pinup_game, pinup_shriek  (default: all)."""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets  # noqa: E402
import materials  # noqa: E402

OUT = "build/previews"
MM = 0.001


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 40
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.threads_mode = 'AUTO'
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    w = bpy.data.worlds.new("w")
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.02, 0.02, 0.03, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = w
    return sc


def emit_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*color, 1)
    em.inputs[1].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def panel(loc, size, color, strength, target=(0, 0, 0)):
    me = bpy.data.meshes.new("panel")
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("panel", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    me.materials.append(emit_mat("panel", color, strength))
    return ob


def ground(size=3.0):
    me = bpy.data.meshes.new("ground")
    s = size
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
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
    ob.location.z = -0.0002
    return ob


def camera(loc, target, lens=50):
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    cam.clip_start = 0.01
    ob = bpy.data.objects.new("cam", cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def lights(centre=(0, 0, 0), r=0.6):
    cx, cy, cz = centre
    panel((cx - r, cy - r, cz + r), r * 1.2, (1.0, 0.85, 0.7), 5, centre)
    panel((cx + r * 1.2, cy - r * 0.4, cz + r * 0.7), r * 1.0, (0.55, 0.75, 1.0), 3.5, centre)
    panel((cx, cy + r * 0.9, cz + r * 1.1), r * 1.4, (1.0, 0.35, 0.15), 2.5, centre)
    panel((cx, cy - r * 0.2, cz + r * 1.6), r * 1.6, (1, 1, 1), 1.2, centre)


def place(root, x, y, z=0.0, rz=0.0, rx=0.0):
    root.location = (x * MM, y * MM, z * MM)
    root.rotation_euler = (math.radians(rx), 0, math.radians(rz))


def normals_override():
    """Green = front face, red = back face (three.js culls back faces)."""
    m = bpy.data.materials.new("normals_dbg")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    a = nt.nodes.new("ShaderNodeBsdfDiffuse")
    a.inputs[0].default_value = (0.1, 0.8, 0.2, 1)
    b = nt.nodes.new("ShaderNodeEmission")
    b.inputs[0].default_value = (1, 0, 0, 1)
    b.inputs[1].default_value = 3
    nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
    nt.links.new(a.outputs[0], mix.inputs[1])
    nt.links.new(b.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def render(name, w=960, h=600, normals=False):
    sc = bpy.context.scene
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    if normals:
        dbg = normals_override()
        for ob in sc.objects:
            if ob.type == 'MESH' and ob.name not in ("ground",) and not ob.name.startswith("panel"):
                ob.data.materials.clear()
                ob.data.materials.append(dbg)
                for p in ob.data.polygons:
                    p.material_index = 0
        name += "_normals"
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", sc.render.filepath)


def report(tag, root):
    lo, hi = assets.bounds_mm(root)
    parts = [c.name for c in root.children]
    print("ASSET %-11s tris=%5d  min=%s max=%s  parts=%s" % (tag, assets.tri_count(root), lo, hi, parts))


def sheet_skull(normals):
    reset()
    ground()
    for i, (rz, x) in enumerate(((0, -190), (-38, -60), (-90, 75), (180, 205))):
        s = assets.make_skull("skull%d" % i)
        place(s, x, 0, rz=rz)
        if i == 0:
            report("skull", s)
    top = assets.make_skull("skullT")
    place(top, 0, 230)
    lights((0, 0, 0.05), 0.55)
    camera((0.0, -0.74, 0.52), (0.0, 0.05, 0.03), lens=55)
    render("sheet_skull", 1100, 620, normals)


def sheet_small(normals):
    reset()
    ground()
    x = -250
    items = []
    b = assets.make_bumper(); place(b, -205, 60); items.append(("bumper", b))
    f = assets.make_flipper(); place(f, -170, -40, rz=-30); items.append(("flipper", f))
    for i, ch in enumerate("ROCK"):
        d = assets.make_drop_target("dt_" + ch, ch); place(d, -150 + i * 30, 70)
        if i == 0:
            items.append(("droptarget", d))
    p = assets.make_post(); place(p, -60, -30); items.append(("post", p))
    lg = assets.make_lane_guide(); place(lg, -20, 40); items.append(("laneguide", lg))
    sp = assets.make_spinner(); place(sp, 30, -40); items.append(("spinner", sp))
    sp.children[0].rotation_euler.x = math.radians(25)
    g = assets.make_gate(); place(g, 50, 70); items.append(("gate", g))
    g.children[0].rotation_euler.x = math.radians(-20)
    pl = assets.make_plunger(); place(pl, 105, 150); items.append(("plunger", pl))
    t = assets.make_tesla_coil(); place(t, 155, 70); items.append(("tesla", t))
    fp = assets.make_flame_pot(); place(fp, 100, -60); items.append(("flamepot", fp))
    par = assets.make_par_can(); place(par, 205, 40, z=75); items.append(("par", par))
    bo = assets.make_bolt(); place(bo, 150, -50); items.append(("bolt", bo))
    for tag, root in items:
        report(tag, root)
    lights((0, 0, 0.03), 0.5)
    camera((0.0, -0.56, 0.44), (0.0, 0.03, 0.01), lens=58)
    render("sheet_small", 1200, 640, normals)


def sheet_big(normals):
    reset()
    ground()
    a = assets.make_amp_stack(); place(a, -190, 120, rz=-18); report("amp", a)
    g = assets.make_guitar(); place(g, 40, -40, z=7, rz=-62); report("guitar", g)
    lo = assets.make_logo(); place(lo, 60, 230, z=45, rz=-25); report("logo", lo)
    lights((0, 0.05, 0.05), 0.7)
    camera((0.0, -0.66, 0.60), (0.0, 0.07, 0.03), lens=52)
    render("sheet_big", 1200, 680, normals)


def pose_rocker(root, lean=15.0, head=14.0, arm=28.0):
    """Laughing pose: torso leans back, head tilts back, right arm punches up."""
    torso = next(c for c in root.children if c.name.endswith("_torso"))
    torso.rotation_euler.x = math.radians(lean)
    for c in torso.children:
        if c.name.endswith("_head"):
            c.rotation_euler.x = math.radians(head)
        if c.name.endswith("_arm_R"):
            c.rotation_euler.y = math.radians(arm)


def sheet_rocker(normals):
    reset()
    ground()
    for i, (rz, x) in enumerate(((0, -290), (-38, -165), (38, -40), (90, 80), (180, 190))):
        r = assets.make_rocker("roxy%d" % i)
        place(r, x, 0, rz=rz)
        if i == 0:
            report("rocker", r)
    posed = assets.make_rocker("roxyP")
    place(posed, 300, 0, rz=-20)
    pose_rocker(posed)
    lights((0, 0, 0.08), 0.75)
    camera((0.0, -1.1, 0.36), (0.005, 0.0, 0.075), lens=56)
    render("sheet_rocker", 1400, 520, normals)


def sheet_rocker_game(normals):
    """What the player sees: about 60 degrees above the horizon, plus a ball for scale."""
    reset()
    ground()
    for i, (rz, x, pose) in enumerate(((0, -120, False), (0, 0, True), (-25, 120, False))):
        r = assets.make_rocker("roxyG%d" % i)
        place(r, x, 0, rz=rz)
        if pose:
            pose_rocker(r)
    me = bpy.data.meshes.new("ball")
    import bmesh as _bm
    b = _bm.new()
    _bm.ops.create_uvsphere(b, u_segments=24, v_segments=16, radius=13.5 * MM)
    for f in b.faces:
        f.smooth = True
    b.to_mesh(me)
    b.free()
    me.materials.append(materials.mat("chrome"))
    ball = bpy.data.objects.new("ball", me)
    bpy.context.scene.collection.objects.link(ball)
    ball.location = (-0.120, -0.03, 0.0135)
    lights((0, 0, 0.08), 0.6)
    camera((0.0, -0.36, 0.66), (0.0, 0.02, 0.06), lens=60)
    render("sheet_rocker_game", 1000, 640, normals)


def clone(root, suffix):
    """Linked copy of an asset hierarchy (shares mesh data, so sheets build fast)."""
    def rec(ob, parent):
        c = ob.copy()
        c.name = ob.name + suffix
        bpy.context.scene.collection.objects.link(c)
        if parent is not None:
            c.parent = parent
        for ch in ob.children:
            rec(ch, c)
        return c
    return rec(root, None)


def pose_pinup(root, lean=-10.0, head=-15.0, arm=20.0):
    """Laughing pose. Negative X rotation leans back (she faces -Y); +Y lifts her right arm."""
    torso = next(c for c in root.children if "_torso" in c.name)
    torso.rotation_euler.x = math.radians(lean)
    for c in torso.children:
        if "_head" in c.name:
            c.rotation_euler.x = math.radians(head)
        if "_arm_R" in c.name:
            c.rotation_euler.y = math.radians(arm)


def add_ball(x, y):
    import bmesh as _bm
    me = bpy.data.meshes.new("ball")
    b = _bm.new()
    _bm.ops.create_uvsphere(b, u_segments=24, v_segments=16, radius=13.5 * MM)
    for f in b.faces:
        f.smooth = True
    b.to_mesh(me)
    b.free()
    me.materials.append(materials.mat("chrome"))
    ball = bpy.data.objects.new("ball", me)
    bpy.context.scene.collection.objects.link(ball)
    ball.location = (x * MM, y * MM, 0.0135)


def sheet_pinup(normals):
    reset()
    ground()
    base = assets.make_pinup("pin")
    report("pinup", base)
    place(base, -300, 0)
    for i, (rz, x) in enumerate(((-38, -180), (38, -60), (90, 60), (180, 170))):
        place(clone(base, "_%d" % i), x, 0, rz=rz)
    posed = clone(base, "_P")
    place(posed, 290, 0, rz=-15)
    pose_pinup(posed)
    lights((0, 0, 0.08), 0.75)
    camera((0.0, -1.1, 0.30), (0.0, 0.0, 0.078), lens=56)
    render("sheet_pinup", 1500, 560, normals)


def sheet_pinup_close(normals):
    reset()
    ground()
    base = assets.make_pinup("pin")
    place(base, -32, 0)
    b = clone(base, "_b")
    place(b, 32, 0, rz=-32)
    lights((0, 0, 0.13), 0.5)
    camera((0.0, -0.26, 0.152), (0.0, 0.0, 0.130), lens=70)
    render("sheet_pinup_close", 1100, 700, normals)


def sheet_pinup_game(normals):
    reset()
    ground()
    base = assets.make_pinup("pin")
    place(base, -110, 0)
    p = clone(base, "_p")
    place(p, 0, 0)
    pose_pinup(p)
    c = clone(base, "_c")
    place(c, 110, 0, rz=-25)
    add_ball(-110, -30)
    add_ball(0, 0)
    lights((0, 0, 0.08), 0.6)
    camera((0.0, -0.36, 0.66), (0.0, 0.02, 0.06), lens=60)
    render("sheet_pinup_game", 1000, 640, normals)


def shriek_pinup(root, mode="scale", amount=1.0, wobble=0.12):
    """Shriek pose: torso back 8 deg, head back 12 deg, arm up 25 deg, skirt fluttering.
    mode "scale": the game's object transform (Blender X/Y scale 1.35, Z scale 0.85, wobble about Y);
    mode "morph": the "flare" shape key."""
    pose_pinup(root, lean=-8.0, head=-12.0, arm=25.0)
    skirt = next(c for c in root.children if c.name.split(".")[0].endswith("_skirt") or "_skirt" in c.name)
    if mode == "scale":
        skirt.scale = (1.0 + 0.35 * amount, 1.0 + 0.35 * amount, 1.0 - 0.15 * amount)
        skirt.rotation_euler.y = wobble * amount
    else:
        skirt.data.shape_keys.key_blocks["flare"].value = amount
        skirt.rotation_euler.y = wobble * amount * 0.5


def sheet_pinup_shriek(normals):
    reset()
    ground()
    base = assets.make_pinup("pin")
    report("pinup", base)
    place(base, -330, 0)
    place(clone(base, "_r34"), -205, 0, rz=-38)
    sc = clone(base, "_s1")
    place(sc, -60, 0)
    shriek_pinup(sc, "scale")
    sc2 = clone(base, "_s2")
    place(sc2, 60, 0, rz=-38)
    shriek_pinup(sc2, "scale")
    mo = assets.make_pinup("pinM")          # own mesh: the shape key value lives on the mesh
    place(mo, 190, 0)
    shriek_pinup(mo, "morph")
    mo2 = clone(mo, "_m2")
    place(mo2, 320, 0, rz=-38)
    lights((0, 0, 0.08), 0.75)
    camera((0.0, -1.2, 0.30), (0.0, 0.0, 0.078), lens=56)
    render("sheet_pinup_shriek", 1600, 560, normals)
    # game camera: rest, scale-flutter, morph-flutter, each with a ball in the tunnel
    reset()
    ground()
    b = assets.make_pinup("pinG")
    place(b, -110, 0)
    s1 = clone(b, "_s")
    place(s1, 0, 0)
    shriek_pinup(s1, "scale")
    m = assets.make_pinup("pinGM")
    place(m, 110, 0)
    shriek_pinup(m, "morph")
    for x in (-110, 0, 110):
        add_ball(x, 0)
    lights((0, 0, 0.08), 0.6)
    camera((0.0, -0.36, 0.66), (0.0, 0.02, 0.06), lens=60)
    render("sheet_pinup_shriek_game", 1000, 640, normals)


def export_all():
    reset()
    total = 0
    x = 0
    for tag, fn in assets.ALL_ASSETS.items():
        root = fn()
        report(tag, root)
        root.location.x = x * MM
        x += 200
        total += assets.tri_count(root)
    path = os.path.join(OUT, "assets_test.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False,
                              export_yup=True, export_extras=True)
    print("GLB %s  %.1f kB   one-of-each tris=%d" % (path, os.path.getsize(path) / 1024, total))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    normals = "--normals" in sys.argv
    sheets = {"skull": sheet_skull, "small": sheet_small, "big": sheet_big, "rocker": sheet_rocker, "rocker_game": sheet_rocker_game,
              "pinup": sheet_pinup, "pinup_close": sheet_pinup_close, "pinup_game": sheet_pinup_game,
              "pinup_shriek": sheet_pinup_shriek}
    for key in (args or list(sheets)):
        if key == "glb":
            continue
        sheets[key](normals)
    if not args or "glb" in args:
        export_all()

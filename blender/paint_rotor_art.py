"""ROTORSTURM: painted playfield artwork (dusk patrol scene, apron sunset, two soldier panels).

Blender renders the 3-D actors (soldiers, helicopter, palm) as back-lit RGBA layers; numpy then
paints sky, hills, haze, smoke, grass, composites everything and gives it a painted finish
(Kuwahara filter, colour grade, grain, torn-paper alpha edge).

Run:   python3 blender/paint_rotor_art.py            (render actors + paint)
       python3 blender/paint_rotor_art.py paint      (re-paint from cached renders)
Output: assets/rotor/art_scene.png, art_apron.png, art_soldier_left.png, art_soldier_right.png
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "rotor")
CACHE = os.path.join(ROOT, "build", "art_cache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
sys.path.insert(0, HERE)


# =============================================================================== Blender actors
def blender_renders(only=None):
    import bpy
    import bmesh
    from mathutils import Matrix, Vector

    def reset():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 48
        sc.cycles.use_denoising = True
        try:
            sc.cycles.denoiser = "OPENIMAGEDENOISE"
        except Exception:
            pass
        sc.render.film_transparent = True
        sc.view_settings.view_transform = "Standard"
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGBA"
        return sc

    mats = {}

    def M(name, base, rough=0.75, metal=0.0):
        if name in mats:
            return mats[name]
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*base, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        mats[name] = m
        return m

    def camo(name, cols, scale=18.0):
        if name in mats:
            return mats[name]
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        nt = m.node_tree
        b = nt.nodes.get("Principled BSDF")
        b.inputs["Roughness"].default_value = 0.85
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = 3.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        rp = nt.nodes.new("ShaderNodeValToRGB")
        rp.color_ramp.interpolation = "CONSTANT"
        els = rp.color_ramp.elements
        while len(els) < len(cols):
            els.new(0.5)
        for i, (e, c) in enumerate(zip(els, cols)):
            e.position = 0.0 if i == 0 else 0.35 + 0.15 * i
            e.color = (*c, 1)
        nt.links.new(nz.outputs["Fac"], rp.inputs["Fac"])
        nt.links.new(rp.outputs["Color"], b.inputs["Base Color"])
        mats[name] = m
        return m

    def link(ob, parent):
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob

    def mesh_obj(name, bm, mat, parent):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(mat)
        return link(bpy.data.objects.new(name, me), parent)

    def sphere(name, center, radius, scale, mat, parent, cut_below=None, segs=24):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=radius)
        if cut_below is not None:
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut_below], context="VERTS")
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
        ob = mesh_obj(name, bm, mat, parent)
        ob.location = center
        return ob

    def box(name, size, matrix, mat, parent, bevel=0.0):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=size, verts=bm.verts)
        if bevel:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
        return mesh_obj(name, bm, mat, parent)

    def cyl(name, r, length, matrix, mat, parent, segs=16, r2=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=length)
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
        return mesh_obj(name, bm, mat, parent)

    def frame_from(a, b, up=Vector((0, 0, 1))):
        """Matrix whose local X points from a to b, origin at a."""
        x = (Vector(b) - Vector(a)).normalized()
        z = (up - x * up.dot(x)).normalized()
        y = z.cross(x)
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = Vector(a)
        return m

    # ---------------------------------------------------------------- rifle (local X forward, origin at the pistol grip)
    def rifle(parent, matrix, mat):
        parts = []
        def B(sz, c, rot=None):
            mm = Matrix.Translation(c)
            if rot:
                mm = mm @ rot
            parts.append(box("rf", sz, matrix @ mm, mat, parent, bevel=0.004))
        def CY(r, x0, x1, z, r2=None):
            mm = Matrix.Translation(((x0 + x1) / 2, 0, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
            parts.append(cyl("rf", r, x1 - x0, matrix @ mm, mat, parent, r2=r2))
        B((0.030, 0.028, 0.085), (-0.01, 0, -0.035), Matrix.Rotation(0.3, 4, "Y"))          # pistol grip
        B((0.27, 0.036, 0.065), (0.04, 0, 0.045))                                           # receiver
        B((0.15, 0.016, 0.035), (0.06, 0, 0.095))                                           # carry handle
        B((0.35, 0.034, 0.05), (-0.32, 0, 0.04), Matrix.Rotation(-0.06, 4, "Y"))            # stock
        B((0.05, 0.03, 0.10), (-0.48, 0, 0.03))                                             # butt plate
        CY(0.024, 0.17, 0.46, 0.05)                                                          # handguard
        CY(0.008, 0.46, 0.63, 0.055)                                                         # barrel
        CY(0.011, 0.63, 0.67, 0.055)                                                         # flash hider
        B((0.016, 0.012, 0.07), (0.46, 0, 0.085))                                            # front sight
        B((0.035, 0.026, 0.16), (0.08, 0, -0.06), Matrix.Rotation(0.18, 4, "Y"))            # magazine
        return parts

    # ---------------------------------------------------------------- soldier from a joint pose (facing +X)
    ORDER = ["pelvis", "spine", "chest", "neck", "hipL", "kneeL", "ankleL", "toeL", "hipR", "kneeR", "ankleR", "toeR",
             "shL", "elL", "wrL", "shR", "elR", "wrR"]
    EDGES = [("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"), ("pelvis", "hipL"), ("hipL", "kneeL"),
             ("kneeL", "ankleL"), ("ankleL", "toeL"), ("pelvis", "hipR"), ("hipR", "kneeR"), ("kneeR", "ankleR"),
             ("ankleR", "toeR"), ("chest", "shL"), ("shL", "elL"), ("elL", "wrL"), ("chest", "shR"), ("shR", "elR"),
             ("elR", "wrR")]
    RAD = {"pelvis": (0.15, 0.15), "spine": (0.145, 0.145), "chest": (0.165, 0.165), "neck": (0.06, 0.06),
           "hipL": (0.11, 0.11), "kneeL": (0.085, 0.085), "ankleL": (0.06, 0.06), "toeL": (0.05, 0.045),
           "shL": (0.075, 0.075), "elL": (0.06, 0.06), "wrL": (0.045, 0.04)}
    for k in list(RAD):
        if k.endswith("L"):
            RAD[k[:-1] + "R"] = RAD[k]

    def soldier(pose, name="sold", gear=(), helmet_tilt=-0.06, cover=True, yaw=0.0, loc=(0, 0, 0), view=(0.0, -1.0, 0.0), nose=True):
        fig = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(fig)
        fatigue = camo("fatigue", [(0.13, 0.15, 0.07), (0.16, 0.18, 0.09), (0.11, 0.12, 0.06)], scale=6.0)
        hcover = camo("hcover", [(0.20, 0.22, 0.10), (0.10, 0.13, 0.05), (0.26, 0.20, 0.10), (0.05, 0.06, 0.03)], scale=26.0) if cover else M("helm", (0.15, 0.17, 0.08), 0.6)
        skin = M("skin", (0.30, 0.19, 0.13), 0.55)
        dark = M("boots", (0.03, 0.025, 0.02), 0.5)
        gun = M("gun", (0.025, 0.025, 0.025), 0.45, 0.3)
        web = M("web", (0.12, 0.13, 0.07), 0.9)
        P = {k: Vector(v) for k, v in pose.items() if k != "rifle"}
        me = bpy.data.meshes.new(name + "_body")
        me.from_pydata([P[k] for k in ORDER], [(ORDER.index(a), ORDER.index(b)) for a, b in EDGES], [])
        body = link(bpy.data.objects.new(name + "_body", me), fig)
        body.modifiers.new("skin", "SKIN")
        sv = me.skin_vertices[0].data
        for i, k in enumerate(ORDER):
            sv[i].radius = RAD[k]
        sv[0].use_root = True
        sub = body.modifiers.new("sub", "SUBSURF")
        sub.levels = 2
        sub.render_levels = 2
        me.materials.append(fatigue)
        # head, nose, helmet
        hc = P["head"]
        sphere(name + "_head", hc, 0.086, (1.0, 0.82, 1.12), skin, fig)
        sphere(name + "_jaw", hc + Vector((0.035, 0, -0.065)), 0.058, (1.0, 0.85, 0.75), skin, fig)
        if nose:
            cyl(name + "_nose", 0.024, 0.045, Matrix.Translation(hc + Vector((0.098, 0, -0.025))) @ Matrix.Rotation(math.pi / 2 + 0.35, 4, "Y"), skin, fig, r2=0.006)
        hm = Matrix.Translation(hc + Vector((-0.008, 0, -0.004))) @ Matrix.Rotation(helmet_tilt, 4, "Y")
        dome = sphere(name + "_helmet", (0, 0, 0), 0.148, (1.10, 0.98, 0.92), hcover, fig, cut_below=-0.004)
        dome.matrix_world = hm
        cyl(name + "_brim", 0.165, 0.012, hm @ Matrix.Translation((0, 0, -0.004)) @ Matrix.Diagonal((1.09, 1.0, 1.0, 1.0)), hcover, fig, segs=28, r2=0.148)
        # hands, boots
        for s in "LR":
            sphere(name + "_hand" + s, P["wr" + s], 0.045, (1.1, 0.85, 0.9), skin, fig)
            a, t = P["ankle" + s], P["toe" + s]
            m = frame_from(a, t)
            ln = (t - a).length
            box(name + "_boot" + s, (ln + 0.08, 0.10, 0.11), m @ Matrix.Translation((ln * 0.42, 0, -0.01)), dark, fig, bevel=0.035)
        # back pack, blanket roll, belt, pouches, canteen
        ch, pe = P["chest"], P["pelvis"]
        fwd = Vector((1, 0, 0))
        pk = ch + Vector((-0.20, 0, -0.09))
        box(name + "_pack", (0.19, 0.32, 0.36 if "radio" not in gear else 0.44), Matrix.Translation(pk), web, fig, bevel=0.06)
        belt_z = pe.z + 0.06
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=1.0)
        belt = bpy.data.objects.new(name + "_beltc", None)
        for s in (-1, 1):
            box(name + "_pouch", (0.09, 0.06, 0.1), Matrix.Translation((pe.x + 0.1, pe.y + s * 0.11, belt_z - 0.03)), web, fig, bevel=0.012)
        bm.free()
        cyl(name + "_belt", 0.165, 0.05, Matrix.Translation((pe.x + 0.01, pe.y, belt_z)) @ Matrix.Diagonal((1.0, 0.8, 1.0, 1.0)), web, fig, segs=24)
        if "radio" in gear:
            box(name + "_radio", (0.12, 0.26, 0.20), Matrix.Translation(pk + Vector((-0.06, 0, 0.0))), M("radio", (0.08, 0.09, 0.05)), fig, bevel=0.01)
            a = pk + Vector((-0.05, -0.08, 0.2))
            cyl(name + "_ant", 0.006, 1.15, Matrix.Translation(a + Vector((-0.12, 0, 0.56))) @ Matrix.Rotation(-0.2, 4, "Y"), gun, fig, segs=6, r2=0.003)
        # rifle
        r = pose.get("rifle")
        if r == "ready":
            m = frame_from(P["wrR"], P["wrL"])
            rifle(fig, m @ Matrix.Translation((0.0, 0, 0.0)), gun)
        elif r == "handle":
            d = Vector((1, 0, -0.12)).normalized()
            m = frame_from(Vector((0, 0, 0)), d)
            m.translation = P["wrR"] - (m.to_3x3() @ Vector((0.07, 0, 0.11)))
            rifle(fig, m, gun)
        elif r == "sling":
            v = Vector(view)
            v = Vector((v.x * math.cos(-yaw) - v.y * math.sin(-yaw), v.x * math.sin(-yaw) + v.y * math.cos(-yaw), 0))
            right = Vector((-v.y, v.x, 0)) * -1.0
            A = Vector((-0.06, -0.25, 0.98))
            Bm = A + Vector((0, 0, 0.95)) + right * 0.32
            d = (Bm - A).normalized()
            g = A + d * 0.48
            up = v.cross(d).normalized()
            rifle(fig, frame_from(g, g + d, up=up), gun)
        elif r == "port":
            m = frame_from(P["wrR"], P["wrL"], up=Vector((1, 0, 0)))
            rifle(fig, m, gun)
        fig.rotation_euler = (0, 0, yaw)
        fig.location = loc
        return fig

    def lights(rim=8.0, cool=2.5, fill=0.6, front=0.0, world=(0.10, 0.06, 0.10), rim_dir=(-0.5, -1.0, -0.15)):
        w = bpy.data.worlds.new("w")
        bpy.context.scene.world = w
        try:
            w.use_nodes = True
        except Exception:
            pass
        bg = w.node_tree.nodes.get("Background")
        bg.inputs["Color"].default_value = (*world, 1)
        bg.inputs["Strength"].default_value = fill

        def sun(nm, d, energy, col, ang=2.0):
            ld = bpy.data.lights.new(nm, "SUN")
            ld.energy = energy
            ld.color = col
            ld.angle = math.radians(ang)
            ob = bpy.data.objects.new(nm, ld)
            bpy.context.scene.collection.objects.link(ob)
            ob.rotation_euler = Vector(d).normalized().to_track_quat("-Z", "Y").to_euler()
        sun("rim", rim_dir, rim, (1.0, 0.55, 0.28))
        sun("cool", (0.6, -1.0, -0.2), cool, (0.6, 0.45, 0.85))
        if front:
            sun("front", (0.3, 1.0, -0.5), front, (1.0, 0.75, 0.6), 8.0)

    def bounds(objs):
        dg = bpy.context.evaluated_depsgraph_get()
        lo = Vector((1e9, 1e9, 1e9))
        hi = -lo
        for ob in objs:
            if ob.type != "MESH" or ob.hide_render:
                continue
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            for v in me.vertices:
                w = ev.matrix_world @ v.co
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
            ev.to_mesh_clear()
        return lo, hi

    def render(path, res, region=None, view="side", margin=0.06):
        sc = bpy.context.scene
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        bpy.context.view_layer.update()
        lo, hi = bounds(list(sc.objects))
        if region:
            lo = Vector((region[0], lo.y, region[2]))
            hi = Vector((region[1], hi.y, region[3]))
        cd = bpy.data.cameras.new("cam")
        cd.type = "ORTHO"
        cd.sensor_fit = "HORIZONTAL"
        w, h = (hi.x - lo.x), (hi.z - lo.z)
        asp = res[0] / res[1]
        cd.ortho_scale = max(w, h * asp) * (1 + margin)
        cam = bpy.data.objects.new("cam", cd)
        sc.collection.objects.link(cam)
        cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
        if view == "side":
            cam.location = (cx, -20, cz)
            cam.rotation_euler = (math.pi / 2, 0, 0)
        sc.camera = cam
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("rendered", os.path.basename(path))

    # ---------------------------------------------------------------- poses
    WALK = dict(pelvis=(0, 0, 0.98), spine=(0.03, 0, 1.16), chest=(0.07, 0, 1.36), neck=(0.10, 0, 1.52), head=(0.13, 0, 1.64),
                hipL=(0.0, 0.10, 0.95), kneeL=(0.17, 0.11, 0.55), ankleL=(0.27, 0.11, 0.12), toeL=(0.40, 0.11, 0.05),
                hipR=(0.0, -0.10, 0.95), kneeR=(-0.05, -0.11, 0.53), ankleR=(-0.24, -0.11, 0.17), toeR=(-0.13, -0.11, 0.04),
                shL=(0.07, 0.20, 1.42), elL=(0.24, 0.25, 1.20), wrL=(0.44, 0.12, 1.13),
                shR=(0.06, -0.20, 1.42), elR=(0.0, -0.25, 1.17), wrR=(0.17, -0.15, 1.04), rifle="ready")
    WALK2 = dict(WALK, hipL=(0.0, 0.10, 0.95), kneeL=(-0.04, 0.11, 0.53), ankleL=(-0.22, 0.11, 0.18), toeL=(-0.11, 0.11, 0.05),
                 hipR=(0.0, -0.10, 0.95), kneeR=(0.15, -0.11, 0.55), ankleR=(0.25, -0.11, 0.12), toeR=(0.38, -0.11, 0.05))
    CARRY = dict(WALK2, shR=(0.05, -0.20, 1.42), elR=(0.07, -0.24, 1.15), wrR=(0.09, -0.25, 0.88),
                 shL=(0.07, 0.20, 1.42), elL=(-0.05, 0.24, 1.18), wrL=(-0.06, 0.23, 0.95), rifle="handle")
    KNEEL = dict(pelvis=(0, 0, 0.56), spine=(0.03, 0, 0.76), chest=(0.07, 0, 0.97), neck=(0.10, 0, 1.13), head=(0.14, 0, 1.25),
                 hipL=(0.0, 0.10, 0.53), kneeL=(0.33, 0.11, 0.54), ankleL=(0.30, 0.11, 0.10), toeL=(0.43, 0.11, 0.04),
                 hipR=(0.0, -0.10, 0.53), kneeR=(0.10, -0.11, 0.07), ankleR=(-0.29, -0.11, 0.08), toeR=(-0.38, -0.11, 0.03),
                 shL=(0.08, 0.19, 1.03), elL=(0.29, 0.15, 0.66), wrL=(0.47, 0.07, 0.76),
                 shR=(0.06, -0.19, 1.03), elR=(0.0, -0.25, 0.80), wrR=(0.20, -0.14, 0.80), rifle="ready")
    NEAR = dict(WALK, shR=(0.06, -0.20, 1.42), elR=(0.10, -0.26, 1.17), wrR=(0.05, -0.18, 1.36),
                shL=(0.07, 0.20, 1.42), elL=(0.05, 0.25, 1.16), wrL=(0.10, 0.22, 0.93), rifle="sling", head=(0.12, 0, 1.645))

    jobs = {
        "near": lambda: (soldier(NEAR, "near", yaw=0.95, helmet_tilt=-0.16, nose=False), lights(rim=12, cool=2.0, fill=0.45, rim_dir=(-0.35, -1.0, -0.12)),
                         render(os.path.join(CACHE, "near.png"), (900, 1000), region=(-0.42, 0.42, 0.86, 1.86))),
        "walk_a": lambda: (soldier(WALK, "a", helmet_tilt=-0.05), lights(), render(os.path.join(CACHE, "walk_a.png"), (520, 900))),
        "walk_b": lambda: (soldier(CARRY, "b", helmet_tilt=0.04, cover=False), lights(), render(os.path.join(CACHE, "walk_b.png"), (520, 900))),
        "walk_c": lambda: (soldier(WALK2, "c", gear=("radio",), helmet_tilt=-0.1), lights(), render(os.path.join(CACHE, "walk_c.png"), (520, 1100))),
        "panel_walk": lambda: (soldier(WALK, "p", helmet_tilt=-0.06), lights(rim=11, cool=2.5, fill=0.55, front=0.12, world=(0.16, 0.10, 0.12)),
                               render(os.path.join(CACHE, "panel_walk.png"), (560, 900))),
        "panel_kneel": lambda: (soldier(KNEEL, "k", helmet_tilt=-0.02), lights(rim=11, cool=2.5, fill=0.55, front=0.12, world=(0.16, 0.10, 0.12)),
                                render(os.path.join(CACHE, "panel_kneel.png"), (700, 760))),
    }

    def heli_job():
        try:
            import assets_rotor as AR
            root = AR.make_heli(name="heli")
            for ob in bpy.context.scene.objects:
                if ob.name.startswith("heli_rotor"):
                    ob.hide_render = True
            root.rotation_euler = (math.radians(9), 0, 0)
        except Exception as exc:
            print("heli fallback:", exc)
            fig = bpy.data.objects.new("heli", None)
            bpy.context.scene.collection.objects.link(fig)
            od = M("od", (0.12, 0.14, 0.07), 0.6)
            sphere("fus", (0, 0, 0), 0.5, (0.55, 1.0, 0.5), od, fig)
            cyl("boom", 0.09, 1.3, Matrix.Translation((0, 0.95, 0.1)) @ Matrix.Rotation(math.pi / 2, 4, "X"), od, fig, r2=0.05)
            fig.rotation_euler = (math.radians(9), 0, math.pi)
        lights(rim=6, cool=2.0, fill=0.4)
        sc = bpy.context.scene
        # side view with the nose to the right: look along +X
        sc.render.resolution_x, sc.render.resolution_y = 1000, 500
        bpy.context.view_layer.update()
        lo, hi = bounds(list(sc.objects))
        cd = bpy.data.cameras.new("cam")
        cd.type = "ORTHO"
        cd.sensor_fit = "HORIZONTAL"
        cd.ortho_scale = max(hi.y - lo.y, (hi.z - lo.z) * 2) * 1.08
        cam = bpy.data.objects.new("cam", cd)
        sc.collection.objects.link(cam)
        cam.location = (lo.x - 5, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
        cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
        sc.camera = cam
        sc.render.filepath = os.path.join(CACHE, "heli.png")
        bpy.ops.render.render(write_still=True)

    def palm_job():
        try:
            import assets_rotor as AR
            AR.make_palm(name="palm", height=240, seed=5)
        except Exception as exc:
            print("palm fallback:", exc)
            return
        lights(rim=6, cool=2.0, fill=0.4)
        render(os.path.join(CACHE, "palm.png"), (800, 1000))

    jobs["heli"] = heli_job
    jobs["palm"] = palm_job
    for k, fn in jobs.items():
        if only and k not in only:
            continue
        reset()
        mats.clear()
        fn()


# =============================================================================== painting helpers
RNG = np.random.default_rng(1968)


def load(name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        return None
    return np.asarray(Image.open(p).convert("RGBA")).astype(np.float32) / 255.0


def noise2d(h, w, cell, seed, octaves=4, aspect=1.0):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cx = max(2, int(w / (cell * aspect)) + 2)
        cy = max(2, int(h / cell) + 2)
        g = rng.random((cy, cx)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(im).astype(np.float32) / 255.0)
        tot += amp
        amp *= 0.5
        cell /= 2.0
    return out / tot


def fbm1d(n, cell, seed, octaves=4):
    rng = np.random.default_rng(seed)
    x = np.arange(n, dtype=np.float32)
    out = np.zeros(n, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        k = int(n / cell) + 3
        pts = rng.random(k).astype(np.float32)
        xs = np.linspace(0, n - 1 + cell, k)
        out += amp * np.interp(x, xs, pts)
        tot += amp
        amp *= 0.5
        cell /= 2.0
    return out / tot


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gradient(h, w, stops):
    ys = np.linspace(0, 1, h)
    pos = [s[0] for s in stops]
    col = np.stack([np.interp(ys, pos, [s[1][c] for s in stops]) for c in range(3)], -1)
    return np.repeat(col[:, None, :], w, 1).astype(np.float32)


def lay(canvas, color, mask):
    m = np.clip(mask, 0, 1)[..., None]
    col = np.asarray(color, np.float32)
    canvas[:] = canvas * (1 - m) + col * m


def canopy_line(w, base, amp, seed, crown=(14, 34), cell=260):
    """Ridge line with tree-crown bumps; returns y per x (smaller y = higher)."""
    rng = np.random.default_rng(seed)
    y = base - amp * fbm1d(w, cell, seed, 4)
    x = np.arange(w)
    bump = np.zeros(w, np.float32)
    cx = -20.0
    while cx < w + 40:
        r = rng.uniform(*crown)
        lo, hi = int(max(0, cx - r)), int(min(w, cx + r))
        if hi > lo:
            xx = x[lo:hi]
            hump = r * 0.75 * np.sqrt(np.clip(1 - ((xx - cx) / r) ** 2, 0, 1))
            bump[lo:hi] = np.maximum(bump[lo:hi], hump)
        cx += r * rng.uniform(0.9, 1.4)
    return y - bump


def ridge_mask(h, w, line, soft=1.2):
    yy = np.arange(h, dtype=np.float32)[:, None]
    return smooth(-soft, soft, yy - line[None, :])


def paste(canvas, img, cx, bottom, height, tint=None, tint_amt=0.0, alpha=1.0, flip=False):
    """Composite an RGBA float image scaled to `height`, anchored at its bottom centre."""
    if img is None:
        return
    a = img[..., 3]
    ys, xs = np.nonzero(a > 0.02)
    if len(ys) == 0:
        return
    crop = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    if flip:
        crop = crop[:, ::-1]
    s = height / crop.shape[0]
    nw, nh = max(1, int(crop.shape[1] * s)), max(1, int(height))
    pim = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), "RGBA").resize((nw, nh), Image.LANCZOS)
    p = np.asarray(pim).astype(np.float32) / 255.0
    rgb, al = p[..., :3], p[..., 3] * alpha
    if tint is not None:
        rgb = rgb * (1 - tint_amt) + np.asarray(tint, np.float32) * tint_amt
    x0, y0 = int(cx - nw / 2), int(bottom - nh)
    H, W = canvas.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    ex, ey = min(nw, W - x0), min(nh, H - y0)
    if ex <= sx0 or ey <= sy0:
        return
    region = canvas[y0 + sy0:y0 + ey, x0 + sx0:x0 + ex]
    m = al[sy0:ey, sx0:ex, None]
    region[:] = region * (1 - m) + rgb[sy0:ey, sx0:ex] * m
    return x0, y0, nw, nh


def heli_sil(canvas, img, cx, cy, length, col, alpha=1.0, flip=False):
    """Helicopter silhouette with rotor-blur disc."""
    if img is None:
        return
    h = length * 0.42
    pl = paste(canvas, img, cx, cy + h / 2, h, tint=col, tint_amt=0.85, alpha=alpha, flip=flip)
    if pl is None:
        return
    x0, y0, nw, nh = pl
    H, W = canvas.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ry, rx = length * 0.035, length * 0.62
    top = y0 + nh * 0.04
    cx = x0 + nw * (0.62 if not flip else 0.38)
    e = ((xx - cx) / rx) ** 2 + ((yy - top) / ry) ** 2
    lay(canvas, col, np.clip(1 - e, 0, 1) ** 0.6 * 0.55 * alpha)
    lay(canvas, col, smooth(1.0, 0.0, np.abs(yy - top) / 1.6) * (np.abs(xx - cx) < rx * 0.98) * 0.5 * alpha)
    tx = x0 + nw * (0.04 if not flip else 0.96)
    e2 = ((xx - tx) / (length * 0.06)) ** 2 + ((yy - (y0 + nh * 0.18)) / (length * 0.06)) ** 2
    lay(canvas, col, np.clip(1 - e2, 0, 1) ** 0.7 * 0.35 * alpha)


def grass_layer(w, h, y_top, y_bot, n, seed, dark, lit, rim_side=1, sun_x=None):
    """Elephant grass: tapered curved blades drawn at 2x and filtered down."""
    rng = np.random.default_rng(seed)
    S = 2
    im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for i in range(n):
        x = rng.uniform(-20, w + 20)
        base = rng.uniform(y_bot - 10, h + 10)
        ht = rng.uniform(0.35, 1.0) * (base - y_top)
        lean = rng.uniform(-0.45, 0.45) + 0.15 * rim_side
        wid = rng.uniform(2.5, 6.0)
        pts_l, pts_r = [], []
        steps = 9
        for k in range(steps + 1):
            t = k / steps
            px = x + lean * ht * t * t
            py = base - ht * t
            ww = wid * (1 - t) + 0.3
            pts_l.append(((px - ww) * S, py * S))
            pts_r.append(((px + ww) * S, py * S))
        shade = rng.uniform(0.0, 1.0)
        c = tuple(int(255 * (dark[j] * (0.75 + 0.5 * shade))) for j in range(3))
        dr.polygon(pts_l + pts_r[::-1], fill=c + (255,))
        # sun catches the tips
        if rng.random() < 0.55:
            tip = pts_r[-4:]
            t2 = [(p[0] + (1.4 if rim_side > 0 else -1.4) * S, p[1]) for p in tip]
            lc = tuple(int(255 * lit[j] * rng.uniform(0.7, 1.0)) for j in range(3))
            dr.line(tip, fill=lc + (220,), width=max(1, int(1.6 * S)))
    im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def palm_img(height, seed, lean=0.18, dark=(0.05, 0.03, 0.04), rim=(1.0, 0.55, 0.28), rim_side=1):
    """Painted palm silhouette: curved ringed trunk and drooping fronds with leaflets (RGBA float)."""
    rng = np.random.default_rng(seed)
    S = 2
    w = int(height * 1.15)
    h = int(height)
    im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    D = tuple(int(255 * c) for c in dark) + (255,)
    Rc = tuple(int(255 * c) for c in rim)
    bx, by = w * 0.5, h - 2
    tx, ty = w * 0.5 + lean * h * 0.55, h * 0.16
    pts = []
    for k in range(41):
        t = k / 40
        x = bx + (tx - bx) * t + lean * h * 0.18 * math.sin(t * math.pi)
        y = by + (ty - by) * t
        pts.append((x, y, (0.026 - 0.012 * t) * h))
    for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
        dr.polygon([((x0 - r0) * S, y0 * S), ((x0 + r0) * S, y0 * S), ((x1 + r1) * S, y1 * S), ((x1 - r1) * S, y1 * S)], fill=D)
    for k in range(3, 40, 2):
        x, y, r = pts[k]
        dr.line([((x - r) * S, y * S), ((x + r) * S, (y + 0.004 * h) * S)], fill=(0, 0, 0, 255), width=S)
        e = x + rim_side * r * 0.85
        dr.line([(e * S, (y - 0.006 * h) * S), (e * S, (y + 0.006 * h) * S)], fill=Rc + (200,), width=max(1, S))
    cx, cy = tx, ty
    n = rng.integers(9, 13)
    for i in range(n):
        ang = -math.pi / 2 + (i / (n - 1) - 0.5) * math.pi * 1.9 + rng.uniform(-0.12, 0.12)
        L = h * rng.uniform(0.30, 0.46)
        droop = rng.uniform(0.45, 0.85) * L
        p0 = np.array([cx, cy])
        dirv = np.array([math.cos(ang), math.sin(ang)])
        p2 = p0 + dirv * L + np.array([0, droop * (0.4 + 0.6 * abs(math.cos(ang)))])
        p1 = p0 + dirv * L * 0.55 + np.array([0, -L * 0.12])
        seg = []
        for k in range(24):
            t = k / 23
            q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
            seg.append(q)
        dr.line([(q[0] * S, q[1] * S) for q in seg], fill=D, width=max(1, int(0.008 * h * S)))
        for k in range(1, 23):
            t = k / 23
            q, qn = seg[k], seg[min(k + 1, 23)]
            tang = (qn - q) / (np.linalg.norm(qn - q) + 1e-6)
            nrm = np.array([-tang[1], tang[0]])
            ll = h * 0.13 * (1 - t * 0.7) * rng.uniform(0.75, 1.1)
            for sgn in (-1, 1):
                v = nrm * sgn * 0.42 + np.array([0, 1.0]) * 0.95 + tang * 0.3
                v = v / np.linalg.norm(v)
                e = q + v * ll
                dr.polygon([((q[0] - tang[0] * 1.4) * S, (q[1] - tang[1] * 1.4) * S), ((q[0] + tang[0] * 1.4) * S, (q[1] + tang[1] * 1.4) * S), (e[0] * S, e[1] * S)], fill=D)
                if rim_side * v[0] > 0.2 and rng.random() < 0.5:
                    dr.line([(q[0] * S, q[1] * S), (e[0] * S, e[1] * S)], fill=Rc + (120,), width=1)
    for k in range(4):
        dr.ellipse([(cx - 0.02 * h + rng.uniform(-6, 6)) * S, (cy + rng.uniform(0, 10)) * S, (cx + 0.02 * h + rng.uniform(-6, 6)) * S, (cy + 0.04 * h + rng.uniform(0, 10)) * S], fill=D)
    im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def over_rgba(canvas, layer):
    m = layer[..., 3:4]
    canvas[:] = canvas * (1 - m) + layer[..., :3] * m


def kuwahara(img, r):
    k = r + 1
    pad = np.pad(img, ((r, r), (r, r), (0, 0)), mode="reflect")
    lum = pad @ np.array([0.3, 0.59, 0.11], np.float32)

    def boxmean(a):
        c = np.cumsum(np.cumsum(a, 0, dtype=np.float64), 1)
        padw = ((1, 0), (1, 0)) + ((0, 0),) * (a.ndim - 2)
        c = np.pad(c, padw)
        return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype(np.float32)

    m, ml, ml2 = boxmean(pad), boxmean(lum), boxmean(lum * lum)
    var = ml2 - ml * ml
    H, W = img.shape[:2]
    offs = [(0, 0), (0, r), (r, 0), (r, r)]
    vs = np.stack([var[oy:oy + H, ox:ox + W] for oy, ox in offs])
    ms = np.stack([m[oy:oy + H, ox:ox + W] for oy, ox in offs])
    idx = vs.argmin(0)
    return np.take_along_axis(ms, idx[None, ..., None], 0)[0]


def finish(img, seed, kr=3, grain=0.022, strokes=True):
    """Painted finish: Kuwahara flats, brush streak texture, grade, grain."""
    out = kuwahara(img, kr)
    out = 0.82 * out + 0.18 * kuwahara(out, 2)
    H, W = out.shape[:2]
    if strokes:
        st = noise2d(H, W, 14, seed + 7, 3, aspect=3.5)
        out *= (0.94 + 0.12 * st)[..., None]
    # grade: lift shadows to dusk violet, warm the highlights
    lum = out @ np.array([0.3, 0.59, 0.11], np.float32)
    sh = smooth(0.35, 0.0, lum)[..., None]
    out = out * (1 - 0.18 * sh) + np.array([0.10, 0.05, 0.12], np.float32) * 0.18 * sh
    hi = smooth(0.55, 1.0, lum)[..., None]
    out = out + hi * np.array([0.04, 0.015, -0.03], np.float32)
    out = np.clip(out, 0, 1) ** 1.02
    rng = np.random.default_rng(seed)
    out += rng.normal(0, grain, out.shape[:2]).astype(np.float32)[..., None] * np.array([1.0, 0.95, 0.9], np.float32)
    return np.clip(out, 0, 1)


def torn_alpha(h, w, seed, band=90, ragged=34):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.minimum.reduce([xx, w - 1 - xx, yy, h - 1 - yy])
    n1 = noise2d(h, w, 60, seed, 4) - 0.5
    n2 = noise2d(h, w, 9, seed + 1, 2) - 0.5
    e = d + ragged * 2.0 * n1 + 10 * n2
    return smooth(6, band, e) * smooth(0, 14, d)


def save_rgba(path, rgb, alpha=None):
    arr = np.clip(rgb, 0, 1)
    if alpha is not None:
        arr = np.concatenate([arr, np.clip(alpha, 0, 1)[..., None]], -1)
        Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)
    else:
        Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGB").save(path, optimize=True)
    print("wrote", path, Image.open(path).size)


# =============================================================================== the paintings
def sky_canvas(H, W, sun, stops):
    c = gradient(H, W, stops)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.hypot(xx - sun[0], (yy - sun[1]) * 1.35)
    c += (np.exp(-(d / (0.42 * W)) ** 2) * 0.32)[..., None] * np.array([1.0, 0.55, 0.22], np.float32)
    c += (np.exp(-(d / (0.10 * W)) ** 2) * 0.35)[..., None] * np.array([1.0, 0.8, 0.45], np.float32)
    return c, yy, xx


def clouds(c, yy, xx, sun, y0, y1, seed, H, W, amount=0.65):
    n = noise2d(H, W, 70, seed, 5, aspect=4.5)
    band = smooth(y0, y0 + 60, yy) * smooth(y1, y1 - 80, yy)
    m = smooth(0.52, 0.72, n) * band
    d = np.hypot(xx - sun[0], yy - sun[1]) / W
    lit = np.clip(1.2 - d * 2.0, 0, 1)[..., None]
    under = smooth(0.5, 0.75, noise2d(H, W, 40, seed + 3, 3, aspect=4))[..., None]
    col = (np.array([0.32, 0.12, 0.20], np.float32) * (1 - lit) + np.array([1.0, 0.52, 0.24], np.float32) * lit)
    col = col * (0.75 + 0.45 * under)
    m3 = (m * amount)[..., None]
    c[:] = c * (1 - m3) + col * m3


def sun_rays(c, yy, xx, sun, seed, strength=0.08):
    ang = np.arctan2(yy - sun[1], xx - sun[0])
    rng = np.random.default_rng(seed)
    k = np.zeros_like(ang)
    for i in range(14):
        a0 = rng.uniform(-math.pi, 0)
        k += np.exp(-((np.angle(np.exp(1j * (ang - a0)))) / rng.uniform(0.015, 0.05)) ** 2)
    d = np.hypot(xx - sun[0], yy - sun[1])
    fall = np.exp(-d / (0.5 * c.shape[1]))
    c += (k * fall * strength)[..., None] * np.array([1.0, 0.7, 0.4], np.float32)


def smoke_column(c, yy, xx, x0, y0, seed, H, W, drift=0.55, lit_side=1):
    up = np.clip(y0 - yy, 0, None)
    wig = (noise2d(H, W, 90, seed, 3) - 0.5) * 70
    xc = x0 + drift * up ** 1.08 * 0.6 + wig * smooth(0, 200, up)
    wid = 10 + 0.32 * up
    core = np.exp(-((xx - xc) / wid) ** 2)
    turb = noise2d(H, W, 26, seed + 2, 4)
    m = core * smooth(0.25, 0.75, turb + 0.25 * core) * smooth(0, 30, up) * smooth(y0 - 0.9 * y0, y0 - 0.25 * y0, yy) ** 0.0
    m *= np.exp(-up / (0.9 * y0))
    side = np.clip((xx - xc) / wid * lit_side, -1, 1)[..., None]
    col = np.array([0.24, 0.17, 0.17], np.float32) * (1 - np.clip(side, 0, 1)) + np.array([0.80, 0.45, 0.28], np.float32) * np.clip(side, 0, 1)
    m3 = (np.clip(m, 0, 1) * 0.82)[..., None]
    c[:] = c * (1 - m3) + col * m3


def paint_scene():
    W, H = 1400, 1000
    sun = (0.64 * W, 0.535 * H)
    c, yy, xx = sky_canvas(H, W, sun, [
        (0.00, (0.13, 0.08, 0.20)), (0.22, (0.36, 0.12, 0.20)), (0.40, (0.74, 0.25, 0.14)),
        (0.52, (0.97, 0.52, 0.20)), (0.62, (1.00, 0.76, 0.42)), (1.00, (1.0, 0.8, 0.5))])
    clouds(c, yy, xx, sun, 40, 470, 11, H, W)
    sun_rays(c, yy, xx, sun, 5, 0.07)
    # sun disc
    d = np.hypot(xx - sun[0], yy - sun[1])
    lay(c, (1.0, 0.86, 0.58), smooth(64, 58, d))
    lay(c, (1.0, 0.95, 0.78), smooth(52, 30, d) * 0.6)
    # helicopters
    heli = load("heli.png")
    heli_sil(c, heli, 0.75 * W, 0.20 * H, 240, (0.12, 0.05, 0.08))
    heli_sil(c, heli, 0.89 * W, 0.29 * H, 130, (0.28, 0.10, 0.12), alpha=0.9)
    heli_sil(c, heli, 0.52 * W, 0.12 * H, 86, (0.30, 0.12, 0.17), alpha=0.85)
    # far ridges with valley mist
    layers = [
        (0.575, 120, (0.90, 0.55, 0.40), (1.0, 0.80, 0.58), 21, (4, 9), 520),
        (0.635, 95, (0.68, 0.34, 0.30), (0.95, 0.62, 0.46), 22, (5, 12), 400),
    ]
    for base, amp, col, mist, seed, crown, cell in layers:
        line = canopy_line(W, base * H, amp, seed, crown, cell=cell)
        m = ridge_mask(H, W, line)
        top = line[None, :]
        mm = smooth(top + 10, top + 110, yy) * 0.75
        cc = np.asarray(col, np.float32) * (1 - mm[..., None]) + np.asarray(mist, np.float32) * mm[..., None]
        m3 = m[..., None]
        c[:] = c * (1 - m3) + cc * m3
        if seed == 21:
            smoke_column(c, yy, xx, 0.33 * W, 0.6 * H, 4, H, W, drift=0.5, lit_side=1)
    # a few palms poking out of the far jungle
    rng = np.random.default_rng(77)
    for k in range(9):
        x = rng.uniform(0.05, 0.95) * W
        if 0.47 * W < x < 0.78 * W:
            continue
        paste(c, palm_img(220, 100 + k, lean=rng.uniform(-0.2, 0.2), dark=(0.42, 0.19, 0.19), rim=(0.95, 0.6, 0.45)), x, line[int(x)] + 10, rng.uniform(60, 105))
    # middle ridge where the patrol walks (silhouetted against the pale haze)
    mid = canopy_line(W, 0.70 * H, 30, 31, (3, 8), cell=420)
    flat = np.clip((np.arange(W) - 0.42 * W) / (0.36 * W), 0, 1)
    flat = np.sin(flat * math.pi)
    mid = mid * (1 - 0.8 * flat) + (0.675 * H) * 0.8 * flat
    m = ridge_mask(H, W, mid)
    top = mid[None, :]
    mm = smooth(top + 12, top + 160, yy) * 0.5
    cc = np.array([0.38, 0.19, 0.20], np.float32) * (1 - mm[..., None]) + np.array([0.72, 0.42, 0.36], np.float32) * mm[..., None]
    c[:] = c * (1 - m[..., None]) + cc * m[..., None]
    # patrol on the ridge (back-lit)
    sil = (0.07, 0.04, 0.06)
    for nm, fx, hgt in (("walk_c.png", 0.53, 178), ("walk_a.png", 0.625, 150), ("walk_b.png", 0.715, 146)):
        x = int(fx * W)
        paste(c, load(nm), x, mid[x] + 6, hgt, tint=sil, tint_amt=0.55)
    # near ridge and ground
    near = canopy_line(W, 0.80 * H, 34, 41, (16, 40))
    m = ridge_mask(H, W, near)
    top = near[None, :]
    gg = smooth(top, top + 220, yy)[..., None]
    cc = np.array([0.15, 0.08, 0.10], np.float32) * (1 - gg) + np.array([0.06, 0.04, 0.05], np.float32) * gg
    c[:] = c * (1 - m[..., None]) + cc * m[..., None]
    # palms
    paste(c, palm_img(900, 3, lean=-0.22, rim_side=-1), 0.93 * W, H + 40, 0.92 * H)
    paste(c, palm_img(560, 4, lean=0.14, dark=(0.10, 0.06, 0.08)), 0.07 * W, 0.84 * H, 0.50 * H)
    paste(c, palm_img(380, 6, lean=0.10, dark=(0.22, 0.10, 0.12)), 0.43 * W, 0.70 * H, 0.27 * H)
    # elephant grass
    g = grass_layer(W, H, 0.72 * H, 0.86 * H, 900, 7, (0.07, 0.05, 0.05), (1.0, 0.62, 0.30))
    over_rgba(c, g)
    # the nearest soldier, big on the left third
    paste(c, load("near.png"), 0.215 * W, H + 18, 0.70 * H, tint=(0.06, 0.035, 0.05), tint_amt=0.25)
    g2 = grass_layer(W, H, 0.88 * H, 0.97 * H, 360, 9, (0.05, 0.035, 0.035), (1.0, 0.6, 0.3))
    over_rgba(c, g2)
    out = finish(c, 3, kr=3)
    save_rgba(os.path.join(OUT, "art_scene.png"), out, torn_alpha(H, W, 12, band=110, ragged=40))


def paint_apron():
    W, H = 1200, 420
    sun = (0.63 * W, 0.62 * H)
    c, yy, xx = sky_canvas(H, W, sun, [
        (0.00, (0.16, 0.07, 0.17)), (0.30, (0.50, 0.13, 0.15)), (0.55, (0.90, 0.36, 0.14)),
        (0.72, (1.00, 0.62, 0.26)), (1.00, (1.0, 0.7, 0.35))])
    clouds(c, yy, xx, sun, 10, 210, 19, H, W, amount=0.55)
    d = np.hypot(xx - sun[0], yy - sun[1])
    lay(c, (1.0, 0.62, 0.20), smooth(92, 86, d))
    lay(c, (1.0, 0.80, 0.42), smooth(70, 30, d) * 0.55)
    heli = load("heli.png")
    heli_sil(c, heli, 0.30 * W, 0.30 * H, 170, (0.07, 0.03, 0.05))
    heli_sil(c, heli, 0.47 * W, 0.20 * H, 104, (0.10, 0.04, 0.06), alpha=0.95)
    line = canopy_line(W, 0.74 * H, 26, 51, (3, 9), cell=300)
    m = ridge_mask(H, W, line)
    c[:] = c * (1 - m[..., None]) + np.array([0.07, 0.03, 0.05], np.float32) * m[..., None]
    rng = np.random.default_rng(78)
    for k in range(7):
        x = rng.uniform(0.15, 0.7) * W
        paste(c, palm_img(200, 120 + k, lean=rng.uniform(-0.2, 0.2), dark=(0.07, 0.03, 0.05)), x, line[int(min(W - 1, x))] + 8, rng.uniform(50, 85))
    # rice paddies reflecting the sun
    py = 0.86 * H
    pad = smooth(py - 2, py + 2, yy)
    refl = np.exp(-((xx - sun[0]) / 70) ** 2) * (0.5 + 0.5 * noise2d(H, W, 6, 3, 2, aspect=8))
    pcol = np.array([0.30, 0.12, 0.10], np.float32)[None, None] + refl[..., None] * np.array([0.8, 0.45, 0.15], np.float32)
    c[:] = c * (1 - pad[..., None]) + pcol * pad[..., None]
    for k in range(4):
        y = int(py + 8 + k * 14)
        c[y:y + 2, :] *= 0.55
    paste(c, palm_img(500, 13, lean=0.2, dark=(0.05, 0.02, 0.04)), 0.07 * W, H + 10, 1.02 * H)
    paste(c, palm_img(500, 14, lean=-0.25, dark=(0.05, 0.02, 0.04), rim_side=-1), 0.90 * W, H + 10, 0.96 * H)
    paste(c, palm_img(300, 15, lean=0.1, dark=(0.07, 0.03, 0.05)), 0.77 * W, 0.80 * H, 0.52 * H)
    out = finish(c, 21, kr=3, grain=0.02)
    save_rgba(os.path.join(OUT, "art_apron.png"), out)


def paint_panel(fig_name, out_name, flip, seed):
    W, H = 600, 700
    sun = (0.5 * W if not flip else 0.45 * W, 0.58 * H)
    c, yy, xx = sky_canvas(H, W, sun, [
        (0.00, (0.20, 0.09, 0.18)), (0.35, (0.60, 0.19, 0.15)), (0.62, (0.98, 0.55, 0.22)), (1.00, (1.0, 0.74, 0.42))])
    clouds(c, yy, xx, sun, 20, 300, seed, H, W, amount=0.5)
    line = canopy_line(W, 0.68 * H, 70, seed + 4, (3, 7), cell=300)
    m = ridge_mask(H, W, line)
    top = line[None, :]
    mm = smooth(top + 8, top + 90, yy) * 0.6
    cc = np.array([0.55, 0.27, 0.26], np.float32) * (1 - mm[..., None]) + np.array([0.90, 0.55, 0.42], np.float32) * mm[..., None]
    c[:] = c * (1 - m[..., None]) + cc * m[..., None]
    rng = np.random.default_rng(seed)
    for k in range(4):
        x = rng.uniform(0.05, 0.95) * W
        paste(c, palm_img(200, seed + 30 + k, lean=rng.uniform(-0.2, 0.2), dark=(0.38, 0.17, 0.18)), x, line[int(min(W - 1, x))] + 8, rng.uniform(55, 90))
    line2 = canopy_line(W, 0.80 * H, 26, seed + 5, (4, 10), cell=260)
    m = ridge_mask(H, W, line2)
    c[:] = c * (1 - m[..., None]) + np.array([0.12, 0.06, 0.08], np.float32) * m[..., None]
    fig = load(fig_name)
    paste(c, fig, 0.5 * W, 0.94 * H, 0.80 * H if "walk" in fig_name else 0.66 * H, flip=flip, tint=(0.07, 0.04, 0.06), tint_amt=0.42)
    g = grass_layer(W, H, 0.80 * H, 0.92 * H, 260, seed + 8, (0.06, 0.04, 0.04), (1.0, 0.62, 0.3), rim_side=-1 if flip else 1)
    over_rgba(c, g)
    out = finish(c, seed, kr=2, grain=0.02)
    save_rgba(os.path.join(OUT, out_name), out, torn_alpha(H, W, seed, band=80, ragged=30))


def paint_all():
    paint_scene()
    paint_apron()
    paint_panel("panel_walk.png", "art_soldier_left.png", True, 61)
    paint_panel("panel_kneel.png", "art_soldier_right.png", False, 71)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args or args[0] == "all":
        blender_renders()
        paint_all()
    elif args[0] == "render":
        blender_renders(set(args[1:]) or None)
    elif args[0] == "paint":
        paint_all()

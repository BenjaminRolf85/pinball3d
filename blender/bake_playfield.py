"""Bakes the playfield base texture (scorched metal plates with glowing lava cracks) with Cycles.

Run: python3 blender/bake_playfield.py [--table riff|rotor|alien]  ->  assets/<table>/playfield_base.jpg
The artwork (inserts, bolts, lettering) is painted on top at runtime (src/playfieldArt.js).
"""
import os
import sys
import bpy

TABLE = sys.argv[sys.argv.index("--table") + 1] if "--table" in sys.argv else "riff"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, L = 0.52, 1.08
RES_X = int(sys.argv[sys.argv.index("--res") + 1]) if "--res" in sys.argv else 1920
RES_Y = int(round(RES_X * L / W))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

me = bpy.data.meshes.new("pf")
me.from_pydata([(0, 0, 0), (W, 0, 0), (W, L, 0), (0, L, 0)], [], [(0, 1, 2, 3)])
ob = bpy.data.objects.new("pf", me)
scene.collection.objects.link(ob)

m = bpy.data.materials.new("bake")
try:
    m.use_nodes = True
except Exception:
    pass
nt = m.node_tree
nt.nodes.clear()
N = nt.nodes.new
out = N("ShaderNodeOutputMaterial")
emit = N("ShaderNodeEmission")
geo = N("ShaderNodeNewGeometry")
nt.links.new(emit.outputs[0], out.inputs["Surface"])


def link(a, b):
    nt.links.new(a, b)


def ramp(stops, interp='LINEAR'):
    r = N("ShaderNodeValToRGB")
    r.color_ramp.interpolation = interp
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for e, (p, c) in zip(els, stops):
        e.position = p
        e.color = c
    return r


# --- cracked plates: distance to the Voronoi cell edges
vor = N("ShaderNodeTexVoronoi")
vor.feature = 'DISTANCE_TO_EDGE'
vor.inputs["Scale"].default_value = 17.0
warp = N("ShaderNodeTexNoise")
warp.inputs["Scale"].default_value = 9.0
warp.inputs["Detail"].default_value = 5.0
mixv = N("ShaderNodeMixRGB")
mixv.blend_type = 'ADD'
mixv.inputs["Fac"].default_value = 0.07
link(geo.outputs["Position"], warp.inputs["Vector"])
link(geo.outputs["Position"], mixv.inputs["Color1"])
link(warp.outputs["Color"], mixv.inputs["Color2"])
link(mixv.outputs["Color"], vor.inputs["Vector"])
crack = ramp([(0.0, (1, 1, 1, 1)), (0.035, (0.35, 0.35, 0.35, 1)), (0.11, (0, 0, 0, 1))])
link(vor.outputs["Distance"], crack.inputs["Fac"])

# --- where the lava shows: big soft patches
patch = N("ShaderNodeTexNoise")
patch.inputs["Scale"].default_value = 3.2
patch.inputs["Detail"].default_value = 2.0
link(geo.outputs["Position"], patch.inputs["Vector"])
patch_r = ramp([(0.42, (0, 0, 0, 1)), (0.68, (1, 1, 1, 1))])
link(patch.outputs["Fac"], patch_r.inputs["Fac"])
heat = N("ShaderNodeMath")
heat.operation = 'MULTIPLY'
link(crack.outputs["Color"], heat.inputs[0])
link(patch_r.outputs["Color"], heat.inputs[1])
lava = ramp([(0.0, (0, 0, 0, 1)), (0.25, (0.5, 0.02, 0.0, 1)), (0.6, (1.0, 0.22, 0.02, 1)), (1.0, (1.0, 0.75, 0.25, 1))])
link(heat.outputs[0], lava.inputs["Fac"])

# --- the plates themselves: brushed dark steel with soot
grain = N("ShaderNodeTexNoise")
grain.inputs["Scale"].default_value = 140.0
grain.inputs["Detail"].default_value = 6.0
grain.inputs["Roughness"].default_value = 0.7
sx = N("ShaderNodeMapping")
sx.inputs["Scale"].default_value = (1.0, 0.06, 1.0)
link(geo.outputs["Position"], sx.inputs["Vector"])
link(sx.outputs["Vector"], grain.inputs["Vector"])
plate = ramp([(0.3, (0.012, 0.01, 0.014, 1)), (0.75, (0.07, 0.055, 0.06, 1))])
link(grain.outputs["Fac"], plate.inputs["Fac"])
cell = N("ShaderNodeTexVoronoi")
cell.inputs["Scale"].default_value = 17.0
link(mixv.outputs["Color"], cell.inputs["Vector"])
tint = N("ShaderNodeMixRGB")
tint.blend_type = 'MULTIPLY'
tint.inputs["Fac"].default_value = 0.55
link(plate.outputs["Color"], tint.inputs["Color1"])
link(cell.outputs["Color"], tint.inputs["Color2"])
edge = ramp([(0.0, (0.25, 0.25, 0.25, 1)), (0.2, (1, 1, 1, 1))])
link(vor.outputs["Distance"], edge.inputs["Fac"])
dark = N("ShaderNodeMixRGB")
dark.blend_type = 'MULTIPLY'
dark.inputs["Fac"].default_value = 1.0
link(tint.outputs["Color"], dark.inputs["Color1"])
link(edge.outputs["Color"], dark.inputs["Color2"])

final = N("ShaderNodeMixRGB")
final.blend_type = 'ADD'
final.inputs["Fac"].default_value = 1.0
link(dark.outputs["Color"], final.inputs["Color1"])
link(lava.outputs["Color"], final.inputs["Color2"])
link(final.outputs["Color"], emit.inputs["Color"])

if TABLE == "rotor":
    # ---- jungle valley on a field map: canopy crowns, clearings, contour lines, a muddy track
    for n in list(nt.nodes):
        if n not in (out, emit, geo):
            nt.nodes.remove(n)
    crowns = N("ShaderNodeTexVoronoi")
    crowns.inputs["Scale"].default_value = 46.0
    cw = N("ShaderNodeTexNoise"); cw.inputs["Scale"].default_value = 14.0; cw.inputs["Detail"].default_value = 3.0
    cwm = N("ShaderNodeMixRGB"); cwm.blend_type = 'ADD'; cwm.inputs["Fac"].default_value = 0.05
    link(geo.outputs["Position"], cw.inputs["Vector"]); link(geo.outputs["Position"], cwm.inputs["Color1"])
    link(cw.outputs["Color"], cwm.inputs["Color2"]); link(cwm.outputs["Color"], crowns.inputs["Vector"])
    crown_r = ramp([(0.0, (0.16, 0.23, 0.07, 1)), (0.55, (0.07, 0.12, 0.04, 1)), (1.0, (0.02, 0.04, 0.015, 1))])
    link(crowns.outputs["Distance"], crown_r.inputs["Fac"])
    # big terrain noise: height for contours and clearings
    terr = N("ShaderNodeTexNoise"); terr.inputs["Scale"].default_value = 2.4; terr.inputs["Detail"].default_value = 4.0
    terr.inputs["Roughness"].default_value = 0.45
    link(geo.outputs["Position"], terr.inputs["Vector"])
    clearing = ramp([(0.56, (0, 0, 0, 1)), (0.68, (1, 1, 1, 1))])
    link(terr.outputs["Fac"], clearing.inputs["Fac"])
    ground = N("ShaderNodeTexNoise"); ground.inputs["Scale"].default_value = 60.0; ground.inputs["Detail"].default_value = 6.0
    link(geo.outputs["Position"], ground.inputs["Vector"])
    ground_r = ramp([(0.3, (0.22, 0.17, 0.08, 1)), (0.7, (0.36, 0.30, 0.15, 1))])
    link(ground.outputs["Fac"], ground_r.inputs["Fac"])
    land = N("ShaderNodeMixRGB"); land.blend_type = 'MIX'
    link(clearing.outputs["Color"], land.inputs["Fac"]); link(crown_r.outputs["Color"], land.inputs["Color1"]); link(ground_r.outputs["Color"], land.inputs["Color2"])
    # contour lines every "20 m"
    mul = N("ShaderNodeMath"); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 22.0
    link(terr.outputs["Fac"], mul.inputs[0])
    frac = N("ShaderNodeMath"); frac.operation = 'FRACT'
    link(mul.outputs[0], frac.inputs[0])
    lines = ramp([(0.0, (1, 1, 1, 1)), (0.06, (0, 0, 0, 1)), (0.94, (0, 0, 0, 1)), (1.0, (1, 1, 1, 1))])
    link(frac.outputs[0], lines.inputs["Fac"])
    cmix = N("ShaderNodeMixRGB"); cmix.blend_type = 'MIX'
    lf = N("ShaderNodeMath"); lf.operation = 'MULTIPLY'; lf.inputs[1].default_value = 0.55
    link(lines.outputs["Color"], lf.inputs[0])
    link(lf.outputs[0], cmix.inputs["Fac"]); link(land.outputs["Color"], cmix.inputs["Color1"])
    cmix.inputs["Color2"].default_value = (0.55, 0.38, 0.16, 1)
    link(cmix.outputs["Color"], emit.inputs["Color"])

if TABLE == "alien":
    # ---- dark blue-violet hull plating: hex panels with bevelled seams, brushed grain, scratches,
    #      faint circuitry and a few scorch marks. Kept dark and low in contrast (art is painted on top).
    for n in list(nt.nodes):
        if n not in (out, emit, geo):
            nt.nodes.remove(n)

    def sock(v):
        return v.outputs[0] if hasattr(v, "outputs") else v

    def M(op, a, b=None, clamp=False):
        n = N("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                link(sock(v), n.inputs[i])
        return n.outputs[0]

    def mix(op, a, b, fac=1.0):
        n = N("ShaderNodeMixRGB")
        n.blend_type = op
        if isinstance(fac, (int, float)):
            n.inputs["Fac"].default_value = fac
        else:
            link(sock(fac), n.inputs["Fac"])
        for key, v in (("Color1", a), ("Color2", b)):
            if isinstance(v, tuple):
                n.inputs[key].default_value = v
            else:
                link(sock(v), n.inputs[key])
        return n.outputs[0]

    def ramp_of(fac, stops, interp='LINEAR'):
        r = ramp(stops, interp)
        link(sock(fac), r.inputs["Fac"])
        return r.outputs["Color"]

    def noise(scale, detail=2.0, rough=0.5, vec=None):
        n = N("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        link(sock(vec) if vec is not None else geo.outputs["Position"], n.inputs["Vector"])
        return n

    def mapping(scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        mp = N("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = scale
        mp.inputs["Rotation"].default_value = rot
        mp.inputs["Location"].default_value = loc
        link(geo.outputs["Position"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    sep = N("ShaderNodeSeparateXYZ")
    link(geo.outputs["Position"], sep.inputs[0])
    px, py = sep.outputs[0], sep.outputs[1]

    # hex lattice (pointy top), cell pitch 24 mm
    HS = 1.0 / 0.024
    qx, qy = M('MULTIPLY', px, HS), M('MULTIPLY', py, HS)
    ax = M('SUBTRACT', M('FLOORED_MODULO', qx, 1.0), 0.5)
    ay = M('SUBTRACT', M('FLOORED_MODULO', qy, 1.7320508), 0.8660254)
    bx = M('SUBTRACT', M('FLOORED_MODULO', M('SUBTRACT', qx, 0.5), 1.0), 0.5)
    by = M('SUBTRACT', M('FLOORED_MODULO', M('SUBTRACT', qy, 0.8660254), 1.7320508), 0.8660254)
    da = M('ADD', M('MULTIPLY', ax, ax), M('MULTIPLY', ay, ay))
    db = M('ADD', M('MULTIPLY', bx, bx), M('MULTIPLY', by, by))
    sel = M('LESS_THAN', da, db)
    gx = M('ADD', bx, M('MULTIPLY', M('SUBTRACT', ax, bx), sel))
    gy = M('ADD', by, M('MULTIPLY', M('SUBTRACT', ay, by), sel))
    agx, agy = M('ABSOLUTE', gx), M('ABSOLUTE', gy)
    hexd = M('MAXIMUM', agx, M('ADD', M('MULTIPLY', agx, 0.5), M('MULTIPLY', agy, 0.8660254)))
    edge = M('SUBTRACT', 0.5, hexd)                       # 0 on the seam, 0.5 in the centre
    # seam: dark groove with a thin lit bevel on one side (light from the top)
    groove = ramp_of(edge, [(0.0, (0.25, 0.25, 0.25, 1)), (0.022, (0.35, 0.35, 0.35, 1)), (0.05, (1, 1, 1, 1))])
    bevel = ramp_of(edge, [(0.02, (0, 0, 0, 1)), (0.035, (1, 1, 1, 1)), (0.06, (0, 0, 0, 1))])
    upper = M('GREATER_THAN', gy, 0.0)                    # only the upper half of each seam catches light
    bevel_lit = M('MULTIPLY', sock(bevel), upper)
    # per-cell random tint
    cid = N("ShaderNodeCombineXYZ")
    link(M('SUBTRACT', qx, gx), cid.inputs[0])
    link(M('SUBTRACT', qy, gy), cid.inputs[1])
    wn = N("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = '3D'
    link(cid.outputs[0], wn.inputs["Vector"])
    cell_tint = ramp_of(wn.outputs["Value"], [(0.0, (0.72, 0.72, 0.8, 1)), (0.85, (1.0, 1.0, 1.0, 1)), (1.0, (1.25, 1.15, 1.45, 1))])

    # brushed grain + soft cloudy variation
    grain = noise(160.0, 6.0, 0.7, mapping(scale=(1.0, 0.05, 1.0)))
    grain_c = ramp_of(grain.outputs["Fac"], [(0.3, (0.55, 0.55, 0.55, 1)), (0.75, (1.0, 1.0, 1.0, 1))])
    cloud = noise(3.0, 4.0, 0.55)
    base_col = ramp_of(cloud.outputs["Fac"], [(0.3, (0.012, 0.011, 0.026, 1)), (0.55, (0.022, 0.019, 0.045, 1)), (0.8, (0.03, 0.022, 0.06, 1))])
    plate = mix('MULTIPLY', base_col, grain_c)
    plate = mix('MULTIPLY', plate, cell_tint)
    plate = mix('MULTIPLY', plate, groove)
    plate = mix('ADD', plate, (0.05, 0.045, 0.09, 1), M('MULTIPLY', bevel_lit, 0.55))

    # scratches: thin streaks in two directions
    for rot, sc, thr in ((0.55, 0.012, 0.74), (-0.95, 0.018, 0.76), (1.9, 0.01, 0.75)):
        s = noise(70.0, 3.0, 0.6, mapping(scale=(1.0, sc, 1.0), rot=(0, 0, rot)))
        sm = ramp_of(s.outputs["Fac"], [(thr, (0, 0, 0, 1)), (thr + 0.012, (1, 1, 1, 1)), (thr + 0.03, (0, 0, 0, 1))])
        patchy = ramp_of(noise(6.0, 2.0).outputs["Fac"], [(0.45, (0, 0, 0, 1)), (0.65, (1, 1, 1, 1))])
        plate = mix('ADD', plate, (0.09, 0.09, 0.12, 1), M('MULTIPLY', sock(sm), sock(patchy)))

    # faint circuitry: the seams of a few random cells glow, only in some regions of the plating
    seam = ramp_of(edge, [(0.0, (1, 1, 1, 1)), (0.01, (1, 1, 1, 1)), (0.022, (0, 0, 0, 1))])
    pick = ramp_of(wn.outputs["Value"], [(0.84, (0, 0, 0, 1)), (0.85, (1, 1, 1, 1))])
    region = ramp_of(noise(2.6, 2.0).outputs["Fac"], [(0.42, (0, 0, 0, 1)), (0.58, (1, 1, 1, 1))])
    circ_mask = M('MULTIPLY', M('MULTIPLY', sock(seam), sock(pick)), sock(region))
    plate = mix('ADD', plate, (0.08, 0.035, 0.16, 1), circ_mask)
    # a small cyan node dot in the centre of some lit cells
    dot = ramp_of(edge, [(0.43, (0, 0, 0, 1)), (0.46, (1, 1, 1, 1))])
    pick2 = ramp_of(wn.outputs["Value"], [(0.93, (0, 0, 0, 1)), (0.94, (1, 1, 1, 1))])
    plate = mix('ADD', plate, (0.02, 0.08, 0.09, 1), M('MULTIPLY', M('MULTIPLY', sock(dot), sock(pick2)), sock(region)))
    # scorch marks: a few dark burnt patches with a faint warm rim
    sc = noise(3.4, 6.0, 0.62, mapping(loc=(3.7, 1.3, 0.0)))
    burn = ramp_of(sc.outputs["Fac"], [(0.0, (0.08, 0.07, 0.07, 1)), (0.3, (0.2, 0.18, 0.18, 1)), (0.38, (1, 1, 1, 1))])
    rim = ramp_of(sc.outputs["Fac"], [(0.33, (0, 0, 0, 1)), (0.35, (1, 1, 1, 1)), (0.37, (0, 0, 0, 1))])
    plate = mix('MULTIPLY', plate, burn)
    plate = mix('ADD', plate, (0.035, 0.012, 0.006, 1), rim)
    link(plate, emit.inputs["Color"])

me.materials.append(m)

cam_d = bpy.data.cameras.new("cam")
cam_d.type = 'ORTHO'
cam_d.ortho_scale = L
cam = bpy.data.objects.new("cam", cam_d)
cam.location = (W / 2, L / 2, 1.0)
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 10
scene.cycles.use_denoising = False
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 86
out_path = os.path.join(ROOT, "assets", TABLE, "playfield_base.jpg")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
scene.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print("baked", out_path, os.path.getsize(out_path) // 1024, "kB", RES_X, RES_Y)

"""RIFFGEWITTER procedural asset library (Blender 5.x, bpy module).

Every make_*() returns the ROOT object at the world origin (unrotated, unit
scale, final meshes). All dimensions in the code are millimetres; meshes are
written in metres. +Z up, playfield at z=0, the front of an asset faces -Y.
Animated parts are separate child objects named `{name}_{part}` whose object
origin sits on the stated pivot.
"""
import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

try:
    from .materials import mat
except ImportError:  # run as a plain script module
    from materials import mat

MM = 0.001
FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "MetalMania-Regular.ttf")


# --------------------------------------------------------------------------
# small maths helpers
# --------------------------------------------------------------------------
def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1.0))


def _ccw(pts):
    area = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        area += x0 * y1 - x1 * y0
    return list(pts) if area > 0 else list(reversed(pts))


def stadium(r1, r2, d, n1=12, n2=8):
    """Outline of two circles (r1 at the origin, r2 at (d,0)) joined by tangents."""
    phi = math.acos((r1 - r2) / d)
    pts = []
    for i in range(n1 + 1):  # back arc: +phi -> 2pi - phi
        a = phi + (2 * math.pi - 2 * phi) * i / n1
        pts.append((r1 * math.cos(a), r1 * math.sin(a)))
    for i in range(n2 + 1):  # tip arc: -phi -> +phi
        a = -phi + 2 * phi * i / n2
        pts.append((d + r2 * math.cos(a), r2 * math.sin(a)))
    return pts


BOLT_SHAPE = [(0.15, 1.0), (-0.45, 0.05), (-0.05, 0.05), (-0.25, -1.0),
              (0.5, 0.2), (0.08, 0.2), (0.45, 1.0)]


def bolt_points(cx, cy, half_h, flip=False):
    pts = [(cx + (-x if flip else x) * half_h, cy + y * half_h) for x, y in BOLT_SHAPE]
    return _ccw(pts)


# --------------------------------------------------------------------------
# raw bmesh primitives (all return a fresh bmesh in mm, outward normals)
# --------------------------------------------------------------------------
def _box(sx, sy, sz, bevel=0.0, segs=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs,
                        profile=0.5, affect='EDGES')
    return bm


def _lathe(profile, segs=24, cap_start=True, cap_end=True):
    """Revolve (r, z) profile about Z. Walk the profile counter-clockwise
    around the solid cross-section (up the outside, down the inside)."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * j / segs),
                                        r * math.sin(2 * math.pi * j / segs), z))
                          for j in range(segs)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[j2], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[j], a[j2], b[0]))
            else:
                bm.faces.new((a[j], a[j2], b[j2], b[j]))
    if cap_start and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    return bm


def _torus(major, minor, segs=24, sides=8):
    prof = [(major + minor * math.cos(2 * math.pi * k / sides),
             minor * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
    prof.append(prof[0])
    bm = _lathe(prof, segs, cap_start=False, cap_end=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return bm


def _sphere(radius, u=12, v=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    return bm


def _prism(pts, z0, z1, bevel=0.0, bevel_bottom=False, cap_bottom=True):
    pts = _ccw(pts)
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    top_face = bm.faces.new(top)
    if cap_bottom:
        bm.faces.new(list(reversed(bot)))
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((bot[i], bot[i2], top[i2], top[i]))
    if bevel > 0:
        edges = list(top_face.edges)
        if bevel_bottom and cap_bottom:
            bm.edges.ensure_lookup_table()
            edges += [e for e in bm.edges
                      if abs(e.verts[0].co.z - z0) < 1e-6 and abs(e.verts[1].co.z - z0) < 1e-6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, profile=0.5, affect='EDGES')
    return bm


def _tube(path, radius, sides=6, closed=False, caps=True):
    """Sweep a circle along a 3D polyline (parallel-transport frames)."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    bm = bmesh.new()
    tangents = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        elif i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tangents.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = (up - tangents[0] * up.dot(tangents[0])).normalized()
    rings = []
    prev_t = tangents[0]
    for i in range(n):
        t = tangents[i]
        axis = prev_t.cross(t)
        if axis.length > 1e-8:
            ang = prev_t.angle(t)
            nrm = Matrix.Rotation(ang, 3, axis.normalized()) @ nrm
        nrm = (nrm - t * nrm.dot(t)).normalized()
        b = t.cross(nrm)
        rings.append([bm.verts.new(pts[i] + (nrm * math.cos(2 * math.pi * k / sides)
                                             + b * math.sin(2 * math.pi * k / sides)) * radius)
                      for k in range(sides)])
        prev_t = t
    count = n if closed else n - 1
    for i in range(count):
        a, c = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((a[k], a[k2], c[k2], c[k]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _font():
    for f in bpy.data.fonts:
        if os.path.abspath(bpy.path.abspath(f.filepath)) == FONT_PATH:
            return f
    return bpy.data.fonts.load(FONT_PATH)


def _text(text, extrude, bevel=0.0, res=2):
    """Text as bmesh in the XY plane (front faces +Z), centred on its bounds,
    1 unit = font em. Returns (bm, width, height)."""
    cu = bpy.data.curves.new("_txt", 'FONT')
    cu.font = _font()
    cu.body = text
    cu.size = 1.0
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 0
    cu.resolution_u = res
    ob = bpy.data.objects.new("_txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    bmesh.ops.translate(bm, vec=(-cx, -cy, 0), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, max(xs) - min(xs), max(ys) - min(ys)


def _text_loops(text, res=2):
    """Closed outline loops (lists of 2D Vectors, em units, centred) of a text."""
    bm, w, h = _text(text, extrude=0.0, res=res)
    # walk the fill boundary with the face on the left: outer contours come out
    # counter-clockwise (positive area), holes clockwise (negative area)
    bm.normal_update()
    nxt = {}
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        f = e.link_faces[0]
        for lp in f.loops:
            if lp.edge is e:
                a, c = lp.vert, lp.link_loop_next.vert
                if f.normal.z < 0:
                    a, c = c, a
                nxt[a] = c
                break
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, v = [], start
        while v in nxt:
            loop.append(v.co.xy.copy())
            v = nxt.pop(v)
            if v is start:
                break
        if len(loop) >= 3:
            loops.append(loop)
    bm.free()
    return loops, w, h


def _dp(points, eps):
    """Douglas-Peucker on an open polyline."""
    if len(points) < 3:
        return list(points)
    a, b = points[0], points[-1]
    ab = b - a
    best, idx = -1.0, 0
    for i in range(1, len(points) - 1):
        ap = points[i] - a
        if ab.length_squared < 1e-12:
            d = ap.length
        else:
            d = abs(ab.x * ap.y - ab.y * ap.x) / ab.length
        if d > best:
            best, idx = d, i
    if best <= eps:
        return [a, b]
    return _dp(points[:idx + 1], eps)[:-1] + _dp(points[idx:], eps)


def _simplify_loop(loop, eps):
    far = max(range(len(loop)), key=lambda i: (loop[i] - loop[0]).length_squared)
    if far == 0:
        return loop
    first = _dp(loop[:far + 1], eps)
    second = _dp(loop[far:] + [loop[0]], eps)
    return first[:-1] + second[:-1]


def _loop_area(loop):
    return 0.5 * sum(loop[i].x * loop[(i + 1) % len(loop)].y - loop[(i + 1) % len(loop)].x * loop[i].y
                     for i in range(len(loop)))


def _text_solid(text, max_points, depth=1.0):
    """Simplified extruded text: closed solid in the XY plane, front at
    z=+depth/2, back at z=-depth/2, em units. Returns (bm, width, height)."""
    from mathutils.geometry import tessellate_polygon
    raw, w, h = _text_loops(text)
    eps = 0.0015
    while True:
        loops = [_simplify_loop(l, eps) for l in raw]
        loops = [l for l in loops if len(l) >= 3 and abs(_loop_area(l)) > 2e-4]
        if sum(len(l) for l in loops) <= max_points or eps > 0.05:
            break
        eps *= 1.25
    def inside(pt, poly):
        hit = False
        n = len(poly)
        for i in range(n):
            a, c = poly[i], poly[(i + 1) % n]
            if (a.y > pt.y) != (c.y > pt.y) and pt.x < a.x + (pt.y - a.y) * (c.x - a.x) / (c.y - a.y):
                hit = not hit
        return hit

    # group every outer contour (area > 0) with the holes (area < 0) inside it
    outers = [i for i, l in enumerate(loops) if _loop_area(l) > 0]
    groups = {i: [i] for i in outers}
    for i, l in enumerate(loops):
        if _loop_area(l) < 0:
            holders = [j for j in outers if inside(l[0], loops[j])]
            if holders:
                groups[min(holders, key=lambda j: _loop_area(loops[j]))].append(i)

    bm = bmesh.new()
    for members in groups.values():
        front, back, polys = [], [], []
        for i in members:
            l = loops[i]
            polys.append([Vector((p.x, p.y, 0.0)) for p in l])
            base = len(front)
            for p in l:
                front.append(bm.verts.new((p.x, p.y, depth / 2)))
                back.append(bm.verts.new((p.x, p.y, -depth / 2)))
            n = len(l)
            for k in range(n):
                j = (k + 1) % n
                bm.faces.new((front[base + k], front[base + j], back[base + j], back[base + k]))
        for t in tessellate_polygon(polys):
            if len(set(t)) == 3:
                try:
                    bm.faces.new([front[i] for i in t])
                    bm.faces.new([back[i] for i in reversed(t)])
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, w, h


# --------------------------------------------------------------------------
# Builder: collects pieces (mm) into one mesh with material slots
# --------------------------------------------------------------------------
class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, piece, m=None, M=None):
        """Merge a temporary bmesh (consumed). `m` paints every face."""
        if M is not None:
            bmesh.ops.transform(piece, matrix=M, verts=piece.verts)
            if M.to_3x3().determinant() < 0:
                bmesh.ops.reverse_faces(piece, faces=piece.faces)
        if m is not None:
            idx = self.mi(m)
            for f in piece.faces:
                f.material_index = idx
        me = bpy.data.meshes.new("_piece")
        piece.to_mesh(me)
        piece.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self

    # convenience wrappers ---------------------------------------------------
    def box(self, size, loc, m, bevel=0.0, M=None):
        mtx = T(*loc) if M is None else T(*loc) @ M
        return self.add(_box(size[0], size[1], size[2], bevel), m, mtx)

    def lathe(self, profile, m, segs=24, M=None, cap_start=True, cap_end=True):
        return self.add(_lathe(profile, segs, cap_start, cap_end), m, M)

    def cyl(self, r, z0, z1, m, segs=16, r2=None, M=None, cap_start=True, cap_end=True):
        return self.add(_lathe([(r, z0), (r if r2 is None else r2, z1)], segs, cap_start, cap_end), m, M)

    def torus(self, major, minor, m, segs=24, sides=8, M=None):
        return self.add(_torus(major, minor, segs, sides), m, M)

    def sphere(self, radius, loc, m, u=12, v=8, scale=(1, 1, 1), M=None):
        mtx = T(*loc) @ (M if M is not None else Matrix.Identity(4)) @ S(*scale)
        return self.add(_sphere(radius, u, v), m, mtx)

    def ellipsoid(self, loc, radii, m="chrome_dark", rot=None, u=20, v=12):
        mtx = R(rot[0], rot[1]) if rot else None
        return self.sphere(1.0, loc, m, u, v, scale=radii, M=mtx)

    def prism(self, pts, z0, z1, m, bevel=0.0, M=None, bevel_bottom=False, cap_bottom=True):
        return self.add(_prism(pts, z0, z1, bevel, bevel_bottom, cap_bottom), m, M)

    def tube(self, path, radius, m, sides=6, closed=False, M=None):
        return self.add(_tube(path, radius, sides, closed), m, M)

    # ------------------------------------------------------------------------
    def finish(self, name, origin=(0.0, 0.0, 0.0), parent=None, sharp_deg=38.0, smooth=True):
        """Write the mesh (metres). Geometry is expressed relative to the
        object origin; `origin` (mm, parent space) only sets the location."""
        bm = self.bm
        o = Vector(origin)
        bmesh.ops.scale(bm, vec=(MM, MM, MM), verts=bm.verts)
        _shade(bm, sharp_deg, smooth)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for m in self.mats:
            me.materials.append(mat(m))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = o * MM
        if parent is not None:
            ob.parent = parent
        return ob


def _shade(bm, sharp_deg=38.0, smooth=True):
    limit = math.radians(sharp_deg)
    for f in bm.faces:
        f.smooth = smooth
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) <= limit
        else:
            e.smooth = False


def tri_count(obj_root):
    """Triangles of an object including all of its children."""
    total = 0
    stack = [obj_root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        if ob.type == 'MESH':
            ob.data.calc_loop_triangles()
            total += len(ob.data.loop_triangles)
    return total


def bounds_mm(obj_root):
    """World-space bounding box (min, max) in mm, including children."""
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    stack = [obj_root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        if ob.type == 'MESH':
            for v in ob.data.vertices:
                w = ob.matrix_world @ v.co
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
    return tuple(round(c / MM, 1) for c in lo), tuple(round(c / MM, 1) for c in hi)


def _apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def _remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


# --------------------------------------------------------------------------
# 1. Skull
# --------------------------------------------------------------------------
SKULL_LEAN = 0.2        # backward shear of the upper skull (per mm above z=40)
# eye sockets: (centre, radii, rotation about Y in degrees) - also painted dark
SKULL_SOCKETS = [((_s * 18.5, -60, 56.5), (12.5, 20, 9.5), _s * -17) for _s in (-1, 1)]
# nose cavity: upside-down heart in the XZ plane, cut from y=-85 to y=-61
SKULL_NOSE = [(0, 36.5), (7.5, 39.5), (9.2, 44.5), (5.8, 49), (2.8, 55), (0, 57),
              (-2.8, 55), (-5.8, 49), (-9.2, 44.5), (-7.5, 39.5)]
SKULL_NOSE_Y = (-85.0, -61.0)


def _in_cavity(p, grow=1.03):
    """True if point p (mm, final leaned skull space) lies inside a cavity."""
    y0 = p.y - SKULL_LEAN * max(0.0, p.z - 40.0)
    for c, r, deg in SKULL_SOCKETS:
        d = Matrix.Rotation(math.radians(-deg), 3, 'Y') @ Vector((p.x - c[0], y0 - c[1], p.z - c[2]))
        if (d.x / r[0]) ** 2 + (d.y / r[1]) ** 2 + (d.z / r[2]) ** 2 < grow * grow:
            return True
    if SKULL_NOSE_Y[0] < y0 < SKULL_NOSE_Y[1] + 0.6:
        qx, qz = p.x / 1.08, 46.5 + (p.z - 46.5) / 1.08
        hit = False
        n = len(SKULL_NOSE)
        for i in range(n):
            (x1, z1), (x2, z2) = SKULL_NOSE[i], SKULL_NOSE[(i + 1) % n]
            if (z1 > qz) != (z2 > qz) and qx < x1 + (qz - z1) * (x2 - x1) / (z2 - z1):
                hit = not hit
        return hit
    return False


def _lean(y, z):
    return y + SKULL_LEAN * max(0.0, z - 40.0)


def _skull_volume():
    """Sculpted skull body (object, metres) before the crisp mouth-tunnel cut."""
    P = Builder()
    P.ellipsoid((0, 0, 52), (46, 50, 44))                  # cranium
    P.ellipsoid((0, 6, 18), (33, 38, 22))                  # skull base
    P.box((56, 40, 30), (0, -47, 46), "chrome_dark", bevel=8)   # upper face block
    P.ellipsoid((0, -52, 46), (30, 22, 15))                # maxilla
    P.box((66, 46, 30), (0, -51, 15), "chrome_dark", bevel=4)   # lower jaw block
    for s in (-1, 1):
        P.ellipsoid((s * 30, -33, 34), (8, 11, 26))        # jaw ramus
        P.ellipsoid((s * 33, -43, 52.5), (9, 16, 7))       # cheekbone
        P.ellipsoid((s * 15, -44.5, 70.5), (17, 6, 6), rot=('Y', s * -15))  # angry brow
    P.ellipsoid((0, -56, 62), (7, 8, 12))                  # nose bridge
    body = P.finish("_skull_body")

    def remesh(voxel_mm):
        md = body.modifiers.new("rm", 'REMESH')
        md.mode = 'VOXEL'
        md.voxel_size = voxel_mm * MM
        md.adaptivity = 0.0
        _apply_modifiers(body)

    remesh(2.0)

    def cut(build):
        C = Builder()
        build(C)
        c = C.finish("_cut")
        md = body.modifiers.new("b", 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.solver = 'EXACT'
        md.object = c
        _apply_modifiers(body)
        _remove(c)

    for c, r, deg in SKULL_SOCKETS:
        cut(lambda C, c=c, r=r, deg=deg: C.ellipsoid(c, r, rot=('Y', deg)))
    cut(lambda C: C.prism(SKULL_NOSE, -SKULL_NOSE_Y[1], -SKULL_NOSE_Y[0], "chrome_dark", M=R('X', 90)))
    for s in (-1, 1):
        cut(lambda C, s=s: C.ellipsoid((s * 51, -14, 56), (8, 22, 16)))                              # temple
        cut(lambda C, s=s: C.box((26, 44, 6.5), (s * 32, -60, 32.2), "chrome_dark"))                 # side mouth slit

    remesh(1.9)
    md = body.modifiers.new("sm", 'SMOOTH')
    md.factor = 0.5
    md.iterations = 5
    _apply_modifiers(body)

    # lean the upper skull back and keep the cranium inside its footprint circle
    for v in body.data.vertices:
        v.co.y = _lean(v.co.y / MM, v.co.z / MM) * MM
        if v.co.y / MM > -40:
            r = math.hypot(v.co.x, v.co.y) / MM
            if r > 51.5:
                k = 51.5 / r
                v.co.x *= k
                v.co.y *= k
    return body


def _skull_problems(root):
    """Sanity checks on a finished skull (the exact boolean solver is known to
    hiccup once in a while). Returns a list of problem strings."""
    vs = [v.co / MM for v in root.data.vertices]
    out = []
    if min(v.y for v in vs) < -74.5:
        out.append("geometry in front of y=-74")
    if max(abs(v.x) for v in vs) > 47.5:
        out.append("too wide")
    if max(math.hypot(v.x, v.y) for v in vs if v.y > -40) > 54.5:
        out.append("cranium outside footprint circle")
    if any(abs(v.x) < 20.4 and 0.05 < v.z < 33.9 and -73.9 < v.y < -28.2 for v in vs):
        out.append("mouth tunnel obstructed")
    for eye in root.children:
        c = eye.location / MM
        if any((v - c).length < 4.0 for v in vs):
            out.append("eye socket not carved")
            break
    return out


def make_skull(name="skull"):
    problems = []
    for attempt in range(5):
        root = _build_skull(name)
        problems = _skull_problems(root)
        if not problems:
            return root
        for ob in list(root.children) + [root]:
            _remove(ob)
    raise RuntimeError("skull generation failed validation: %s" % ", ".join(problems))


def _build_skull(name):
    body = _skull_volume()

    # decimate to the mobile budget
    body.data.calc_loop_triangles()
    tris = len(body.data.loop_triangles)
    target = 9200
    if tris > target:
        md = body.modifiers.new("dec", 'DECIMATE')
        md.ratio = target / tris
        _apply_modifiers(body)

    # crisp ball tunnel + lip notch for the upper teeth
    C = Builder()
    C.box((41, 62, 44), (0, -59, 12), "black_plastic")          # x +-20.5, y -90..-28, z -10..34
    cutter = C.finish("_tunnel")
    C2 = Builder()
    C2.box((41, 30, 12), (0, -79, 36), "chrome_dark")           # notch: y < -64, z 30..42
    notch = C2.finish("_notch")
    for c in (cutter, notch):
        md = body.modifiers.new("b", 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.solver = 'EXACT'
        md.object = c
        _apply_modifiers(body)
        _remove(c)

    bm = bmesh.new()
    bm.from_mesh(body.data)
    _remove(body)
    bmesh.ops.scale(bm, vec=(1 / MM, 1 / MM, 1 / MM), verts=bm.verts)   # back to mm
    # flat floor
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1),
                           clear_inner=True, clear_outer=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()

    B = Builder()
    B.mi("chrome_dark")
    lining = B.mi("black_plastic")
    for f in bm.faces:
        f.material_index = 0
        c = f.calc_center_median()
        if abs(c.x) <= 20.6 and c.z <= 34.1 and -74.6 <= c.y <= -27.9:
            n = f.normal
            if (abs(abs(c.x) - 20.5) < 0.15 and abs(n.x) > 0.9) or \
               (abs(c.z - 34) < 0.15 and abs(n.z) > 0.9 and c.y > -64.2) or \
               (abs(c.y + 28) < 0.15 and abs(n.y) > 0.9):
                f.material_index = lining
        elif c.z > 34.5 and _in_cavity(c):
            f.material_index = lining
    me = bpy.data.meshes.new("_skullmesh")
    bm.to_mesh(me)
    bm.free()

    # helper object for surface queries (rivets, spikes)
    probe = bpy.data.objects.new("_probe", me)
    bpy.context.scene.collection.objects.link(probe)
    bpy.context.view_layer.update()

    def surface(p):
        ok, loc, nrm, _ = probe.closest_point_on_mesh(Vector(p))
        return loc, nrm

    B.bm.from_mesh(me)

    def stud(p, prof, m="chrome", segs=6, sink=0.6):
        loc, nrm = surface(p)
        q = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix().to_4x4()
        B.lathe(prof, m, segs=segs, M=T(*(loc - nrm * sink)) @ q, cap_start=False)

    rivet = [(2.2, 0), (2.2, 1.2), (1.3, 2.4), (0, 2.7)]
    # riveted seam across the forehead and down both temples
    for x in (-30, -18, -6, 6, 18, 30):
        stud((x, -60, 86 - abs(x) * 0.12), rivet)
    for s in (-1, 1):
        for (y, z) in ((-22, 74), (-6, 78), (12, 76)):
            stud((s * 60, y, z), rivet)
        # jaw hinge bolt
        B.lathe([(4.6, 0), (4.6, 2.0), (3.4, 3.0), (0, 3.0)], "chrome", segs=6,
                M=T(s * 32.6, -45, 14) @ R('Y', s * 90), cap_start=False)
    # mohawk of chrome spikes along the crown
    for i, y in enumerate((-22, -6, 10, 26, 40)):
        h = (11.0, 14.0, 15.0, 13.0, 10.0)[i]
        stud((0, y, 140), [(4.6, 0), (3.9, 2.0), (0, h)], segs=6, sink=1.2)

    # teeth ---------------------------------------------------------------
    def tooth(x, y, z_root, z_tip, w=5.6, d=5.0, yaw=0.0):
        up = z_tip > z_root
        h = abs(z_tip - z_root)
        prof = [(w * 0.707, 0), (w * 0.6, h * 0.55), (w * 0.2, h)]
        piece = _lathe([(r, z) for r, z in prof], segs=4, cap_start=True, cap_end=True)
        mtx = T(x, y, z_root) @ R('Z', yaw + 45) @ S(1.0, d / w, 1.0)
        if not up:
            mtx = T(x, y, z_root) @ R('X', 180) @ R('Z', yaw + 45) @ S(1.0, d / w, 1.0)
        B.add(piece, "chrome", mtx)

    # upper front teeth hang over the tunnel: tips at z=34
    for x in (-17.2, -10.4, -3.5, 3.5, 10.4, 17.2):
        tooth(x, -68.5, 43.5, 34.0, w=6.4, d=6.0)
    # fangs + side teeth (upper) and lower teeth on the jaw prongs
    for s in (-1, 1):
        tooth(s * 25.5, -70.5, 37.5, 27.5, w=6.6, d=6.0)              # upper fang
        for y in (-63.5, -56, -48.5):
            tooth(s * 31.2, y, 36.8, 31.4, w=5.6, d=5.0)               # upper side
        tooth(s * 23.8, -70.5, 28.0, 33.4, w=5.0, d=5.0)                # lower front
        tooth(s * 29.6, -70.5, 28.0, 34.0, w=5.4, d=5.0)
        for y in (-60, -52.5, -45):
            tooth(s * 31.2, y, 28.0, 33.0, w=5.6, d=5.0)               # lower side

    root = B.finish(name, sharp_deg=48)
    bpy.data.objects.remove(probe)
    bpy.data.meshes.remove(me)

    for s, tag in ((-1, "L"), (1, "R")):
        E = Builder()
        E.sphere(4.6, (0, 0, 0), "glow_red", u=12, v=8)
        E.finish("%s_eye_%s" % (name, tag), origin=(s * 18.5, _lean(-48.0, 56.5), 56.5), parent=root)
    return root


# --------------------------------------------------------------------------
# 2. Pop bumper (drum)
# --------------------------------------------------------------------------
def make_bumper(name="bumper"):
    B = Builder()
    B.lathe([(30, 3), (30, 4.4), (29.2, 5), (24, 5)], "white_plastic", segs=28, cap_start=False, cap_end=False)
    B.cyl(24, 0, 30, "black_plastic", segs=28, cap_start=False)
    for z in (6.5, 27.5):   # drum hoops
        B.lathe([(24, z - 1.6), (25.6, z - 1.6), (25.6, z + 1.6), (24, z + 1.6)], "chrome", segs=28,
                cap_start=False, cap_end=False)
    for i in range(6):      # tension lugs
        a = math.radians(i * 60 + 30)
        B.box((5, 3.4, 15), (0, 0, 0), "chrome", bevel=0.8,
              M=R('Z', math.degrees(a)) @ T(25.2, 0, 17) @ R('Z', 90) @ R('X', 0))
    B.cyl(13, 30, 38, "steel", segs=16, cap_start=False, cap_end=False)
    root = B.finish(name)

    G = Builder()
    G.torus(31, 2, "chrome", segs=28, sides=6)
    G.finish(name + "_ring", origin=(0, 0, 24), parent=root)

    C = Builder()
    # rim (chrome hoop of the drum head), local z 0..12
    C.lathe([(13, 0), (34, 0), (34, 9.5), (32.8, 11.2), (30.6, 11.2), (30.6, 9.6)],
            "chrome", segs=32, cap_start=False, cap_end=False)
    C.lathe([(30.6, 9.6), (20, 10.3), (0, 10.6)], "glow_orange", segs=32, cap_start=False)
    C.prism(bolt_points(0, 0, 17), 10.2, 12.0, "chrome", bevel=0.5, cap_bottom=False)
    for i in range(8):      # tension rods on the rim
        a = math.radians(i * 45 + 22.5)
        C.cyl(1.7, 9.5, 12.0, "chrome", segs=6, M=T(32.2 * math.cos(a), 32.2 * math.sin(a), 0), cap_start=False)
    C.finish(name + "_cap", origin=(0, 0, 38), parent=root)
    return root


# --------------------------------------------------------------------------
# 3. Flipper
# --------------------------------------------------------------------------
def make_flipper(name="flipper"):
    B = Builder()
    B.prism(stadium(11.5, 7.0, 78, 14, 10), 8, 20, "rubber_black", bevel=1.6, bevel_bottom=True)
    B.prism(stadium(10.0, 5.6, 78, 14, 10), 3, 23.2, "red_paint", bevel=1.4)
    B.prism(stadium(6.6, 3.0, 74, 10, 6), 23.2, 24.2, "chrome", bevel=0.5, cap_bottom=False)
    hexagon = [(4.6 * math.cos(math.radians(a)), 4.6 * math.sin(math.radians(a))) for a in range(0, 360, 60)]
    B.prism(hexagon, 24.2, 25.0, "chrome", bevel=0.4, cap_bottom=False)
    B.cyl(1.6, 24.2, 25.0, "steel_dark", segs=6, M=T(74, 0, 0), cap_start=False)
    return B.finish(name)


# --------------------------------------------------------------------------
# 4. Drop target
# --------------------------------------------------------------------------
def make_drop_target(name="droptarget", letter="R"):
    B = Builder()
    B.box((24, 6, 30), (0, 0, 17), "white_plastic", bevel=1.2)
    B.box((20, 8, 2), (0, 0, 1), "steel")
    txt, w, h = _text_solid(letter, max_points=120, depth=1.0)
    # drop the hidden back faces, then stand the letter up facing -Y
    bmesh.ops.delete(txt, geom=[f for f in txt.faces if f.normal.z < -0.5], context='FACES')
    k = min(17.0 / w, 22.0 / h)
    B.add(txt, "glow_orange", T(0, -3.0, 17.5) @ R('X', 90) @ S(k, k, 1.0) @ T(0, 0, 0.5))
    return B.finish(name)


# --------------------------------------------------------------------------
# 5. Post  /  6. Lane guide
# --------------------------------------------------------------------------
def make_post(name="post"):
    B = Builder()
    B.cyl(3, 0, 26, "steel", segs=10, cap_start=False, cap_end=False)
    B.lathe([(3, 8), (6.4, 8), (7.5, 9.6), (7.5, 18.4), (6.4, 20), (3, 20)], "rubber_red", segs=14,
            cap_start=False, cap_end=False)
    B.lathe([(3, 25.2), (4.4, 25.2), (4.4, 26.8), (2.6, 28), (0, 28)], "chrome", segs=10, cap_start=False)
    return B.finish(name)


def make_lane_guide(name="laneguide", length=60):
    """Capsule in plan: end-circle centres at y=0 and y=length (radius 4)."""
    B = Builder()
    pts = []
    for i in range(7):
        a = math.pi + math.pi * i / 6
        pts.append((4 * math.cos(a), 4 * math.sin(a)))
    for i in range(7):
        a = math.pi * i / 6
        pts.append((4 * math.cos(a), length + 4 * math.sin(a)))
    B.prism(pts, 0, 18, "steel", bevel=1.0, cap_bottom=False)
    B.box((2.4, length + 2.0, 0.9), (0, length / 2, 18.3), "glow_blue")
    return B.finish(name)


# --------------------------------------------------------------------------
# 7. Spinner  /  8. Gate
# --------------------------------------------------------------------------
def make_spinner(name="spinner"):
    B = Builder()
    for s in (-1, 1):
        B.cyl(1.5, 0, 34, "steel", segs=6, M=T(s * 20, 0, 0), cap_start=False)
        B.cyl(3.2, 0, 2, "steel", segs=8, M=T(s * 20, 0, 0), cap_start=False)
    B.tube([(-20, 0, 34), (20, 0, 34)], 1.3, "steel", sides=6)
    B.tube([(-20, 0, 22), (20, 0, 22)], 0.9, "steel", sides=5)
    root = B.finish(name)

    P = Builder()
    plate = _box(34, 2, 24, bevel=0.6)
    red = P.mi("red_paint")
    chrome = P.mi("chrome")
    for f in plate.faces:
        f.material_index = red if abs(f.normal.y) > 0.9 else chrome
    P.add(plate)
    for s in (-1, 1):   # lightning emblem on both faces
        P.prism(bolt_points(0, 0, 9), 0, 0.7, "chrome", cap_bottom=False,
                M=T(0, s * 1.0, 0) @ R('X', 90 * -s) @ (R('Z', 180) if s > 0 else Matrix.Identity(4)))
    P.finish(name + "_plate", origin=(0, 0, 22), parent=root)
    return root


def make_gate(name="gate"):
    B = Builder()
    B.box((40, 3, 3), (0, 0, 31.5), "steel", bevel=0.6)
    for s in (-1, 1):
        B.cyl(1.5, 0, 30, "steel", segs=6, M=T(s * 20, 0, 0), cap_start=False, cap_end=False)
    root = B.finish(name)
    F = Builder()
    F.tube([(-18, 0, 0), (-18, 0, -23), (-15, 0, -26), (15, 0, -26), (18, 0, -23), (18, 0, 0)],
           1.0, "steel", sides=6)
    F.tube([(-19.5, 0, 0), (19.5, 0, 0)], 0.8, "steel", sides=5)
    F.finish(name + "_flap", origin=(0, 0, 30), parent=root)
    return root


# --------------------------------------------------------------------------
# 9. Plunger
# --------------------------------------------------------------------------
def make_plunger(name="plunger"):
    """Origin on the playfield plane under the rubber tip face (y=0);
    rod axis at z=13.5, everything extends toward -Y."""
    B = Builder()
    A = T(0, 0, 13.5) @ R('X', 90)        # lathe +Z  ->  world -Y
    B.lathe([(0, 0), (4.2, 0.4), (6, 2.4), (6, 9), (4.5, 10)], "rubber_black", segs=14, M=A, cap_end=False)
    B.cyl(3.5, 10, 140, "chrome", segs=12, M=A, cap_start=False, cap_end=False)
    B.lathe([(3.5, 10), (7.6, 10), (7.6, 12), (3.5, 12)], "steel", segs=14, M=A, cap_start=False, cap_end=False)
    B.lathe([(3.5, 72), (9, 72), (9, 78), (3.5, 78)], "steel_dark", segs=14, M=A, cap_start=False, cap_end=False)
    turns, steps = 8, 10
    helix = []
    for i in range(turns * steps + 1):
        a = 2 * math.pi * i / steps
        helix.append((6.0 * math.cos(a), 6.0 * math.sin(a), 13 + 58.0 * i / (turns * steps)))
    B.tube(helix, 1.1, "steel", sides=4, M=A)
    B.lathe([(3.5, 138), (8, 138), (11.5, 142), (13, 148), (13, 158), (11, 163.5), (6, 166), (0, 166)],
            "black_plastic", segs=18, M=A, cap_start=False)
    return B.finish(name)


# --------------------------------------------------------------------------
# 10. Amp stack
# --------------------------------------------------------------------------
def _amp_box(B, w, d, h, z0, front_mat, inset=7.0, depth=3.0):
    """Tolex box with a recessed front panel (front = -Y). Returns panel y."""
    bm = _box(w, d, h, bevel=2.0)
    tolex = B.mi("tolex")
    fm = B.mi(front_mat)
    for f in bm.faces:
        f.material_index = tolex
    front = max(bm.faces, key=lambda f: -f.normal.y * f.calc_area())
    res = bmesh.ops.inset_region(bm, faces=[front], thickness=inset, depth=-depth, use_even_offset=True)
    front.material_index = fm
    B.add(bm, None, T(0, 0, z0 + h / 2))
    return -d / 2 + depth


def make_amp_stack(name="amp"):
    B = Builder()
    W, D, H = 110, 55, 110
    Z0 = 3.0
    py = _amp_box(B, W, D, H, Z0, "grille")
    hd = 50
    hy = _amp_box(B, W, hd, 45, Z0 + H, "black_plastic", inset=6.0, depth=2.5)
    # white piping around the grille opening
    for (sx, sz, cx, cz) in ((W - 12, 1.2, 0, Z0 + 7.2), (W - 12, 1.2, 0, Z0 + H - 7.2),
                             (1.2, H - 12, -W / 2 + 7.2, Z0 + H / 2), (1.2, H - 12, W / 2 - 7.2, Z0 + H / 2)):
        B.box((sx, 1.0, sz), (cx, -D / 2 + 0.6, cz), "white_plastic")
    # corner protectors
    for (bw, bd, bh, bz) in ((W, D, H, Z0), (W, hd, 45, Z0 + H)):
        for sx in (-1, 1):
            for sz in (0, 1):
                B.box((10, 10, 10), (sx * (bw / 2 - 4.4), -bd / 2 + 4.4, bz + (bh - 4.4 if sz else 4.4)),
                      "chrome", bevel=1.6)
                B.box((10, 10, 10), (sx * (bw / 2 - 4.4), bd / 2 - 4.4, bz + (bh - 4.4 if sz else 4.4)),
                      "chrome", bevel=1.6)
    for sx in (-1, 1):      # feet
        for sy in (-1, 1):
            B.box((12, 10, 3), (sx * 40, sy * 17, 1.5), "rubber_black")
    # speaker rims
    F = R('X', 90)          # lathe +Z -> world -Y
    centres = [(-26.5, Z0 + 30), (26.5, Z0 + 30), (-26.5, Z0 + 80), (26.5, Z0 + 80)]
    for cx, cz in centres:
        B.lathe([(23.6, 0), (23.6, 1.6), (22.4, 2.6), (20.2, 2.6), (20.2, 0)], "chrome", segs=24,
                M=T(cx, py, cz) @ F, cap_start=False, cap_end=False)
    # head: control strip, knobs, lamp, handle
    hz = Z0 + H
    B.box((92, 1.6, 13), (0, hy - 0.6, hz + 13.5), "gold", bevel=0.5)
    for i in range(7):
        x = -36 + i * 10.5
        B.lathe([(3.2, 0), (3.2, 3.4), (2.4, 4.4), (0, 4.4)], "black_plastic", segs=8,
                M=T(x, hy - 1.2, hz + 13.5) @ F, cap_start=False)
        B.box((0.7, 0.6, 2.6), (x, hy - 5.7, hz + 14.6), "white_plastic")
    B.sphere(2.0, (40, hy - 1.4, hz + 13.5), "glow_red", u=8, v=5)
    B.tube([(-22, 0, hz + 44.5), (-18, 0, hz + 47.5), (18, 0, hz + 47.5), (22, 0, hz + 44.5)], 1.8, "black_plastic", sides=5)
    root = B.finish(name)

    for i, (cx, cz) in enumerate(centres):
        Cn = Builder()
        # local frame: +Z = out of the cabinet front (rotated to -Y below)
        Cn.lathe([(20.2, 0.6), (18.6, 1.4), (17.2, 0.2), (7.0, -7.5), (5.6, -6.2), (0, -4.6)],
                 "cone", segs=18, M=F, cap_start=False)
        Cn.finish("%s_cone_%d" % (name, i), origin=(cx, py, cz), parent=root)

    L = Builder()
    L.box((42, 1.6, 10), (0, 0, 0), "glow_orange", bevel=0.5)
    L.box((45, 1.0, 13), (0, 0.6, 0), "chrome")
    L.finish(name + "_logo_glow", origin=(0, hy - 0.8, hz + 31), parent=root)
    return root


# --------------------------------------------------------------------------
# 11. Tesla coil  /  12. Flame pot
# --------------------------------------------------------------------------
def make_tesla_coil(name="tesla"):
    B = Builder()
    B.lathe([(15, 0), (15, 7.5), (13, 10), (9.5, 10)], "black_plastic", segs=24, cap_start=False, cap_end=False)
    for i in range(4):
        a = math.radians(45 + 90 * i)
        B.lathe([(2.2, 0), (2.2, 0.9), (0, 1.2)], "chrome", segs=6, cap_start=False,
                M=T(11.6 * math.cos(a), 11.6 * math.sin(a), 8.6) @ R('Z', math.degrees(a)) @ R('Y', 38))
    prof = [(9.5, 10)]
    ribs = 10
    for i in range(ribs):
        z = 10 + 52.0 * i / ribs
        dz = 52.0 / ribs
        prof += [(8.2, z + dz * 0.1), (8.2, z + dz * 0.55), (7.1, z + dz * 0.7), (7.1, z + dz * 0.95)]
    prof += [(7.1, 62), (5, 62), (5, 66), (0, 66)]
    B.lathe(prof, "copper", segs=12, cap_start=False)
    B.cyl(4.2, 62, 70, "steel", segs=10, cap_start=False, cap_end=False)
    B.torus(14, 5, "chrome", segs=20, sides=8, M=T(0, 0, 70))
    B.lathe([(9.5, 70), (0, 70.6)], "chrome", segs=12, cap_start=False)       # torus web
    B.lathe([(1.6, 70), (1.1, 77), (0, 77)], "steel", segs=6, cap_start=False)  # electrode
    root = B.finish(name)
    G = Builder()
    G.sphere(5, (0, 0, 0), "glow_blue", u=12, v=8)
    G.finish(name + "_glow", origin=(0, 0, 80), parent=root)
    return root


def make_flame_pot(name="flamepot"):
    B = Builder()
    B.lathe([(11, 0), (11, 15.5), (12.6, 16.5), (12.6, 20), (8.4, 20), (8.4, 12)], "steel_dark", segs=16,
            cap_start=False, cap_end=False)
    B.lathe([(11, 2), (13.4, 2), (13.4, 5), (11, 5)], "steel", segs=16, cap_start=False, cap_end=False)
    for i in range(4):
        B.box((2.2, 4.2, 11), (0, 0, 0), "steel", M=R('Z', 45 + i * 90) @ T(0, 11.4, 10.5))
    root = B.finish(name)
    G = Builder()
    G.lathe([(8.4, 0), (0, 0)], "glow_orange", segs=14, cap_start=False)
    G.finish(name + "_glow", origin=(0, 0, 19), parent=root)
    return root


# --------------------------------------------------------------------------
# 13. Guitar (original pointed design)
# --------------------------------------------------------------------------
GUITAR_BODY = [
    (11, 50), (20, 44), (47, 60), (31, 20), (33, -6), (55, -40), (24, -37),
    (9, -62), (-3, -52), (-31, -58), (-25, -26), (-33, 2), (-50, 63), (-21, 42), (-11, 50),
]
GUITAR_HEAD = [(-9.2, 186), (9.2, 186), (15, 195), (11.5, 212), (21, 238), (-1.5, 221), (-14, 201)]
GUITAR_GUARD = [(12, 40), (24, 22), (27, -8), (40, -30), (22, -30), (10, -20), (12, 10)]


def make_guitar(name="guitar"):
    B = Builder()
    B.prism(GUITAR_BODY, -6, 6, "red_paint", bevel=2.2, bevel_bottom=True)
    B.prism(GUITAR_GUARD, 6, 6.7, "black_plastic", cap_bottom=False)
    # neck (tapered) + fretboard
    nut_y, heel_y = 186.0, 44.0
    neck = [(-10.8, heel_y), (10.8, heel_y), (8.6, nut_y), (-8.6, nut_y)]
    B.prism(neck, -4, 5.8, "wood_dark", bevel=0.8)
    B.prism([(-10.2, 36), (10.2, 36), (8.3, nut_y), (-8.3, nut_y)], 5.8, 7.2, "black_plastic", cap_bottom=False)
    bridge_y = -34.0
    scale = nut_y - bridge_y
    for n in range(1, 17):
        y = nut_y - scale * (1 - 2 ** (-n / 12.0))
        w = 8.3 + (10.2 - 8.3) * (nut_y - y) / (nut_y - 36)
        B.box((2 * w, 0.9, 0.7), (0, y, 7.4), "steel")
    for n in (3, 5, 7, 9, 12):     # inlay bolts
        y0 = nut_y - scale * (1 - 2 ** (-(n - 1) / 12.0))
        y1 = nut_y - scale * (1 - 2 ** (-n / 12.0))
        B.prism(bolt_points(0, (y0 + y1) / 2, min(3.2, (y0 - y1) * 0.36)), 7.2, 7.35, "white_plastic", cap_bottom=False)
    B.box((18.0, 1.8, 1.8), (0, nut_y + 0.6, 7.6), "white_plastic")
    B.prism(GUITAR_HEAD, -3, 4.5, "black_plastic", bevel=1.0, bevel_bottom=True)
    def head_left_x(y):
        edge = [(-9.2, 186), (-14, 201), (-1.5, 221), (21, 238)]
        for (x0, y0), (x1, y1) in zip(edge, edge[1:]):
            if y0 <= y <= y1:
                return x0 + (x1 - x0) * (y - y0) / (y1 - y0)
        return edge[-1][0]

    tuner_pts = []
    for i in range(6):
        t = i / 5.0
        x, y = -5.0 + 16.0 * t, 197.0 + 30.0 * t
        tuner_pts.append((x, y))
        B.cyl(1.9, 4.5, 8.2, "chrome", segs=8, M=T(x, y, 0), cap_start=False)
        B.box((6.0, 3.4, 2.6), (head_left_x(y - 2.5) - 2.2, y - 2.5, 0.8), "chrome", bevel=0.6)
    # pickups, bridge, knobs, whammy bar, jack
    for y in (17, -11):
        B.box((33, 10.5, 3.2), (0, y, 7.4), "chrome", bevel=0.9)
        for i in range(6):
            B.cyl(1.0, 9.0, 9.5, "steel_dark", segs=5, M=T(-11.5 + i * 4.6, y, 0), cap_start=False)
    B.box((37, 9, 4.4), (0, bridge_y - 1.5, 8.0), "chrome", bevel=1.0)
    B.box((30, 4, 3.4), (0, bridge_y - 11, 7.5), "chrome", bevel=0.8)
    for (x, y) in ((33, -19), (42, -31), (27, -32.5)):
        B.lathe([(4.6, 6), (4.6, 10.2), (3.6, 11.2), (0, 11.2)], "gold", segs=12, M=T(x, y, 0), cap_start=False)
    B.tube([(19, bridge_y - 1, 9), (22, bridge_y - 1, 13.5), (30, bridge_y + 14, 14.5), (37, bridge_y + 34, 13.5)],
           1.0, "chrome", sides=5)
    B.sphere(2.0, (37, bridge_y + 34, 13.5), "black_plastic", u=6, v=4)
    # lightning decal on the upper horn
    B.prism(bolt_points(-30, 28, 12), 6, 6.5, "gold", cap_bottom=False, M=T(-30, 28, 0) @ R('Z', 16) @ T(30, -28, 0))
    root = B.finish(name)

    Sg = Builder()
    for i in range(6):
        xb = -11.5 + i * 4.6
        xn = -6.5 + i * 2.6
        path = [(xb, bridge_y - 11, 9.4), (xb, bridge_y - 1.5, 10.6), (xn, nut_y + 0.6, 8.8), tuple(list(tuner_pts[i]) + [7.2])]
        Sg.tube(path, 0.42 + 0.05 * (5 - i), "glow_white", sides=4)
    Sg.finish(name + "_strings_glow", origin=(0, 0, 0), parent=root)
    return root


# --------------------------------------------------------------------------
# 14. Logo
# --------------------------------------------------------------------------
def make_logo(name="logo", text="RIFFGEWITTER", width=400):
    depth = 8.0
    txt, w, h = _text_solid(text, max_points=2300, depth=1.0)
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
    # chrome frame: push the side walls out a touch so they outline the glowing face
    B = Builder()
    B.add(txt, "chrome")
    root = B.finish(name, sharp_deg=30)
    G = Builder()
    G.add(front, "glow_orange")
    G.finish(name + "_glow", origin=(0, 0, 0), parent=root, smooth=False)
    return root


# --------------------------------------------------------------------------
# 15. PAR can  /  16. Bolt
# --------------------------------------------------------------------------
def make_par_can(name="par"):
    """Origin = bracket mount point (top). Can points -Y, 35 deg downward."""
    B = Builder()
    pivot = Vector((0, 0, -30))
    aim = T(*pivot) @ R('X', 90 + 35)       # lathe +Z -> (-Y, 35 deg down)
    B.lathe([(0, -20), (9, -20), (13.5, -14), (16, -6), (16, 18.5), (17.2, 18.5), (17.2, 20), (14.6, 20), (14.6, 17)],
            "black_plastic", segs=14, M=aim, cap_end=False)
    B.lathe([(16.3, -3), (16.9, -3), (16.9, 0), (16.3, 0)], "chrome", segs=14, M=aim, cap_start=False, cap_end=False)
    for s in (-1, 1):       # barn doors
        B.box((0.8, 27, 13), (0, 0, 0), "black_plastic", M=aim @ T(s * 19.6, 0, 26) @ R('Y', s * 22))
    B.tube([(-19.5, 0, -30), (-19.5, 0, -6), (-15, 0, -3), (15, 0, -3), (19.5, 0, -6), (19.5, 0, -30)],
           1.5, "steel_dark", sides=5)
    B.cyl(2.4, -3, 0, "steel_dark", segs=8)
    for s in (-1, 1):
        B.cyl(3.0, 0, 2.2, "chrome", segs=6, M=T(s * 19.5, 0, -30) @ R('Y', s * 90), cap_start=False)
    root = B.finish(name)
    G = Builder()
    G.lathe([(14.6, 0), (9, 0.9), (0, 1.3)], "glow_white", segs=16, M=R('X', 90 + 35), cap_start=False)
    lens = pivot + (R('X', 90 + 35).to_3x3() @ Vector((0, 0, 17.0)))
    G.finish(name + "_glow", origin=tuple(lens), parent=root)
    return root


def make_bolt(name="bolt"):
    B = Builder()
    r = 3.2
    B.lathe([(r, 0), (r, 1.4), (r * 0.78, 2.0)], "chrome", segs=6, cap_start=False)
    return B.finish(name, sharp_deg=25)


# --------------------------------------------------------------------------
# 17. Rock frontwoman "Roxy" (the ball is shot between her boots)
# --------------------------------------------------------------------------
ROCKER_BOOT_X = 26.0        # boots stand at x = +-26
ROCKER_BOOT_R = 7.5         # footprint capsule radius around x=+-26, y -9..+9
ROCKER_TUNNEL_HALF = 18.5   # free for |x| < 18.5 ...
ROCKER_TUNNEL_Z = 42.0      # ... up to this height


def _aim(direction):
    """Rotation matrix that turns +Z into `direction`."""
    return Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()


def _limb(p0, p1, r0, r1, segs=10, cap_start=True, cap_end=True):
    """Tapered cylinder from p0 (radius r0) to p1 (radius r1)."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bm = _lathe([(r0, 0.0), (r1, d.length)], segs, cap_start, cap_end)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ _aim(d), verts=bm.verts)
    return bm


def _rocker_check(root, label="rocker"):
    """Physics contract: free ball tunnel between the legs, boots inside their capsules."""
    problems = []
    stack = [(root, Vector((0, 0, 0)))]
    while stack:
        ob, off = stack.pop()
        base = off + ob.location
        for c in ob.children:
            stack.append((c, base))
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            w = (base + v.co) / MM
            if w.z < -0.01:
                problems.append("%s below the playfield" % ob.name)
                break
            if abs(w.x) < ROCKER_TUNNEL_HALF - 1e-4 and w.z < ROCKER_TUNNEL_Z:
                problems.append("%s intrudes into the ball tunnel at (%.1f, %.1f, %.1f)" % (ob.name, w.x, w.y, w.z))
                break
            if w.z < ROCKER_TUNNEL_Z:
                dy = max(0.0, abs(w.y) - 9.0)
                if math.hypot(abs(w.x) - ROCKER_BOOT_X, dy) > ROCKER_BOOT_R + 0.02:
                    problems.append("%s boot leaves its capsule at (%.1f, %.1f, %.1f)" % (ob.name, w.x, w.y, w.z))
                    break
    if problems:
        raise RuntimeError("%s violates the physics contract: " % label + "; ".join(problems))


def make_rocker(name="roxy"):
    """Hard-rock frontwoman in a wide power stance, facing -Y.

    Origin: playfield, midpoint between the boots (x = +-26). The tunnel
    |x| < 18.5, z < 42 is empty so the ball can roll through front to back.
    Children: {name}_torso (pivot waist) > {name}_head (pivot neck base),
    {name}_arm_R (pivot right shoulder, her right = -X)."""
    X = ROCKER_BOOT_X
    SY = 2.0                                   # shin / body centre line in y

    # ------------------------------------------------------------------ root
    B = Builder()
    foot = lambda r: [(-y, x - 9.0) for x, y in stadium(r, r, 18.0, 10, 10)]   # stadium along Y, -9..+9
    for s in (-1, 1):
        M = T(s * X, 0, 0)
        B.prism(foot(7.3), 0.0, 8.5, "black_plastic", bevel=0.9, M=M)                # platform sole
        B.prism(foot(7.45), 3.2, 5.0, "rubber_red", M=M, cap_bottom=False)          # red stripe
        B.prism(foot(6.5), 8.5, 17.5, "black_plastic", bevel=2.2, M=M, cap_bottom=False)
        B.add(_limb((s * X, SY, 14.5), (s * X, SY, 47.5), 6.5, 7.0, 12, cap_start=False), "black_plastic")
        for z in (21.0, 30.0, 39.0):                                                # buckle straps
            B.lathe([(6.6, z), (7.38, z), (7.38, z + 2.6), (6.6, z + 2.6)], "chrome", segs=12,
                    M=T(s * X, SY, 0), cap_start=False, cap_end=False)
            B.box((4.2, 1.0, 3.6), (s * X, SY - 7.35, z + 1.3), "steel_dark", bevel=0.3)
        knee = Vector((s * X, SY, 48.0))
        hip = Vector((s * 11.5, SY, 77.0))
        B.sphere(7.3, tuple(knee), "leather", u=12, v=8)
        B.lathe([(6.9, 44.0), (7.7, 44.0), (7.7, 47.0), (6.9, 47.0)], "leather", segs=12,
                M=T(s * X, SY, 0), cap_start=False, cap_end=False)                  # boot cuff
        B.add(_limb(knee, hip, 7.2, 9.8, 12), "leather")
        axis = (hip - knee).normalized()
        out = Vector((s, 0, 0)) - axis * axis.dot(Vector((s, 0, 0)))
        out.normalize()
        for k in range(4):                                                          # studs down the seam
            f = 0.18 + 0.2 * k
            c = knee.lerp(hip, f) + out * (7.2 + 2.6 * f - 0.3)
            B.add(_lathe([(1.5, 0), (0, 2.0)], 4), "chrome", T(*c) @ _aim(out))
    B.ellipsoid((0, SY, 78.0), (20.0, 11.5, 11.0), "leather", u=18, v=10)           # hips
    B.lathe([(16.6, 81.0), (18.7, 81.0), (18.7, 86.0), (16.6, 86.0)], "black_plastic", segs=24,
            M=T(0, SY, 0) @ S(1.0, 0.62, 1.0), cap_start=False, cap_end=False)      # belt
    for k in range(14):
        a = 2 * math.pi * (k + 0.5) / 14
        d = Vector((math.sin(a), -math.cos(a) * 0.62, 0.0))
        nrm = Vector((math.sin(a) * 0.62, -math.cos(a), 0.0)).normalized()
        B.add(_lathe([(1.7, 0), (0, 2.4)], 4), "chrome", T(d.x * 18.6, SY + d.y * 18.6, 83.5) @ _aim(nrm))
    B.box((8.5, 2.4, 6.6), (0, SY - 11.9, 83.5), "chrome", bevel=0.8)               # buckle
    B.box((4.4, 0.8, 3.0), (0, SY - 13.2, 83.5), "steel_dark", bevel=0.3)
    root = B.finish(name, sharp_deg=42)

    def shift(builder, pivot):
        bmesh.ops.translate(builder.bm, vec=(-pivot[0], -pivot[1], -pivot[2]), verts=builder.bm.verts)

    # ------------------------------------------------------------------ torso
    PT = (0.0, SY, 86.0)
    Tb = Builder()
    Tb.lathe([(13.4, 84.0), (12.6, 91.0), (13.8, 98.0), (16.2, 107.0), (17.2, 114.0), (15.5, 119.0),
              (9.0, 123.0), (5.2, 125.0)], "red_paint", segs=20, M=T(0, SY, 0) @ S(1.0, 0.62, 1.0))
    for s in (-1, 1):
        Tb.ellipsoid((s * 6.8, SY - 6.4, 109.5), (6.6, 4.4, 5.6), "red_paint", u=12, v=8)
    # open cropped leather jacket: a shell with the front sector removed
    jprof = [(13.0, 89.0), (14.8, 89.0), (14.4, 92.0), (15.6, 98.0), (18.0, 107.0), (19.1, 114.0), (18.2, 119.5),
             (12.5, 124.0), (8.6, 125.6)]
    KY, OPEN = 0.66, math.radians(30.0)
    jacket = _lathe(jprof, 24, cap_start=False, cap_end=False)
    bmesh.ops.scale(jacket, vec=(1.0, KY, 1.0), verts=jacket.verts)
    doomed = []
    for f in jacket.faces:
        c = f.calc_center_median()
        if abs(math.atan2(c.x, -c.y / KY)) < OPEN and c.z < 123.0:
            doomed.append(f)
    bmesh.ops.delete(jacket, geom=doomed, context='FACES')
    Tb.add(jacket, "leather", T(0, SY, 0))
    for s in (-1, 1):                                                                # zip along the open edges
        a = s * OPEN
        zipline = [((r + 0.25) * math.sin(a), SY - (r + 0.25) * KY * math.cos(a), z) for r, z in jprof[1:-2]]
        Tb.tube(zipline, 0.75, "chrome", sides=4)
    Tb.torus(8.6, 2.3, "leather", segs=16, sides=6, M=T(0, SY + 0.6, 124.2) @ S(1.0, 0.82, 1.0))   # collar
    for s in (-1, 1):
        sh = Vector((s * 20.5, SY, 118.5))
        Tb.sphere(7.7, tuple(sh), "leather", u=12, v=8)
        for d in ((s * 0.55, -0.1, 0.83), (s * 0.95, -0.15, 0.28), (s * 0.3, 0.45, 0.84), (s * 0.8, 0.5, 0.35)):
            dv = Vector(d).normalized()
            Tb.add(_lathe([(2.2, 0), (1.5, 2.0), (0, 8.0)], 6), "chrome", T(*(sh + dv * 6.9)) @ _aim(dv))
    # her left arm (+X): hand on the hip
    sh, el, wr = Vector((20.5, SY, 118.5)), Vector((34.0, 6.0, 102.0)), Vector((23.5, -2.5, 91.0))
    Tb.add(_limb(sh, el, 5.7, 5.1, 10), "leather")
    Tb.sphere(5.2, tuple(el), "leather", u=10, v=6)
    Tb.add(_limb(el, wr, 5.1, 4.3, 10), "leather")
    Tb.add(_limb(el.lerp(wr, 0.8), el.lerp(wr, 0.93), 4.75, 4.6, 10), "chrome")      # studded cuff
    Tb.sphere(4.9, (21.6, -4.8, 89.0), "skin", u=10, v=6)
    shift(Tb, PT)
    torso = Tb.finish(name + "_torso", origin=PT, parent=root, sharp_deg=42)

    # ------------------------------------------------------------------ head
    PH = (0.0, SY, 123.5)
    H = Builder()
    H.cyl(4.6, 120.5, 131.0, "skin", segs=10, M=T(0, SY, 0), cap_start=False, cap_end=False)
    H.lathe([(4.5, 125.2), (5.2, 125.2), (5.2, 127.8), (4.5, 127.8)], "black_plastic", segs=10,
            M=T(0, SY, 0), cap_start=False, cap_end=False)                           # choker
    H.add(_lathe([(1.3, 0), (0, 1.8)], 4), "chrome", T(0, SY - 5.1, 126.5) @ _aim((0, -1, 0)))
    H.ellipsoid((0, 1.0, 139.0), (10.5, 11.3, 12.5), "skin", u=18, v=12)
    H.ellipsoid((0, -1.5, 131.6), (7.6, 8.0, 6.0), "skin", u=14, v=8)                # jaw / chin
    H.ellipsoid((0, -10.5, 137.6), (1.7, 2.0, 2.6), "skin", u=8, v=6)                # nose
    # broad open laugh: dark mouth, teeth strip, red lips
    H.ellipsoid((0, -9.0, 132.6), (6.2, 1.6, 2.7), "black_plastic", u=12, v=6)
    H.box((9.8, 1.0, 2.3), (0, -10.3, 133.75), "teeth", bevel=0.3)
    H.torus(6.3, 0.75, "lips", segs=16, sides=6, M=T(0, -10.0, 132.6) @ S(1.0, 1.0, 0.46) @ R('X', 90))
    # chrome sunglasses
    for s in (-1, 1):
        H.ellipsoid((s * 5.0, -9.5, 142.0), (4.7, 1.7, 3.5), "chrome", u=12, v=8)
        H.tube([(s * 9.3, -8.2, 142.6), (s * 11.4, 2.5, 142.0)], 0.7, "chrome", sides=4)
    H.box((3.4, 1.2, 1.3), (0, -10.3, 143.0), "chrome", bevel=0.3)
    # big flame-red hair
    H.ellipsoid((0, 5.0, 143.5), (13.2, 13.2, 12.8), "hair_red", u=16, v=10)
    for s in (-1, 1):
        H.ellipsoid((s * 12.5, 6.0, 133.0), (6.5, 9.5, 15.0), "hair_red", u=10, v=8)
        H.ellipsoid((s * 13.5, -2.0, 121.0), (4.2, 4.2, 12.5), "hair_red", rot=('Y', s * 8), u=8, v=6)
    H.ellipsoid((0, 13.5, 120.0), (16.0, 7.5, 26.0), "hair_red", u=14, v=10)         # mane down the back
    crown = Vector((0, 5.0, 143.5))
    for d, h in (((0, -0.35, 1.0), 10.0), ((0.55, -0.05, 0.85), 9.0), ((-0.55, -0.05, 0.85), 9.0),
                 ((0.85, 0.3, 0.5), 8.0), ((-0.85, 0.3, 0.5), 8.0), ((0, 0.55, 0.85), 10.0),
                 ((0.45, 0.75, 0.5), 8.0), ((-0.45, 0.75, 0.5), 8.0)):
        dv = Vector(d).normalized()
        base = crown + Vector((dv.x * 13.2, dv.y * 13.2, dv.z * 12.8)) * 0.78
        H.add(_lathe([(4.6, 0), (2.4, h * 0.55), (0, h)], 6, cap_start=False), "hair_red", T(*base) @ _aim(dv))
    shift(H, PH)
    H.finish(name + "_head", origin=tuple(Vector(PH) - Vector(PT)), parent=torso, sharp_deg=50)

    # ------------------------------------------------------------------ right arm (her right = -X), horns up
    PA = (-20.5, SY, 118.5)
    Ar = Builder()
    sh, el, wr = Vector(PA), Vector((-33.5, 1.0, 127.0)), Vector((-37.5, -2.5, 146.0))
    Ar.add(_limb(sh, el, 5.7, 5.1, 10), "leather")
    Ar.sphere(5.2, tuple(el), "leather", u=10, v=6)
    Ar.add(_limb(el, wr, 5.1, 4.3, 10), "leather")
    Ar.add(_limb(el.lerp(wr, 0.78), el.lerp(wr, 0.92), 4.8, 4.6, 10), "chrome")
    fist = Vector((-38.4, -3.3, 151.0))
    Ar.sphere(5.1, tuple(fist), "skin", u=10, v=6)
    for dx in (-3.1, 3.1):                                                           # index + pinky: the horns
        Ar.add(_limb(fist + Vector((dx, -0.6, 2.6)), fist + Vector((dx * 1.45, -0.9, 12.0)), 1.7, 1.3, 6), "skin")
    Ar.add(_limb(fist + Vector((1.5, -3.6, 0.5)), fist + Vector((-2.0, -4.9, 2.6)), 1.6, 1.4, 6), "skin")   # thumb
    shift(Ar, PA)
    Ar.finish(name + "_arm_R", origin=tuple(Vector(PA) - Vector(PT)), parent=torso, sharp_deg=42)

    _rocker_check(root)
    return root


# --------------------------------------------------------------------------
# 18. Vintage pin-up "Roxy" (natural proportions; same part contract as make_rocker)
# --------------------------------------------------------------------------
def _organic(build, voxel, smooth=5, tris=None, factor=0.5):
    """Blobby primitives -> one smooth organic surface. Returns a bmesh in mm."""
    P = Builder()
    build(P)
    ob = P.finish("_organic")
    md = ob.modifiers.new("rm", 'REMESH')
    md.mode = 'VOXEL'
    md.voxel_size = voxel * MM
    md.adaptivity = 0.0
    _apply_modifiers(ob)
    if smooth:
        md = ob.modifiers.new("sm", 'SMOOTH')
        md.factor = factor
        md.iterations = smooth
        _apply_modifiers(ob)
    if tris:
        ob.data.calc_loop_triangles()
        n = len(ob.data.loop_triangles)
        if n > tris:
            md = ob.modifiers.new("dec", 'DECIMATE')
            md.ratio = tris / n
            _apply_modifiers(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    _remove(ob)
    bmesh.ops.scale(bm, vec=(1 / MM, 1 / MM, 1 / MM), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    return bm


class _Probe:
    """Ray / nearest-point queries against a bmesh (mm)."""

    def __init__(self, bm):
        me = bpy.data.meshes.new("_probe")
        bm.to_mesh(me)
        self.ob = bpy.data.objects.new("_probe", me)
        bpy.context.scene.collection.objects.link(self.ob)
        bpy.context.view_layer.update()

    def front(self, x, z, y0=-60.0):
        """First surface point hit when looking along +Y at (x, z)."""
        ok, loc, nrm, _ = self.ob.ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
        return (loc, nrm) if ok else (Vector((x, 0.0, z)), Vector((0, -1, 0)))

    def near(self, p):
        ok, loc, nrm, _ = self.ob.closest_point_on_mesh(Vector(p))
        return loc, nrm

    def free(self):
        _remove(self.ob)


def _blob_limb(P, p0, p1, r0, r1, segs=12):
    P.add(_limb(p0, p1, r0, r1, segs), "skin")
    P.sphere(r0, tuple(p0), "skin", u=12, v=8)
    P.sphere(r1, tuple(p1), "skin", u=12, v=8)


PINUP_CY = 3.2          # body centre line in y


def _pinup_shoe(B, s):
    """Red pump with a heel; toe at -Y. Stays inside the boot capsule."""
    X = ROCKER_BOOT_X
    half = [(0.0, -14.2), (1.7, -12.6), (3.1, -9.4), (3.6, -5.2), (3.4, -0.5), (2.9, 3.8), (2.7, 7.0), (1.9, 8.7), (0.0, 9.3)]
    outline = half + [(-x, y) for x, y in reversed(half[1:-1])]

    def lift(bm):
        for v in bm.verts:
            if v.co.y > -4.5:
                v.co.z += 0.70 * (v.co.y + 4.5)
        return bm

    M = T(s * X, 0, 0)
    B.add(lift(_prism(outline, 0.0, 1.1)), "black_plastic", M)
    upper = _prism([(x * 0.98, y) for x, y in outline], 1.1, 4.4, bevel=1.3, cap_bottom=False)
    B.add(lift(upper), "shoe_red", M)
    B.add(_limb((0, 7.75, 0.06), (0, 7.9, 8.4), 1.35, 2.5, 8), "shoe_red", M)


PINUP_SKIRT_PIVOT = (0.0, 3.2, 87.5)   # waist centre at the belt (mm)


def _pinup_skirt(B, hem_z=49.5, flare=0.0):
    """Flared swing skirt with a wavy hem, closed underneath by a white petticoat.

    `flare` (0..1) builds the same topology blown up by a gust: the waistband stays put,
    the lower skirt billows out and the hem rises (used as the "flare" shape key)."""
    prof = [(9.7, 89.8), (12.2, 86.0), (18.4, 80.0), (23.6, 71.0), (27.8, 61.0), (30.6, 53.0), (32.0, hem_z)]
    SEG, WAVES, AMP = 40, 10, 0.07 * (1.0 + 0.25 * flare)
    top_z = prof[0][1]

    def point(i_f, a):
        """Point on the skirt for a fractional ring index and an angle."""
        i0 = min(len(prof) - 2, int(i_f))
        f = i_f - i0
        r = prof[i0][0] + (prof[i0 + 1][0] - prof[i0][0]) * f
        z = prof[i0][1] + (prof[i0 + 1][1] - prof[i0][1]) * f
        lin = i_f / (len(prof) - 1)
        w = lin ** 1.6
        if flare:
            g = lin ** 1.35                      # no movement at the waistband, most at the hem
            r *= 1.0 + 0.34 * flare * g
            z += flare * 0.15 * (top_z - z) * g  # hem lifts by about 6 mm
            # the gust comes from the front: the front billows a little more than the back
            r *= 1.0 + 0.06 * flare * g * max(0.0, math.cos(a))
        rr = r * (1.0 + AMP * w * math.cos(WAVES * a))
        ky = 0.74 - 0.13 * i_f / (len(prof) - 1)      # rounder at the waist, flatter at the hem
        return Vector((rr * math.sin(a), PINUP_CY + 0.8 * w - rr * ky * math.cos(a), z))

    bm = bmesh.new()
    rings = [[bm.verts.new(point(i, 2 * math.pi * j / SEG)) for j in range(SEG)] for i in range(len(prof))]
    # hidden tuck ring inside the bodice: closes the waistband when the game scales the skirt up
    tuck = [bm.verts.new((7.6 * math.sin(2 * math.pi * j / SEG),
                          PINUP_CY - 7.6 * 0.74 * math.cos(2 * math.pi * j / SEG), 92.0)) for j in range(SEG)]
    rings.insert(0, tuck)
    for i in range(len(rings) - 1):
        for j in range(SEG):
            j2 = (j + 1) % SEG
            bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # make sure the shell faces outwards
    f0 = bm.faces[:][0]
    c = f0.calc_center_median()
    if f0.normal.dot(Vector((c.x, c.y - PINUP_CY, 0.0))) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    B.add(bm, "dress_red")
    cap = bmesh.new()
    centre = cap.verts.new((0.0, PINUP_CY, hem_z + 1.2 + flare * 0.15 * (top_z - hem_z)))
    hem = [cap.verts.new(point(len(prof) - 1, 2 * math.pi * j / SEG) + Vector((0, 0, 0.05))) for j in range(SEG)]
    for j in range(SEG):
        cap.faces.new((centre, hem[(j + 1) % SEG], hem[j]))
    cap.normal_update()
    if cap.faces[:][0].normal.z > 0:
        bmesh.ops.reverse_faces(cap, faces=cap.faces)
    B.add(cap, "petticoat")
    # polka dots
    k = 0
    for row, (i_f, n, off) in enumerate(((1.7, 7, 0.0), (2.9, 9, 0.5), (4.1, 11, 0.0), (5.3, 13, 0.5))):
        for j in range(n):
            a = 2 * math.pi * (j + off) / n
            p = point(i_f, a)
            du = point(i_f, a + 0.02) - point(i_f, a - 0.02)
            dv = point(min(len(prof) - 1.001, i_f + 0.05), a) - point(i_f - 0.05, a)
            nrm = du.cross(dv).normalized()
            if nrm.dot(Vector((p.x, p.y - PINUP_CY, 0.0))) < 0:
                nrm = -nrm
            B.add(_lathe([(1.25, 0.0), (0.0, 0.4)], 6, cap_start=False), "petticoat",
                  T(*(p - nrm * 0.08)) @ _aim(nrm))
            k += 1


def _torso_blobs(P, grow=0.0, dress=False):
    g = grow
    P.ellipsoid((0, PINUP_CY, 93.0), (8.3 + g, 6.3 + g, 12.5), "skin")              # waist / abdomen
    P.ellipsoid((0, PINUP_CY + 0.2, 107.0), (12.2 + g, 8.0 + g, 11.5 + g), "skin")   # ribcage
    for s in (-1, 1):
        P.ellipsoid((s * 5.3, PINUP_CY - 6.0, 110.3), (4.9 + g, 4.5 + g, 4.8 + g), "skin")   # bust
    if dress:
        return
    P.ellipsoid((0, PINUP_CY + 0.6, 119.6), (14.6, 5.6, 4.6), "skin")                # shoulder girdle
    P.ellipsoid((0, PINUP_CY + 1.2, 122.6), (6.2, 4.8, 4.2), "skin")                 # neck base
    for s in (-1, 1):
        P.sphere(4.3, (s * 15.4, PINUP_CY, 120.4), "skin", u=12, v=8)                # shoulder caps


def make_pinup(name="roxy"):
    """Classic 1930s pin-up in a red polka-dot halter dress, facing -Y.

    Same contract as make_rocker: origin on the playfield between the shoes
    (x = +-26), free ball tunnel |x| < 18.5 / z < 42, children
    {name}_torso (pivot waist) > {name}_head (pivot neck base) and
    {name}_arm_R (pivot right shoulder; her right is -X, she waves)."""
    X = ROCKER_BOOT_X
    CY = PINUP_CY

    def shift(builder, pivot):
        bmesh.ops.translate(builder.bm, vec=(-pivot[0], -pivot[1], -pivot[2]), verts=builder.bm.verts)

    # ------------------------------------------------------------------ root: shoes, legs, hips, skirt
    def legs(P):
        for s in (-1, 1):
            ankle, knee, hip = Vector((s * X, 6.2, 13.4)), Vector((s * X, 2.4, 44.0)), Vector((s * 8.8, CY + 0.4, 75.5))
            P.ellipsoid((s * X, -2.2, 5.6), (2.9, 7.0, 2.5), "skin", rot=('X', 30))    # instep
            P.sphere(2.9, (s * X, 7.0, 10.0), "skin", u=10, v=8)                         # heel
            _blob_limb(P, ankle, knee, 3.1, 4.5)
            P.ellipsoid((s * X, 5.6, 32.5), (4.6, 4.9, 9.0), "skin")                     # calf
            P.sphere(4.35, tuple(knee), "skin", u=12, v=8)
            _blob_limb(P, knee, hip, 4.6, 7.4)
            P.ellipsoid((s * 17.6, CY + 0.6, 62.5), (6.9, 7.3, 13.0), "skin", rot=('Y', s * -25))
        P.ellipsoid((0, CY + 0.8, 78.0), (13.4, 8.8, 8.0), "skin")                       # pelvis

    B = Builder()
    B.add(_organic(legs, 0.9, smooth=5, tris=1650), "skin")
    for s in (-1, 1):
        _pinup_shoe(B, s)
    B.lathe([(8.5, 85.4), (9.9, 85.4), (9.9, 89.6), (8.5, 89.6)], "black_plastic", segs=24,
            M=T(0, CY, 0) @ S(1.0, 0.74, 1.0), cap_start=False, cap_end=False)          # belt
    B.box((4.6, 1.0, 4.4), (0, CY - 9.9 * 0.74 - 0.2, 87.5), "gold", bevel=0.4)
    B.box((2.2, 0.5, 2.0), (0, CY - 9.9 * 0.74 - 0.8, 87.5), "black_plastic", bevel=0.2)
    root = B.finish(name, sharp_deg=48)

    # ------------------------------------------------------------------ skirt: own part so it can flutter
    # pivot at the waist centre (belt); shape key "flare" = the skirt blown up by a gust
    PS = PINUP_SKIRT_PIVOT
    Sk = Builder()
    _pinup_skirt(Sk)
    shift(Sk, PS)
    skirt_ob = Sk.finish(name + "_skirt", origin=PS, parent=root, sharp_deg=48)
    Sf = Builder()
    _pinup_skirt(Sf, flare=1.0)
    shift(Sf, PS)
    flared = Sf.finish("_skirt_flare_tmp", sharp_deg=48)
    if len(flared.data.vertices) != len(skirt_ob.data.vertices):
        raise RuntimeError("skirt flare shape has a different topology")
    skirt_ob.shape_key_add(name="Basis", from_mix=False)
    key = skirt_ob.shape_key_add(name="flare", from_mix=False)
    for i, v in enumerate(flared.data.vertices):
        key.data[i].co = v.co
    key.value = 0.0
    _remove(flared)

    # ------------------------------------------------------------------ torso (+ her left arm, hand on the hip)
    PT = (0.0, CY, 87.0)
    sh_l, el_l, wr_l = Vector((15.4, CY, 120.4)), Vector((29.5, 7.6, 103.0)), Vector((19.8, 1.0, 87.6))

    def torso(P):
        _torso_blobs(P)
        _blob_limb(P, sh_l, el_l, 4.3, 3.6)
        _blob_limb(P, el_l, wr_l, 3.5, 2.6)
        P.ellipsoid((16.6, -1.0, 84.0), (2.5, 1.9, 3.5), "skin", rot=('Y', 28))         # hand on the hip

    skin_t = _organic(torso, 0.8, smooth=5, tris=2000)
    probe = _Probe(skin_t)
    Tb = Builder()
    Tb.add(skin_t, "skin")

    # fitted bodice: a second, slightly larger skin of the trunk with a crisp sweetheart neckline
    bod = _organic(lambda P: _torso_blobs(P, grow=0.75, dress=True), 0.8, smooth=5, tris=750)
    planes = [((0, 0, 111.0), (-0.85, 0, 1)), ((0, 0, 111.0), (0.85, 0, 1)), ((0, 0, 117.2), (0, 0, 1)),
              ((0, 2.0, 117.2), (0, 1.25, 1)), ((0, 2.0, 0), (0, 1, 0)), ((0, 0, 83.0), (0, 0, 1))]
    for co, no in planes:
        geom = list(bod.verts) + list(bod.edges) + list(bod.faces)
        bmesh.ops.bisect_plane(bod, geom=geom, plane_co=co, plane_no=Vector(no).normalized(),
                               clear_inner=False, clear_outer=False)
    doomed = []
    for f in bod.faces:
        c = f.calc_center_median()
        if c.z < 83.0 or c.z > 117.2:
            doomed.append(f)
        elif c.y <= 2.0 and c.z > 111.0 + 0.85 * abs(c.x):
            doomed.append(f)
        elif c.y > 2.0 and c.z > 117.2 - 1.25 * (c.y - 2.0):
            doomed.append(f)
    bmesh.ops.delete(bod, geom=doomed, context='FACES')
    Tb.add(bod, "dress_red")
    # halter straps from the bust up around the neck
    for s in (-1, 1):
        way = []
        for x, z in ((7.0, 116.2), (6.5, 118.0), (6.0, 119.8), (5.4, 121.4), (4.9, 122.9)):
            loc, nrm = probe.front(s * x, z)
            way.append(tuple(loc + nrm * 0.45))
        way += [(s * 4.3, 2.6, 124.9), (s * 3.3, 6.2, 125.7), (s * 1.6, 7.7, 125.9), (0.0, 8.0, 126.0)]
        Tb.tube(way, 0.95, "dress_red", sides=6)
    probe.free()
    shift(Tb, PT)
    torso_ob = Tb.finish(name + "_torso", origin=PT, parent=root, sharp_deg=55)

    # ------------------------------------------------------------------ head, neck, hair
    PH = (0.0, CY + 1.0, 124.5)

    def head(P):
        P.ellipsoid((0, 2.6, 140.8), (7.6, 9.0, 8.8), "skin")                            # cranium
        P.ellipsoid((0, -1.2, 135.4), (5.9, 6.9, 6.8), "skin")                           # face
        P.ellipsoid((0, -4.9, 130.4), (2.4, 2.6, 2.2), "skin")                           # chin
        for s in (-1, 1):
            P.ellipsoid((s * 3.5, -4.6, 136.1), (2.3, 2.3, 2.0), "skin")                 # cheekbones
        P.ellipsoid((0, -7.7, 137.9), (0.8, 1.3, 2.4), "skin", rot=('X', -14))           # nose bridge
        P.ellipsoid((0, -8.5, 136.3), (1.05, 1.1, 0.9), "skin")                          # nose tip
        _blob_limb(P, Vector((0, CY + 1.4, 118.5)), Vector((0, CY - 0.4, 131.5)), 3.3, 3.0)   # neck

    skin_h = _organic(head, 0.5, smooth=4, tris=1700)
    fp = _Probe(skin_h)
    H = Builder()
    H.add(skin_h, "skin")

    def on_face(x, z, lift=0.0):
        loc, nrm = fp.front(x, z)
        return Vector((x, loc.y - lift, z))

    # eyes: white, iris, upper lash with a wing, softly arched brow
    EZ = 138.9
    for s in (-1, 1):
        ex = s * 2.95
        c = on_face(ex, EZ)
        H.ellipsoid((c.x, c.y + 0.3, c.z), (1.6, 0.58, 1.05), "eye_white", u=10, v=6)
        H.ellipsoid((c.x - s * 0.08, c.y - 0.05, c.z + 0.02), (0.9, 0.36, 0.92), "eye_iris", u=8, v=6)
        H.ellipsoid((c.x - s * 0.08, c.y - 0.3, c.z + 0.02), (0.45, 0.18, 0.47), "eye_dark", u=6, v=4)
        lash = [on_face(ex + s * dx, EZ + dz, 0.12) for dx, dz in ((-1.7, 0.1), (-0.9, 0.95), (0.2, 1.2), (1.2, 0.9), (1.95, 0.5), (2.55, 0.85))]
        H.tube([tuple(p) for p in lash], 0.25, "eye_dark", sides=4)
        brow = [on_face(ex + s * dx, EZ + dz, 0.1) for dx, dz in ((-1.8, 2.75), (-0.5, 3.3), (1.0, 3.45), (2.5, 2.85))]
        H.tube([tuple(p) for p in brow], 0.26, "hair_brown", sides=4)
    # laughing mouth: dark opening, upper teeth, red lips with raised corners
    MZ = 132.7
    m = on_face(0.0, MZ)
    H.ellipsoid((0, m.y + 0.4, MZ - 0.05), (2.1, 0.7, 0.95), "eye_dark", u=10, v=6)
    H.ellipsoid((0, m.y + 0.22, MZ + 0.45), (1.85, 0.45, 0.5), "teeth", u=10, v=5)
    upper, lower = [], []
    for i in range(9):
        u = -1.0 + 2.0 * i / 8
        x = u * 2.55
        zu = MZ + 0.75 + 0.4 * u * u - 0.2 * math.exp(-(u / 0.16) ** 2) + 0.1 * math.exp(-((abs(u) - 0.3) / 0.18) ** 2)
        zl = MZ - 1.2 + 2.35 * u * u
        upper.append(tuple(on_face(x, zu, 0.14)))
        lower.append(tuple(on_face(x, zl, 0.16)))
    H.tube(upper, 0.33, "lips", sides=5)
    H.tube(lower, 0.45, "lips", sides=5)
    fp.free()

    # hair: one organic mass with finger waves, falling in curls to the shoulders
    def hair(P):
        P.ellipsoid((0, 3.9, 142.0), (8.9, 10.0, 9.0), "hair_brown")                     # cap
        P.ellipsoid((3.4, -4.4, 146.9), (6.2, 3.4, 2.7), "hair_brown", rot=('Y', -18))   # side-parted wave over the brow
        P.ellipsoid((-4.6, -3.6, 146.6), (4.2, 3.0, 2.3), "hair_brown", rot=('Y', 22))
        P.ellipsoid((0, 9.4, 132.0), (8.8, 5.2, 10.5), "hair_brown")                     # back
        P.ellipsoid((0, 9.2, 124.2), (9.6, 4.4, 3.4), "hair_brown")                      # roll at the nape
        for s in (-1, 1):
            P.ellipsoid((s * 8.4, 3.6, 135.2), (3.5, 7.2, 8.6), "hair_brown")            # sides
            P.ellipsoid((s * 9.3, 2.6, 127.6), (3.9, 5.8, 4.4), "hair_brown")
            for q, r in (((s * 10.2, -1.8, 126.4), 2.7), ((s * 11.0, 3.0, 124.0), 2.9), ((s * 7.6, 8.4, 122.6), 2.8),
                         ((s * 9.6, -3.0, 130.4), 2.2)):
                P.sphere(r, q, "hair_brown", u=10, v=8)                                  # curls

    hm = _organic(hair, 0.55, smooth=3)
    hm.normal_update()
    for v in hm.verts:
        ang = math.atan2(v.co.x, v.co.y - 3.9)
        front = max(0.0, 1.0 - max(0.0, v.co.z - 143.0) / 5.0)                           # calmer on the crown
        d = 0.5 * math.sin(2 * math.pi * (v.co.z / 4.6 + 0.22 * math.sin(3.0 * ang)))
        v.co += v.normal * d * (0.45 + 0.55 * front)
    tmp = bpy.data.meshes.new("_hair")
    hm.to_mesh(tmp)
    hm.free()
    hob = bpy.data.objects.new("_hair", tmp)
    bpy.context.scene.collection.objects.link(hob)
    tmp.calc_loop_triangles()
    md = hob.modifiers.new("dec", 'DECIMATE')
    md.ratio = min(1.0, 1900 / max(1, len(tmp.loop_triangles)))
    _apply_modifiers(hob)
    hm = bmesh.new()
    hm.from_mesh(hob.data)
    _remove(hob)
    bmesh.ops.recalc_face_normals(hm, faces=hm.faces)
    H.add(hm, "hair_brown")
    # red flower above her left ear
    fc = Vector((8.3, -3.6, 144.8))
    out = Vector((0.72, -0.62, 0.3)).normalized()
    Q = _aim(out)
    for k in range(5):
        a = 2 * math.pi * k / 5
        H.add(_sphere(1.0, 8, 6), "flower_red", T(*fc) @ Q @ R('Z', math.degrees(a)) @ T(1.55, 0, 0.25) @ S(1.5, 1.05, 0.5))
    H.add(_sphere(0.85, 8, 6), "gold", T(*(fc + out * 0.55)))
    shift(H, PH)
    H.finish(name + "_head", origin=tuple(Vector(PH) - Vector(PT)), parent=torso_ob, sharp_deg=62)

    # ------------------------------------------------------------------ her right arm (-X): a cheerful wave
    PA = (-15.4, CY, 120.4)
    sh, el, wr = Vector(PA), Vector((-28.0, 2.4, 126.2)), Vector((-30.6, 0.6, 143.2))
    palm = Vector((-31.0, 0.0, 148.6))

    def arm(P):
        P.sphere(4.4, tuple(sh), "skin", u=12, v=8)
        _blob_limb(P, sh, el, 4.3, 3.6)
        _blob_limb(P, el, wr, 3.5, 2.5)
        P.ellipsoid(tuple(palm), (3.0, 1.35, 3.7), "skin")
        for i, dx in enumerate((-2.25, -0.75, 0.75, 2.25)):
            ln = (5.6, 6.6, 6.2, 4.9)[i]
            base = palm + Vector((dx, 0.0, 2.6))
            tip = base + Vector((dx * 0.42, -0.5, ln))
            P.add(_limb(base, tip, 0.98, 0.82, 8), "skin")
            P.sphere(0.82, tuple(tip), "skin", u=8, v=6)
        tb = palm + Vector((2.7, -0.2, -1.4))
        tt = tb + Vector((2.6, -0.6, 3.4))
        P.add(_limb(tb, tt, 1.05, 0.85, 8), "skin")
        P.sphere(0.85, tuple(tt), "skin", u=8, v=6)

    Ar = Builder()
    Ar.add(_organic(arm, 0.42, smooth=2, tris=850), "skin")
    shift(Ar, PA)
    Ar.finish(name + "_arm_R", origin=tuple(Vector(PA) - Vector(PT)), parent=torso_ob, sharp_deg=62)

    _rocker_check(root, "pinup")
    return root


ALL_ASSETS = {
    "skull": make_skull,
    "bumper": make_bumper,
    "flipper": make_flipper,
    "droptarget": make_drop_target,
    "post": make_post,
    "laneguide": make_lane_guide,
    "spinner": make_spinner,
    "gate": make_gate,
    "plunger": make_plunger,
    "amp": make_amp_stack,
    "tesla": make_tesla_coil,
    "flamepot": make_flame_pot,
    "guitar": make_guitar,
    "logo": make_logo,
    "par": make_par_can,
    "rocker": make_rocker,
    "pinup": make_pinup,
    "bolt": make_bolt,
}

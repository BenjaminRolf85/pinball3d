"""RIFFGEWITTER material library.

`mat(name)` returns a Principled-BSDF material, creating it on first use.
Only base colour, metallic, roughness and emission are used so that every
material survives the glTF export unchanged (emission strength is written as
KHR_materials_emissive_strength).
"""
import bpy

EMISSION_STRENGTH = 4.0


def _grey(v):
    return (v, v, v)


# name: (base colour, metallic, roughness, emission colour or None)
SPECS = {
    "chrome":        ((0.90, 0.90, 0.92), 1.0, 0.08, None),
    "chrome_dark":   (_grey(0.45),        1.0, 0.20, None),
    "steel":         (_grey(0.55),        1.0, 0.35, None),
    "steel_dark":    (_grey(0.12),        1.0, 0.45, None),
    "black_plastic": (_grey(0.02),        0.0, 0.35, None),
    "tolex":         (_grey(0.015),       0.0, 0.80, None),
    "grille":        (_grey(0.03),        0.0, 0.90, None),
    "rubber_black":  (_grey(0.02),        0.0, 0.70, None),
    "rubber_red":    ((0.60, 0.02, 0.02), 0.0, 0.70, None),
    "copper":        ((0.95, 0.50, 0.25), 1.0, 0.25, None),
    "gold":          ((1.00, 0.75, 0.30), 1.0, 0.20, None),
    "red_paint":     ((0.60, 0.02, 0.02), 0.3, 0.30, None),
    "orange_paint":  ((0.90, 0.25, 0.02), 0.3, 0.30, None),
    "white_plastic": ((0.90, 0.90, 0.85), 0.0, 0.40, None),
    "wood_dark":     ((0.08, 0.04, 0.02), 0.0, 0.60, None),
    "cone":          (_grey(0.05),        0.0, 0.85, None),
    "skin":          ((0.85, 0.60, 0.48), 0.0, 0.50, None),
    "hair_red":      ((0.75, 0.08, 0.02), 0.2, 0.40, None),
    "leather":       (_grey(0.02),        0.0, 0.30, None),
    "lips":          ((0.70, 0.02, 0.05), 0.0, 0.30, None),
    "teeth":         (_grey(0.90),        0.0, 0.30, None),
    "hair_brown":    ((0.115, 0.04, 0.022), 0.0, 0.34, None),
    "dress_red":     ((0.62, 0.03, 0.05), 0.0, 0.45, None),
    "shoe_red":      ((0.55, 0.02, 0.04), 0.0, 0.16, None),
    "eye_dark":      (_grey(0.015),       0.0, 0.35, None),
    "eye_white":     (_grey(0.93),        0.0, 0.30, None),
    "eye_iris":      ((0.10, 0.22, 0.30), 0.0, 0.25, None),
    "flower_red":    ((0.85, 0.04, 0.07), 0.0, 0.50, None),
    "petticoat":     ((0.92, 0.90, 0.86), 0.0, 0.60, None),
    "glow_red":      (_grey(0.0),         0.0, 0.50, (1.00, 0.05, 0.02)),
    "glow_orange":   (_grey(0.0),         0.0, 0.50, (1.00, 0.35, 0.05)),
    "glow_blue":     (_grey(0.0),         0.0, 0.50, (0.30, 0.70, 1.00)),
    "glow_white":    (_grey(0.0),         0.0, 0.50, (1.00, 1.00, 1.00)),
    "glow_amber":    (_grey(0.0),         0.0, 0.50, (1.00, 0.65, 0.10)),
}


def _principled(m):
    """Return the material's Principled BSDF node, building the tree if needed."""
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return bsdf


def mat(name):
    """Return the named library material (created on demand)."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    spec = SPECS.get(name)
    if spec is None:
        raise KeyError(
            "Unknown material '%s'. Known materials: %s" % (name, ", ".join(sorted(SPECS)))
        )
    color, metallic, roughness, emission = spec
    m = bpy.data.materials.new(name)
    bsdf = _principled(m)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = EMISSION_STRENGTH
    else:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    m.diffuse_color = (*(emission or color), 1.0)
    m.metallic = metallic
    m.roughness = roughness
    return m


def all_names():
    return sorted(SPECS)

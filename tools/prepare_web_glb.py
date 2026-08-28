"""Prepare the authored mascot GLB for a browser-focused compression pass.

Run with Blender:
  blender --background --python tools/prepare_web_glb.py -- input.glb output.glb

This script intentionally does not simplify geometry or modify animation data.
It limits embedded texture dimensions and lets Blender re-encode them as WebP.
"""

import bpy
import sys
from pathlib import Path


args = sys.argv[sys.argv.index("--") + 1 :]
source = Path(args[0]).resolve()
destination = Path(args[1]).resolve()
max_texture_size = int(args[2]) if len(args) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

for image in bpy.data.images:
    width, height = image.size
    if not width or not height or max(width, height) <= max_texture_size:
        continue
    scale = max_texture_size / max(width, height)
    image.scale(max(1, round(width * scale)), max(1, round(height * scale)))

destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(destination),
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=False,
    export_optimize_animation_size=True,
    export_morph=True,
    export_morph_animation=False,
    export_morph_normal=False,
    export_morph_tangent=False,
    export_image_format="WEBP",
    export_image_quality=78,
    export_keep_originals=False,
    export_tangents=False,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)

print(f"WEB_GLB={destination}")
print(f"MAX_TEXTURE={max_texture_size}")

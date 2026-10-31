# Stylized Nature MegaKit (source)

`public/models/megakit.glb` is built from Quaternius' free **Stylized Nature MegaKit** (Standard), CC0 1.0.
The 99 MB download isn't kept in git. To rebuild:

1. Download `Stylized Nature MegaKit[Standard].zip` from https://quaternius.itch.io/stylized-nature-megakit
   (name your own price; $0 works) into this folder.
2. `unzip "Stylized Nature MegaKit[Standard].zip" 'glTF/*' License_Standard.txt -d unzipped`
3. `blender -b --factory-startup --python tools/blender/prepare_megakit.py`

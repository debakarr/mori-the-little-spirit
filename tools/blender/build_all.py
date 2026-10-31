"""Headless rebuild of every procedural asset:
    blender -b --factory-startup --python tools/blender/build_all.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_ancient_tree, build_props, build_forest_kit

print("ASSETS", build_ancient_tree.build(), build_props.build_all(), build_forest_kit.build())

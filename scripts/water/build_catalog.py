#!/usr/bin/env python3
"""Stream source vector files into immutable, indexed WGS84 FlatGeobuf releases."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile


def build(config_path, output):
    import fiona
    from fiona.transform import transform_geom
    from shapely.geometry import shape, mapping, MultiPolygon, MultiLineString

    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text())
    version = config['version']
    if not version or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-' for c in version):
        raise ValueError('Use a safe, immutable release version.')
    destination = Path(output).resolve() / version
    destination.mkdir(parents=True, exist_ok=False)
    manifest = {'schemaVersion': 1, 'version': version, 'datasets': []}
    for spec in config['datasets']:
        source = spec['id']
        if source not in ['osm', 'hydrolakes', 'grwl', 'coastline']:
            raise ValueError('Unknown water source')
        for key in ['version', 'attribution', 'license', 'sourceUrl', 'category']:
            if not spec.get(key):
                raise ValueError(f'Missing {key} for {source}')
        input_path = spec['input']
        if not input_path.startswith(('/vsi', 'zip://')):
            input_path = str((config_path.parent / input_path).resolve())
        output_path = destination / f"{spec.get('name', source)}.fgb"
        if output_path.parent != destination or output_path.exists():
            raise ValueError('Use a unique dataset name without directory separators')
        geometry_type = 'MultiLineString' if spec['category'] == 'river' and source == 'grwl' else 'MultiPolygon'
        schema = {'geometry': geometry_type, 'properties': {
            'source_id': 'str', 'name': 'str', 'category': 'str', 'width_m': 'float', 'complete': 'int', 'original_id': 'str'}}
        count = 0
        with tempfile.TemporaryDirectory(prefix='trailprint-water-') as scratch:
            ids = sqlite3.connect(str(Path(scratch) / 'ids.sqlite'))
            ids.execute('CREATE TABLE ids (id TEXT PRIMARY KEY)')
            with fiona.open(input_path, layer=spec.get('layer')) as src, fiona.open(str(output_path), 'w', driver='FlatGeobuf',
                    schema=schema, crs='EPSG:4326', SPATIAL_INDEX='YES', TEMPORARY_DIR=scratch,
                    TITLE=f"{source} {spec['version']}", DESCRIPTION=f"{spec['attribution']}; {spec['license']}; {spec['sourceUrl']}") as dst:
                if not src.crs:
                    raise ValueError(f'{source} source has no coordinate reference system')
                # Never clip at a shard boundary: keep the complete outline and islands.
                # Bounds can select input features in their native CRS, if needed.
                records = src.filter(bbox=tuple(spec['inputBounds'])) if spec.get('inputBounds') else src
                for feature in records:
                    geometry = transform_geom(src.crs, 'EPSG:4326', feature['geometry'])
                    value = shape(geometry)
                    if value.is_empty or not value.is_valid:
                        raise ValueError(f"Invalid {source} geometry at source record {feature.id}")
                    if geometry_type == 'MultiPolygon' and value.geom_type == 'Polygon':
                        value = MultiPolygon([value])
                    if geometry_type == 'MultiLineString' and value.geom_type == 'LineString':
                        value = MultiLineString([value])
                    if value.geom_type != geometry_type:
                        raise ValueError(f'{source} expects {geometry_type}; use vector river centerlines, not GRWL pixel points')
                    properties = feature['properties']
                    original_id = properties.get(spec.get('idField', 'source_id'))
                    if original_id is None:
                        if source != 'coastline':
                            raise ValueError(f"Missing stable ID field {spec.get('idField', 'source_id')}")
                        # Processed coast polygons have no single OSM way ID. Keep a
                        # geometry-derived ID, plus the original dataset record ID.
                        stable_id = hashlib.sha256(value.normalize().wkb).hexdigest()
                        original_id = feature.id
                    else:
                        stable_id = str(original_id)
                    ids.execute('INSERT INTO ids VALUES (?)', (stable_id,))
                    width = properties.get(spec.get('widthField', 'width_m'))
                    width = float(width) if width is not None else None
                    if width is not None and (not math.isfinite(width) or width <= 0):
                        raise ValueError(f'Invalid river width in {stable_id}')
                    dst.write({'geometry': mapping(value), 'properties': {
                        'source_id': stable_id, 'original_id': str(original_id),
                        'name': str(properties.get(spec.get('nameField', 'name')) or ''),
                        'category': spec['category'], 'width_m': width, 'complete': 1}})
                    count += 1
            ids.close()
        if not count:
            raise ValueError(f'{source} dataset is empty')
        # Full post-write validation; the manifest is created only after all pass.
        with fiona.open(str(output_path), VERIFY_BUFFERS='YES') as verified:
            bounds = verified.bounds
            if len(verified) != count:
                raise ValueError('Feature count changed during conversion')
            for feature in verified:
                if not shape(feature['geometry']).is_valid:
                    raise ValueError('Invalid geometry in the generated FlatGeobuf')
        digest = hashlib.sha256()
        with output_path.open('rb') as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                digest.update(chunk)
        manifest['datasets'].append({key: spec[key] for key in ['id', 'version', 'attribution', 'license', 'sourceUrl']})
        manifest['datasets'][-1].update({'url': f'{version}/{output_path.name}', 'sha256': digest.hexdigest(),
            'bytes': output_path.stat().st_size, 'featureCount': count,
            'bounds': dict(zip(['minLon', 'minLat', 'maxLon', 'maxLat'], bounds))})
        print(f'{source}: {count} complete features → {output_path.name}')
    candidate = Path(output).resolve() / f'manifest-{version}.json'
    candidate.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Candidate: {candidate}. Validate HTTP range access before publishing manifest.json.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='Source configuration JSON')
    parser.add_argument('--output', required=True, help='Local release directory')
    args = parser.parse_args()
    build(args.config, args.output)

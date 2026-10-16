import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = await build({
  stdin: { contents: "export { payloadToBufferGeometry } from './src/utils/terrain-mesh-three';", resolveDir: resolve('.') },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: 'tsconfig.web.json',
});
const directory = await mkdtemp(join(tmpdir(), 'trailprint-preview-geometry-'));
after(() => rm(directory, { recursive: true, force: true }));
await writeFile(join(directory, 'preview.mjs'), compiled.outputFiles[0].contents);
const { payloadToBufferGeometry } = await import(pathToFileURL(join(directory, 'preview.mjs')).href);
const metadata = { bottomZ: 0, minSurfaceZ: 0, gridCols: 0, gridRows: 0 };

test('engraving floors and vertical walls keep distinct face normals at shared corners', () => {
  const mesh = { ...metadata,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0.6, 1, 0, 0.6],
    indices: [0, 1, 2, 1, 3, 2, 0, 4, 1, 1, 4, 5],
  };
  const geometry = payloadToBufferGeometry(mesh, { hardEdges: true });
  try {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const count = index?.count ?? positions.count;
    for (let i = 0; i < count; i++) {
      const vertex = index ? index.getX(i) : i;
      const expected = i < 6 ? [0, 0, 1] : [0, 1, 0];
      assert.ok(Math.abs(normals.getX(vertex) - expected[0]) < 1e-6);
      assert.ok(Math.abs(normals.getY(vertex) - expected[1]) < 1e-6);
      assert.ok(Math.abs(normals.getZ(vertex) - expected[2]) < 1e-6);
    }
  } finally { geometry.dispose(); }
});

test('gentle terrain facets still share smooth normals with sharp-edge rendering', () => {
  const geometry = payloadToBufferGeometry({ ...metadata,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.3], indices: [0, 1, 2, 1, 3, 2],
  }, { hardEdges: true });
  try {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const shared = [];
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) === 1 && positions.getY(i) === 0) shared.push([normals.getX(i), normals.getY(i), normals.getZ(i)]);
    }
    assert.equal(shared.length, 2);
    assert.deepEqual(shared[0], shared[1]);
    assert.ok(shared[0][0] < 0 && shared[0][2] < 1 && shared[0][2] > 0.9);
  } finally { geometry.dispose(); }
});

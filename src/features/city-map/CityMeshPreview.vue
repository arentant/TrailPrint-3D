<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CityGenerateResponse } from '@shared/types/city';
import type { ModelColors } from '@shared/types/model-colors';
import { payloadToBufferGeometry } from '@/utils/terrain-mesh-three';
const props = defineProps<{ result: CityGenerateResponse; colors: ModelColors }>();
const container = ref<HTMLDivElement | null>(null);
const error = ref<string | null>(null);
let renderer: THREE.WebGLRenderer | undefined;
let controls: OrbitControls | undefined;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let group: THREE.Group | undefined;
let observer: ResizeObserver | undefined;
let frame = 0;
let cityMaterial: THREE.MeshStandardMaterial | undefined;
let routeMaterial: THREE.MeshStandardMaterial | undefined;
function disposeGroup() {
  group?.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((m) => m.dispose()); } });
  if (group) scene.remove(group);
  group = undefined;
  cityMaterial = undefined;
  routeMaterial = undefined;
}
function build(resetView = false) {
  if (!renderer) return;
  disposeGroup();
  group = new THREE.Group();
  // Shared assembly coordinates are preserved, with Z up in the source meshes.
  group.rotation.x = -Math.PI / 2;
  cityMaterial = new THREE.MeshStandardMaterial({ color: props.colors.terrain, roughness: 0.8, flatShading: true });
  routeMaterial = new THREE.MeshStandardMaterial({ color: props.colors.trail, roughness: 0.5 });
  group.add(new THREE.Mesh(payloadToBufferGeometry(props.result.cityMesh, { hardEdges: true }), cityMaterial));
  group.add(new THREE.Mesh(payloadToBufferGeometry(props.result.routeMesh, { hardEdges: true }), routeMaterial));
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 20);
  camera.near = 0.1; camera.far = span * 30; camera.updateProjectionMatrix();
  if (resetView) {
    camera.position.copy(center).add(new THREE.Vector3(span * 0.85, span * 1.1, span * 1.1));
    controls!.target.copy(center);
  }
  controls!.update();
}
onMounted(() => {
  try {
    const el = container.value!;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0xf4f5f1);
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b968d, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(100, 200, 70); scene.add(light);
    observer = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer!.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
    observer.observe(el); build(true);
    const animate = () => { frame = requestAnimationFrame(animate); controls!.update(); renderer!.render(scene, camera); }; animate();
  } catch { error.value = '3D preview is unavailable on this device. The finalized STL files can still be downloaded.'; }
});
watch(() => props.result, () => build());
watch(() => props.colors, (colors) => {
  cityMaterial?.color.set(colors.terrain);
  routeMaterial?.color.set(colors.trail);
}, { deep: true });
onUnmounted(() => { cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); disposeGroup(); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); renderer = undefined; });
</script>
<template><div ref="container" class="city-mesh"><p v-if="error" role="status">{{ error }}</p></div></template>
<style scoped>.city-mesh { position: relative; flex: 1; min-height: 200px; overflow: hidden; border-radius: 12px; }.city-mesh :deep(canvas) { display: block; } p { padding: 24px; }</style>

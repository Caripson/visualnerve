import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GameEntity } from '../types';

interface PreviewScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  world: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  meshes: THREE.Mesh[];
  center: THREE.Vector3;
  distance: number;
  placed: boolean;
}
function disposeWorld(world: THREE.Group) {
  world.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: THREE.Material) => material.dispose());
    }
  });
  world.clear();
}
function fitView(state: PreviewScene, kind: 'orbit' | 'top' | 'front') {
  const { camera, center, distance, controls } = state;
  camera.up.set(0, 1, 0);
  camera.position
    .copy(center)
    .add(
      kind === 'top'
        ? new THREE.Vector3(0, distance, 0.001)
        : kind === 'front'
          ? new THREE.Vector3(0, distance * 0.1, distance)
          : new THREE.Vector3(distance * 0.7, distance * 0.65, distance * 0.7),
    );
  controls.target.copy(center);
  controls.update();
}

/** World geometry uses Roblox studs. This view does not simulate Roblox physics. */
export function WorldPreview({
  entities,
  selected,
  select,
}: {
  entities: GameEntity[];
  selected?: string;
  select: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<PreviewScene | undefined>(undefined);
  const [error, setError] = useState('');
  const current = useRef({ select });
  current.current = { select };
  // Keep one WebGL context across edits and autosave acknowledgements. Recreating it for
  // every numeric change can stall software renderers and lose the user's camera view.
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        'Your browser cannot show the 3D world here. Every object is still available in the list and position fields.',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0b1425, 1);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    target.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    scene.add(world, new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(40, 80, 20);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 300000;
    const state: PreviewScene = {
      renderer,
      scene,
      world,
      camera,
      controls,
      meshes: [],
      center: new THREE.Vector3(),
      distance: 40,
      placed: false,
    };
    controller.current = state;
    const resize = () => {
      const width = target.clientWidth || 400,
        height = target.clientHeight || 300;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
    observer?.observe(target);
    const raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let start: { x: number; y: number } | undefined;
    const down = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(state.meshes, false)[0];
      if (hit) current.current.select(hit.object.userData.entityId as string);
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls.dispose();
      disposeWorld(world);
      controller.current = undefined;
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    const state = controller.current;
    if (!state) return;
    disposeWorld(state.world);
    state.meshes = [];
    const bounds = new THREE.Box3();
    for (const entity of entities) {
      const geometry = new THREE.BoxGeometry(
        entity.transform.size.x,
        entity.transform.size.y * (entity.kind === 'npc' ? 0.65 : 1),
        entity.transform.size.z,
      );
      const material = new THREE.MeshStandardMaterial({
        color: entity.color,
        roughness: entity.material === 'Metal' ? 0.25 : 0.7,
        metalness: entity.material === 'Metal' ? 0.7 : 0,
        transparent: !entity.visible || !entity.enabled || entity.material === 'Glass',
        opacity: !entity.enabled
          ? 0.2
          : !entity.visible
            ? 0.18
            : entity.material === 'Glass'
              ? 0.55
              : 1,
        emissive: entity.material === 'Neon' ? entity.color : 0,
        emissiveIntensity: 0.5,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        entity.transform.position.x,
        entity.transform.position.y,
        entity.transform.position.z,
      );
      mesh.rotation.set(
        THREE.MathUtils.degToRad(entity.transform.rotation.x),
        THREE.MathUtils.degToRad(entity.transform.rotation.y),
        THREE.MathUtils.degToRad(entity.transform.rotation.z),
        'YXZ',
      );
      mesh.userData.entityId = entity.id;
      state.world.add(mesh);
      state.meshes.push(mesh);
      if (entity.kind === 'npc') {
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(
            entity.transform.size.x * 0.65,
            entity.transform.size.y * 0.35,
            entity.transform.size.z * 0.8,
          ),
          material.clone(),
        );
        head.position.y = entity.transform.size.y * 0.5;
        head.userData.entityId = entity.id;
        mesh.add(head);
        state.meshes.push(head);
      }
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: entity.id === selected ? 0xffffff : 0xadc2e4,
          transparent: true,
          opacity: entity.id === selected ? 1 : 0.35,
        }),
      );
      mesh.add(outline);
      bounds.expandByObject(mesh);
      if (entity.movement) {
        const endpoint = mesh.position
          .clone()
          .add(
            new THREE.Vector3(
              entity.movement.offset.x,
              entity.movement.offset.y,
              entity.movement.offset.z,
            ),
          );
        const path = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([mesh.position, endpoint]),
          new THREE.LineDashedMaterial({ color: 0x71d9da, dashSize: 1, gapSize: 0.6 }),
        );
        path.computeLineDistances();
        state.world.add(path);
        bounds.expandByPoint(endpoint);
      }
    }
    const size = bounds.isEmpty()
      ? new THREE.Vector3(30, 10, 30)
      : bounds.getSize(new THREE.Vector3());
    state.center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    state.distance = Math.max(size.length() * 1.3, 40);
    const extent = Math.min(Math.max(Math.ceil(Math.max(size.x, size.z) / 20) * 20, 60), 4000);
    const grid = new THREE.GridHelper(extent, Math.min(extent / 5, 200), 0x7397b2, 0x233c58);
    grid.position.set(state.center.x, 0, state.center.z);
    state.world.add(grid);
    if (!state.placed) {
      fitView(state, 'orbit');
      state.placed = true;
    }
  }, [entities, selected]);
  const view = (kind: 'orbit' | 'top' | 'front') => {
    if (controller.current) fitView(controller.current, kind);
  };
  return (
    <section className="roblox-world" aria-label="World geometry preview">
      <div
        className="roblox-world-canvas"
        ref={container}
        aria-label="3D world. Select objects using the list below."
      />
      {error && (
        <p role="status" className="roblox-preview-error">
          {error}
        </p>
      )}
      <div className="roblox-actions">
        <button onClick={() => view('orbit')} disabled={!!error}>
          3D view
        </button>
        <button onClick={() => view('top')} disabled={!!error}>
          Top view
        </button>
        <button onClick={() => view('front')} disabled={!!error}>
          Front view
        </button>
      </div>
      <p className="roblox-hint">
        Drag to orbit · pinch or scroll to zoom · select an object in the list for keyboard editing.
        This previews placement; play and test physics in Roblox Studio.
      </p>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Edge } from '@xyflow/react';
import { ArrowLeft, Focus, Maximize, RotateCcw } from 'lucide-react';
import type { Graph } from '../model/types';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { getSpatialView, spatialLimits, type SpatialCamera, type SpatialPoint } from './types';
import {
  defaultSpatialCamera,
  orientationCamera,
  spatialBounds,
  projectSpatialGraph,
} from './layout';
import {
  boundedSpatialProjection,
  createSpatialBatches,
  selectSpatialBatches,
  spatialIntersectionIdentity,
  type SpatialBatches,
  disposeSpatialScene,
  isCompletedStatus,
  SPATIAL_LABEL_LIMIT,
  spatialNodeDimensions,
  spatialNodeAppearance,
  spatialTextPlane,
  setSpatialFaceOpacity,
  setSpatialNodeFaceCaptured,
} from './scene';
import './spatial.css';
import { captureSpatialNodeFaces } from './faces';
import { NavigationGizmo } from './NavigationGizmo';
import {
  navigateSpatialCamera,
  type SpatialNavigationAxis,
  type SpatialNavigationMode,
} from './navigation';

export interface SpatialCanvasProps {
  graph: Graph;
  nodes: CanvasNode[];
  edges: Edge[];
  onReturnTo2D: () => void;
  onCameraChange: (camera: SpatialCamera) => void;
}
type Bounds = ReturnType<typeof spatialBounds>;
type FaceMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
function faceCorners(face: FaceMesh, camera: THREE.Camera, width: number, height: number) {
  const size = face.geometry.parameters;
  return [
    [-size.width / 2, size.height / 2],
    [size.width / 2, size.height / 2],
    [size.width / 2, -size.height / 2],
    [-size.width / 2, -size.height / 2],
  ].map(([x, y]) => {
    const point = new THREE.Vector3(x, y, 0).applyMatrix4(face.matrixWorld).project(camera);
    return [((point.x + 1) * width) / 2, ((1 - point.y) * height) / 2];
  });
}
function capturedCardColor(source: HTMLCanvasElement) {
  const sample = document.createElement('canvas');
  sample.width = sample.height = 16;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  const colors = new Map<string, { rgb: number[]; count: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 240) continue;
    const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const key = rgb.join(',');
    const existing = colors.get(key);
    colors.set(key, { rgb, count: (existing?.count ?? 0) + 1 });
  }
  const dominant = [...colors.values()].sort((a, b) => b.count - a.count)[0];
  return dominant
    ? new THREE.Color().setRGB(
        dominant.rgb[0] / 255,
        dominant.rgb[1] / 255,
        dominant.rgb[2] / 255,
        THREE.SRGBColorSpace,
      )
    : undefined;
}
interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  root: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bounds: Bounds;
  positions: Map<string, SpatialPoint>;
  pickable: THREE.Object3D[];
  batches?: SpatialBatches;
  labelLayer: THREE.Group;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  initialized: boolean;
  glyphScale: number;
  lastSavedCamera?: string;
  draw: () => void;
  setCamera: (camera: SpatialCamera, persist?: boolean) => void;
  saveCamera: () => void;
  queueCamera: () => void;
  flushCamera: () => void;
  refreshFaces: () => void;
  captureAbort?: AbortController;
}
function cameraValue(runtime: Runtime): SpatialCamera {
  const point = (value: THREE.Vector3) => ({
    x: Number(value.x.toFixed(5)),
    y: Number(value.y.toFixed(5)),
    z: Number(value.z.toFixed(5)),
  });
  const value: SpatialCamera = {
    position: point(runtime.camera.position),
    target: point(runtime.controls.target),
  };
  if (runtime.camera.up.distanceToSquared(new THREE.Vector3(0, 1, 0)) > 0.0000000001)
    value.up = point(runtime.camera.up.clone().normalize());
  return value;
}
function colorValue(value: unknown, fallback: string) {
  return typeof value === 'string' && CSS.supports('color', value) ? value : fallback;
}
function compareLabelDepth(a: number | undefined, b: number | undefined) {
  const left = a ?? Infinity,
    right = b ?? Infinity;
  return left === right ? 0 : left - right;
}
function focusSpatialObjects(current: Runtime, ids: string[]) {
  const chosen = ids.flatMap((id) => {
    const instance = current.batches?.nodes.get(id);
    if (!instance) return [];
    const { position, dimensions } = instance;
    return [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => ({
        x: position.x + (x * dimensions.x) / 2,
        y: position.y + (y * dimensions.y) / 2,
        z: position.z,
      })),
    );
  });
  if (!chosen.length) return;
  const value = spatialBounds(chosen);
  const offset = current.camera.position
    .clone()
    .sub(current.controls.target)
    .normalize()
    .multiplyScalar(Math.max(2.4 * current.glyphScale, value.radius * 3.2));
  current.setCamera(
    {
      position: {
        x: value.center.x + offset.x,
        y: value.center.y + offset.y,
        z: value.center.z + offset.z,
      },
      target: value.center,
      ...(cameraValue(current).up ? { up: cameraValue(current).up } : {}),
    },
    true,
  );
}

export function SpatialCanvas(props: SpatialCanvasProps) {
  const { graph, nodes, edges } = props;
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const selectedEdges = useEditor((state) => state.selectedEdges);
  const focusNode = useEditor((state) => state.focusNode);
  const propsRef = useRef(props);
  propsRef.current = props;
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const [rendererState, setRendererState] = useState<'starting' | 'ready' | 'unavailable' | 'lost'>(
    'starting',
  );
  const [listQuery, setListQuery] = useState('');
  const [listPage, setListPage] = useState(0);
  const [relationshipPage, setRelationshipPage] = useState(0);
  const [relationshipQuery, setRelationshipQuery] = useState('');
  const [showLabels, setShowLabels] = useState(true);
  const [faceRevision, setFaceRevision] = useState(0);
  const [faceCaptureError, setFaceCaptureError] = useState('');
  const [faceCaptureBusy, setFaceCaptureBusy] = useState(false);
  const [renderedCounts, setRenderedCounts] = useState({ nodes: 0, edges: 0 });
  const [navigationCamera, setNavigationCamera] = useState<SpatialCamera>();
  const view = getSpatialView(graph);
  const visibleNodes = useMemo(() => nodes.filter((node) => !node.hidden), [nodes]);
  const visibleEdges = useMemo(() => edges.filter((edge) => !edge.hidden), [edges]);
  const projected = useMemo(
    () =>
      boundedSpatialProjection(
        nodes,
        edges,
        focusNode ? [...selectedNodes, focusNode] : selectedNodes,
        selectedEdges,
      ),
    [nodes, edges, selectedNodes, selectedEdges, focusNode],
  );
  const relief = useMemo(
    () => projectSpatialGraph(graph),
    [graph.nodes, graph.edges, graph.diagram.type],
  );
  const positions = relief.positions;
  const bounds = useMemo(
    () =>
      spatialBounds(
        projected.nodes.flatMap((node) => {
          const position = positions.get(node.id);
          if (!position) return [];
          const { width, height, depth } = spatialNodeDimensions(node, relief.scale);
          return [-1, 1].flatMap((x) =>
            [-1, 1].flatMap((y) =>
              [-1, 1].map((z) => ({
                x: position.x + (x * width) / 2,
                y: position.y + (y * height) / 2,
                z: position.z + (z * depth) / 2,
              })),
            ),
          );
        }),
      ),
    [positions, projected.nodes, relief.scale],
  );
  // Selection and camera changes do not recreate geometry, materials, labels or GPU buffers.
  const sceneKey = JSON.stringify([
    projected.nodes
      .map((node) => [
        node.id,
        node.data.node.title,
        node.data.node.color,
        node.data.mindmap?.color,
        node.data.mindmap?.depth,
        node.data.node.status,
        node.data.node.nodeType,
        node.width,
        node.height,
        node.data.node.metadata.spatial,
        node.data.node.metadata,
        node.data.owners,
        node.style?.opacity,
        node.className,
        positions.get(node.id),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    projected.edges
      .map((edge) => [
        edge.id,
        edge.source,
        edge.target,
        edge.label,
        edge.markerStart,
        edge.markerEnd,
        edge.style,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
  const modelRef = useRef({ projected, positions, bounds, showLabels, scale: relief.scale });
  modelRef.current = { projected, positions, bounds, showLabels, scale: relief.scale };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const diagramId = graph.diagram.id;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setRendererState('unavailable');
      return;
    }
    const canvas = renderer.domElement;
    canvas.dataset.testid = 'spatial-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Interactive 3D diagram. Drag to rotate, scroll to zoom.');
    canvas.setAttribute('aria-describedby', 'spatial-instructions');
    container.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    camera.up.set(0, 1, 0);
    let controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.minDistance = 0.2;
    controls.maxDistance = spatialLimits.cameraCoordinate;
    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight('#ffffff', '#6e8290', 2));
    const light = new THREE.DirectionalLight('#ffffff', 2.4);
    light.position.set(-3, 5, 7);
    scene.add(light);
    const fill = new THREE.DirectionalLight('#bccddf', 1.2);
    fill.position.set(4, 0, -4);
    scene.add(fill);
    let frame = 0;
    let disposed = false;
    let lost = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const current: Runtime = {
      renderer,
      scene,
      root,
      camera,
      controls,
      bounds: modelRef.current.bounds,
      positions: new Map(),
      pickable: [],
      labelLayer: new THREE.Group(),
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set(),
      initialized: false,
      glyphScale: 1,
      draw: () => {
        if (disposed || lost || frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!disposed && !lost) {
            // Controls change the camera quaternion before Three updates its world matrix.
            // Label projection must use the same orientation as this frame's geometry.
            camera.updateMatrixWorld(true);
            root.updateMatrixWorld(true);
            const width = Math.max(1, canvas.clientWidth);
            const height = Math.max(1, canvas.clientHeight);
            const labels = current.labelLayer.children.filter(
              (object): object is FaceMesh => object instanceof THREE.Mesh,
            );
            for (const object of labels) {
              const corners = faceCorners(object, camera, width, height);
              const center = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
              const normal = new THREE.Vector3(0, 0, 1).transformDirection(object.matrixWorld);
              const front = normal.dot(camera.position.clone().sub(center)) > 0;
              const projected = center.clone().project(camera);
              object.visible =
                front &&
                projected.z > -1 &&
                projected.z < 1 &&
                Math.min(...corners.map(([x]) => x)) < width &&
                Math.max(...corners.map(([x]) => x)) > 0 &&
                Math.min(...corners.map(([, y]) => y)) < height &&
                Math.max(...corners.map(([, y]) => y)) > 0;
            }
            canvas.dataset.visibleLabels = String(labels.filter((label) => label.visible).length);
            canvas.dataset.nodeFaces = 'relief';
            const nodeFaces = labels.filter((face) => face.userData.nodeId);
            const captured = nodeFaces.filter(
              (face) => face.userData.faceSource === '2d-node',
            ).length;
            canvas.dataset.faceCaptures = String(captured);
            canvas.dataset.faceSource =
              nodeFaces.length && captured === nodeFaces.length
                ? '2d-node'
                : nodeFaces.length
                  ? 'loading'
                  : 'empty';
            if (current.batches) {
              const faces = new Map(
                labels
                  .filter((face) => face.userData.nodeId)
                  .map((face) => [face.userData.nodeId, face]),
              );
              const sampled = [...current.batches.nodes.entries()].filter(
                ([, instance], index) =>
                  index < 12 ||
                  current.selectedNodeIds.has(instance.mesh.userData.nodeIds[instance.index]),
              );
              canvas.dataset.faceProjections = JSON.stringify(
                sampled.map(([id, instance]) => {
                  const { position, dimensions } = instance;
                  const project = (x: number, y: number) => {
                    const point = new THREE.Vector3(
                      position.x + (x * dimensions.x) / 2,
                      position.y + (y * dimensions.y) / 2,
                      position.z + dimensions.z / 2 + 0.002,
                    ).project(camera);
                    return [((point.x + 1) * width) / 2, ((1 - point.y) * height) / 2];
                  };
                  const face = faces.get(id);
                  return {
                    id,
                    center: project(0, 0),
                    corners: [project(-1, 1), project(1, 1), project(1, -1), project(-1, -1)],
                    width: dimensions.x,
                    height: dimensions.y,
                    depth: dimensions.z,
                    labelBillboard: face instanceof THREE.Sprite,
                    source: face?.userData.faceSource,
                    textCorners: face ? faceCorners(face, camera, width, height) : [],
                  };
                }),
              );
            }
            renderer.render(scene, camera);
            const value = cameraValue(current);
            setNavigationCamera((previous) =>
              JSON.stringify(previous) === JSON.stringify(value) ? previous : value,
            );
          }
        });
      },
      setCamera: (value, persist = false) => {
        const before = cameraValue(current);
        const up = new THREE.Vector3(
          value.up?.x ?? 0,
          value.up?.y ?? 1,
          value.up?.z ?? 0,
        ).normalize();
        if (camera.up.distanceToSquared(up) > 0.0000000001) {
          // OrbitControls derives its orbit basis from camera.up at construction.
          // Recreate only the controls when a gizmo changes that basis, preserving
          // the renderer, graph buffers, textures and all canonical objects.
          controls.removeEventListener('change', change);
          controls.removeEventListener('end', end);
          controls.dispose();
          camera.up.copy(up);
          controls = new OrbitControls(camera, canvas);
          controls.enableDamping = false;
          controls.minDistance = 0.2;
          controls.maxDistance = spatialLimits.cameraCoordinate;
          controls.enabled = !lost;
          controls.addEventListener('change', change);
          controls.addEventListener('end', end);
          current.controls = controls;
        }
        const bounded = (coordinate: number) =>
          Math.max(
            -spatialLimits.cameraCoordinate,
            Math.min(spatialLimits.cameraCoordinate, coordinate),
          );
        camera.position.set(
          bounded(value.position.x),
          bounded(value.position.y),
          bounded(value.position.z),
        );
        controls.target.set(
          bounded(value.target.x),
          bounded(value.target.y),
          bounded(value.target.z),
        );
        if (camera.position.distanceToSquared(controls.target) < 0.000001)
          camera.position.z += camera.position.z > 0 ? -0.2 : 0.2;
        camera.far = Math.max(
          1000,
          current.bounds.radius * 20,
          camera.position.distanceTo(controls.target) * 4,
        );
        camera.near = Math.max(0.01, camera.position.distanceTo(controls.target) * 0.0001);
        camera.updateProjectionMatrix();
        controls.update();
        current.draw();
        if (
          current.labelLayer.children.length &&
          JSON.stringify(before) !== JSON.stringify(cameraValue(current))
        )
          current.refreshFaces();
        syncCameraAttributes();
        if (persist) current.saveCamera();
      },
      saveCamera: () => {
        if (disposed || propsRef.current.graph.diagram.id !== diagramId) return;
        if (
          [...camera.position.toArray(), ...controls.target.toArray()].some(
            (coordinate) => Math.abs(coordinate) > spatialLimits.cameraCoordinate,
          )
        )
          current.setCamera(cameraValue(current));
        const value = cameraValue(current);
        current.lastSavedCamera = JSON.stringify(value);
        propsRef.current.onCameraChange(value);
        syncCameraAttributes();
      },
      queueCamera: () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          current.saveCamera();
        }, 180);
      },
      flushCamera: () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
          current.saveCamera();
        }
      },
      refreshFaces: () => {
        if (!disposed) setFaceRevision((revision) => revision + 1);
      },
    };
    const syncCameraAttributes = () => {
      const value = cameraValue(current);
      canvas.dataset.cameraPosition = JSON.stringify(value.position);
      canvas.dataset.cameraTarget = JSON.stringify(value.target);
      canvas.dataset.cameraUp = JSON.stringify({ x: camera.up.x, y: camera.up.y, z: camera.up.z });
    };
    runtime.current = current;
    const resize = () => {
      const width = Math.max(1, container.clientWidth),
        height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      current.draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const theme = () => {
      const background = getComputedStyle(container).getPropertyValue('--canvas').trim();
      scene.background = new THREE.Color(colorValue(background, '#f4f6f4'));
      current.draw();
    };
    theme();
    const themeObserver = new MutationObserver(() => {
      theme();
      current.refreshFaces();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    const change = () => {
      const distance = camera.position.distanceTo(controls.target);
      camera.near = Math.max(0.01, distance * 0.0001);
      camera.far = Math.max(1000, current.bounds.radius * 20, distance * 4);
      camera.updateProjectionMatrix();
      syncCameraAttributes();
      current.draw();
    };
    const end = () => {
      current.refreshFaces();
      current.queueCamera();
    };
    controls.addEventListener('change', change);
    controls.addEventListener('end', end);
    window.addEventListener('visualnerve:spatial-camera-flush', current.flushCamera);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.07 };
    const pointers = new Set<number>();
    let clickStart: { x: number; y: number; id: number } | undefined;
    const pointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      if (event.button === 0 && pointers.size === 1)
        clickStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      else clickStart = undefined;
    };
    const pointerUp = (event: PointerEvent) => {
      const start = clickStart;
      pointers.delete(event.pointerId);
      clickStart = undefined;
      if (
        !start ||
        start.id !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
        lost
      )
        return;
      const rectangle = canvas.getBoundingClientRect();
      raycaster.params.Line = { threshold: 0.07 * current.glyphScale };
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rectangle.left) / rectangle.width) * 2 - 1,
          -((event.clientY - rectangle.top) / rectangle.height) * 2 + 1,
        ),
        camera,
      );
      scene.updateMatrixWorld(true);
      const hits = raycaster.intersectObjects(
        current.pickable.filter((object) => object.visible),
        false,
      );
      const identity = spatialIntersectionIdentity(hits[0]);
      if (identity.nodeId) useEditor.getState().select([identity.nodeId]);
      else if (identity.edgeId && !identity.edgeId.startsWith('hierarchy:'))
        useEditor.getState().select([], [identity.edgeId]);
      else if (!hits.length) useEditor.getState().select([]);
    };
    const pointerCancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      clickStart = undefined;
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      controls.enabled = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      current.flushCamera();
      current.captureAbort?.abort();
      current.captureAbort = undefined;
      setRendererState('lost');
    };
    const contextRestored = () => {
      lost = false;
      controls.enabled = true;
      setRendererState('ready');
      current.draw();
      current.refreshFaces();
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    const keyDown = (event: KeyboardEvent) => {
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') {
        current.setCamera(defaultSpatialCamera(current.bounds, camera.aspect), true);
        return;
      }
      const zoom = event.key === '+' || event.key === '=' || event.key === '-';
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      const pixels = zoom
        ? (Math.log(1 / 0.85) / 0.012) * (event.key === '-' ? -1 : 1)
        : vertical
          ? event.key === 'ArrowUp'
            ? -10
            : 10
          : (Math.PI / (18 * 0.012)) * (event.key === 'ArrowLeft' ? -1 : 1);
      current.setCamera(
        navigateSpatialCamera(
          cameraValue(current),
          zoom ? 'scale' : 'rotate',
          zoom ? 'free' : vertical ? 'x' : 'y',
          { x: pixels, y: 0 },
        ),
        true,
      );
    };
    canvas.addEventListener('keydown', keyDown);
    setRendererState('ready');
    return () => {
      current.flushCamera();
      current.captureAbort?.abort();
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('keydown', keyDown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      controls.removeEventListener('change', change);
      controls.removeEventListener('end', end);
      window.removeEventListener('visualnerve:spatial-camera-flush', current.flushCamera);
      controls.dispose();
      disposeSpatialScene(root);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (runtime.current === current) runtime.current = null;
    };
  }, [graph.diagram.id]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const model = modelRef.current;
    current.captureAbort?.abort();
    current.captureAbort = undefined;
    disposeSpatialScene(current.root);
    current.pickable = [];
    current.positions = model.positions;
    current.bounds = model.bounds;
    current.glyphScale = model.scale;
    current.batches = createSpatialBatches(
      model.projected.nodes,
      model.projected.edges,
      model.positions,
      current.glyphScale,
    );
    const counts = { nodes: current.batches.nodes.size, edges: current.batches.edges.size };
    setRenderedCounts((previous) =>
      previous.nodes === counts.nodes && previous.edges === counts.edges ? previous : counts,
    );
    current.root.add(current.batches.group);
    current.pickable = current.batches.pickable;
    current.labelLayer = new THREE.Group();
    current.root.add(current.labelLayer);
    current.selectedNodeIds = new Set();
    current.selectedEdgeIds = new Set();
    if (!current.initialized) {
      current.initialized = true;
      current.setCamera(
        getSpatialView(propsRef.current.graph).camera ??
          defaultSpatialCamera(model.bounds, current.camera.aspect),
      );
    }
    current.draw();
  }, [sceneKey, graph.diagram.id]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const selected = new Set(selectedNodes),
      relationships = new Set(selectedEdges);
    if (current.batches)
      selectSpatialBatches(
        current.batches,
        selected,
        relationships,
        current.selectedNodeIds,
        current.selectedEdgeIds,
      );
    current.selectedNodeIds = selected;
    current.selectedEdgeIds = relationships;
    current.draw();
  }, [selectedNodes, selectedEdges, sceneKey]);

  useEffect(() => {
    const current = runtime.current;
    if (!current?.batches) return;
    const model = modelRef.current;
    current.camera.updateMatrixWorld(true);
    const wanted = new Map<
      string,
      {
        text: string;
        position: THREE.Vector3;
        nodeId?: string;
        edgeId?: string;
        selected: boolean;
        options: NonNullable<Parameters<typeof spatialTextPlane>[1]>;
        opacity: number;
      }
    >();
    const selected = new Set(selectedNodes),
      selectedLinks = new Set(selectedEdges);
    if (showLabels) {
      // Keep physical text faces near the visible camera region resident. Camera movement
      // changes which textures are useful, never their world orientation or dimensions.
      const candidates = model.projected.nodes.flatMap((view) => {
        const instance = current.batches!.nodes.get(view.id);
        if (!instance) return [];
        const point = instance.position.clone().project(current.camera);
        const onScreen =
          point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.3 && Math.abs(point.y) < 1.3;
        if (
          !selected.has(view.id) &&
          (!onScreen || current.camera.position.z < instance.position.z)
        )
          return [];
        return [{ view, instance, distance: point.x ** 2 + point.y ** 2 }];
      });
      candidates.sort(
        (a, b) =>
          Number(selected.has(b.view.id)) - Number(selected.has(a.view.id)) ||
          compareLabelDepth(a.view.data.mindmap?.depth, b.view.data.mindmap?.depth) ||
          a.distance - b.distance,
      );
      for (const { view, instance } of candidates.slice(0, SPATIAL_LABEL_LIMIT)) {
        const node = view.data.node;
        const appearance = spatialNodeAppearance(view);
        wanted.set(`node:${node.id}`, {
          text: `${view.className === 'analysis-outside-data-view' ? '↗ ' : ''}${node.title}`,
          position: instance.position
            .clone()
            .add(new THREE.Vector3(0, 0, instance.dimensions.z / 2 + 0.002)),
          nodeId: node.id,
          selected: selected.has(node.id),
          options: {
            width: instance.dimensions.x,
            height: instance.dimensions.y,
            background: appearance.background,
            color: appearance.color,
            status: node.status,
            kind: node.nodeType,
          },
          opacity: Number(view.style?.opacity ?? 1),
        });
      }
      const edgeOrder = [
        ...model.projected.edges.filter((edge) => selectedLinks.has(edge.id)),
        ...model.projected.edges.filter((edge) => !selectedLinks.has(edge.id) && edge.label),
      ];
      for (const edge of edgeOrder.slice(0, 40)) {
        const points = current.batches.edgePoints.get(edge.id);
        if (!points) continue;
        wanted.set(`edge:${edge.id}`, {
          text: String(edge.label || 'Connection'),
          position: points[Math.floor(points.length / 2)]
            .clone()
            .add(new THREE.Vector3(0, 0.13 * current.glyphScale, 0.003)),
          edgeId: edge.id,
          selected: selectedLinks.has(edge.id),
          options: {
            width: 1.3 * current.glyphScale,
            height: 0.22 * current.glyphScale,
            color: '#4e6058',
            background: '#edf2ee',
            fontSize: 48,
          },
          opacity: Number(edge.style?.opacity ?? 1),
        });
      }
    }
    const signature = (label: { text: string; options: object }) =>
      JSON.stringify([
        label.text,
        label.options,
        document.documentElement.dataset.theme,
        document.documentElement.className,
      ]);
    const existing = new Map(
      current.labelLayer.children.map((object) => [object.userData.labelKey, object as FaceMesh]),
    );
    for (const [key, object] of existing) {
      const label = wanted.get(key);
      if (label && signature(label) === object.userData.labelSignature) continue;
      if (object.userData.nodeId)
        setSpatialNodeFaceCaptured(
          current.batches,
          object.userData.nodeId,
          false,
          current.selectedNodeIds.has(object.userData.nodeId),
        );
      current.labelLayer.remove(object);
      disposeSpatialScene(object);
      existing.delete(key);
    }
    for (const [key, label] of wanted) {
      let face = existing.get(key);
      if (!face) {
        face = spatialTextPlane(label.text, label.options);
        if (!face) continue;
        face.userData.labelKey = key;
        face.userData.labelSignature = signature(label);
        current.labelLayer.add(face);
      }
      face.position.copy(label.position);
      face.userData.nodeId = label.nodeId;
      face.userData.edgeId = label.edgeId;
      face.userData.selected = label.selected;
      face.material.color.set('#ffffff');
      setSpatialFaceOpacity(face, label.opacity);
    }
    current.pickable = [...current.batches.pickable, ...current.labelLayer.children];
    current.draw();
    const pendingFaces = current.labelLayer.children.filter(
      (face) => face.userData.nodeId && face.userData.faceSource !== '2d-node',
    ) as FaceMesh[];
    if (!pendingFaces.length) {
      setFaceCaptureBusy(false);
      return;
    }
    if (current.captureAbort) return;
    const pendingIds = new Set(pendingFaces.map((face) => face.userData.nodeId));
    const abort = new AbortController();
    current.captureAbort = abort;
    const captureSignatures = new Map(
      pendingFaces.map((face) => [face.userData.nodeId, face.userData.labelSignature]),
    );
    setFaceCaptureError('');
    setFaceCaptureBusy(true);
    void captureSpatialNodeFaces(
      propsRef.current.graph,
      model.projected.nodes.filter((view) => pendingIds.has(view.id)),
      abort.signal,
    )
      .then((canvases) => {
        if (abort.signal.aborted || runtime.current !== current) return;
        for (const face of current.labelLayer.children as FaceMesh[]) {
          const canvas = canvases.get(face.userData.nodeId);
          if (
            !canvas ||
            captureSignatures.get(face.userData.nodeId) !== face.userData.labelSignature
          )
            continue;
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          face.material.map?.dispose();
          face.material.map = texture;
          face.material.alphaTest = 0.01;
          face.material.needsUpdate = true;
          face.userData.faceSource = '2d-node';
          setSpatialFaceOpacity(face, face.material.opacity);
          if (current.batches)
            setSpatialNodeFaceCaptured(
              current.batches,
              face.userData.nodeId,
              true,
              current.selectedNodeIds.has(face.userData.nodeId),
            );
          const instance = current.batches?.nodes.get(face.userData.nodeId);
          const color = capturedCardColor(canvas);
          if (instance && color) {
            instance.color.copy(color);
            if (!current.selectedNodeIds.has(face.userData.nodeId))
              instance.mesh.setColorAt(instance.index, color);
            instance.mesh.instanceColor?.addUpdateRange(instance.index * 3, 3);
            if (instance.mesh.instanceColor) instance.mesh.instanceColor.needsUpdate = true;
          }
        }
        current.draw();
        if (current.captureAbort === abort) current.captureAbort = undefined;
        // A turn may have brought a few new cards into the resident set. Finish
        // the current bounded batch, then capture those cards without restarting it.
        current.refreshFaces();
        setFaceCaptureBusy(false);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          if (current.captureAbort === abort) current.captureAbort = undefined;
          setFaceCaptureBusy(false);
          setFaceCaptureError(
            error instanceof Error ? error.message : 'Could not render the original node faces.',
          );
        }
      });
  }, [sceneKey, showLabels, selectedNodes, selectedEdges, faceRevision]);

  const cameraKey = JSON.stringify(view.camera);
  useEffect(() => {
    const current = runtime.current;
    if (current && view.camera && current.lastSavedCamera !== cameraKey)
      current.setCamera(view.camera);
  }, [cameraKey, graph.diagram.id]);

  const orient = (orientation: 'front' | 'back' | 'left' | 'right' | 'top') => {
    const current = runtime.current;
    if (!current) return;
    current.flushCamera();
    const distance = current.camera.position.distanceTo(current.controls.target);
    current.setCamera(orientationCamera(orientation, cameraValue(current).target, distance), true);
  };
  const fit = () => {
    const current = runtime.current;
    if (current)
      current.setCamera(defaultSpatialCamera(current.bounds, current.camera.aspect), true);
  };
  const tilt = (radians: number) => {
    const current = runtime.current;
    if (!current) return;
    current.flushCamera();
    current.setCamera(
      navigateSpatialCamera(cameraValue(current), 'rotate', 'y', { x: radians / 0.012, y: 0 }),
      true,
    );
  };
  const navigate = (
    mode: SpatialNavigationMode,
    axis: SpatialNavigationAxis,
    delta: { x: number; y: number },
  ) => {
    const current = runtime.current;
    if (!current || rendererState !== 'ready') return;
    const value = navigateSpatialCamera(
      cameraValue(current),
      mode,
      axis,
      delta,
      current.renderer.domElement.clientHeight,
    );
    current.setCamera(value);
    current.queueCamera();
  };
  const endNavigation = () => runtime.current?.flushCamera();
  const focus = () => {
    const current = runtime.current;
    if (current) focusSpatialObjects(current, selectedNodes);
  };
  useEffect(() => {
    const current = runtime.current;
    if (!focusNode || !current?.batches?.nodes.has(focusNode)) return;
    useEditor.getState().select([focusNode]);
    focusSpatialObjects(current, [focusNode]);
    useEditor.setState({ focusNode: null });
  }, [focusNode, sceneKey, graph.diagram.id]);
  const returnTo2D = () => {
    runtime.current?.flushCamera();
    propsRef.current.onReturnTo2D();
  };
  const matches = visibleNodes.filter((view) =>
    view.data.node.title.toLocaleLowerCase().includes(listQuery.toLocaleLowerCase()),
  );
  const listed = matches.slice(listPage * 50, (listPage + 1) * 50);
  const nodeNames = new Map(visibleNodes.map((view) => [view.id, view.data.node.title]));
  const relationshipMatches = visibleEdges.filter((edge) =>
    `${edge.label || ''} ${nodeNames.get(edge.source) || ''} ${nodeNames.get(edge.target) || ''}`
      .toLocaleLowerCase()
      .includes(relationshipQuery.toLocaleLowerCase()),
  );
  const listedRelationships = relationshipMatches.slice(
    relationshipPage * 50,
    (relationshipPage + 1) * 50,
  );
  useEffect(
    () => setListPage((page) => Math.min(page, Math.max(0, Math.ceil(matches.length / 50) - 1))),
    [matches.length],
  );
  useEffect(
    () =>
      setRelationshipPage((page) =>
        Math.min(page, Math.max(0, Math.ceil(relationshipMatches.length / 50) - 1)),
      ),
    [relationshipMatches.length],
  );
  const ready = rendererState === 'ready';
  const outsideDataView = projected.nodes.filter(
    (node) => node.className === 'analysis-outside-data-view',
  ).length;

  return (
    <section
      className="canvas-shell spatial-canvas"
      aria-label="3D diagram"
      data-testid="spatial-view"
      data-renderer={rendererState}
      data-rendered-nodes={renderedCounts.nodes}
      data-rendered-edges={renderedCounts.edges}
    >
      <div ref={host} className="spatial-stage" />
      <NavigationGizmo
        camera={navigationCamera}
        disabled={!ready}
        onNavigate={navigate}
        onGestureEnd={endNavigation}
      />
      <div className="spatial-toolbar" role="toolbar" aria-label="3D navigation">
        <button className="spatial-return" onClick={returnTo2D}>
          <ArrowLeft size={15} />
          Return to 2D
        </button>
        <div className="spatial-orientations">
          {(['front', 'back', 'left', 'right', 'top'] as const).map((orientation) => (
            <button
              key={orientation}
              disabled={!ready}
              onClick={() => orient(orientation)}
              aria-label={`${orientation[0].toUpperCase()}${orientation.slice(1)} view`}
            >
              {orientation[0].toUpperCase()}
              {orientation.slice(1)}
            </button>
          ))}
        </div>
        <button
          disabled={!ready}
          onClick={() => tilt(-Math.PI / 18)}
          aria-label="Tilt diagram left 10 degrees"
        >
          −10°
        </button>
        <button
          disabled={!ready}
          onClick={() => tilt(Math.PI / 18)}
          aria-label="Tilt diagram right 10 degrees"
        >
          +10°
        </button>
        <button onClick={fit} disabled={!ready} aria-label="Fit 3D diagram">
          <Maximize size={15} />
          Fit
        </button>
        <button
          onClick={focus}
          disabled={!ready || !selectedNodes.length}
          aria-label="Focus selected object"
        >
          <Focus size={15} />
          Focus
        </button>
        <label>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(event) => setShowLabels(event.target.checked)}
          />
          Labels
        </label>
      </div>
      <div className="spatial-caption">
        <strong>Diagram relief</strong>
        <span id="spatial-instructions">
          The same diagram with depth. Drag to tilt · scroll or pinch to zoom · right drag or two
          fingers to pan. Use the Move, Rotate and Scale handles for axis control. Keyboard: arrows
          rotate, +/− zoom, Home fits.
        </span>
        {showLabels && projected.nodes.length > SPATIAL_LABEL_LIMIT && (
          <small>
            Text stays on the card faces and follows the perspective. Zoom or select an object to
            read it, or find any object in the list below.
          </small>
        )}
        {outsideDataView > 0 && (
          <small>
            {outsideDataView} objects are outside the current data view and show their retained
            values. They were included by relationship exploration.
          </small>
        )}
        {faceCaptureError && (
          <small role="status">
            The original card appearance could not be loaded. Return to 2D to continue.
          </small>
        )}
        {faceCaptureBusy && <small role="status">Preparing the original node appearance…</small>}
      </div>
      {(rendererState === 'unavailable' || rendererState === 'lost') && (
        <div className="spatial-fallback" role="status">
          <RotateCcw size={24} />
          <h2>
            {rendererState === 'lost'
              ? 'The 3D graphics connection was interrupted'
              : '3D graphics are unavailable in this browser'}
          </h2>
          <p>
            Your diagram is saved locally. You can still inspect objects below and continue in 2D.
          </p>
          <button onClick={returnTo2D}>Return to 2D</button>
        </div>
      )}
      {projected.truncated && (
        <p className="spatial-limit" role="status">
          Showing {projected.nodes.length.toLocaleString()} of{' '}
          {projected.totalNodes.toLocaleString()} objects and{' '}
          {projected.edges.length.toLocaleString()} of {projected.totalEdges.toLocaleString()}{' '}
          relationships. Narrow your filters or explore a smaller area; selected objects take
          priority.
        </p>
      )}
      <details className="spatial-object-list">
        <summary>
          Objects and relationships <span>{visibleNodes.length.toLocaleString()} objects</span>
        </summary>
        <div className="spatial-list-content">
          <label>
            Find a 3D object
            <input
              value={listQuery}
              onChange={(event) => {
                setListQuery(event.target.value);
                setListPage(0);
              }}
              type="search"
            />
          </label>
          <div role="list" aria-label="3D objects">
            {listed.map((view) => (
              <div key={view.id} role="listitem">
                <button
                  aria-label={`Select object ${view.data.node.title}`}
                  aria-pressed={selectedNodes.includes(view.id)}
                  data-node-id={view.id}
                  data-node-status={view.data.node.status ?? ''}
                  onClick={() => useEditor.getState().select([view.id])}
                >
                  <span>{view.data.node.title}</span>
                  {view.className === 'analysis-outside-data-view' && (
                    <small>Outside data view</small>
                  )}
                  {view.data.node.status && (
                    <small
                      className={isCompletedStatus(view.data.node.status) ? 'spatial-complete' : ''}
                    >
                      {isCompletedStatus(view.data.node.status) ? '✓ ' : ''}
                      {view.data.node.status}
                    </small>
                  )}
                </button>
              </div>
            ))}
          </div>
          {matches.length > 50 && (
            <nav aria-label="3D object pages">
              <button disabled={!listPage} onClick={() => setListPage(Math.max(0, listPage - 1))}>
                Previous
              </button>
              <span>
                {listPage + 1} / {Math.ceil(matches.length / 50)}
              </span>
              <button
                disabled={(listPage + 1) * 50 >= matches.length}
                onClick={() => setListPage(listPage + 1)}
              >
                Next
              </button>
            </nav>
          )}
          <details>
            <summary>Relationships ({visibleEdges.length.toLocaleString()})</summary>
            <label>
              Find a 3D relationship
              <input
                type="search"
                value={relationshipQuery}
                onChange={(event) => {
                  setRelationshipQuery(event.target.value);
                  setRelationshipPage(0);
                }}
              />
            </label>
            <div role="list" aria-label="3D relationships">
              {listedRelationships.map((edge) => (
                <div role="listitem" key={edge.id}>
                  <button
                    disabled={edge.id.startsWith('hierarchy:')}
                    aria-label={`Select relationship ${edge.label || 'connection'} from ${nodeNames.get(edge.source)} to ${nodeNames.get(edge.target)}`}
                    aria-pressed={selectedEdges.includes(edge.id)}
                    onClick={() => useEditor.getState().select([], [edge.id])}
                  >
                    {nodeNames.get(edge.source)}
                    {edge.markerStart && edge.markerEnd
                      ? ' ↔ '
                      : edge.markerStart
                        ? ' ← '
                        : edge.markerEnd
                          ? ' → '
                          : ' — '}
                    {nodeNames.get(edge.target)}
                    {edge.label ? ` · ${String(edge.label)}` : ''}
                  </button>
                </div>
              ))}
            </div>
            {relationshipMatches.length > 50 && (
              <nav aria-label="3D relationship pages">
                <button
                  disabled={!relationshipPage}
                  onClick={() => setRelationshipPage(Math.max(0, relationshipPage - 1))}
                >
                  Previous
                </button>
                <span>
                  {relationshipPage + 1} / {Math.ceil(relationshipMatches.length / 50)}
                </span>
                <button
                  disabled={(relationshipPage + 1) * 50 >= relationshipMatches.length}
                  onClick={() => setRelationshipPage(relationshipPage + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </details>
        </div>
      </details>
      <div className="canvas-statusbar">
        <span>
          {projected.nodes.length.toLocaleString()} objects ·{' '}
          {projected.edges.length.toLocaleString()} relationships
        </span>
        <span>The same diagram, with depth and perspective</span>
      </div>
    </section>
  );
}

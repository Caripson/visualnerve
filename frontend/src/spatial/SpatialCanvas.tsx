import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Edge } from '@xyflow/react';
import { ArrowLeft, Focus, Maximize, RotateCcw } from 'lucide-react';
import type { Graph } from '../model/types';
import type { CanvasNode } from '../canvas/projection';
import { useEditor } from '../state/editor';
import { getSpatialView, spatialLimits, type SpatialCamera, type SpatialPoint } from './types';
import { defaultSpatialCamera, orientationCamera, spatialBounds, spatialPositions } from './layout';
import {
  boundedSpatialProjection,
  createSpatialBatches,
  selectSpatialBatches,
  spatialIntersectionIdentity,
  type SpatialBatches,
  disposeSpatialScene,
  isCompletedStatus,
  SPATIAL_LABEL_LIMIT,
  spatialGlyphScale,
  spatialTextSprite,
} from './scene';
import './spatial.css';

export interface SpatialCanvasProps {
  graph: Graph;
  nodes: CanvasNode[];
  edges: Edge[];
  onReturnTo2D: () => void;
  onCameraChange: (camera: SpatialCamera) => void;
}
type Bounds = ReturnType<typeof spatialBounds>;
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
  flushCamera: () => void;
}
function cameraValue(runtime: Runtime): SpatialCamera {
  const point = (value: THREE.Vector3) => ({
    x: Number(value.x.toFixed(5)),
    y: Number(value.y.toFixed(5)),
    z: Number(value.z.toFixed(5)),
  });
  return { position: point(runtime.camera.position), target: point(runtime.controls.target) };
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
  const chosen = ids
    .map((id) => current.positions.get(id))
    .filter((point): point is SpatialPoint => !!point);
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
  const [renderedCounts, setRenderedCounts] = useState({ nodes: 0, edges: 0 });
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
  const positions = useMemo(
    () => spatialPositions(graph),
    [graph.nodes, graph.edges, graph.diagram.type],
  );
  const bounds = useMemo(
    () => spatialBounds(projected.nodes.map((node) => positions.get(node.id)!).filter(Boolean)),
    [positions, projected.nodes],
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
        node.data.node.metadata.spatial,
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
  const modelRef = useRef({ projected, positions, bounds, showLabels });
  modelRef.current = { projected, positions, bounds, showLabels };

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
    const controls = new OrbitControls(camera, canvas);
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
            const height = Math.max(1, canvas.clientHeight);
            const labels = current.labelLayer.children.filter(
              (object): object is THREE.Sprite => object instanceof THREE.Sprite,
            );
            labels.sort(
              (a, b) =>
                Number(b.userData.selected) - Number(a.userData.selected) ||
                compareLabelDepth(a.userData.mindmapDepth, b.userData.mindmapDepth) ||
                a.position.distanceToSquared(controls.target) -
                  b.position.distanceToSquared(controls.target),
            );
            const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
            const projectedPoint = new THREE.Vector3();
            for (const object of labels) {
              const distance = camera.position.distanceTo(object.position);
              const visibleHeight =
                distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2;
              const width = (visibleHeight * object.userData.labelPixelWidth) / height;
              object.scale.set(width, (width * 112) / 512, 1);
              projectedPoint.copy(object.position).project(camera);
              const box = {
                x:
                  ((projectedPoint.x + 1) * canvas.clientWidth) / 2 -
                  object.userData.labelPixelWidth / 2,
                y:
                  ((1 - projectedPoint.y) * height) / 2 -
                  (object.userData.labelPixelWidth * 112) / 1024,
                width: object.userData.labelPixelWidth,
                height: (object.userData.labelPixelWidth * 112) / 512 + 6,
              };
              const onScreen =
                projectedPoint.z > -1 &&
                projectedPoint.z < 1 &&
                Math.abs(projectedPoint.x) < 1.1 &&
                Math.abs(projectedPoint.y) < 1.1;
              const overlaps = occupied.some(
                (other) =>
                  box.x < other.x + other.width &&
                  box.x + box.width > other.x &&
                  box.y < other.y + other.height &&
                  box.y + box.height > other.y,
              );
              object.visible = onScreen && (object.userData.selected || !overlaps);
              if (object.visible) occupied.push(box);
            }
            canvas.dataset.visibleLabels = String(labels.filter((label) => label.visible).length);
            renderer.render(scene, camera);
          }
        });
      },
      setCamera: (value, persist = false) => {
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
      flushCamera: () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
          current.saveCamera();
        }
      },
    };
    const syncCameraAttributes = () => {
      const value = cameraValue(current);
      canvas.dataset.cameraPosition = JSON.stringify(value.position);
      canvas.dataset.cameraTarget = JSON.stringify(value.target);
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
    const themeObserver = new MutationObserver(theme);
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
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        current.saveCamera();
      }, 180);
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
      setRendererState('lost');
    };
    const contextRestored = () => {
      lost = false;
      controls.enabled = true;
      setRendererState('ready');
      current.draw();
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
        current.setCamera(defaultSpatialCamera(current.bounds), true);
        return;
      }
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
      if (event.key === 'ArrowRight') spherical.theta += 0.12;
      if (event.key === 'ArrowUp') spherical.phi = Math.max(0.04, spherical.phi - 0.12);
      if (event.key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.04, spherical.phi + 0.12);
      if (event.key === '+' || event.key === '=')
        spherical.radius = Math.max(0.2, spherical.radius * 0.85);
      if (event.key === '-')
        spherical.radius = Math.min(spatialLimits.cameraCoordinate, spherical.radius / 0.85);
      offset.setFromSpherical(spherical).add(controls.target);
      current.setCamera(
        {
          position: { x: offset.x, y: offset.y, z: offset.z },
          target: cameraValue(current).target,
        },
        true,
      );
    };
    canvas.addEventListener('keydown', keyDown);
    setRendererState('ready');
    return () => {
      current.flushCamera();
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
    disposeSpatialScene(current.root);
    current.pickable = [];
    current.positions = model.positions;
    current.bounds = model.bounds;
    current.glyphScale = spatialGlyphScale(model.bounds.radius);
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
        getSpatialView(propsRef.current.graph).camera ?? defaultSpatialCamera(model.bounds),
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
    const wanted = new Map<
      string,
      {
        text: string;
        position: THREE.Vector3;
        nodeId?: string;
        edgeId?: string;
        selected: boolean;
        depth?: number;
      }
    >();
    const selected = new Set(selectedNodes),
      selectedLinks = new Set(selectedEdges);
    if (showLabels) {
      const nodeOrder = [
        ...model.projected.nodes.filter((node) => selected.has(node.id)),
        ...model.projected.nodes.filter((node) => !selected.has(node.id)),
      ];
      if (nodeOrder.some((node) => node.data.mindmap))
        nodeOrder.sort(
          (a, b) =>
            Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
            compareLabelDepth(a.data.mindmap?.depth, b.data.mindmap?.depth) ||
            (current
              .batches!.nodes.get(a.id)
              ?.position.distanceToSquared(current.controls.target) ?? Infinity) -
              (current
                .batches!.nodes.get(b.id)
                ?.position.distanceToSquared(current.controls.target) ?? Infinity),
        );
      for (const view of nodeOrder.slice(0, SPATIAL_LABEL_LIMIT)) {
        const position = current.batches.nodes.get(view.id)?.position;
        if (!position) continue;
        const node = view.data.node;
        wanted.set(`node:${node.id}`, {
          text: `${view.className === 'analysis-outside-data-view' ? '↗ ' : ''}${isCompletedStatus(node.status) ? '✓ ' : ''}${node.title}`,
          position: position.clone().add(new THREE.Vector3(0, 0.42 * current.glyphScale, 0)),
          nodeId: node.id,
          selected: selected.has(node.id),
          depth: view.data.mindmap?.depth,
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
            .add(new THREE.Vector3(0, 0.13 * current.glyphScale, 0)),
          edgeId: edge.id,
          selected: selectedLinks.has(edge.id),
        });
      }
    }
    const existing = new Map(
      current.labelLayer.children.map((object) => [
        object.userData.labelKey,
        object as THREE.Sprite,
      ]),
    );
    for (const [key, object] of existing) {
      if (wanted.get(key)?.text === object.userData.labelText) continue;
      current.labelLayer.remove(object);
      disposeSpatialScene(object);
      existing.delete(key);
    }
    for (const [key, label] of wanted) {
      let sprite = existing.get(key);
      if (!sprite) {
        sprite = spatialTextSprite(
          label.text,
          label.edgeId ? { width: 1.3, color: '#4e6058', background: '#edf2ee' } : undefined,
        );
        if (!sprite) continue;
        sprite.userData.labelKey = key;
        sprite.userData.labelText = label.text;
        current.labelLayer.add(sprite);
      }
      sprite.position.copy(label.position);
      sprite.userData.nodeId = label.nodeId;
      sprite.userData.edgeId = label.edgeId;
      sprite.userData.selected = label.selected;
      sprite.userData.mindmapDepth = label.depth;
      sprite.material.color.set(label.selected ? '#ccdeff' : '#ffffff');
    }
    current.pickable = [...current.batches.pickable, ...current.labelLayer.children];
    current.draw();
  }, [sceneKey, showLabels, selectedNodes, selectedEdges]);

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
    if (current) current.setCamera(defaultSpatialCamera(current.bounds), true);
  };
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
        <strong>3D diagram</strong>
        <span id="spatial-instructions">
          Drag to rotate · scroll or pinch to zoom · right drag or two fingers to pan. Keyboard:
          arrows rotate, +/− zoom, Home fits.
        </span>
        {showLabels && projected.nodes.length > SPATIAL_LABEL_LIMIT && (
          <small>
            Labels adapt to available space. Select an object to keep its label visible, or find any
            object in the list below.
          </small>
        )}
        {outsideDataView > 0 && (
          <small>
            {outsideDataView} objects are outside the current data view and show their retained
            values. They were included by relationship exploration.
          </small>
        )}
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
        <span>Same objects, separate 2D and 3D layouts</span>
      </div>
    </section>
  );
}

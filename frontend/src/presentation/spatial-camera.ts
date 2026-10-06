import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SpatialBatches } from '../spatial/scene';
import type { SpatialCamera, SpatialPoint } from '../spatial/types';
import {
  PRESENTATION_FOCUS,
  PRESENTATION_CAMERA_CANCEL,
  PRESENTATION_VIEW_REQUEST,
  presentationFocus,
  presentationArrived,
  presentationInterrupted,
  planPresentationFlight,
  presentationFlightFrames,
  pointInsideObstacle,
  presentationEase,
  type PresentationFocus,
  type PresentationObstacle,
  type PresentationViewRequest,
} from './camera';

interface SpatialPresentationRuntime {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;
  batches?: Pick<SpatialBatches, 'nodes'>;
  glyphScale: number;
  bounds: { radius: number };
  presentationActive: boolean;
  cancelPresentation: (reason?: string, manual?: boolean) => void;
  abortMovement: () => void;
  flushCamera: () => void;
  draw: () => void;
  refreshFaces: () => void;
  setCamera: (value: SpatialCamera, persist?: boolean, presentation?: boolean) => void;
}
interface SpatialPresentationOptions {
  unavailable: () => boolean;
  visible: (id: string) => boolean;
  select: (id: string) => void;
  selectMany?: (nodeIds: string[], edgeIds: string[]) => void;
  reveal?: (request: PresentationFocus) => Promise<void> | void;
  syncCameraAttributes: () => void;
  obstacles: () => readonly PresentationObstacle[];
}
function cameraValue(current: SpatialPresentationRuntime): SpatialCamera {
  const point = (value: THREE.Vector3) => ({ x: value.x, y: value.y, z: value.z });
  return {
    position: point(current.camera.position),
    target: point(current.controls.target),
    up: point(current.camera.up),
  };
}

/** Owns only transient tour requests, safe camera motion and cleanup, never graph mutations. */
export function attachSpatialPresentationCamera(
  current: SpatialPresentationRuntime,
  options: SpatialPresentationOptions,
) {
  const camera = current.camera;
  const canvas = current.renderer.domElement;
  let presentationFrame = 0;
  let presentationRequest: PresentationFocus | undefined;
  let presentationPending = false;
  let presentationControlsEnabled = true;
  let presentationInitialUp: THREE.Vector3 | undefined;
  current.cancelPresentation = (reason = 'Camera movement cancelled.', manual = false) => {
    const previous = presentationRequest;
    presentationRequest = undefined;
    if (presentationFrame) cancelAnimationFrame(presentationFrame);
    presentationFrame = 0;
    current.presentationActive = false;
    if (previous) {
      current.controls.enabled = presentationControlsEnabled && !options.unavailable();
      if (presentationInitialUp) {
        const value = cameraValue(current);
        camera.up.copy(presentationInitialUp);
        presentationInitialUp = undefined;
        // Restore OrbitControls' basis to the actual paused viewing frame.
        current.setCamera(value, false, true);
      }
      if (presentationPending) presentationArrived(previous, reason);
      if (manual) presentationInterrupted(previous, reason);
    }
    presentationPending = false;
    canvas.dataset.presentationMoving = 'false';
  };
  const focusPresentation = (event: Event) => {
    const next = presentationFocus(event);
    if (!next) return;
    current.cancelPresentation('Camera movement replaced.');
    current.abortMovement();
    current.flushCamera();
    if (options.unavailable()) {
      presentationArrived(next, 'The 3D renderer is unavailable.');
      return;
    }
    if (next.view && next.view.mode !== '3d') {
      presentationArrived(next, 'Switch to 2D to play this saved storyboard viewport.');
      return;
    }
    const ids = next.nodeIds ?? [next.nodeId];
    if (!options.reveal && ids.some((id) => !options.visible(id))) {
      presentationArrived(next, 'The presentation object is hidden or unavailable in this view.');
      return;
    }
    presentationRequest = next;
    presentationPending = true;
    presentationControlsEnabled = current.controls.enabled;
    // Prioritise a requested object in the bounded resident scene before planning.
    // Highlighting changes selection only, without an editor command or revision.
    if (options.selectMany) options.selectMany(ids, next.edgeIds ?? []);
    else options.select(next.nodeId);
    const deadline = performance.now() + 5000;
    const prepare = () => {
      presentationFrame = requestAnimationFrame(() => {
        presentationFrame = 0;
        if (presentationRequest !== next || options.unavailable()) return;
        const instances = ids.map((id) => current.batches?.nodes.get(id));
        if (ids.some((id) => !options.visible(id)) || instances.some((instance) => !instance)) {
          if (options.reveal && performance.now() < deadline) {
            prepare();
            return;
          }
          current.cancelPresentation(
            'The presentation objects are hidden or unavailable in the 3D view.',
          );
          return;
        }
        const instance = instances[0];
        if (!instance || !current.batches) {
          current.cancelPresentation('The presentation object is not ready in the 3D view.');
          return;
        }
        current.root.updateMatrixWorld(true);
        const matrix = instance.mesh.matrixWorld;
        let target = instance.position.clone().applyMatrix4(matrix);
        const selectionBounds = new THREE.Box3();
        for (const member of instances)
          if (member) {
            const box = new THREE.Box3()
              .setFromCenterAndSize(member.position, member.dimensions)
              .applyMatrix4(member.mesh.matrixWorld);
            selectionBounds.union(box);
          }
        if (ids.length > 1) target = selectionBounds.getCenter(new THREE.Vector3());
        if (next.view?.mode === '3d')
          target = new THREE.Vector3(
            next.view.camera.target.x,
            next.view.camera.target.y,
            next.view.camera.target.z,
          );
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
        const right = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
        const worldScale = Math.max(
          new THREE.Vector3().setFromMatrixColumn(matrix, 0).length(),
          new THREE.Vector3().setFromMatrixColumn(matrix, 1).length(),
          new THREE.Vector3().setFromMatrixColumn(matrix, 2).length(),
        );
        const width =
          instance.dimensions.x * new THREE.Vector3().setFromMatrixColumn(matrix, 0).length();
        const height =
          instance.dimensions.y * new THREE.Vector3().setFromMatrixColumn(matrix, 1).length();
        const depth =
          instance.dimensions.z * new THREE.Vector3().setFromMatrixColumn(matrix, 2).length();
        const clearance = Math.max(0.01, 0.08 * current.glyphScale * worldScale);
        const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const focusDistance = Math.max(
          ids.length > 1
            ? (selectionBounds.getSize(new THREE.Vector3()).length() /
                (2 * tangent * Math.min(1, camera.aspect))) *
                1.35
            : 0,
          0.2,
          Math.max(height / (2 * tangent), width / (2 * tangent * camera.aspect)) * 1.35 +
            depth / 2 +
            clearance * 2,
        );
        const obstacles = options.obstacles();
        const from = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        if (obstacles.some((box) => pointInsideObstacle(from, box, clearance))) {
          current.cancelPresentation(
            'The camera is too close to an object. Move it clear before playing.',
          );
          return;
        }
        const front =
          camera.position.clone().sub(current.controls.target).dot(normal) >= 0 ? 1 : -1;
        let path: SpatialPoint[] | undefined;
        let failure: unknown;
        if (next.view?.mode === '3d') {
          try {
            path = planPresentationFlight(from, next.view.camera.position, obstacles, clearance);
          } catch (error) {
            failure = error;
          }
        }
        for (const side of next.view ? [] : [front, -front]) {
          for (const factor of [1, 1.6, 2.5, 4]) {
            for (const [x, y] of [
              [0, 0],
              [0.3, 0.15],
              [-0.3, 0.15],
              [0, -0.3],
            ]) {
              const destination = target
                .clone()
                .addScaledVector(normal, side * focusDistance * factor)
                .addScaledVector(right, x * focusDistance * factor)
                .addScaledVector(up, y * focusDistance * factor);
              try {
                path = planPresentationFlight(from, destination, obstacles, clearance);
                break;
              } catch (error: unknown) {
                failure = error;
              }
            }
            if (path) break;
          }
          if (path) break;
        }
        if (!path) {
          current.cancelPresentation(
            failure instanceof Error ? failure.message : 'No safe camera route was found.',
          );
          return;
        }
        const route = path;
        const flight = presentationFlightFrames(route);
        const initialTarget = current.controls.target.clone();
        const originalUp = camera.up.clone();
        const desiredUp =
          next.view?.mode === '3d' && next.view.camera.up
            ? new THREE.Vector3(next.view.camera.up.x, next.view.camera.up.y, next.view.camera.up.z)
            : originalUp.clone();
        presentationInitialUp = originalUp;
        const started = performance.now();
        current.presentationActive = true;
        current.controls.enabled = false;
        canvas.dataset.presentationMoving = 'true';
        const step = (now: number) => {
          presentationFrame = 0;
          if (options.unavailable() || presentationRequest !== next) return;
          const progress = next.transitionMs ? Math.min(1, (now - started) / next.transitionMs) : 1;
          const { position, arrived } = flight(progress);
          camera.position.set(position.x, position.y, position.z);
          current.controls.target.lerpVectors(initialTarget, target, presentationEase(progress));
          if (camera.position.distanceToSquared(current.controls.target) < 0.000001)
            current.controls.target.z += 0.01;
          // Keep the viewing basis valid even during an orbit past a top/bottom view.
          const direction = camera.position.clone().sub(current.controls.target).normalize();
          const basisUp = originalUp.clone().lerp(desiredUp, presentationEase(progress));
          const projectedUp = basisUp.clone().addScaledVector(direction, -basisUp.dot(direction));
          if (projectedUp.lengthSq() < 0.000001) {
            projectedUp.set(
              Math.abs(direction.y) < 0.9 ? 0 : 1,
              Math.abs(direction.y) < 0.9 ? 1 : 0,
              0,
            );
            projectedUp.addScaledVector(direction, -projectedUp.dot(direction));
          }
          camera.up.copy(projectedUp.normalize());
          camera.lookAt(current.controls.target);
          camera.near = Math.max(
            0.01,
            camera.position.distanceTo(current.controls.target) * 0.0001,
          );
          camera.far = Math.max(
            1000,
            current.bounds.radius * 20,
            camera.position.distanceTo(current.controls.target) * 4,
          );
          camera.updateProjectionMatrix();
          options.syncCameraAttributes();
          current.draw();
          if (!arrived) {
            presentationFrame = requestAnimationFrame(step);
            return;
          }
          current.controls.enabled = presentationControlsEnabled && !options.unavailable();
          canvas.dataset.presentationMoving = 'false';
          const value = cameraValue(current);
          camera.up.copy(originalUp);
          presentationInitialUp = undefined;
          current.setCamera(value, false, true);
          current.refreshFaces();
          // Draw is queued before this callback: arrival means the final camera frame rendered.
          presentationFrame = requestAnimationFrame(() => {
            presentationFrame = 0;
            if (presentationRequest !== next || options.unavailable()) return;
            presentationPending = false;
            presentationArrived(next);
          });
        };
        presentationFrame = requestAnimationFrame(step);
      });
    };
    if (options.reveal)
      Promise.resolve(options.reveal(next))
        .then(() => {
          if (presentationRequest === next) prepare();
        })
        .catch((error) => {
          if (presentationRequest === next)
            current.cancelPresentation(
              error instanceof Error ? error.message : 'The storyboard view is not ready.',
            );
        });
    else prepare();
  };
  const captureView = (event: Event) => {
    const detail = (event as CustomEvent<PresentationViewRequest>).detail;
    if (!detail?.respond) return;
    if (options.unavailable()) {
      detail.error('The 3D renderer is unavailable.');
      return;
    }
    detail.respond({ mode: '3d', camera: cameraValue(current) });
  };
  const cancelPresentation = () => current.cancelPresentation();
  window.addEventListener(PRESENTATION_FOCUS, focusPresentation);
  window.addEventListener(PRESENTATION_CAMERA_CANCEL, cancelPresentation);
  window.addEventListener(PRESENTATION_VIEW_REQUEST, captureView);
  return () => {
    current.cancelPresentation('The diagram view changed.');
    window.removeEventListener(PRESENTATION_FOCUS, focusPresentation);
    window.removeEventListener(PRESENTATION_CAMERA_CANCEL, cancelPresentation);
    window.removeEventListener(PRESENTATION_VIEW_REQUEST, captureView);
  };
}

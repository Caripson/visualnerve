import * as THREE from 'three';

/** Intersect a screen ray with the object's XY plane, preserving its saved world Z. */
export function spatialDragPoint(camera: THREE.Camera, pointer: THREE.Vector2, z: number) {
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  if (Math.abs(raycaster.ray.direction.z) < 0.00001) return undefined;
  return (
    raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
      new THREE.Vector3(),
    ) ?? undefined
  );
}

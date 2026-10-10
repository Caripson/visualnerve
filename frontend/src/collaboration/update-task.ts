/** Small restart fence, independent of runtime, Yjs, MLS and private room state. */
const tasks = new Set<symbol>();

/** Register before connecting/requesting admission; release only when the local room lifecycle has ended. */
export function registerCollaborationUpdateTask(): () => void {
  const task = Symbol('active collaboration lifecycle');
  tasks.add(task);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    tasks.delete(task);
  };
}

export function hasCollaborationUpdateTask(): boolean {
  return tasks.size > 0;
}

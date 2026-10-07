import type { GraphNode } from '../model/types';

export interface CapacityBankGeometry {
  node: GraphNode;
  cards: number;
}
export const CAPACITY_CARD_GAP = 24;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CapacityLayoutDiagnostics {
  candidateChecks: number;
  bucketQueries: number;
}
const CELL_SIZE = 256;
const MAX_CELLS_PER_BOX = 256;

/** Very large rectangles stay outside the grid so imported dimensions cannot explode it. */
class BankIndex {
  private cells = new Map<string, Set<Box>>();
  private spanning = new Set<Box>();
  private all = new Set<Box>();
  private keys(box: Box) {
    const left = Math.floor(box.x / CELL_SIZE),
      right = Math.floor((box.x + box.width + CAPACITY_CARD_GAP) / CELL_SIZE);
    const top = Math.floor(box.y / CELL_SIZE),
      bottom = Math.floor((box.y + box.height + CAPACITY_CARD_GAP) / CELL_SIZE);
    const count = (right - left + 1) * (bottom - top + 1);
    if (!Number.isFinite(count) || count > MAX_CELLS_PER_BOX) return;
    const result: string[] = [];
    for (let x = left; x <= right; x++)
      for (let y = top; y <= bottom; y++) result.push(`${x}:${y}`);
    return result;
  }
  add(box: Box) {
    this.all.add(box);
    const keys = this.keys(box);
    if (!keys) {
      this.spanning.add(box);
      return;
    }
    for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = new Set()));
      cell.add(box);
    }
  }
  candidates(box: Box) {
    const keys = this.keys(box);
    if (!keys) return this.all;
    const result = new Set(this.spanning);
    for (const key of keys) for (const item of this.cells.get(key) ?? []) result.add(item);
    return result;
  }
}

/** Reserve whole banks, including future unit cards, before laying out lower rows. */
export function layoutCapacityBanks(
  banks: CapacityBankGeometry[],
  diagnostics?: CapacityLayoutDiagnostics,
) {
  if (diagnostics) {
    diagnostics.candidateChecks = 0;
    diagnostics.bucketQueries = 0;
  }
  const positions = new Map<string, { x: number; y: number }>();
  if (banks.every((bank) => bank.cards === 1)) {
    for (const { node } of banks) positions.set(node.id, { x: node.x, y: node.y });
    return positions;
  }
  const occupied = new BankIndex();
  for (const { node } of banks)
    if (node.nodeType === 'group') positions.set(node.id, { x: node.x, y: node.y });
  const ordered = banks
    .filter(({ node }) => node.nodeType !== 'group')
    .sort(
      (a, b) => a.node.y - b.node.y || a.node.x - b.node.x || a.node.id.localeCompare(b.node.id),
    );
  for (const { node, cards } of ordered) {
    const height = cards * node.height + (cards - 1) * CAPACITY_CARD_GAP;
    let y = node.y;
    while (true) {
      if (diagnostics) diagnostics.bucketQueries++;
      let next = y;
      for (const box of occupied.candidates({ x: node.x, y, width: node.width, height })) {
        if (diagnostics) diagnostics.candidateChecks++;
        if (
          node.x < box.x + box.width + CAPACITY_CARD_GAP &&
          node.x + node.width + CAPACITY_CARD_GAP > box.x &&
          y < box.y + box.height + CAPACITY_CARD_GAP &&
          y + height + CAPACITY_CARD_GAP > box.y
        )
          next = Math.max(next, box.y + box.height + CAPACITY_CARD_GAP);
      }
      if (next === y) break;
      y = next;
    }
    positions.set(node.id, { x: node.x, y });
    occupied.add({ x: node.x, y, width: node.width, height });
  }
  return positions;
}

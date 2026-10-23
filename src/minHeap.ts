export interface HeapItem {
  id: number;
  sortIndex: number; // 比较权值（即 expirationTime）
}

export class MinHeap<T extends HeapItem> {
  private heap: T[] = [];

  get size(): number {
    return this.heap.length;
  }

  peek(): T | null {
    return this.heap.length === 0 ? null : this.heap[0];
  }

  push(node: T): void {
    const index = this.heap.length;
    this.heap.push(node);
    this.siftUp(index);
  }

  pop(): T | null {
    if (this.heap.length === 0) return null;
    const root = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return root;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parentIndex = (i - 1) >>> 1;
      const parent = this.heap[parentIndex];
      const node = this.heap[i];
      if (node.sortIndex < parent.sortIndex) {
        this.heap[parentIndex] = node;
        this.heap[i] = parent;
        i = parentIndex;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let i = index;
    const len = this.heap.length;
    const halfLen = len >>> 1;

    while (i < halfLen) {
      const leftIndex = (i << 1) + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = leftIndex;

      if (rightIndex < len && this.heap[rightIndex].sortIndex < this.heap[leftIndex].sortIndex) {
        smallestIndex = rightIndex;
      }

      if (this.heap[smallestIndex].sortIndex < this.heap[i].sortIndex) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[smallestIndex];
        this.heap[smallestIndex] = temp;
        i = smallestIndex;
      } else {
        break;
      }
    }
  }
}

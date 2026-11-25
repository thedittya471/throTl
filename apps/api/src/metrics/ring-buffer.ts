export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private capacity: number;
  private head: number = 0;
  private count: number = 0;

  constructor(capacity: number = 100) {
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than zero");
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      const index = (this.head + this.count) % this.capacity;
      this.buffer[index] = item;
      this.count++;
    } else {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  size(): number {
    return this.count;
  }

  getCapacity(): number {
    return this.capacity;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(undefined);
  }

  toArray(): T[] {
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity] as T;
    }
    return result;
  }
}

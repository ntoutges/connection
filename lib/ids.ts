export class Ids {
  private readonly freeIds: number[] = [];
  private readonly freeIdsMap = new Map<number, number>();
  private readonly usedIds = new Set<number>();
  private maxId: number = 0;

  generateId(): number {
    if (this.freeIds.length == 0) {
      const id = ++this.maxId;
      this.usedIds.add(id);
      return id;
    }
    const id = this.freeIds.pop();
    this.freeIdsMap.delete(id);
    this.usedIds.add(id);
    return id;
  }

  reserveId(id: number) {
    if (this.freeIdsMap.has(id)) {
      this.freeIdsMap.delete(id);
      return true; // success
    }
    else if (this.usedIds.has(id)) {
      return false; // failure; id in use
    }

    this.usedIds.add(id);
    this.maxId = Math.max(this.maxId, id); // ensure no collisions
    return true; // success
  }

  releaseId(id: number) {
    if (!this.usedIds.has(id)) return;
    this.usedIds.delete(id);
    this.freeIdsMap.set(id, this.freeIds.length); // save array index
    this.freeIds.push(id);

    this.pruneFreeIds(id);
  }

  // attempts to decrease [maxId] as much as possible
  private pruneFreeIds(releasedId: number) {
    if (releasedId != this.maxId) return; // released id must be the last
    while (this.maxId > 0) {
      if (this.freeIdsMap.has(this.maxId)) {
        this.freeIds.splice(this.freeIdsMap.get(this.maxId),1); // dete from array
        this.freeIdsMap.delete(this.maxId);
        this.maxId--;
      }
      else break; // last id still in use
    }
  }

  getIdsInUse() {
    return Array.from(this.usedIds);
  }

  isInUse(id: number) {
    return this.usedIds.has(id);
  }
}
// A set where accessing an element removes it
export class TempSet extends Set {
    has(value) {
        return this.delete(value);
    }
}
//# sourceMappingURL=tempSet.js.map
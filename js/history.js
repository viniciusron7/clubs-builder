/* Small immutable undo/redo history used by the builder and Node tests. */
window.BuildHistory = {
  create(limit = 100) {
    const undoStack = [];
    const redoStack = [];
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    return {
      record(before, after) {
        if (same(before, after)) return false;
        undoStack.push(clone(before));
        if (undoStack.length > limit) undoStack.shift();
        redoStack.length = 0;
        return true;
      },
      undo(current) {
        if (!undoStack.length) return { changed: false, state: current };
        redoStack.push(clone(current));
        return { changed: true, state: undoStack.pop() };
      },
      redo(current) {
        if (!redoStack.length) return { changed: false, state: current };
        undoStack.push(clone(current));
        if (undoStack.length > limit) undoStack.shift();
        return { changed: true, state: redoStack.pop() };
      },
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      clear() {
        undoStack.length = 0;
        redoStack.length = 0;
      },
    };
  },
};

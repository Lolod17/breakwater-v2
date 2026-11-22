const listeners = new Map();

export function on(name, fn) {
  if (typeof fn !== 'function') return;
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(fn);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of [...set]) fn(payload);
}

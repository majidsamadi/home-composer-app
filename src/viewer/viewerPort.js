// HCA side of the ARC shared viewer interface (plan X.8.1, viewer-interface.v0.4.json).
// Status: component-tested (synthetic data only). HCA never imports ARC code: this
// module mirrors the versioned surface and checks any injected viewer against it.

export const VIEWER_INTERFACE_VERSION = "wisestay.viewer/1.0.0-draft";

export const RENDERER_LABELS = Object.freeze({
  webgpu: "WebGPU view",
  "webgl2-compatibility": "Compatibility view (WebGL2) — not WebGPU",
  unsupported: "3D view not supported on this device yet"
});

export const VIEWER_METHODS = Object.freeze([
  "capability", "load", "setInstances", "setCameraMode", "orbit", "zoom", "focus",
  "select", "highlight", "showUncertainty", "describe", "on", "dispose"
]);

export const VIEWER_EVENTS = Object.freeze(["capability", "loaded", "selection", "device-lost", "error", "disposed"]);

export const DESCRIBE_MAX_CHARS = 600;

function major(version) {
  const match = /^wisestay\.viewer\/(\d+)\./.exec(String(version ?? ""));
  return match ? Number(match[1]) : null;
}

// Throws TypeError when the injected viewer does not match the interface the app was built for.
export function assertViewerContract(viewer) {
  if (!viewer || typeof viewer !== "object") throw new TypeError("viewer is required");
  if (major(viewer.interfaceVersion) !== major(VIEWER_INTERFACE_VERSION)) {
    throw new TypeError(`unsupported viewer interface ${viewer.interfaceVersion}`);
  }
  for (const method of VIEWER_METHODS) {
    if (typeof viewer[method] !== "function") throw new TypeError(`viewer.${method} is missing`);
  }
  const capability = viewer.capability();
  if (!Object.hasOwn(RENDERER_LABELS, capability?.renderer)) throw new TypeError("unknown renderer kind");
  if (capability.label !== RENDERER_LABELS[capability.renderer]) throw new TypeError("renderer label must be shown verbatim");
  if (capability.countsAsWebGPU !== (capability.renderer === "webgpu")) throw new TypeError("only webgpu counts as WebGPU");
  return viewer;
}

// Status text for the renderer. Compatibility is never presented as WebGPU.
export function rendererStatusText(capability) {
  const label = RENDERER_LABELS[capability?.renderer] ?? RENDERER_LABELS.unsupported;
  return capability?.reason && capability.renderer !== "webgpu" ? `${label} · ${capability.reason}` : label;
}

// Fallback viewer used when no viewer is wired (the default composition).
export function createUnavailableViewer(reason = "No 3D viewer is connected in this build") {
  const listeners = new Map();
  let disposed = false;
  const capability = Object.freeze({ renderer: "unsupported", label: RENDERER_LABELS.unsupported, countsAsWebGPU: false, reason });
  const unsupported = () => Object.assign(new Error(RENDERER_LABELS.unsupported), { code: "UNSUPPORTED" });
  return {
    interfaceVersion: VIEWER_INTERFACE_VERSION,
    capability: () => capability,
    async load() { throw unsupported(); },
    async setInstances() {},
    setCameraMode() {},
    orbit() {},
    zoom() {},
    focus() {},
    select() {},
    highlight() {},
    showUncertainty() {},
    describe: () => `${RENDERER_LABELS.unsupported}. ${reason}. No asset loaded, 0 nodes. Selected: none. 0 uncertainty regions.`.slice(0, DESCRIBE_MAX_CHARS),
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)); };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const listener of listeners.get("disposed") ?? []) listener({});
      listeners.clear();
    }
  };
}

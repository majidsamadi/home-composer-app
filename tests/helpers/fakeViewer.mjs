// Recording fake of the ARC shared viewer (X.8.1, viewer-interface.v0.4.json).
// Implements every listed method and event; HCA never imports ARC code.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VIEWER_INTERFACE_VERSION = "wisestay.viewer/1.0.0-draft";
const LABELS = {
  webgpu: "WebGPU view",
  "webgl2-compatibility": "Compatibility view (WebGL2) — not WebGPU",
  unsupported: "3D view not supported on this device yet"
};

export const GLB_PATH = fileURLToPath(new URL("../../contracts/draft/v0.4/fixtures/assets/synthetic-unit-box.glb", import.meta.url));
export function loadGlbBytes() {
  const bytes = readFileSync(GLB_PATH);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createFakeViewer({ renderer = "webgpu", interfaceVersion = VIEWER_INTERFACE_VERSION, failLoad = null } = {}) {
  const calls = [];
  const listeners = new Map();
  let loaded = null;
  let instances = [];
  let selected = null;
  let overlays = [];
  let distance = 6;
  let mode = "orbit";
  let disposeCount = 0;
  const record = (method, ...args) => calls.push({ method, args });
  const emit = (event, payload) => { for (const listener of [...(listeners.get(event) ?? [])]) listener(payload); };
  const capability = { renderer, label: LABELS[renderer], countsAsWebGPU: renderer === "webgpu" };
  const viewer = {
    interfaceVersion,
    capability() { record("capability"); return capability; },
    async load(source, options) {
      record("load", source, options);
      if (failLoad) throw Object.assign(new Error(failLoad), { code: failLoad });
      // Contract: verify component sha256 before parse.
      for (const component of source.envelope.components) {
        const raw = source.components[component.component_id];
        const buffer = typeof raw === "function" ? await raw() : raw;
        const digest = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
        if (digest !== component.sha256) {
          emit("error", { code: "COMPONENT_DIGEST_MISMATCH" });
          throw Object.assign(new Error("digest mismatch"), { code: "COMPONENT_DIGEST_MISMATCH" });
        }
      }
      loaded = { assetId: source.envelope.asset_id, version: source.envelope.version, kind: source.envelope.kind,
        nodes: [{ nodeId: "unit-box", label: "unit-box", bounds: source.envelope.bounds_m }], triangles: 12 };
      emit("loaded", loaded);
      return loaded;
    },
    async setInstances(next) { record("setInstances", next); instances = next; },
    setCameraMode(next) { record("setCameraMode", next); mode = next; },
    orbit(yaw, pitch) { record("orbit", yaw, pitch); },
    zoom(factor) { record("zoom", factor); distance = Math.min(10000, Math.max(0.05, distance / factor)); },
    focus(target) { record("focus", target); },
    select(nodeId) { record("select", nodeId); selected = nodeId; },
    highlight(ids) { record("highlight", ids); },
    showUncertainty(next) { record("showUncertainty", next); overlays = next; },
    describe() {
      record("describe");
      const asset = loaded ? `${loaded.kind} ${loaded.assetId} version ${loaded.version}` : "no asset";
      return `${capability.label}. ${asset}. ${loaded ? loaded.nodes.length : 0} nodes. Selected: ${selected ?? "none"}. ${overlays.length} uncertainty regions. Camera ${mode} ${distance.toFixed(2)} m.`.slice(0, 600);
    },
    on(event, listener) {
      record("on", event);
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener));
    },
    async dispose() {
      record("dispose");
      disposeCount += 1;
      if (disposeCount === 1) emit("disposed", {});
    },
    // Test controls.
    calls,
    emit,
    get instances() { return instances; },
    get overlays() { return overlays; },
    get disposeCount() { return disposeCount; },
    listenerCount: event => (listeners.get(event) ?? []).length
  };
  return viewer;
}

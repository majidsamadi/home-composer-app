// Synthetic workspace fixtures (HCA-02/03/04/06/07). Prototype / synthetic / not connected.
// IDs, users and objects are synthetic only; nothing here is a real home, object or account.
import { RENDERER_LABELS, VIEWER_INTERFACE_VERSION } from "../viewer/viewerPort.js";

const id = (prefix, n) => `${prefix}_01HZYSYNTH${String(n).padStart(16, "0")}`;

export const SYNTHETIC = Object.freeze({
  designId: id("dsg", 1),
  emptyDesignId: id("dsg", 2),
  sceneId: id("scn", 1),
  objects: Object.freeze({
    box: id("obj", 1),
    shelf: id("obj", 2),
    lamp: id("obj", 3),
    withdrawn: id("obj", 4),
    viewOnly: id("obj", 5),
    hidden: id("obj", 6)
  }),
  placements: Object.freeze({ p1: id("plc", 1), p2: id("plc", 2) }),
  users: Object.freeze({ owner: "USER-A", commenter: "USER-B", viewer: "USER-C", editor: "USER-D", stranger: "USER-E" })
});

export const SYNTHETIC_GLB_SHA256 = "c18f2e9260e2bc4567c7d97d1397f3240694a0c5f14beeb0d69e85b576da0b1a";
export const SYNTHETIC_GLB_BYTES = 812;
// Same-origin path of the v0.4 synthetic unit box (DRAFT fixture; read-only).
export const SYNTHETIC_GLB_URL = "./contracts/draft/v0.4/fixtures/assets/synthetic-unit-box.glb";

const geometryComponent = Object.freeze({
  component_id: "main", role: "geometry", media_type: "model/gltf-binary",
  sha256: SYNTHETIC_GLB_SHA256, bytes: SYNTHETIC_GLB_BYTES
});

function envelope({ assetId, kind, app, bounds, scaleClaim, unobserved = [] }) {
  return {
    schema: "wisestay.asset-envelope.v1",
    asset_id: assetId,
    kind,
    version: "1",
    producer: { engine: "three-dimension-view-arcore", engine_version: "0.2.0", app },
    components: [{ ...geometryComponent }],
    frame: { handedness: "right", up: "+Y", units: "metre" },
    bounds_m: bounds,
    scale_claim: scaleClaim,
    unobserved_regions: unobserved,
    provenance: { capture_mode: "local", cloud_refinement: false, content_class: "synthetic", permission_record_id: null },
    audience_projection_id: null
  };
}

function objectFacts({ objectId, claim, dims, evidenceClass, callerAllowedUse = { default: ["view", "place"] }, state = "validated", variants = [] }) {
  const half = dims ? dims.map(value => value / 2) : [0.5, 0.5, 0.5];
  return {
    object_id: objectId,
    version: "1",
    state,
    envelope: envelope({
      assetId: objectId, kind: "object", app: "object-scanner",
      bounds: { min: [-half[0], 0, -half[2]], max: [half[0], dims ? dims[1] : 1, half[2]] },
      scaleClaim: claim
    }),
    dimension_evidence: dims ? [{
      class: evidenceClass, dimensions_m: dims, evidence_id: `evd_${objectId.slice(4)}`,
      orientation: { front: "-Z", up: "+Y" }, recorded_at: "2026-10-20T00:00:00Z", recorded_by: "USER-A",
      reference_point: "bottom-centre", uncertainty_m: dims.map(() => 0.01), verification_record_id: null
    }] : [],
    effective_scale_claim: claim,
    effective_dimensions_m: dims,
    variants,
    allowed_use: ["view", "place"],
    // Fixture-only: per-user caller_allowed_use, resolved by the fake reader.
    caller_allowed_use_by_user: callerAllowedUse
  };
}

function placement(placementId, objectId, position, rotation, dims, claim) {
  return {
    placement_id: placementId,
    object_source: { object_id: objectId, version: "1" },
    transform: { position_m: position, rotation_deg_y: rotation },
    scale_mode: "real",
    illustrative_scale: null,
    dimensions_m: dims,
    scale_claim: claim,
    hidden: false
  };
}

export function syntheticWorkspaceSeed() {
  const { objects, users, placements } = SYNTHETIC;
  const homeBounds = { min: [-2, 0, -2], max: [2, 2.5, 2] };
  return {
    clockStart: "2026-10-20T00:00:00Z",
    homes: {
      [`${SYNTHETIC.sceneId}@1`]: {
        scene_id: SYNTHETIC.sceneId,
        version: "1",
        bounds_m: homeBounds,
        scale_claim: "reference-supported",
        envelope: envelope({
          assetId: SYNTHETIC.sceneId, kind: "home", app: "home-scanner", bounds: homeBounds,
          scaleClaim: "reference-supported",
          unobserved: [{ region_id: "r1", bounds_m: { min: [1.5, 0, 1.5], max: [2, 2.5, 2] }, label: "Not observed" }]
        })
      }
    },
    objects: {
      [`${objects.box}@1`]: objectFacts({
        objectId: objects.box, claim: "reference-supported", dims: [1, 1, 1], evidenceClass: "creator-measured",
        variants: [{ link_status: "declared", merchant_id: id("mer", 1), product_id: id("prd", 1), variant_id: id("var", 1), variant_link_id: id("vln", 1) }]
      }),
      [`${objects.shelf}@1`]: objectFacts({ objectId: objects.shelf, claim: "seller-declared", dims: [0.8, 1.8, 0.4], evidenceClass: "seller-declared" }),
      [`${objects.lamp}@1`]: objectFacts({ objectId: objects.lamp, claim: "unknown", dims: null, evidenceClass: null }),
      [`${objects.withdrawn}@1`]: objectFacts({ objectId: objects.withdrawn, claim: "estimated", dims: [0.5, 0.5, 0.5], evidenceClass: "estimated", state: "withdrawn" }),
      [`${objects.viewOnly}@1`]: objectFacts({ objectId: objects.viewOnly, claim: "estimated", dims: [0.6, 0.4, 0.6], evidenceClass: "estimated", callerAllowedUse: { default: ["view"] } }),
      [`${objects.hidden}@1`]: objectFacts({ objectId: objects.hidden, claim: "estimated", dims: [0.3, 0.3, 0.3], evidenceClass: "estimated", callerAllowedUse: { default: [], [users.owner]: [] } })
    },
    designs: [
      {
        design_id: SYNTHETIC.designId,
        title: "Synthetic plan",
        context_kind: "private_planning",
        home_source: { scene_id: SYNTHETIC.sceneId, version: "1" },
        property_id: "PROP-VIRTUAL-1",
        owner: users.owner,
        shares: [
          { share_id: id("shr", 11), grantee_user_id: users.commenter, role: "commenter", state: "accepted" },
          { share_id: id("shr", 12), grantee_user_id: users.viewer, role: "viewer", state: "accepted" },
          { share_id: id("shr", 13), grantee_user_id: users.editor, role: "editor", state: "accepted" }
        ],
        branches: [{
          branch_id: "main",
          name: "Main",
          base_revision: 1,
          revisions: [
            { revision: 1, placements: [], created_by: users.owner, created_at: "2026-10-20T00:00:00Z", parent_revision: null },
            {
              revision: 2,
              placements: [
                placement(placements.p1, objects.box, [1, 0, 1], 90, [1, 1, 1], "reference-supported"),
                placement(placements.p2, objects.shelf, [-1, 0, -1.5], 0, [0.8, 1.8, 0.4], "seller-declared")
              ],
              created_by: users.owner,
              created_at: "2026-10-20T00:00:00Z",
              parent_revision: 1
            }
          ]
        }]
      },
      {
        design_id: SYNTHETIC.emptyDesignId,
        title: "Empty synthetic plan",
        context_kind: "non_property_sandbox",
        home_source: { scene_id: SYNTHETIC.sceneId, version: "1" },
        property_id: null,
        owner: users.owner,
        shares: [],
        branches: [{
          branch_id: "main", name: "Main", base_revision: 1,
          revisions: [{ revision: 1, placements: [], created_by: users.owner, created_at: "2026-10-20T00:00:00Z", parent_revision: null }]
        }]
      }
    ]
  };
}

// Asset source: turns a view-session grant into a SceneSource for viewer.load.
// The component bytes are fetched lazily from the same-origin synthetic GLB.
export function createSyntheticAssetSource({ seed = syntheticWorkspaceSeed(), loadBytes } = {}) {
  const bytes = loadBytes ?? (() => fetch(SYNTHETIC_GLB_URL).then(response => response.arrayBuffer()));
  return Object.freeze({
    home({ scene_id, version }) {
      const home = seed.homes[`${scene_id}@${version}`];
      if (!home) return null;
      return { envelope: structuredClone(home.envelope), components: { main: bytes } };
    },
    object({ object_id, version }) {
      const facts = seed.objects[`${object_id}@${version}`];
      if (!facts) return null;
      return { envelope: structuredClone(facts.envelope), components: { main: bytes } };
    }
  });
}

async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

// Text-only synthetic viewer for the review page. It implements the X.8.1 shared
// viewer surface but draws nothing: describe() is the only output.
export function createSyntheticViewer({ renderer = "webgl2-compatibility" } = {}) {
  const listeners = new Map();
  const capability = Object.freeze({
    renderer, label: RENDERER_LABELS[renderer], countsAsWebGPU: renderer === "webgpu",
    reason: renderer === "webgpu" ? undefined : "Synthetic review viewer: nothing is rendered"
  });
  let loaded = null;
  let instances = [];
  let selected = null;
  let overlays = [];
  let cameraMode = "orbit";
  let distance = 6;
  let disposed = false;
  const emit = (event, payload) => { for (const listener of listeners.get(event) ?? []) listener(payload); };
  const viewer = {
    interfaceVersion: VIEWER_INTERFACE_VERSION,
    capability: () => capability,
    async load(source, options = {}) {
      if (disposed) throw Object.assign(new Error("viewer disposed"), { code: "DISPOSED" });
      if (renderer === "unsupported") throw Object.assign(new Error("unsupported"), { code: "UNSUPPORTED" });
      for (const component of source.envelope.components) {
        const raw = source.components[component.component_id];
        const buffer = typeof raw === "function" ? await raw() : raw;
        if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { code: "ABORTED" });
        if (!buffer || await sha256Hex(buffer) !== component.sha256) {
          emit("error", { code: "COMPONENT_DIGEST_MISMATCH" });
          throw Object.assign(new Error("component digest mismatch"), { code: "COMPONENT_DIGEST_MISMATCH" });
        }
      }
      loaded = { assetId: source.envelope.asset_id, version: source.envelope.version, kind: source.envelope.kind,
        nodes: [{ nodeId: "unit-box", label: "unit-box", bounds: source.envelope.bounds_m }], triangles: 12 };
      emit("loaded", loaded);
      return loaded;
    },
    async setInstances(next) { instances = next.map(item => ({ ...item })); },
    setCameraMode(mode) { cameraMode = mode === "top" ? "top" : "orbit"; },
    orbit() {},
    zoom(factor) { distance = Math.min(10000, Math.max(0.05, distance / factor)); },
    focus() {},
    select(nodeId) { selected = nodeId; emit("selection", { nodeId, label: nodeId }); },
    highlight() {},
    showUncertainty(next) { overlays = [...next]; },
    describe() {
      const asset = loaded ? `${loaded.kind} ${loaded.assetId} version ${loaded.version}` : "no asset loaded";
      return `${capability.label}. ${asset}. ${loaded ? loaded.nodes.length : 0} nodes, ${instances.length} placed objects. Camera ${cameraMode}, ${distance.toFixed(2)} m. Selected: ${selected ?? "none"}. ${overlays.length} uncertainty regions.`.slice(0, 600);
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener)); };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      emit("disposed", {});
      listeners.clear();
    },
    // Fixture-only control for the review page: simulate a lost GPU device.
    simulateDeviceLost() { emit("device-lost", { reason: "synthetic device loss", recoverable: true }); }
  };
  return viewer;
}

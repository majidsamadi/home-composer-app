// HCA consumer checks against the v0.4 DRAFT/SYNTHETIC composer fixture (plan X.4).
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadFixture } from "../scripts/check-contract-fixtures-v0_4.mjs";
import { COMPOSER_ROUTES, PROBLEM_TITLES, ServiceProblem, THRESHOLDS_VERSION } from "../src/service/composerApi.js";
import { createComposerHttpApi, createDisconnectedTransport } from "../src/service/composerHttpApi.js";
import { computeFit, createFakeComposerApi } from "../src/service/fakeComposerApi.js";
import { SYNTHETIC, syntheticWorkspaceSeed } from "../src/fixtures/workspaceFixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const composer = loadFixture(ROOT, "api/composer.v0.4.json");
const conventions = loadFixture(ROOT, "common/conventions.v0.4.json");
const { designId, placements, objects } = SYNTHETIC;
const sortedKeys = value => Object.keys(value).sort();
let keySeq = 0;
const key = () => `contract-key-${String(keySeq += 1).padStart(4, "0")}`;

const operationOf = route => COMPOSER_ROUTES.find(item => item.id === route.id && item.path === route.path)?.operation;

test("HCA X.4 fake routes/keys equal composer.v0.4.json; BFF paths", async () => {
  assert.equal(composer.status, "DRAFT_SYNTHETIC_NOT_FROZEN");
  assert.deepEqual(
    composer.routes.map(route => [route.id, route.method, route.path, route.idempotency_key, route.expected_version]),
    COMPOSER_ROUTES.map(route => [route.id, route.method, route.path, route.idempotency, route.expectedVersion])
  );
  const fake = createFakeComposerApi({ seed: syntheticWorkspaceSeed() });
  const http = createComposerHttpApi();
  const operations = COMPOSER_ROUTES.map(route => route.operation).sort();
  assert.deepEqual(Object.keys(fake.api).sort(), operations);
  assert.deepEqual(Object.keys(http).sort(), operations);

  // Every route goes through the BFF template with only pass-through headers.
  const sent = [];
  const recording = createComposerHttpApi({
    transport: async (method, path, request) => { sent.push({ method, path, request }); return { status: 200, headers: {}, body: {} }; }
  });
  const template = conventions.bff.path_template;
  for (const route of composer.routes) {
    const example = route.request_example;
    await recording[operationOf(route)]({
      params: example.path_params, query: example.query, body: example.body, idempotencyKey: example.headers["Idempotency-Key"]
    });
    const call = sent.at(-1);
    const expandedPath = route.path.replace(/\{([a-z_]+)\}/g, (_, name) => example.path_params[name]);
    const query = Object.entries(example.query).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const expected = template.replace("{app}", "composer").replace("{service}", composer.bff_service).replace("{path}", expandedPath) + (query ? `?${query}` : "");
    assert.equal(call.path, expected, route.id);
    assert.equal(call.method, route.method, route.id);
    for (const header of Object.keys(call.request.headers)) assert.ok(conventions.bff.request_headers_passed.includes(header), `${route.id} ${header}`);
    assert.equal("Authorization" in call.request.headers, false, "the BFF adds the bearer, never the app");
    assert.equal(call.request.headers["Idempotency-Key"], route.idempotency_key === "required" ? example.headers["Idempotency-Key"] : undefined, route.id);
    if (route.method === "POST" || route.method === "PATCH") assert.deepEqual(JSON.parse(call.request.body), example.body ?? {}, route.id);
    else assert.equal(call.request.body, undefined, route.id);
    for (const segment of expandedPath.split("/")) assert.equal(conventions.bff.forbidden_path_segments.includes(segment), false, `${route.id} ${segment}`);
    if (route.expected_version === "query") assert.ok(Object.keys(example.query).length, `${route.id} version in query`);
  }

  // Drive the fake through every route and compare response keys with the fixture examples.
  const A = fake.forUser("USER-A");
  const E = fake.forUser("USER-E");
  const results = {};
  results.C01 = await A.createDesign({ body: { title: "Synthetic plan", context_kind: "private_planning", home_source: { scene_id: SYNTHETIC.sceneId, version: "1" }, property_id: "PROP-VIRTUAL-1" }, idempotencyKey: key() });
  results.C02 = await A.listDesigns({ query: { status: "active", limit: 20 } });
  results.C03 = await A.getDesign({ params: { design_id: designId } });
  results.C04 = await A.getRevision({ params: { design_id: designId, branch_id: "main", revision: 2 } });
  const branch = { design_id: designId, branch_id: "main" };
  results.C06 = await A.addPlacement({ params: branch, body: { object_source: { object_id: objects.box, version: "1" }, transform: { position_m: [0, 0, 0], rotation_deg_y: 0 }, scale_mode: "real", illustrative_scale: null, expected_revision: 2 }, idempotencyKey: key() });
  results.C07 = await A.updatePlacement({ params: { ...branch, placement_id: results.C06.placement_id }, body: { transform: { position_m: [0.5, 0, 0], rotation_deg_y: 0 }, expected_revision: 3 } });
  results.C09 = await A.duplicatePlacement({ params: { ...branch, placement_id: results.C06.placement_id }, body: { expected_revision: 4, offset_m: [0.5, 0, 0] }, idempotencyKey: key() });
  results.C08 = await A.removePlacement({ params: { ...branch, placement_id: results.C09.placement_id }, query: { expected_revision: 5 } });
  results.C10 = await A.createAlternative({ params: { design_id: designId }, body: { name: "Alternative A", from_branch_id: "main", base_revision: 2 }, idempotencyKey: key() });
  results.C11 = await A.compare({ params: { design_id: designId }, query: { a: "main@1", b: "main@2" } });
  results.C12 = await A.restoreRevision({ params: branch, body: { to_revision: 2, expected_revision: 6 }, idempotencyKey: key() });
  results.C13 = await A.assessFit({ params: { design_id: designId }, body: { branch_id: "main", revision: 7, placement_id: placements.p1, question: "clearance", clearance_margin_m: 0.3 }, idempotencyKey: key() });
  results.C14 = await A.shareDesign({ params: { design_id: designId }, body: { grantee_user_id: "USER-E", role: "commenter", expires_at: null }, idempotencyKey: key() });
  results["C15/accept"] = await E.acceptShare({ params: { share_id: results.C14.share_id }, body: {}, idempotencyKey: key() });
  results.C16 = await A.updateShare({ params: { design_id: designId, share_id: results.C14.share_id }, body: { role: "editor", expected_version: 2 } });
  results.C17 = await A.revokeShare({ params: { design_id: designId, share_id: results.C14.share_id }, query: { expected_version: 3 } });
  const second = await A.shareDesign({ params: { design_id: designId }, body: { grantee_user_id: "USER-E", role: "viewer", expires_at: null }, idempotencyKey: key() });
  results["C15/decline"] = await E.declineShare({ params: { share_id: second.share_id }, body: {}, idempotencyKey: key() });
  results.C18 = await A.shareObject({ body: { object_source: { object_id: objects.box, version: "1" }, grantee_user_id: "USER-E", note: "synthetic" }, idempotencyKey: key() });
  results.C19 = await E.getObjectShare({ params: { object_share_id: results.C18.object_share_id } });
  results.C20 = await A.addComment({ params: { design_id: designId }, body: { branch_id: "main", revision: 7, anchor: { kind: "placement", placement_id: placements.p1 }, body: "Synthetic comment", reply_to: null }, idempotencyKey: key() });
  results.C21 = await A.listComments({ params: { design_id: designId }, query: { branch_id: "main", revision: 7 } });
  results.C22 = await A.resolveComment({ params: { comment_id: results.C20.comment_id }, body: { expected_version: 1 }, idempotencyKey: key() });
  results.C23 = await A.createViewSession({ params: { design_id: designId }, body: { branch_id: "main", revision: 7 }, idempotencyKey: key() });
  results.C05 = await A.archiveDesign({ params: { design_id: results.C01.design_id }, body: { expected_version: 1 }, idempotencyKey: key() });

  for (const route of composer.routes) {
    const name = route.id === "C15" ? `C15/${route.path.split("/").at(-1)}` : route.id;
    const actual = results[name];
    assert.ok(actual, `${name} exercised`);
    assert.deepEqual(sortedKeys(actual), sortedKeys(route.response_example), `${name} response keys`);
    for (const nested of ["placement", "fit", "home"]) {
      if (route.response_example[nested]) assert.deepEqual(sortedKeys(actual[nested]), sortedKeys(route.response_example[nested]), `${name}.${nested}`);
    }
    for (const list of ["items", "placements", "branches", "objects", "differences"]) {
      if (route.response_example[list]?.length) assert.deepEqual(sortedKeys(actual[list][0]), sortedKeys(route.response_example[list][0]), `${name}.${list}[0]`);
    }
  }
  assert.deepEqual(sortedKeys(results.C11.b.placements[0]), sortedKeys(composer.routes.find(route => route.id === "C11").response_example.b.placements[0]));
  assert.equal(results.C13.thresholds_version, composer.fit_rules.thresholds_version);
  assert.equal(results.C13.outcome, "verified_fit");
  assert.equal(results.C12.restored_from, 2);
});

test("HCA X.4 fit rules: verified, unverified, approximate and unknown outcomes", async () => {
  const seed = syntheticWorkspaceSeed();
  const home = seed.homes[`${SYNTHETIC.sceneId}@1`];
  const [p1, p2] = seed.designs[0].branches[0].revisions[1].placements;
  assert.equal(THRESHOLDS_VERSION, composer.fit_rules.thresholds_version);
  // u_obj = max(0.01, 0.03·1) = 0.03; u_room = max(0.05, 0.02·4) = 0.08; sqrt → 0.0854.
  const verified = computeFit({ placement: p1, home, question: "clearance", clearanceMarginM: 0.3 });
  assert.deepEqual(verified, { outcome: "verified_fit", reasons: [], thresholds_version: THRESHOLDS_VERSION, combined_uncertainty_m: 0.0854, margin_m: 0.3 });
  assert.equal(computeFit({ placement: p1, home, question: "clearance", clearanceMarginM: 0.08 }).outcome, "unverified_fit");
  assert.deepEqual(computeFit({ placement: p1, home }).reasons, ["clearance_not_requested"]);
  // Footprint margin: rotated 1 m box at x=1, z=1 inside a 4 m room → 0.5 m.
  assert.equal(computeFit({ placement: p1, home, question: "footprint" }).margin_m, 0.5);
  const outside = { ...p1, transform: { position_m: [1.8, 0, 1], rotation_deg_y: 0 } };
  assert.deepEqual(computeFit({ placement: outside, home, question: "footprint" }).reasons, ["footprint_outside_home_bounds"]);
  const approximate = computeFit({ placement: p2, home, question: "clearance", clearanceMarginM: 0.3 });
  assert.equal(approximate.outcome, "approximate");
  assert.deepEqual(approximate.reasons, ["scale_claim_approximate"]);
  const illustrative = computeFit({ placement: { ...p1, scale_mode: "illustrative", illustrative_scale: 2 }, home, question: "clearance", clearanceMarginM: 0.3 });
  assert.deepEqual([illustrative.outcome, illustrative.reasons, illustrative.combined_uncertainty_m], ["unknown", ["illustrative_scale_mode"], null]);
  assert.equal(computeFit({ placement: { ...p1, scale_claim: "unknown" }, home }).outcome, "unknown");
  assert.equal(computeFit({ placement: p1, home: { ...home, scale_claim: "estimated" }, question: "clearance", clearanceMarginM: 0.3 }).outcome, "approximate");

  // Through the routes: unknown scale is refused in real mode, accepted as illustrative with fit unknown.
  const fake = createFakeComposerApi({ seed });
  const body = mode => ({
    object_source: { object_id: objects.lamp, version: "1" }, transform: { position_m: [0, 0, 0], rotation_deg_y: 0 },
    scale_mode: mode, illustrative_scale: mode === "illustrative" ? 1 : null, expected_revision: 2
  });
  await assert.rejects(fake.api.addPlacement({ params: { design_id: designId, branch_id: "main" }, body: body("real"), idempotencyKey: key() }), { status: 422, code: "unsupported_scale" });
  const placed = await fake.api.addPlacement({ params: { design_id: designId, branch_id: "main" }, body: body("illustrative"), idempotencyKey: key() });
  assert.equal(placed.fit.outcome, "unknown");
  assert.equal(placed.placement.dimensions_m, null);
  await assert.rejects(fake.api.assessFit({ params: { design_id: designId }, body: { branch_id: "main", revision: 3, placement_id: placed.placement_id, question: "doorswing" }, idempotencyKey: key() }), { status: 422 });
});

test("HCA X.4 expected-version and expected-revision conflicts", async () => {
  const fake = createFakeComposerApi({ seed: syntheticWorkspaceSeed() });
  const A = fake.api;
  const p1 = { design_id: designId, branch_id: "main", placement_id: placements.p1 };
  await assert.rejects(A.updatePlacement({ params: p1, body: { hidden: true, expected_revision: 1 } }), problem => {
    assert.ok(problem instanceof ServiceProblem);
    assert.deepEqual([problem.status, problem.code, problem.currentRevision], [409, "version_conflict", 2]);
    return true;
  });
  await assert.rejects(A.removePlacement({ params: p1, query: { expected_revision: 9 } }), { status: 409, currentRevision: 2 });
  await assert.rejects(A.restoreRevision({ params: { design_id: designId, branch_id: "main" }, body: { to_revision: 1, expected_revision: 1 }, idempotencyKey: key() }), { status: 409 });
  await assert.rejects(A.archiveDesign({ params: { design_id: designId }, body: { expected_version: 7 }, idempotencyKey: key() }), { status: 409, code: "version_conflict", currentVersion: 1 });
  const share = await A.shareDesign({ params: { design_id: designId }, body: { grantee_user_id: "USER-E", role: "viewer", expires_at: null }, idempotencyKey: key() });
  await assert.rejects(A.updateShare({ params: { design_id: designId, share_id: share.share_id }, body: { role: "editor", expected_version: 5 } }), { status: 409, currentVersion: 1 });
  await assert.rejects(A.revokeShare({ params: { design_id: designId, share_id: share.share_id }, query: { expected_version: 5 } }), { status: 409 });
  const comment = await A.addComment({ params: { design_id: designId }, body: { branch_id: "main", revision: 2, anchor: { kind: "design" }, body: "x", reply_to: null }, idempotencyKey: key() });
  await A.resolveComment({ params: { comment_id: comment.comment_id }, body: { expected_version: 1 }, idempotencyKey: key() });
  await assert.rejects(A.resolveComment({ params: { comment_id: comment.comment_id }, body: { expected_version: 1 }, idempotencyKey: key() }), { status: 409, currentVersion: 2 });
});

test("HCA X.1 idempotency keys: required, replayed, reuse refused", async () => {
  const fake = createFakeComposerApi({ seed: syntheticWorkspaceSeed() });
  const call = idempotencyKey => fake.api.restoreRevision({ params: { design_id: designId, branch_id: "main" }, body: { to_revision: 1, expected_revision: 2 }, idempotencyKey });
  await assert.rejects(call(undefined), { status: 400, code: "idempotency_key_required" });
  await assert.rejects(call("short"), { status: 400, code: "idempotency_key_required" });
  const first = await call("restore-key-0001");
  const replay = await call("restore-key-0001");
  assert.deepEqual(replay, first, "same key and body replays the stored response");
  const design = await fake.api.getDesign({ params: { design_id: designId } });
  assert.equal(design.branches[0].head_revision, 3, "the replay did not create another revision");
  await assert.rejects(fake.api.restoreRevision({ params: { design_id: designId, branch_id: "main" }, body: { to_revision: 2, expected_revision: 3 }, idempotencyKey: "restore-key-0001" }), { status: 409, code: "idempotency_key_reuse" });
});

test("HCA X.4 role matrix and source checks in the fake", async () => {
  const fake = createFakeComposerApi({ seed: syntheticWorkspaceSeed() });
  const placeBody = objectId => ({ object_source: { object_id: objectId, version: "1" }, transform: { position_m: [0, 0, 0], rotation_deg_y: 0 }, scale_mode: "real", illustrative_scale: null, expected_revision: 2 });
  const params = { design_id: designId, branch_id: "main" };
  assert.deepEqual(composer.roles.viewer, { comment: false, edit: false, read: true, share_archive: false });
  await assert.rejects(fake.forUser("USER-B").addPlacement({ params, body: placeBody(objects.box), idempotencyKey: key() }), { status: 403, code: "action_denied" });
  await assert.rejects(fake.forUser("USER-C").addComment({ params: { design_id: designId }, body: { branch_id: "main", revision: 2, anchor: { kind: "design" }, body: "x", reply_to: null }, idempotencyKey: key() }), { status: 403 });
  await assert.rejects(fake.forUser("USER-D").shareDesign({ params: { design_id: designId }, body: { grantee_user_id: "USER-E", role: "viewer" }, idempotencyKey: key() }), { status: 403 });
  await assert.rejects(fake.forUser("USER-E").getDesign({ params: { design_id: designId } }), { status: 404, code: "not_found" });
  await assert.rejects(fake.forUser("USER-D").addPlacement({ params, body: placeBody(objects.viewOnly), idempotencyKey: key() }), problem => {
    assert.deepEqual([problem.status, problem.code, problem.reasons], [403, "action_denied", ["source_access_denied"]]);
    return true;
  });
  await assert.rejects(fake.forUser("USER-D").addPlacement({ params, body: { ...placeBody(objects.box), transform: { position_m: [Number.NaN, 0, 0], rotation_deg_y: 0 } }, idempotencyKey: key() }), { status: 422, code: "validation_failed" });
  const added = await fake.forUser("USER-D").addPlacement({ params, body: placeBody(objects.box), idempotencyKey: key() });
  assert.equal(added.placement.scale_mode, "real", "real size is the default");
  assert.deepEqual(added.placement.dimensions_m, [1, 1, 1], "dimensions come from effective_dimensions_m");

  // Every problem code the client knows is in the closed X.1 table.
  const closed = Object.values(conventions.error_codes).flat();
  for (const code of Object.keys(PROBLEM_TITLES)) assert.ok(closed.includes(code), code);
  for (const route of composer.routes) for (const error of route.errors) assert.ok(closed.includes(error.code), `${route.id} ${error.code}`);
});

test("HCA X.4 C23 fails per source, not globally", async () => {
  const fake = createFakeComposerApi({ seed: syntheticWorkspaceSeed() });
  fake.scenario.objectOutcomes[`${objects.shelf}@1`] = "unavailable";
  const session = await fake.api.createViewSession({ params: { design_id: designId }, body: { branch_id: "main", revision: 2 }, idempotencyKey: key() });
  assert.equal(session.home.outcome, "accessible");
  assert.ok(session.home.view_grant.view_grant_id.startsWith("vgr_"));
  assert.deepEqual(session.objects.map(item => [item.object_id, item.outcome, Boolean(item.use_grant)]), [[objects.box, "accessible", true], [objects.shelf, "unavailable", false]]);
});

test("HCA X.6 default transport is disconnected and never calls fetch", async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error("no fetch"); };
  try {
    const api = createComposerHttpApi();
    await assert.rejects(api.getDesign({ params: { design_id: designId } }), { status: 503, code: "dependency_unavailable" });
    const response = await createDisconnectedTransport()("GET", "/x", {});
    assert.equal(response.body.code, "dependency_unavailable");
    const failing = createComposerHttpApi({ transport: async () => { throw new Error("socket"); } });
    await assert.rejects(failing.listDesigns({}), { status: 503 });
    const conflict = createComposerHttpApi({ transport: async () => ({ status: 409, headers: { "Content-Type": "application/problem+json" }, body: { code: "version_conflict", status: 409, current_revision: 4 } }) });
    await assert.rejects(conflict.updatePlacement({ params: { design_id: designId, branch_id: "main", placement_id: placements.p1 }, body: { hidden: true, expected_revision: 3 } }), { status: 409, currentRevision: 4 });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetched, 0);
});

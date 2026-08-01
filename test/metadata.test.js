import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  knowledgeBaseFreshness,
  packageVersion,
  validateKnowledgeBase,
} from "../metadata.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const bundledKnowledgeBase = require("../knowledge-base.json");

const validKnowledgeBase = {
  _version: "1.2.0",
  _updatedAt: "2026-08-01T00:00:00Z",
  DEPRECATED: [],
  DOCS: {},
  VERSIONS: {},
};

test("package version is suitable for MCP server metadata", () => {
  assert.equal(packageVersion(packageJson), packageJson.version);
  assert.throws(() => packageVersion({}), /non-empty string/);
});

test("knowledge-base validation reports malformed required fields", () => {
  assert.deepEqual(validateKnowledgeBase(validKnowledgeBase), []);
  assert.deepEqual(validateKnowledgeBase(bundledKnowledgeBase), []);
  assert.deepEqual(validateKnowledgeBase({ ...validKnowledgeBase, DOCS: [] }), [
    "DOCS must be an object",
  ]);
  assert.deepEqual(validateKnowledgeBase(null), ["root must be an object"]);
});

test("knowledge-base freshness is deterministic at the boundary", () => {
  const now = new Date("2026-08-02T00:00:00Z");
  assert.equal(knowledgeBaseFreshness(validKnowledgeBase, now).status, "current");
  assert.equal(
    knowledgeBaseFreshness(
      { ...validKnowledgeBase, _updatedAt: "2026-06-01T00:00:00Z" },
      now
    ).status,
    "stale"
  );
  assert.equal(
    knowledgeBaseFreshness(
      { ...validKnowledgeBase, _updatedAt: "2026-03" },
      now
    ).status,
    "stale"
  );
  assert.equal(
    knowledgeBaseFreshness(
      { ...validKnowledgeBase, _updatedAt: "not-a-date" },
      now
    ).status,
    "unknown"
  );
});

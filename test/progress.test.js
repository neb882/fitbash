import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// docs/PROGRESS.json is what either session reads first after a restart, so it has to stay
// readable by a program and say only things that are there.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const progress = JSON.parse(readFileSync(path.join(root, "docs/PROGRESS.json"), "utf8"));
const orders = readdirSync(path.join(root, "docs/work-orders")).map((file) => file.match(/^(WO-\d+[a-z]?)-/)?.[1]);

test("the progress file has its parts, and every goal says what it decides and where it stands", () => {
  for (const key of ["updated", "about", "goals", "in_flight", "next", "dead_ends", "open_questions"]) {
    assert.ok(key in progress, key);
  }
  assert.match(progress.updated, /^\d{4}-\d{2}-\d{2}$/);
  const ids = progress.goals.map((goal) => goal.id);
  assert.equal(new Set(ids).size, ids.length, "goal ids are unique");
  for (const goal of progress.goals) {
    assert.ok(goal.name && goal.decides, goal.id);
    assert.ok(["open", "closed", "with_owner"].includes(goal.status), `${goal.id}: ${goal.status}`);
    // Three rounds of change-and-confirm, then the goal goes to the owner (docs/PIPELINE.md).
    assert.ok(Number.isInteger(goal.rounds) && goal.rounds >= 0 && goal.rounds <= 3, `${goal.id}: rounds`);
    if (goal.rounds === 3) assert.notEqual(goal.status, "open", `${goal.id} has had its three rounds`);
    if (goal.status === "closed") assert.ok(goal.outcome, `${goal.id} is closed without saying how`);
  }
});

test("every work order the progress file names exists, and one in flight says where its report will be", () => {
  const named = [...progress.goals.flatMap((goal) => goal.orders), ...progress.in_flight.map((flight) => flight.order)];
  for (const order of named) assert.ok(orders.includes(order), `${order} has no file in docs/work-orders`);
  for (const flight of progress.in_flight) {
    assert.ok(flight.with && flight.sent && flight.report, flight.order);
  }
});

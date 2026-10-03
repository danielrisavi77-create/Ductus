import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

// Proves the `property` project runs with fast-check; replaced by real suites
// from M0.2 and M0.3.
test.prop([fc.array(fc.integer())])("reversing twice is identity", (values) => {
  expect([...values].reverse().reverse()).toEqual(values);
});

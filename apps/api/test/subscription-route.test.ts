import { describe, expect, it } from "vitest";
import { serviceError } from "../src/routes/subscriptions.js";

describe("subscription service error mapping", () => {
  it("returns a client error for an unowned payment method", () => {
    let thrown: unknown;
    try {
      serviceError(new Error("payment_method_not_owned"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      statusCode: 400,
      code: "bad_request",
      message: "That payment method no longer exists.",
    });
  });
});

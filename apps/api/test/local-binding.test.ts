import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InstanceServer } from "../src/instance.js";
import { CoordinatorGateway } from "../src/coordinator/gateway.js";

describe("Commit 10.2: Local-only Loopback Bindings and Port Configurations", () => {
  it("defaults InstanceServer to 127.0.0.1 and respects host/port overrides", async () => {
    const defaultInstance = new InstanceServer({ port: 4181 });
    assert.equal(defaultInstance.host, "127.0.0.1");
    assert.equal(defaultInstance.port, 4181);

    const customInstance = new InstanceServer({ host: "127.0.0.2", port: 4182 });
    assert.equal(customInstance.host, "127.0.0.2");
    assert.equal(customInstance.port, 4182);
  });

  it("defaults CoordinatorGateway to 127.0.0.1 and aligns worker targets with loopback", async () => {
    const coordinator = new CoordinatorGateway({ port: 4180 });
    assert.equal(coordinator.host, "127.0.0.1");
    assert.equal(coordinator.port, 4180);
    assert.equal(coordinator.instances.length, 3);
    assert.equal(coordinator.instances[0].url, "http://127.0.0.1:4001");
    assert.equal(coordinator.instances[1].url, "http://127.0.0.1:4002");
    assert.equal(coordinator.instances[2].url, "http://127.0.0.1:4003");
  });

  it("respects INSTANCE_*_PORT environment variable overrides for cluster worker targets", () => {
    process.env.INSTANCE_1_PORT = "5001";
    process.env.INSTANCE_2_PORT = "5002";
    process.env.INSTANCE_3_PORT = "5003";

    try {
      const coordinator = new CoordinatorGateway({ port: 4190 });
      assert.equal(coordinator.instances[0].url, "http://127.0.0.1:5001");
      assert.equal(coordinator.instances[1].url, "http://127.0.0.1:5002");
      assert.equal(coordinator.instances[2].url, "http://127.0.0.1:5003");
    } finally {
      delete process.env.INSTANCE_1_PORT;
      delete process.env.INSTANCE_2_PORT;
      delete process.env.INSTANCE_3_PORT;
    }
  });
});

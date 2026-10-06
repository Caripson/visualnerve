import { createConnection } from "node:net";
export async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `Port ${port} already listens; choose PIPER_ACCEPTANCE_PORT. The test never uses an existing server.`,
        ),
      );
    });
    socket.once("error", (error) =>
      error.code === "ECONNREFUSED" ? resolve() : reject(error),
    );
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error("Could not check the acceptance server port."));
    });
  });
}
export async function waitForBridge(child, origin) {
  let failure;
  const errored = (error) => {
    failure = error;
  };
  const exited = (code, signal) => {
    failure = new Error(
      `Acceptance bridge exited (${code ?? signal}) before readiness.`,
    );
  };
  child.once("error", errored);
  child.once("exit", exited);
  try {
    for (let index = 0; index < 100; index++) {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Acceptance bridge stopped before readiness.");
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (failure) throw failure;
      try {
        const response = await fetch(origin + "/api/v1/health", {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          if (failure || child.exitCode !== null)
            throw (
              failure ??
              new Error("Acceptance bridge stopped before readiness.")
            );
          return;
        }
      } catch (error) {
        if (failure) throw failure;
      }
    }
    throw new Error("Acceptance bridge did not become ready.");
  } finally {
    child.removeListener("error", errored);
    child.removeListener("exit", exited);
  }
}

export async function stopBridge(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      child.removeListener("close", finish);
      resolve();
    };
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", finish);
    child.once("close", finish);
    child.kill("SIGTERM");
  });
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Docker from "dockerode";

const execFileAsync = promisify(execFile);

/** Shared dockerode client (talks to the local Docker socket). */
export const docker = new Docker();

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Run a `docker …` CLI command. */
export async function dockerCli(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync("docker", args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Run a `docker compose -f <file> …` command for a tenant stack. */
export async function composeCli(
  composeFile: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return dockerCli(["compose", "-f", composeFile, ...args], opts);
}

/** True if a container with this exact name exists (any state). */
export async function containerExists(name: string): Promise<boolean> {
  const containers = await docker.listContainers({
    all: true,
    filters: { name: [`^/${name}$`] },
  });
  return containers.length > 0;
}

/** Inspect a container's running state; returns null if it does not exist. */
export async function containerRunning(name: string): Promise<boolean | null> {
  try {
    const info = await docker.getContainer(name).inspect();
    return info.State.Running === true;
  } catch {
    return null;
  }
}

/** Run a command inside a running container and capture stdout. */
export async function dockerExec(container: string, cmd: string[]): Promise<ExecResult> {
  return dockerCli(["exec", container, ...cmd]);
}

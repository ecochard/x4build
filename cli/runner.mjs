import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { info, success, warning } from "./log.mjs";

function samePath(a, b) {
    const left = path.normalize(path.resolve(a));
    const right = path.normalize(path.resolve(b));
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}

export function findRunnableOutput(config, metafile) {
    if (config.dev.run === false)
        return null;

    let entryPoint;

    if (typeof config.dev.run === "string") {
        entryPoint = config.dev.run;

        if (!config.entryPoints.some((entry) => samePath(entry, entryPoint)))
            throw new Error(`dev.run must reference one of entryPoints: '${config.dev.run}'`);
    }
    else {
        if (config.entryPoints.length !== 1)
            throw new Error("dev.run is required when multiple entryPoints are configured");

        entryPoint = config.entryPoints[0];
    }
    for (const [output, meta] of Object.entries(metafile?.outputs ?? {})) {
        if (!meta.entryPoint)
            continue;

        const source = path.resolve(config.root, meta.entryPoint);
        if (!samePath(source, entryPoint))
            continue;

        const target = path.resolve(config.root, output);
        if (/\.(?:mjs|cjs|js)$/i.test(target))
            return target;
    }

    throw new Error(`Cannot determine output file for '${entryPoint}'`);
}

function waitForExit(child, timeout = 1500) {
    if (!child || child.exitCode !== null || child.signalCode !== null)
        return Promise.resolve(true);

    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => finish(false), timeout);
        child.once("exit", () => finish(true));
    });
}

export class NodeRunner {
    #child;
    #target;

    get target() {
        return this.#target;
    }

    async stop() {
        const child = this.#child;
        this.#child = undefined;
        this.#target = undefined;

        if (!child || child.exitCode !== null || child.signalCode !== null)
            return;

        try { child.kill(); }
        catch { return; }

        if (!await waitForExit(child)) {
            try { child.kill("SIGKILL"); }
            catch { /* process already gone */ }
            await waitForExit(child, 500);
        }
    }

    async restart(target, config) {
        if (!target)
            return;

        if (!fs.existsSync(target))
            throw new Error(`Cannot run missing output: ${target}`);

        await this.stop();

        const args = [
            ...config.dev.nodeArgs,
            target,
            ...config.dev.args,
        ];

        info("run", `${process.execPath} ${args.join(" ")}`);

        const child = spawn(process.execPath, args, {
            cwd: config.root,
            env: process.env,
            stdio: "inherit",
        });

        this.#child = child;
        this.#target = target;

        child.once("error", (error) => {
            if (this.#child === child) {
                this.#child = undefined;
                this.#target = undefined;
            }
            warning(`process: ${error.message}`);
        });

        child.once("exit", (code, signal) => {
            if (this.#child !== child)
                return;

            this.#child = undefined;
            this.#target = undefined;

            if (signal)
                success("process", `stopped (${signal})`);
            else if (code && code !== 0)
                warning(`process exited with code ${code}`);
        });
    }
}

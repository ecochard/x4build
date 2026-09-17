import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { DEFAULT_CONFIG_FILE, expandEnv, loadConfig } from "./config.mjs";
import { createBuildOptions } from "./build-options.mjs";
import { printBuildError } from "./diagnostic-plugin.mjs";
import { info, success } from "./log.mjs";

export async function build(argv = [], root = process.cwd()) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            config: { type: "string" },
            debug: { type: "boolean", default: false },
        },
        allowPositionals: true,
        strict: true,
    });

    if (positionals.length)
        throw new Error(`Unexpected argument: ${positionals[0]}`);

    const configArg = values.config ? expandEnv(values.config) : DEFAULT_CONFIG_FILE;
    const config = loadConfig(root, configArg, process.env, { explicit: values.config !== undefined });
    const mode = values.debug ? "debug" : "production";

    info("mode", mode);
    info("config", config.configFile);
    info("outdir", config.outdir);

    await fs.rm(config.outdir, { recursive: true, force: true });
    await fs.mkdir(config.outdir, { recursive: true });

    const started = performance.now();
    try {
        await esbuild.build(createBuildOptions(config, mode));
        success("built", `${Math.round(performance.now() - started)}ms`);
    }
    catch (error) {
        // esbuild diagnostics are already printed once by diagnosticsPlugin().
        // Only print non-esbuild failures here.
        if (!error?.errors?.length)
            await printBuildError(error);
        process.exitCode = 1;
    }
}

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { DEFAULT_CONFIG_FILE, expandEnv, loadConfig, resolveConfigFile } from "./config.mjs";
import { createBuildOptions } from "./build-options.mjs";
import { devPlugin } from "./dev-plugin.mjs";
import { NodeRunner } from "./runner.mjs";
import { info, success, failure } from "./log.mjs";

export async function dev(argv = [], root = process.cwd()) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            config: { type: "string" },
            "no-run": { type: "boolean", default: false },
            "no-restart": { type: "boolean", default: false },
        },
        allowPositionals: true,
        strict: true,
    });

    if (positionals.length)
        throw new Error(`Unexpected argument: ${positionals[0]}`);
    if (values["no-run"] && values["no-restart"])
        throw new Error("--no-restart has no effect with --no-run");

    const configArg = values.config ? expandEnv(values.config) : DEFAULT_CONFIG_FILE;
    const explicitConfig = values.config !== undefined;
    const watchedConfigFile = resolveConfigFile(root, configArg);

    let context;
    let configWatcher;
    let stopping = false;
    let reloadTimer;
    let reloadChain = Promise.resolve();

    const runner = new NodeRunner();

    async function createContext(config) {
        const plugin = devPlugin(config, runner, {
            run: !values["no-run"],
            restart: !values["no-restart"],
        });
        const next = await esbuild.context(
            createBuildOptions(config, "dev", [plugin]),
        );

        try {
            await next.watch({ delay: config.dev.watchDelay });
            return next;
        }
        catch (error) {
            await next.dispose();
            throw error;
        }
    }

    async function start(config) {
        context = await createContext(config);
        info("mode", "dev");
        info("config", config.configFile);
        info("outdir", config.outdir);
        if (values["no-run"])
            info("run", "disabled");
        else if (values["no-restart"])
            info("restart", "disabled");
        success("watching", `${config.entryPoints.length} entr${config.entryPoints.length === 1 ? "y" : "ies"}`);
    }

    async function reload() {
        let config;
        try {
            config = loadConfig(root, configArg, process.env, { explicit: explicitConfig });
        }
        catch (error) {
            failure(`config: ${error.message}`);
            return;
        }

        let next;
        try {
            next = await createContext(config);
        }
        catch (error) {
            failure(`config: ${error.message}`);
            return;
        }

        const previous = context;
        context = next;
        if (previous)
            await previous.dispose();

        success("config", "reloaded");
    }

    function scheduleReload() {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            reloadChain = reloadChain.then(reload, reload);
        }, 150);
    }

    const initialConfig = loadConfig(root, configArg, process.env, { explicit: explicitConfig });
    await start(initialConfig);

    const watchDir = path.dirname(watchedConfigFile);
    const watchName = path.basename(watchedConfigFile);
    configWatcher = fs.watch(watchDir, { persistent: true }, (_event, filename) => {
        if (filename === null || filename.toString() === watchName)
            scheduleReload();
    });

    async function stop() {
        if (stopping)
            return;
        stopping = true;
        clearTimeout(reloadTimer);
        configWatcher?.close();
        await reloadChain.catch(() => {});
        await context?.dispose();
        await runner.stop();
    }

    process.once("SIGINT", async () => {
        await stop();
        process.exit(0);
    });
    process.once("SIGTERM", async () => {
        await stop();
        process.exit(0);
    });

    return { stop };
}

import { copyPlugin } from "./copy.mjs";
import { diagnosticsPlugin } from "./diagnostic-plugin.mjs";

function versionId() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(now.getFullYear() - 2000)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function createBuildOptions(config, mode, extraPlugins = []) {
    const production = mode === "production";
    const dev = mode === "dev";

    const defaults = {
        absWorkingDir: config.root,
        entryPoints: config.entryPoints,
        outdir: config.outdir,
        bundle: true,
        charset: "utf8",
        keepNames: true,
        platform: "node",
        format: config.package.type === "module" ? "esm" : "cjs",
        target: "node20",
        minify: production,
        sourcemap: production ? false : "linked",
        logLevel: "silent",
        external: config.external,
        define: {
            ...config.define,
            DEBUG_MODE: production ? "false" : "true",
            VERSION_ID: versionId(),
        },
        plugins: [
            copyPlugin(config),
            diagnosticsPlugin(),
            ...extraPlugins,
        ],
    };

    const merged = {
        ...defaults,
        ...config.esbuild,
    };

    // Required by `x4build dev` to discover the runnable output reliably.
    if (dev)
        merged.metafile = true;

    // x4build owns diagnostics so errors are never printed twice.
    merged.logLevel = "silent";
    return merged;
}

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CONFIG_FILE = "x4.config.json";

const DEFAULTS = Object.freeze({
    entryPoints: ["src/main.ts"],
    outdir: "./bin",
    copy: [],
    external: [],
    define: {},
    dev: {
        run: undefined,
        args: [],
        nodeArgs: [],
        watchDelay: 100,
    },
});

export function expandEnv(value, env = process.env) {
    if (typeof value !== "string")
        return value;

    return value.replace(
        /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
        (_, braced, plain) => {
            const name = braced ?? plain;
            const result = env[name];
            if (result === undefined)
                throw new Error(`Environment variable '${name}' is not defined`);
            return result;
        },
    );
}

export function resolvePath(root, value, env = process.env) {
    const expanded = expandEnv(value, env);
    return path.isAbsolute(expanded)
        ? path.normalize(expanded)
        : path.resolve(root, expanded);
}

export function resolveConfigFile(root, configFile = DEFAULT_CONFIG_FILE, env = process.env) {
    return resolvePath(root, configFile, env);
}

function readJson(filename, label) {
    try {
        return JSON.parse(fs.readFileSync(filename, "utf8"));
    }
    catch (error) {
        throw new Error(`Cannot read ${label} '${filename}': ${error.message}`);
    }
}

function validateStringArray(value, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new Error(`${field} must be an array of strings`);
}

function validateCopy(copy) {
    if (!Array.isArray(copy))
        throw new Error("copy must be an array");

    for (const item of copy) {
        if (!item || typeof item !== "object" || typeof item.from !== "string" || typeof item.to !== "string")
            throw new Error("Each copy entry must contain string 'from' and 'to' fields");
        if (path.isAbsolute(item.to))
            throw new Error(`copy destination must be relative to outdir: '${item.to}'`);
        const normalized = path.normalize(item.to);
        if (normalized === ".." || normalized.startsWith(`..${path.sep}`))
            throw new Error(`copy destination escapes outdir: '${item.to}'`);
    }
}

export function loadConfig(root = process.cwd(), configFile = DEFAULT_CONFIG_FILE, env = process.env, { explicit = false } = {}) {
    root = path.resolve(root);

    const packageFile = path.join(root, "package.json");
    const pkg = fs.existsSync(packageFile) ? readJson(packageFile, "package.json") : {};

    const filename = resolveConfigFile(root, configFile, env);
    let cfg = {};
    if (fs.existsSync(filename))
        cfg = readJson(filename, "config");
    else if (explicit)
        throw new Error(`Config file not found: ${filename}`);

    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg))
        throw new Error("config must be an object");

    const entryPoints = cfg.entryPoints ?? DEFAULTS.entryPoints;
    if (!Array.isArray(entryPoints) || !entryPoints.length || entryPoints.some((entry) => typeof entry !== "string"))
        throw new Error("entryPoints must be a non-empty array of strings");

    const copy = cfg.copy ?? DEFAULTS.copy;
    validateCopy(copy);

    if (cfg.external !== undefined && cfg.externals !== undefined)
        throw new Error("Use either 'external' or legacy 'externals', not both");

    const external = cfg.external ?? cfg.externals ?? DEFAULTS.external;
    validateStringArray(external, "external");

    const define = cfg.define ?? DEFAULTS.define;
    if (!define || typeof define !== "object" || Array.isArray(define))
        throw new Error("define must be an object");
    if (Object.values(define).some((value) => typeof value !== "string"))
        throw new Error("define values must be strings containing esbuild define expressions");

    const outdirRaw = cfg.outdir ?? DEFAULTS.outdir;
    if (typeof outdirRaw !== "string")
        throw new Error("outdir must be a string");

    const outdir = resolvePath(root, outdirRaw, env);
    if (outdir === root)
        throw new Error("outdir cannot be the project root");
    if (outdir === path.parse(outdir).root)
        throw new Error("outdir cannot be a filesystem root");

    const devCfg = cfg.dev ?? {};
    if (!devCfg || typeof devCfg !== "object" || Array.isArray(devCfg))
        throw new Error("dev must be an object");

    const run = devCfg.run ?? DEFAULTS.dev.run;
    if (run !== undefined && run !== false && typeof run !== "string")
        throw new Error("dev.run must be a string or false");

    const args = devCfg.args ?? DEFAULTS.dev.args;
    validateStringArray(args, "dev.args");

    const nodeArgs = devCfg.nodeArgs ?? DEFAULTS.dev.nodeArgs;
    validateStringArray(nodeArgs, "dev.nodeArgs");

    const watchDelay = devCfg.watchDelay ?? DEFAULTS.dev.watchDelay;
    if (!Number.isInteger(watchDelay) || watchDelay < 0 || watchDelay > 5000)
        throw new Error("dev.watchDelay must be an integer between 0 and 5000");

    let esbuildOptions = {};
    if (cfg.esbuild !== undefined) {
        if (!cfg.esbuild || typeof cfg.esbuild !== "object" || Array.isArray(cfg.esbuild))
            throw new Error("esbuild must be an object");
        esbuildOptions = { ...cfg.esbuild };
    }

    return {
        root,
        configFile: filename,
        packageFile,
        package: pkg,
        entryPoints: entryPoints.map((entry) => resolvePath(root, entry, env)),
        outdir,
        copy: copy.map((item) => ({
            from: resolvePath(root, item.from, env),
            to: path.normalize(item.to),
        })),
        external: [...external],
        define: { ...define },
        dev: {
            run: typeof run === "string" ? resolvePath(root, run, env) : run,
            args: [...args],
            nodeArgs: [...nodeArgs],
            watchDelay,
        },
        esbuild: esbuildOptions,
    };
}

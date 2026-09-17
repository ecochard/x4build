import fs from "node:fs/promises";
import path from "node:path";

async function statOrNull(filename) {
    try { return await fs.stat(filename); }
    catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

export async function copyConfiguredFiles(config) {
    for (const entry of config.copy) {
        const stat = await statOrNull(entry.from);
        if (!stat)
            continue;

        const destination = path.resolve(config.outdir, entry.to);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(entry.from, destination, {
            recursive: stat.isDirectory(),
            force: true,
        });
    }
}

export function copyPlugin(config) {
    return {
        name: "x4build-copy",
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length === 0)
                    await copyConfiguredFiles(config);
            });
        },
    };
}

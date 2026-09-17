import { performance } from "node:perf_hooks";
import { findRunnableOutput } from "./runner.mjs";
import { success, failure } from "./log.mjs";

export function devPlugin(config, runner, { run = true, restart = true } = {}) {
    let started = 0;
    return {
        name: "x4build-dev",
        setup(build) {
            build.onStart(() => {
                started = performance.now();
            });

            build.onEnd(async (result) => {
                if (result.errors.length)
                    return;

                success("built", `${Math.round(performance.now() - started)}ms`);

                if (!run)
                    return;
                if (!restart && runner.target)
                    return;

                try {
                    const target = findRunnableOutput(config, result.metafile);
                    await runner.restart(target, config);
                }
                catch (error) {
                    failure(error instanceof Error ? error.message : String(error));
                }
            });
        },
    };
}

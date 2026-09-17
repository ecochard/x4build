import * as esbuild from "esbuild";
import { failure } from "./log.mjs";

function colors() {
    if (process.env.NO_COLOR !== undefined)
        return false;
    if (process.env.FORCE_COLOR !== undefined)
        return process.env.FORCE_COLOR !== "0";
    return !!process.stderr.isTTY;
}

async function format(messages, kind) {
    if (!messages?.length)
        return [];

    return esbuild.formatMessages(messages, {
        kind,
        color: colors(),
        terminalWidth: process.stderr.columns || 100,
    });
}

export async function printWarnings(messages) {
    for (const line of await format(messages, "warning"))
        process.stderr.write(line);
}

export async function printErrors(messages) {
    if (!messages?.length)
        return;

    failure("build failed");
    for (const line of await format(messages, "error"))
        process.stderr.write(line);
}

export async function printBuildError(error) {
    if (error?.errors?.length) {
        await printErrors(error.errors);
        if (error.warnings?.length)
            await printWarnings(error.warnings);
        return;
    }

    failure(error instanceof Error ? error.message : String(error));
}

export function diagnosticsPlugin() {
    return {
        name: "x4build-diagnostics",

        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length) {
                    await printErrors(result.errors);
                    return;
                }

                if (result.warnings.length)
                    await printWarnings(result.warnings);
            });
        },
    };
}

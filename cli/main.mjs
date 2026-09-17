import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { failure } from "./log.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const packageFile = path.join(cliDir, "..", "package.json");

function version() {
    try {
        return JSON.parse(fs.readFileSync(packageFile, "utf8")).version ?? "unknown";
    }
    catch {
        return "unknown";
    }
}

function help(currentVersion) {
    console.log(`x4build ${currentVersion}

Usage:
  x4build dev [--config <file>] [--no-restart|--no-run]
  x4build build [--config <file>] [--debug]

Commands:
  dev              Watch sources and run Node after successful builds
  build            Production build

Options:
  --config <file>  Config file (default: x4.config.json)
  --debug          Non-minified build with linked source maps
  --no-restart     Launch Node once; keep building without restarting it
  --no-run         Watch/build only; do not launch Node
  -h, --help       Show help
  -v, --version    Show version`);
}

const currentVersion = version();
const [command, ...argv] = process.argv.slice(2);

try {
    switch (command) {
        case "dev": {
            const { dev } = await import("./dev.mjs");
            await dev(argv);
            break;
        }
        case "build": {
            const { build } = await import("./build.mjs");
            await build(argv);
            break;
        }
        case undefined:
        case "help":
        case "--help":
        case "-h":
            help(currentVersion);
            break;
        case "--version":
        case "-v":
            console.log(currentVersion);
            break;
        default:
            throw new Error(`Unknown command '${command}'. Run 'x4build --help'.`);
    }
}
catch (error) {
    failure(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

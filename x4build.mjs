#!/usr/bin/env node

/**
* @file build.mjs
* @author Etienne Cochard 
* @copyright (c) 2024 R-libre ingenierie, all rights reserved.
* @version 1.5
**/

import * as fs from "node:fs"
import * as path from "node:path"
import * as url from "node:url"
import * as http from "node:http"
import * as https from "node:https"

import chalk from "chalk"
import esbuild from "esbuild"
import { WebSocketServer } from 'ws';
import Watcher from "watcher"

//import { hostname } from 'node:os'

let VERSION = "1.6"
let PORT = 3000;
let IP = "127.0.0.1";

console.log( chalk.green(`\n\n-- X4Build ${VERSION} -------------------`) );


function check_ip( argv ) {
	const re = /--ip=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:(\d+))?/

	return argv.some( arg => {
		const m = re.exec( arg );
		if( m ) {
			IP = m[1];
			PORT = parseInt(m[3]);
			return true;
		}	
	})
}

const help = process.argv.some( a => a=="--help" );
if( help ) {

	console.log( 
`build.mjs
    --release ......... release mode (default none)
	--hmr ............. include hmr code (default none)
	--watch ........... watch for source modification
	--serve ........... serve files
	--cjs ............. cjs output
	--outdir=xx ....... force output dir
    --http ............ http mode, build for web
	--https ........... https mode, build for web
    --cert=xx ......... certificate path (include filename without extension) must contain .crt & .key
` );

	process.exit( 0 );
}

const releaseMode = process.argv.some(a => a == "--release")
const hmrMode = process.argv.some(a => a == "--hmr")		// hot module replacement
const watchMode = process.argv.some(a => a == "--watch" )	// watch modifications
const serveMode = process.argv.some(a => a == "--serve")	// watch modifications
const cjsMode = process.argv.some(a => a == "--cjs")		// output mode 

check_ip( process.argv );

let outDir = process.argv.find( a => a.startsWith("--outdir=") );
if( outDir ) {
	outDir = outDir.substring(9);
}

let httpMode = process.argv.find( a => a.startsWith("--http") );
let https_options = {};

if( httpMode ) {
	httpMode = httpMode.substring(2);
}

let certDir;
if( httpMode=="https" ) {
	certDir = process.argv.find( a => a.startsWith("--cert=") );
	if( certDir ) {
		certDir = certDir.substring(7);
	}
	else {
		console.error( "you must provide --cert for https." );
		process.exit( -1 );
	}

	https_options.cert = fs.readFileSync( certDir+".crt", "utf-8" );
	https_options.key = fs.readFileSync( certDir+".key", "utf-8" );
}

function readPackage() {

	let cpath = process.cwd();

	// check here
	let pth = path.join(cpath, "package.json");
	if (fs.existsSync(pth)) {
		const raw = fs.readFileSync(pth, "utf-8");
		return JSON.parse(raw);
	}

	throw new Error("cannot find package.json");
}

const def_settings = {
	"entryPoints": ["src/main.ts"],
	"outdir": "./bin",
	"copy": [],
};

const pkg_settings = readPackage();
const settings = { ...def_settings, ...pkg_settings.x4build };

if( outDir ) {
	settings.outdir = outDir;
}

console.log( chalk.green("    release mode ..."), chalk.white(releaseMode ) );
console.log( chalk.green("    hmr ............"), chalk.white(hmrMode ) );
console.log( chalk.green("    watching ......."), chalk.white(watchMode ) );
console.log( chalk.green("    serve files ...."), chalk.white(serveMode ) );
console.log( chalk.green("    output dir ....."), chalk.white(settings.outdir ) );
console.log( chalk.green("    entry point ...."), chalk.white("[", settings.entryPoints?.join(', '), ']' ) );
console.log( chalk.green("    externals ......"), chalk.white("[", settings.external?.join(', '), ']' ) );
console.log( chalk.green("    copying ........"), chalk.white("[", settings.copy?.map( x => `${x.from} -> ${x.to}` ).join(', '), ']' ) );
console.log( chalk.green("    http mode ......"), chalk.white(httpMode ) );
console.log( chalk.green("    cert path ......"), chalk.white(certDir ) );
console.log( chalk.green("----------------------------------\n") );

const plugins = [];
	

if( httpMode ) {
	const { sassPlugin } = await import( "esbuild-sass-plugin" );
	
	let sass_plugin = sassPlugin( {
		type: "css",
		filter: /\.scss$/,
	});

	plugins.push( sass_plugin );
}

const js_hmr = ` // X4 Hot Module Replacement v1.2
{
	setTimeout( () => {
		const ws = new WebSocket( \`${httpMode=="http" ? "ws:" : "wss:"}//\${window.location.hostname}:${PORT+10}\`, "hmr" );
		ws.onmessage = ( ev ) => {
			if( ev.data=="reload-css" ) {
				const gen_id = Date.now( );
				document.querySelectorAll( "link[rel=stylesheet]").forEach( link => {
					link.href = link.href.replace(/\\?.*|$/, "?" + gen_id)
				} );
			}
			else {
				location.reload(); 
			}
		}
	}, 1000 );
}`

/** custom plugin to copy element after the build */

const post_plugin = {
	name: 'post-cmd',
	setup(build) {

		build.onEnd(result => {
			if (result.errors.length) {
				console.error(`build ended with ${result.errors.length} errors`)
			}
			else {
				settings.copy?.forEach((desc) => {
					const { from, to } = desc;

					if (fs.existsSync(from)) {
						fs.cpSync(from, path.join(settings.outdir, to), { recursive: true });
					}
				});
			}
		})
	},
}

plugins.push( post_plugin );

let buildcnt = 1;

async function build() {

	console.log(chalk.cyan(`building (${buildcnt++})...`));

	try {
		/** @type {esbuild.BuildOptions} */
		const options = {
			target: "node12",
			logLevel: "error",
			entryPoints: settings.entryPoints,
			bundle: true,
			charset: "utf8",
			outdir: settings.outdir,
			keepNames: true,
			platform: "node",
			format: cjsMode ? "cjs" : "iife",
			minify: releaseMode,
			plugins,
			assetNames: "assets/[name]-[hash]",
			jsxFactory: "x4_react.create_element",
			loader: {
				".svg": "dataurl",
				".jpg": "file",
				".png": "file",
				".woff": "file",
				".woff2": "file",
				".ts": "tsx",
				".js": "jsx",
			},
			define: {
				"DEBUG_MODE": releaseMode ? "false" : "true",
			}

		}

		if (!releaseMode) {
			options.sourcemap = "inline";
		}

		if (hmrMode) {
			options.banner = { js: js_hmr }
		}

		await esbuild.build(options);
	}
	catch (e) {
		console.error(chalk.bgRed.white("build failure, waiting for correction"));
		console.log(e.message);
	}
}

// :: WEBSOCKET SERVER FOR HRM ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

function watch( ) {
	let server;
	if( httpMode=="https" ) {
		server = https.createServer( https_options );
	}
	else if( httpMode=="http" ) {
		server = http.createServer( {} );
	}

	server.listen( PORT+10, IP, ( ) => {
		console.log( chalk.white("hmr server is running on port "+(PORT+10)) );
	} );

	const wsServer = new WebSocketServer({
		server,
	});

	// all connected clients (1)
	const clients = [];

	wsServer.on('connection', (ws) => {
		clients.push(ws);

		wsServer.on('error', (err) => {
		});

		wsServer.on('message', function message(data) {
			console.log('received: %s', data);
		});
	});

	const sendClientMessage = (msg) => {
		clients.forEach(ws => {
			ws.send(msg);
		});
	}

	// file watcher ------------------------------------------
	const selfPath = url.fileURLToPath(import.meta.url);
	const cPath = process.cwd();

	const watcher = new Watcher("./", {
		recursive: true,
		ignoreInitial: true,
		ignore: (targetPath) => {
			if (targetPath.startsWith(cPath)) {
				targetPath = path.join(".", targetPath.substring(cPath.length));
				targetPath = path.normalize(targetPath);
			}

			if (targetPath.startsWith("bin") || targetPath.startsWith("node_modules") ) {
				//console.log("skip watch", targetPath);
				return true;
			}

			return false;
		}
	});

	watcher.on('all', async (event, targetPath, targetPathNext) => {
		
		if (event == "change" || event == "add") {
			// one of our copy path ?
			if (targetPath.startsWith(cPath)) {
				let pth = "." + targetPath.substring(cPath.length);
				pth = path.normalize(pth);

				//console.log( targetPath );
				if (settings.copy?.some(desc => {
					const from = path.normalize(desc.from);
					if (pth == from || pth.startsWith(from)) {
						return true;
					}
				})) {
					await build();
					return;
				}
			}
		}
		
		if (event == "change") {
			// somebody changed this file, so leave
			if (targetPath == selfPath) {
				process.exit(0);
			}

			// depending of the extension, we send the correct type of refresh
			switch (path.extname(targetPath)) {
				case ".svg":
				case ".css":
				case ".scss": {
					await build();
					sendClientMessage("reload-css");
					break;
				}

				case ".html":
				case ".ts":
				case ".js":
				case ".jsx":
				case ".tsx": {
					await build();
					sendClientMessage("reload-js");
					break;
				}

				case ".json": {
					if (path.basename(targetPath) == 'package.json') {
						build();
					}
					break;
				}
			}
		}
	});
}

if( watchMode ) {
	// wait a little bit
	setTimeout( watch, 2000 );
}

// :: WEB SERVER ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

function serve() {

	// maps file extention to MIME types
	// full list can be found here: https://www.freeformatter.com/mime-types-list.html
	const mimeType = {
		'.ico': 'image/x-icon',
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.json': 'application/json',
		'.css': 'text/css',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.wav': 'audio/wav',
		'.mp3': 'audio/mpeg',
		'.svg': 'image/svg+xml',
		'.pdf': 'application/pdf',
		'.zip': 'application/zip',
		'.doc': 'application/msword',
		'.eot': 'application/vnd.ms-fontobject',
		'.ttf': 'application/x-font-ttf',
	};
	
	let server;
	if( httpMode=="https" ) {
		server = https.createServer( https_options );
	}
	else if( httpMode=="http" ) {
		server = http.createServer( {} );
	}


	server.on('request', (req, res) => {
		console.log(`> ${req.method} ${req.url}`);

		// parse URL
		const parsedUrl = url.parse(req.url);

		// extract URL path
		// Avoid https://en.wikipedia.org/wiki/Directory_traversal_attack
		// e.g curl --path-as-is http://localhost:9000/../fileInDanger.txt
		// by limiting the path to current directory only
		const sanitizePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
		let pathname = path.join(settings.outdir, sanitizePath);

		if( fs.existsSync(pathname) ) {
			// if is a directory, then look for index.html
			if (fs.statSync(pathname).isDirectory()) {
				pathname = path.join( pathname, 'index.html' );
			}

			// read file from file system
			fs.readFile(pathname, function (err, data) {
				if (err) {
					res.statusCode = 500;
					res.end(`Error getting the file: ${err}.`);
				} 
				else {
					// based on the URL path, extract the file extention. e.g. .js, .doc, ...
					const ext = path.parse(pathname).ext;
					// if the file is found, set Content-type and send data
					res.setHeader('Content-type', mimeType[ext] || 'text/plain');
					res.end(data);
				}
			});
		}
		else {
			// if the file is not found, return 404
			res.statusCode = 404;
			res.end(`File ${pathname} not found!`);
			return;
		}
	});

	server.listen(PORT, IP);
	console.log( chalk.white( `listening on ${httpMode}://${IP}:${PORT}`) );
}

build();

if( serveMode ) {
	serve();
}



#!/usr/bin/env node

/**
* @file build.mjs
* @author Etienne Cochard 
* @copyright (c) 2025 R-libre ingenierie, all rights reserved.
* @version 1.6.14

* npm login
**/

import * as fs from "node:fs"
import * as path from "node:path"
import * as url from "node:url"
import * as http from "node:http"
import * as https from "node:https"

import esbuild from "esbuild"
import { WebSocketServer } from 'ws';
import Watcher from "watcher"
import { styleText } from 'node:util'

//import { hostname } from 'node:os'

let VERSION = "1.6.14"

let PORT 	= Math.round( Math.random( ) * 32000 ) + 1000;
let IP 		= "127.0.0.1";


class Styler {
	green( ...x ) { return styleText( "green", x.map(x=>x+'').join(' ') ); }
	white( ...x ) { return styleText( "white", x.map(x=>x+'').join(' ') ); }
	cyan( ...x )  { return styleText( "cyan",  x.map(x=>x+'').join(' ') ); }
	red( ...x )   { return styleText( "red",  x.map(x=>x+'').join(' ') ); }
	bgRed( ...x ) { return styleText( "bgRed", x.map(x=>x+'').join(' ') ); }
};

const styler = new Styler( );


console.log( styler.green(`\n\n-- X4Build ${VERSION} -------------------`) );


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

function check_hmr_port( argv ) {
	const re =  /--hmr(=(?<port>(\d+)))?/

	for( const arg of argv ) {
		const m = re.exec( arg );
		if( m ) {
			return [ true, m.groups.port ? parseInt(m.groups.port) : PORT+1 ];
		}	
	}

	return [false,null];
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
	--css=xx .......... xx = less or scss, scss by default 
` );

	process.exit( 0 );
}

const releaseMode = process.argv.some(a => a == "--release")
const watchMode = process.argv.some(a => a == "--watch" )		// watch modifications
const serveMode = process.argv.some(a => a == "--serve")		// watch modifications
const cjsMode = process.argv.some(a => a == "--cjs")			// output mode 

const [hmrMode,hmrPort] = check_hmr_port( process.argv )		// hot module replacement

check_ip( process.argv );

let outDir = process.argv.find( a => a.startsWith("--outdir=") );
if( outDir ) {
	outDir = outDir.substring(9);
}

let cssMode = process.argv.find( a => a.startsWith("--css=") );
if( cssMode ) {
	cssMode = outDir.substring(6);
}

let httpMode = process.argv.find( a => a.startsWith("--http") );
let https_options = {};

if( httpMode ) {
	httpMode = httpMode.substring(2);
}
else {
	httpMode = "http";
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
	"externals": [],
	"define": {},
};

const pkg_settings = readPackage();
const settings = { ...def_settings, ...pkg_settings.x4build };

settings.define = {
	...settings.define,
	"DEBUG_MODE": releaseMode ? "false" : "true",
}

if( outDir ) {
	settings.outdir = outDir;
}

console.log( styler.green("    release mode ..."), styler.white( releaseMode ) );
console.log( styler.green("    hmr ............"), styler.white( `${hmrMode} -- port ${hmrPort}` ) );
console.log( styler.green("    watching ......."), styler.white( watchMode ) );
console.log( styler.green("    serve files ...."), styler.white( `${serveMode} -- url ${httpMode}://${IP}:${PORT}`) );
console.log( styler.green("    output dir ....."), styler.white( settings.outdir ) );
console.log( styler.green("    entry point ...."), styler.white("[", settings.entryPoints?.join(', ') ?? 'src/main.ts', ']' ) );
console.log( styler.green("    externals ......"), styler.white("[", settings.externals?.join(', '), ']' ) );
console.log( styler.green("    define ........."), styler.white("[", settings.define ? Object.keys(settings.define).join(', ') : '', ']' ) );
console.log( styler.green("    copying ........"), styler.white("[", settings.copy?.map( x => `${x.from} -> ${x.to}` ).join(', '), ']' ) );
console.log( styler.green("    http mode ......"), styler.white( httpMode ) );
console.log( styler.green("    cert path ......"), styler.white( certDir ?? '-no cert given-' ) );
console.log( styler.green("----------------------------------\n") );

const plugins = [];
	

if( httpMode ) {

	if( cssMode=="less" ) {
		const { lessLoader } = await import( "esbuild-plugin-less" );
		let less_plugin = lessLoader( {
			type: "css",
			filter: /\.less$/,
		});
		plugins.push( less_plugin );
	}
	else {
		if( cssMode && cssMode!="scss" ) {
			console.log( styler.red("unknown css mode: "+cssMode) );
		}

		const { sassPlugin } = await import( "esbuild-sass-plugin" );
		let sass_plugin = sassPlugin( {
			type: "css",
			filter: /\.scss$/,
		});

		plugins.push( sass_plugin );
	}
}

const js_hmr = ` // X4 Hot Module Replacement v1.2
{
	setTimeout( () => {
		const ws = new WebSocket( \`${httpMode=="http" ? "ws:" : "wss:"}//\${window.location.hostname}:${hmrPort}\`, "hmr" );
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

const pad = ( x, len ) => {
	return x.toString().padStart( len, '0' );
}

async function build() {

	console.log(styler.cyan(`building (${buildcnt++})...`));

	const now = new Date( );
	const gen_version = `${pad(now.getFullYear()-2000,2)}${pad(now.getMonth()+1,2)}${pad(now.getDate(),2)}`;

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
			external: settings.externals,
			plugins,
			assetNames: "assets/[name]-[hash]",
			loader: {
				".svg": "dataurl",
				".jpg": "file",
				".png": "file",
				".ttf": "file",
				".woff": "file",
				".woff2": "file",
			},
			define: {
				...settings.define,
				"DEBUG_MODE": releaseMode ? "false" : "true",
				"VERSION_ID": gen_version
			},
			...settings.esbuild
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
		console.error(styler.bgRed(styler.white("build failure, waiting for correction")) );
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
	

	let sendClientMessage = ( msg ) => { }

	if( httpMode && hmrMode ) {
		server.listen( hmrPort, IP, ( ) => {
			console.log( styler.white("hmr server is running on port "+hmrPort) );
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

		sendClientMessage = (msg) => {
			clients.forEach(ws => {
				ws.send(msg);
			});
		}
	}
	
	// file watcher ------------------------------------------
	const selfPath = url.fileURLToPath(import.meta.url);
	const cPath = process.cwd();
	const outDirName = path.basename( settings.outdir );

	const watcher = new Watcher("./", {
		recursive: true,
		ignoreInitial: true,
		ignore: (targetPath) => {
			if (targetPath.startsWith(cPath)) {
				targetPath = path.join(".", targetPath.substring(cPath.length));
				targetPath = path.normalize(targetPath);
			}

			if (targetPath.startsWith(outDirName) || targetPath.startsWith("node_modules") ) {
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
	console.log( styler.white( `listening on ${httpMode}://${IP}:${PORT}`) );
}

build();

if( serveMode ) {
	serve();
}



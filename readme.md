# x4build

x4build is the build system for the x4 framework

you can use this in your package.json 

```json
{
	"name": "myproject",
	"version": "1.0.0",
	"main": "main.js",
	"x4build": {
		"copy": [
			{ "src": "assets", "dst": "public" },
		],
		
		"entryPoints": ["src/main.ts"],	// custom entry points (array)
		"outdir": "./bin",
		"externals": [ "xlsx" ],
		"esbuild": {}	// or full esbuild options
	}
}
```

